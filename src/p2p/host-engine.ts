import type { GameModule } from "../game/module";
import {
	playerConfig,
	playerName,
	playersFor,
	unnamedPlayer,
} from "../players";
import {
	APPLICATION_FEATURES,
	envelopeEvent,
	type JsonObject,
	SEATS,
	type Seat,
} from "../protocol";
import { type Authority, sameAuthority } from "./authority";
import { idleMs, isIdle } from "./expiry";
import { deriveHolder } from "./keys";
import {
	HOST_LOST_MS,
	LOBBY_REFRESH_MS,
	MAX_EVENT_BYTES,
	MAX_JSON_DEPTH,
	MAX_LOG_ENTRIES,
	MAX_PENDING_PER_SEAT,
	MAX_REASON_LENGTH,
	MAX_STATE_BYTES,
	ROSTER_COALESCE_MS,
	SEAT_GRACE_MS,
} from "./limits";
import { LINK_VERSION } from "./link";
import { appendCommit, type LocalLog, seatEvent } from "./log";
import type { Clock, Send } from "./ports";
import type { TableRecord } from "./records";
import {
	type AutoplayRequest,
	type AutoplayStatus,
	CLIENT_REPORT_FEATURE,
	type ClaimSeat,
	type Command,
	type CommandResult,
	type CtlMessage,
	type Entry,
	type Hello,
	jsonBytes,
	type Lobby,
	type Release,
	type ReleaseCode,
	type Report,
	type Roster,
	type SeatCode,
	type SeatHolder,
	withinDepth,
} from "./wire";

/**
 * The host side of replication (plan §4.5, §4.6). The host binds each peer to a seat and generation (from
 * `hello` or a seat claim), orders commands in one queue, and commits each accepted command before it answers
 * or broadcasts, so a crash between the two loses nothing: the sender resends, and deduplication answers.
 */

export type HostStop =
	/** A write failed; this device should not host. */
	| "storage"
	/** The partition changed under the host: another tab took the seat. */
	| "conflict"
	/** The table expired; its replicas are deleted. */
	| "expired";

export interface HostDeps {
	readonly log: LocalLog;
	/** The authority this page hosts; the log's stored host. */
	readonly auth: Authority;
	/** This page's peer id. Its own commands arrive through `receive` from this peer. */
	readonly self: string;
	readonly module: GameModule;
	readonly send: Send;
	readonly clock: Clock;
	readonly newId: () => string;
	/** Called once, when the engine stops on its own. */
	readonly onStop: (reason: HostStop) => void;
	readonly autoplay?: (seat: Seat, enabled: boolean) => Promise<AutoplayStatus>;
	/** Called when a player's report is stored. */
	readonly onReport?: () => void;
}

/** The latest report of a seated player's page. */
export interface PlayerReport {
	readonly seat: Seat;
	readonly build: Report["build"];
	readonly detail: Report["detail"];
	/** `clock.wall()` when the host stored it. */
	readonly receivedAt: number;
}

interface Bound {
	readonly seat: Seat;
	readonly gen: number;
}

type LocalCommandResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string };

const TOO_LARGE = "the result is too large to store";

type CommitOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly code: "storage" | "not_host" | "expired" };

function seatRow(table: TableRecord, seat: Seat): SeatHolder {
	const row = table.seats.find((item) => item.seat === seat);
	if (!row) throw new Error(`no seat row for ${seat}`);
	return row;
}

function samePayload(a: JsonObject, b: JsonObject): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** A reason that fits the result message. */
function reasonText(reason: string): string {
	const text = reason.trim().slice(0, MAX_REASON_LENGTH);
	return text.length > 0 ? text : "the command was rejected";
}

export class HostEngine {
	readonly #deps: HostDeps;
	readonly #tableId: string;
	/** Holder of each peer that said hello, derived here from its client id. */
	readonly #holders = new Map<string, string>();
	readonly #features = new Map<string, readonly string[]>();
	readonly #bindings = new Map<string, Bound>();
	readonly #connected = new Set<string>();
	/** Peers that said hello without a seat; they get the lobby when seats change. */
	readonly #visitors = new Set<string>();
	/** Monotonic time of the last message from each seat's bound peer. */
	readonly #seen = new Map<Seat, number>();
	/** Bound seats that the last roster check found quiet; a change sends the roster again. */
	readonly #quiet = new Set<Seat>();
	readonly #acked = new Map<Seat, number>();
	readonly #pending = new Map<Seat, number>();
	readonly #localBots = new Set<Seat>();
	/** Bot seats whose own player asked for autoplay, so that player stays at the table. */
	readonly #autoplaySeats = new Set<Seat>();
	readonly #autoplayPending = new Set<Seat>();
	readonly #autoplayRequests = new Map<string, number>();
	readonly #reports = new Map<string, PlayerReport>();
	readonly #localResults = new Map<
		string,
		(result: LocalCommandResult) => void
	>();
	#rosterDue: number | null = null;
	#lobbyAt = 0;
	#queue: Promise<void> = Promise.resolve();
	#stopped = false;

	constructor(deps: HostDeps) {
		const table = deps.log.table;
		if (!table || !sameAuthority(table.host, deps.auth)) {
			throw new Error("the log does not name this host");
		}
		const own = seatRow(table, deps.log.seat);
		if (own.holder === null) throw new Error("the host holds no seat");
		this.#deps = deps;
		this.#tableId = deps.log.tableId;
		for (const seat of SEATS) {
			if (table.config.botSetup?.seats.includes(seat) === true)
				this.#localBots.add(seat);
		}
		const now = deps.clock.monotonic();
		// No seat times out because of a host change (rule 9).
		for (const row of table.seats) {
			if (row.holder !== null) this.#seen.set(row.seat, now);
		}
		this.#holders.set(deps.self, own.holder);
		this.#features.set(deps.self, [
			APPLICATION_FEATURES.bridgeUndo,
			APPLICATION_FEATURES.bridgeClaim,
			APPLICATION_FEATURES.bridgeClaimNone,
			APPLICATION_FEATURES.bridgeClaimAnyTurn,
			APPLICATION_FEATURES.bridgeReset,
		]);
		this.#connected.add(deps.self);
		this.#bindings.set(deps.self, { seat: own.seat, gen: own.gen });
		this.#rosterDue = now;
	}

	get stopped(): boolean {
		return this.#stopped;
	}

	/** Only the host's local controller exposes this operation. Ownership and bridge state do not change. */
	renameSeat(
		seat: Seat,
		name: string,
		gen: number,
		revision: number,
		askOnEntry: boolean,
	): Promise<boolean> {
		const run = async (): Promise<boolean> => {
			const table = this.#table();
			const normalized = playerName(name);
			if (
				this.#stopped ||
				!table ||
				!normalized ||
				table.rev >= MAX_LOG_ENTRIES ||
				seatRow(table, seat).gen !== gen ||
				playersFor(table)[seat].rev !== revision
			)
				return false;
			const id = this.#deps.newId();
			const placeholder = unnamedPlayer(normalized);
			const entry: Entry = {
				seq: table.rev + 1,
				auth: this.#deps.auth,
				prevAuth: table.lastAuth,
				id,
				seat,
				gen,
				kind: "seat",
				op: {
					type: "rename",
					by: this.#deps.log.seat,
					name: placeholder ? "player" : normalized,
					askOnEntry: placeholder || askOnEntry,
				},
				event: {
					...seatEvent(
						this.#tableId,
						table.rev + 1,
						id,
						seat,
						"rename",
						this.#deps.log.seat,
					),
					name: placeholder ? "player" : normalized,
				},
			};
			const done = await this.#commit(entry, table.state);
			if (!done.ok) return false;
			this.#broadcast(entry);
			this.#lobbies();
			return true;
		};
		const pending = this.#queue.then(run);
		this.#queue = pending.then(() => {});
		return pending;
	}

	async drain(): Promise<void> {
		await this.#queue;
		await this.#deps.log.drain();
	}

	/** Activates configured bot seats as private host-local actors. Empty seats are claimed for the bot. */
	async activateBots(seats: readonly Seat[]): Promise<boolean> {
		let table = this.#table();
		if (!table || this.#stopped) return false;
		for (const seat of seats) {
			let row = seatRow(table, seat);
			const holder = await deriveHolder(
				this.#tableId,
				`opentrick|host-bot|${seat}`,
			);
			if (row.holder === null) {
				const seq = table.rev + 1;
				const id = this.#deps.newId();
				const entry: Entry = {
					seq,
					auth: this.#deps.auth,
					prevAuth: table.lastAuth,
					id,
					seat,
					gen: row.gen + 1,
					kind: "seat",
					op: { type: "claim", holder },
					event: seatEvent(this.#tableId, seq, id, seat, "claim"),
				};
				const claimed = await this.#commit(entry, table.state);
				if (!claimed.ok) return false;
				table = this.#table();
				if (!table) return false;
				row = seatRow(table, seat);
				this.#broadcast(entry);
			}
			if (row.holder !== holder) {
				const peer = this.#localPeer(seat);
				const bound = this.#bindings.get(peer);
				if (
					!this.#localBots.has(seat) ||
					bound?.seat !== seat ||
					bound.gen !== row.gen
				)
					return false;
			}
		}
		for (const seat of seats) {
			this.#localBots.add(seat);
			if (seat === this.#deps.log.seat) continue;
			const peer = this.#localPeer(seat);
			this.#connected.add(peer);
			this.#bindings.set(peer, {
				seat,
				gen: seatRow(table, seat).gen,
			});
			this.#features.set(peer, Object.values(APPLICATION_FEATURES));
			this.#seen.set(seat, this.#deps.clock.monotonic());
		}
		this.#markRoster();
		this.#lobbies();
		return true;
	}

	/** Host-only automation. An occupied player's holder stays; an empty seat gets a deterministic bot holder. */
	/**
	 * Marks a bot seat of this host as one whose own player asked for autoplay, as before a reload of the host page.
	 * It returns false, and changes nothing, unless this host's bot plays that other player's seat.
	 */
	restoreAutoplay(seat: Seat): boolean {
		if (
			this.#stopped ||
			seat === this.#deps.log.seat ||
			!this.#localBots.has(seat)
		)
			return false;
		if (!this.#autoplaySeats.has(seat)) {
			this.#autoplaySeats.add(seat);
			this.#markRoster();
		}
		return true;
	}

	async setBotSeat(seat: Seat, enabled: boolean): Promise<boolean> {
		let table = this.#table();
		if (!table || this.#stopped) return false;
		const row = seatRow(table, seat);
		const holder = await deriveHolder(
			this.#tableId,
			`opentrick|host-bot|${seat}`,
		);
		if (enabled) {
			if (seat !== this.#deps.log.seat && row.holder === null) {
				const id = this.#deps.newId();
				const entry: Entry = {
					seq: table.rev + 1,
					auth: this.#deps.auth,
					prevAuth: table.lastAuth,
					id,
					seat,
					gen: row.gen + 1,
					kind: "seat",
					op: { type: "claim", holder },
					event: seatEvent(this.#tableId, table.rev + 1, id, seat, "claim"),
				};
				const committed = await this.#commit(entry, table.state);
				if (!committed.ok) return false;
				table = this.#table();
				if (!table) return false;
				this.#broadcast(entry);
			}
			this.#localBots.add(seat);
			if (seat !== this.#deps.log.seat) {
				const peer = this.#localPeer(seat);
				this.#connected.add(peer);
				this.#bindings.set(peer, { seat, gen: seatRow(table, seat).gen });
				this.#features.set(peer, Object.values(APPLICATION_FEATURES));
				this.#seen.set(seat, this.#deps.clock.monotonic());
			}
		} else {
			this.#localBots.delete(seat);
			this.#autoplaySeats.delete(seat);
			const peer = this.#localPeer(seat);
			this.#bindings.delete(peer);
			this.#connected.delete(peer);
			this.#features.delete(peer);
			if (seat !== this.#deps.log.seat && row.holder === holder) {
				const id = this.#deps.newId();
				const entry: Entry = {
					seq: table.rev + 1,
					auth: this.#deps.auth,
					prevAuth: table.lastAuth,
					id,
					seat,
					gen: row.gen + 1,
					kind: "seat",
					op: { type: "release", by: this.#deps.log.seat },
					event: seatEvent(
						this.#tableId,
						table.rev + 1,
						id,
						seat,
						"release",
						this.#deps.log.seat,
					),
				};
				const committed = await this.#commit(entry, table.state);
				if (!committed.ok) return false;
				this.#unbindSeat(seat, null);
				this.#broadcast(entry);
			}
		}
		this.#markRoster();
		this.#lobbies();
		return true;
	}

	/** Submits a bot decision through the same rules and ordered log used for remote commands. */
	localCommand(
		seat: Seat,
		id: string,
		payload: JsonObject,
	): Promise<LocalCommandResult> {
		const peer = this.#localPeer(seat);
		if (!this.#localBots.has(seat) || !this.#bindings.has(peer))
			return Promise.resolve({ ok: false, reason: "bot seat is not active" });
		this.#seen.set(seat, this.#deps.clock.monotonic());
		return new Promise((resolve) => {
			this.#localResults.set(this.#localResultKey(peer, id), resolve);
			this.#command(
				peer,
				{
					k: "cmd",
					id,
					gen: this.#bindings.get(peer)?.gen ?? 0,
					payload,
				},
				true,
			);
		});
	}

	join(peer: string): void {
		this.#connected.add(peer);
	}

	leave(peer: string): void {
		if (peer === this.#deps.self) return;
		this.#connected.delete(peer);
		this.#holders.delete(peer);
		this.#features.delete(peer);
		this.#autoplayRequests.delete(peer);
		this.#reports.delete(peer);
		this.#visitors.delete(peer);
		if (this.#bindings.delete(peer)) this.#markRoster();
	}

	/** Stops ordering; queued requests get `not_host`. */
	stop(): void {
		this.#stopped = true;
		for (const resolve of this.#localResults.values())
			resolve({ ok: false, reason: "host stopped" });
		this.#localResults.clear();
	}

	receive(peer: string, message: CtlMessage): void {
		this.#touch(peer);
		switch (message.k) {
			case "hello":
				this.#enqueue(() => this.#hello(peer, message));
				return;
			case "claim-seat":
				this.#enqueue(() => this.#claim(peer, message));
				return;
			case "release":
				this.#enqueue(() => this.#release(peer, message));
				return;
			case "cmd":
				this.#command(peer, message);
				return;
			case "autoplay-request":
				this.#enqueue(() => this.#autoplay(peer, message));
				return;
			case "ack":
				this.#ack(peer, message.rev);
				return;
			case "report":
				this.#report(peer, message);
				return;
			default:
				return;
		}
	}

	tick(): void {
		const now = this.#deps.clock.monotonic();
		this.#touch(this.#deps.self);
		if (this.#stopped) return;
		for (const seat of this.#localBots) this.#seen.set(seat, now);
		this.#watchQuiet(now);
		if (this.#rosterDue !== null && now >= this.#rosterDue) {
			const roster = this.roster();
			if (roster) {
				this.#rosterDue = null;
				this.#lobbyAt = now;
				this.#deps.send.ctl(null, roster);
				this.#lobbies();
			}
		}
		if (now - this.#lobbyAt >= LOBBY_REFRESH_MS) {
			this.#lobbyAt = now;
			this.#lobbies();
		}
	}

	/**
	 * Current seats with acknowledgements, and the connected peers bound to their current generation that were heard
	 * from within HOST_LOST_MS. A frozen page can keep its WebRTC link, so the link alone does not make it present.
	 */
	roster(): Roster | null {
		const table = this.#deps.log.table;
		if (!table) return null;
		const seats = table.seats.map((row) => ({
			...row,
			acked:
				row.seat === this.#deps.log.seat
					? table.rev
					: Math.min(this.#acked.get(row.seat) ?? 0, table.rev),
		}));
		const peers = [...this.#bindings]
			.filter(
				([peer, bound]) =>
					this.#connected.has(peer) &&
					this.#current(table, bound) &&
					this.#heard(bound.seat),
			)
			.map(([peer, bound]) => ({ peer, seat: bound.seat, gen: bound.gen }));
		return {
			k: "roster",
			auth: this.#deps.auth,
			seats,
			peers: peers.filter(
				({ peer }) => !peer.startsWith("opentrick-host-bot:"),
			),
			bots: [...this.#localBots],
			// The host plays from its own page, so a bot at its seat is always its own autoplay.
			autoplaySeats: [...this.#localBots].filter(
				(seat) => seat === this.#deps.log.seat || this.#autoplaySeats.has(seat),
			),
			autoplay: true,
		};
	}

	/** The latest report of each page that still holds its seat. */
	reports(): PlayerReport[] {
		const table = this.#deps.log.table;
		if (!table) return [];
		return [...this.#reports]
			.filter(([peer, report]) => {
				const bound = this.#bindings.get(peer);
				return bound?.seat === report.seat && this.#current(table, bound);
			})
			.map(([, report]) => report);
	}

	/** Asks each seated player's page for a report; returns how many pages were asked. */
	requestReports(): number {
		const table = this.#deps.log.table;
		if (!table) return 0;
		const peers = [...this.#bindings]
			.filter(
				([peer, bound]) =>
					this.#reportable(peer) && this.#current(table, bound),
			)
			.map(([peer]) => peer);
		for (const peer of peers)
			this.#deps.send.ctl(peer, { k: "report-request" });
		return peers.length;
	}

	/** Asks each connected page, seated or not, to load the latest site; returns how many pages were asked. */
	reloadPeers(): number {
		const peers = [...this.#connected].filter((peer) => this.#reportable(peer));
		for (const peer of peers) this.#deps.send.ctl(peer, { k: "reload" });
		return peers.length;
	}

	/** Another person's connected page that understands report and reload messages. */
	#reportable(peer: string): boolean {
		return (
			peer !== this.#deps.self &&
			!peer.startsWith("opentrick-host-bot:") &&
			this.#connected.has(peer) &&
			(this.#features.get(peer) ?? []).includes(CLIENT_REPORT_FEATURE)
		);
	}

	/** Keeps the report of a page that holds its seat; a report from any other page is ignored. */
	#report(peer: string, message: Report): void {
		const bound = this.#bindings.get(peer);
		const table = this.#deps.log.table;
		if (
			peer === this.#deps.self ||
			!this.#connected.has(peer) ||
			!bound ||
			!table ||
			!this.#current(table, bound)
		)
			return;
		this.#reports.set(peer, {
			seat: bound.seat,
			build: message.build,
			detail: message.detail,
			receivedAt: this.#deps.clock.wall(),
		});
		this.#deps.onReport?.();
	}

	async #autoplay(peer: string, message: AutoplayRequest): Promise<void> {
		const bound = this.#bindings.get(peer);
		const table = this.#table();
		if (
			peer === this.#deps.self ||
			!this.#connected.has(peer) ||
			!bound ||
			!table ||
			!this.#current(table, bound)
		) {
			this.#deps.send.ctl(peer, {
				k: "autoplay-result",
				req: message.req,
				status: "failed",
			});
			return;
		}
		const lastRequest = this.#autoplayRequests.get(peer) ?? 0;
		if (message.req <= lastRequest) {
			this.#deps.send.ctl(peer, {
				k: "autoplay-result",
				req: message.req,
				status: "failed",
			});
			return;
		}
		this.#autoplayRequests.set(peer, message.req);
		if (this.#autoplayPending.has(bound.seat)) {
			this.#deps.send.ctl(peer, {
				k: "autoplay-result",
				req: message.req,
				status: "failed",
			});
			return;
		}
		this.#autoplayPending.add(bound.seat);
		let status: AutoplayStatus;
		try {
			status = await (this.#deps.autoplay?.(bound.seat, message.enabled) ??
				Promise.resolve<AutoplayStatus>("unavailable"));
		} catch {
			status = "failed";
		}
		this.#autoplayPending.delete(bound.seat);
		const current = this.#table();
		const stillBound = this.#bindings.get(peer);
		const valid =
			!this.#stopped &&
			this.#connected.has(peer) &&
			stillBound?.seat === bound.seat &&
			stillBound.gen === bound.gen &&
			current !== null &&
			this.#current(current, bound);
		if (valid && status === "enabled" && this.#localBots.has(bound.seat)) {
			this.#autoplaySeats.add(bound.seat);
			this.#markRoster();
		}
		if (!valid && status === "enabled") {
			try {
				await this.#deps.autoplay?.(bound.seat, false);
			} catch {
				status = "failed";
			}
		}
		this.#deps.send.ctl(peer, {
			k: "autoplay-result",
			req: message.req,
			status: valid ? status : "failed",
		});
	}

	// -------------------------------------------------------------------------------------------------------
	// Requests

	#enqueue(work: () => Promise<void>): void {
		this.#queue = this.#queue.then(work);
	}

	async #hello(peer: string, hello: Hello): Promise<void> {
		const { send, auth } = this.#deps;
		if (this.#stopped) return;
		if (hello.b !== LINK_VERSION) {
			send.ctl(peer, { k: "welcome", status: "incompatible", auth });
			return;
		}
		const table = this.#table();
		if (!table) return;
		if (this.#isExpired(table)) {
			send.ctl(peer, { k: "welcome", status: "expired", auth });
			await this.#expire();
			return;
		}
		const holder = await deriveHolder(this.#tableId, hello.client);
		this.#holders.set(peer, holder);
		this.#features.set(peer, hello.features ?? []);
		if (hello.seat !== undefined) {
			const row = seatRow(table, hello.seat);
			const anotherActivePeer = this.#seatPeerConnected(
				table,
				hello.seat,
				peer,
			);
			if (
				row.holder === holder &&
				row.gen === hello.gen &&
				!anotherActivePeer
			) {
				this.#bind(peer, hello.seat, row.gen);
				send.ctl(peer, {
					k: "welcome",
					status: "bound",
					auth,
					seat: hello.seat,
					gen: row.gen,
				});
				const roster = this.roster();
				if (roster) send.ctl(peer, roster);
				return;
			}
			// A seat that is free, or that another browser holds offline past the grace time, makes the page a visitor
			// that claims the seat again, as after the merge of its table into this one (election rule 13). Before the
			// grace time ends, the page asks again.
			const foreign = row.holder !== holder;
			if (!foreign || this.#online(table, hello.seat)) {
				const busy = !foreign && row.gen === hello.gen && anotherActivePeer;
				send.ctl(peer, {
					k: "welcome",
					status: "superseded",
					auth,
					...(busy ? { busy: true } : {}),
				});
				return;
			}
			if (row.holder !== null && !this.#gracePassed(table, hello.seat)) {
				send.ctl(peer, {
					k: "welcome",
					status: "superseded",
					auth,
					busy: true,
				});
				return;
			}
		}
		if (this.#bindings.delete(peer)) this.#markRoster();
		this.#visitors.add(peer);
		send.ctl(peer, { k: "welcome", status: "unseated", auth });
		send.ctl(peer, this.#lobby(table, peer));
	}

	async #claim(peer: string, claim: ClaimSeat): Promise<void> {
		const reply = (code: SeatCode): void =>
			this.#deps.send.ctl(peer, {
				k: "seat-result",
				req: claim.req,
				ok: false,
				code,
			});
		if (this.#stopped) return reply("not_host");
		const table = this.#table();
		const holder = this.#holders.get(peer);
		if (!table) return reply("not_host");
		if (holder === undefined) return reply("invalid");
		if (this.#isExpired(table)) {
			reply("expired");
			return this.#expire();
		}
		const bound = this.#bindings.get(peer);
		if (bound) {
			if (bound.seat !== claim.seat || !this.#current(table, bound))
				return reply("invalid");
			this.#deps.send.ctl(peer, {
				k: "seat-result",
				req: claim.req,
				ok: true,
				seat: bound.seat,
				gen: bound.gen,
			});
			return;
		}
		if (!this.#available(table, claim.seat, holder)) return reply("taken");
		const row = seatRow(table, claim.seat);
		const profile = playersFor(table)[claim.seat];
		if (
			(claim.gen !== undefined && claim.gen !== row.gen) ||
			(profile.askOnEntry && claim.gen !== row.gen) ||
			(profile.rev > 0 && claim.nameRevision !== profile.rev) ||
			(claim.nameRevision !== undefined && claim.nameRevision !== profile.rev)
		)
			return reply("stale");
		const name = playerName(claim.name);
		if (profile.askOnEntry && (!name || unnamedPlayer(name)))
			return reply("name_required");
		if (table.rev >= MAX_LOG_ENTRIES) return reply("invalid");
		const id = this.#deps.newId();
		const seq = table.rev + 1;
		const entry: Entry = {
			seq,
			auth: this.#deps.auth,
			prevAuth: table.lastAuth,
			id,
			seat: claim.seat,
			gen: row.gen + 1,
			kind: "seat",
			op: {
				type: "claim",
				holder,
				...(profile.askOnEntry && name ? { name } : {}),
			},
			event: seatEvent(this.#tableId, seq, id, claim.seat, "claim"),
		};
		const done = await this.#commit(entry, table.state);
		if (!done.ok) {
			if (done.code === "expired") return reply("expired");
			return reply(done.code);
		}
		this.#bind(peer, claim.seat, entry.gen);
		this.#deps.send.ctl(peer, {
			k: "seat-result",
			req: claim.req,
			ok: true,
			seat: claim.seat,
			gen: entry.gen,
		});
		// As after a hello bind: the claimer gets the bindings before its sync reply, so before its call inbox opens.
		// The others get them after the coalesce.
		const roster = this.roster();
		if (roster) this.#deps.send.ctl(peer, roster);
		this.#broadcast(entry);
		this.#lobbies();
	}

	async #release(peer: string, release: Release): Promise<void> {
		const reply = (code: ReleaseCode): void =>
			this.#deps.send.ctl(peer, {
				k: "release-result",
				req: release.req,
				ok: false,
				code,
			});
		if (this.#stopped) return reply("not_host");
		const table = this.#table();
		if (!table) return reply("not_host");
		const bound = this.#bindings.get(peer);
		if (!bound || !this.#current(table, bound)) return reply("unseated");
		if (this.#isExpired(table)) return this.#expire();
		const row = seatRow(table, release.seat);
		if (row.holder === null) return reply("invalid");
		if (this.#online(table, release.seat)) return reply("online");
		const id = this.#deps.newId();
		const seq = table.rev + 1;
		const entry: Entry = {
			seq,
			auth: this.#deps.auth,
			prevAuth: table.lastAuth,
			id,
			seat: release.seat,
			gen: row.gen + 1,
			kind: "seat",
			op: { type: "release", by: bound.seat },
			event: seatEvent(
				this.#tableId,
				seq,
				id,
				release.seat,
				"release",
				bound.seat,
			),
		};
		const done = await this.#commit(entry, table.state);
		if (!done.ok) {
			if (done.code === "expired") return;
			return reply(done.code);
		}
		this.#unbindSeat(release.seat, null);
		this.#deps.send.ctl(peer, {
			k: "release-result",
			req: release.req,
			ok: true,
		});
		this.#broadcast(entry);
		this.#lobbies();
	}

	/** The pending count is checked on arrival; everything else in order, at the head of the queue. */
	#command(peer: string, command: Command, fromLocalBot = false): void {
		const bound = this.#bindings.get(peer);
		const pending = bound ? (this.#pending.get(bound.seat) ?? 0) : 0;
		if (!bound || pending >= MAX_PENDING_PER_SEAT) {
			this.#result(peer, command.id, "busy");
			return;
		}
		this.#pending.set(bound.seat, pending + 1);
		this.#enqueue(async () => {
			try {
				await this.#order(peer, command, fromLocalBot);
			} finally {
				this.#pending.set(bound.seat, (this.#pending.get(bound.seat) ?? 1) - 1);
			}
		});
	}

	async #order(
		peer: string,
		command: Command,
		fromLocalBot: boolean,
	): Promise<void> {
		const { id } = command;
		if (this.#stopped) return this.#result(peer, id, "not_host");
		const table = this.#table();
		if (!table) return this.#result(peer, id, "not_host");
		// 1. The seat and generation come from the binding, never from the message.
		const bound = this.#bindings.get(peer);
		if (!bound) return this.#result(peer, id, "busy");
		if (bound.gen !== command.gen || !this.#current(table, bound))
			return this.#result(peer, id, "superseded");
		if (
			this.#localBots.has(bound.seat) &&
			bound.seat !== this.#deps.log.seat &&
			!fromLocalBot
		)
			return this.#result(
				peer,
				id,
				"rejected",
				"This seat is controlled by the host bot.",
			);
		// 2. Expiry.
		if (this.#isExpired(table)) {
			this.#result(peer, id, "expired");
			return this.#expire();
		}
		// 3. Deduplication: the stored result for the same command, `invalid` for another one with this id.
		const stored = this.#deps.log.seqOf(id);
		if (stored !== undefined) {
			const entry = this.#deps.log.entry(stored);
			const same =
				entry?.kind === "cmd" &&
				entry.seat === bound.seat &&
				samePayload(entry.payload, command.payload);
			return same
				? this.#accepted(peer, id, stored)
				: this.#result(peer, id, "invalid");
		}
		if (table.rev >= MAX_LOG_ENTRIES) return this.#result(peer, id, "full");
		if (command.payload.type === "deal" && bound.seat !== this.#deps.log.seat)
			return this.#result(
				peer,
				id,
				"rejected",
				"only the host can deal boards",
			);
		// 4. The game rules, then the envelope and the size limits.
		const seq = table.rev + 1;
		const holder = seatRow(table, bound.seat).holder;
		if (holder === null) return this.#result(peer, id, "superseded");
		const applied = this.#deps.module.apply(
			table.state,
			{
				roomId: this.#tableId,
				config: playerConfig(table),
				seat: bound.seat,
				holder,
				commandId: id,
				seq,
				present: SEATS.filter(
					(seat) => seat === this.#deps.log.seat || this.#online(table, seat),
				),
				features: new Map(
					[...this.#bindings]
						.filter(
							([boundPeer, bound]) =>
								this.#connected.has(boundPeer) && this.#current(table, bound),
						)
						.map(([boundPeer, bound]) => [
							bound.seat,
							this.#features.get(boundPeer) ?? [],
						]),
				),
			},
			command.payload,
		);
		if (!applied.ok) {
			const status = applied.waiting ? "waiting" : "rejected";
			return this.#result(peer, id, status, reasonText(applied.reason));
		}
		const event = envelopeEvent(
			{ roomId: this.#tableId, seq, commandId: id, fromSeat: bound.seat },
			applied.event,
		);
		const fits =
			withinDepth(event, MAX_JSON_DEPTH) &&
			withinDepth(applied.state, MAX_JSON_DEPTH) &&
			jsonBytes(event) <= MAX_EVENT_BYTES &&
			jsonBytes(applied.state) <= MAX_STATE_BYTES;
		if (!fits) return this.#result(peer, id, "rejected", TOO_LARGE);
		const entry: Entry = {
			seq,
			auth: this.#deps.auth,
			prevAuth: table.lastAuth,
			id,
			seat: bound.seat,
			gen: bound.gen,
			kind: "cmd",
			payload: command.payload,
			event,
		};
		// 5. One transaction; only then the result and the entry.
		const done = await this.#commit(entry, applied.state);
		if (!done.ok) return this.#result(peer, id, done.code);
		this.#accepted(peer, id, seq);
		this.#broadcast(entry);
	}

	#ack(peer: string, rev: number): void {
		const table = this.#deps.log.table;
		const bound = this.#bindings.get(peer);
		if (!table || !bound || !this.#current(table, bound)) return;
		const acked = Math.min(rev, table.rev);
		if (acked > (this.#acked.get(bound.seat) ?? 0)) {
			this.#acked.set(bound.seat, acked);
			this.#markRoster();
		}
	}

	// -------------------------------------------------------------------------------------------------------
	// Helpers

	#table(): TableRecord | null {
		const table = this.#deps.log.table;
		if (table && !sameAuthority(table.host, this.#deps.auth)) {
			this.#halt("conflict");
			return null;
		}
		return table;
	}

	async #commit(entry: Entry, state: JsonObject): Promise<CommitOutcome> {
		const { log, auth, clock } = this.#deps;
		const now = clock.wall();
		const written = await log.write((table) =>
			table && table.rev === entry.seq - 1 && sameAuthority(table.host, auth)
				? appendCommit(table, [entry], state, now)
				: null,
		);
		if (written.ok && written.value) return { ok: true };
		if (!written.ok && written.code === "expired") {
			this.#halt("expired");
			return { ok: false, code: "expired" };
		}
		if (!written.ok && written.code === "storage") {
			this.#halt("storage");
			return { ok: false, code: "storage" };
		}
		this.#halt("conflict");
		return { ok: false, code: "not_host" };
	}

	#halt(reason: HostStop): void {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#deps.onStop(reason);
	}

	async #expire(): Promise<void> {
		if (this.#stopped) return;
		this.#deps.send.ctl(null, { k: "gone", reason: "expired" });
		await this.#deps.log.expire(this.#deps.clock.wall());
		this.#halt("expired");
	}

	#isExpired(table: TableRecord): boolean {
		return isIdle(table.lastActivityAt, this.#deps.clock.wall());
	}

	#result(
		peer: string,
		id: string,
		status: Exclude<CommandResult["status"], "accepted">,
		reason?: string,
	): void {
		const key = this.#localResultKey(peer, id);
		const local = this.#localResults.get(key);
		if (local) {
			this.#localResults.delete(key);
			local({ ok: false, reason: reason ?? status });
			return;
		}
		this.#deps.send.ctl(peer, {
			k: "result",
			id,
			status,
			...(reason === undefined ? {} : { reason }),
		});
	}

	#accepted(peer: string, id: string, seq: number): void {
		const key = this.#localResultKey(peer, id);
		const local = this.#localResults.get(key);
		if (local) {
			this.#localResults.delete(key);
			local({ ok: true });
			return;
		}
		this.#deps.send.ctl(peer, { k: "result", id, status: "accepted", seq });
	}

	#localPeer(seat: Seat): string {
		return `opentrick-host-bot:${seat}`;
	}

	#localResultKey(peer: string, id: string): string {
		return `${peer}\u0000${id}`;
	}

	#broadcast(entry: Entry): void {
		const table = this.#deps.log.table;
		if (!table) return;
		this.#deps.send.log(null, { k: "entry", e: entry, state: table.state });
		this.#markRoster();
	}

	#touch(peer: string): void {
		const bound = this.#bindings.get(peer);
		const table = this.#deps.log.table;
		if (bound && table && this.#current(table, bound)) {
			this.#seen.set(bound.seat, this.#deps.clock.monotonic());
		}
	}

	#current(table: TableRecord, bound: Bound): boolean {
		const row = seatRow(table, bound.seat);
		return row.holder !== null && row.gen === bound.gen;
	}

	/** Binds `peer`; another peer bound to the seat is superseded. */
	#bind(peer: string, seat: Seat, gen: number): void {
		const botPeer = this.#localBots.has(seat)
			? this.#localPeer(seat)
			: undefined;
		for (const [other, bound] of this.#bindings) {
			if (bound.seat !== seat || other === peer || other === botPeer) continue;
			this.#bindings.delete(other);
			this.#deps.send.ctl(other, {
				k: "welcome",
				status: "superseded",
				auth: this.#deps.auth,
			});
		}
		this.#bindings.set(peer, { seat, gen });
		this.#visitors.delete(peer);
		if (botPeer !== undefined && this.#bindings.has(botPeer)) {
			this.#bindings.set(botPeer, { seat, gen });
			this.#connected.add(botPeer);
			this.#features.set(botPeer, Object.values(APPLICATION_FEATURES));
		}
		this.#seen.set(seat, this.#deps.clock.monotonic());
		this.#markRoster();
		if (this.#reportable(peer))
			this.#deps.send.ctl(peer, { k: "report-request" });
	}

	#unbindSeat(seat: Seat, except: string | null): void {
		for (const [other, bound] of this.#bindings) {
			if (bound.seat !== seat || other === except) continue;
			this.#bindings.delete(other);
			this.#deps.send.ctl(other, {
				k: "welcome",
				status: "superseded",
				auth: this.#deps.auth,
			});
		}
		this.#markRoster();
	}

	/**
	 * The seat's bound peer sent a message within HOST_LOST_MS. The host's seat and a bot of this host are always heard:
	 * the browser can run the timers of a hidden tab only once a minute, so the tick does not keep their time fresh.
	 */
	#heard(seat: Seat, now = this.#deps.clock.monotonic()): boolean {
		if (seat === this.#deps.log.seat) return true;
		if (this.#localBots.has(seat) && this.#bindings.has(this.#localPeer(seat)))
			return true;
		const seen = this.#seen.get(seat);
		return seen !== undefined && now - seen < HOST_LOST_MS;
	}

	/** Marks the roster when a bound seat goes quiet or is heard again, so that every page sees the change. */
	#watchQuiet(now: number): void {
		for (const bound of this.#bindings.values()) {
			const quiet = !this.#heard(bound.seat, now);
			if (quiet === this.#quiet.has(bound.seat)) continue;
			if (quiet) this.#quiet.add(bound.seat);
			else this.#quiet.delete(bound.seat);
			this.#markRoster();
		}
	}

	/** A bound peer of the seat is connected and was heard from within HOST_LOST_MS. */
	#online(table: TableRecord, seat: Seat): boolean {
		if (!this.#heard(seat)) return false;
		return [...this.#bindings].some(
			([peer, bound]) =>
				bound.seat === seat &&
				this.#connected.has(peer) &&
				this.#current(table, bound),
		);
	}

	/**
	 * The seat's holder is offline and has been unseen for SEAT_GRACE_MS. A holder that stays connected but goes
	 * silent is offline after HOST_LOST_MS, which is longer, so its seat frees then.
	 */
	#gracePassed(table: TableRecord, seat: Seat): boolean {
		const seen = this.#seen.get(seat);
		return (
			!this.#online(table, seat) &&
			(seen === undefined ||
				this.#deps.clock.monotonic() - seen >= SEAT_GRACE_MS)
		);
	}

	/** A connected peer other than `except` is bound to the seat's current generation. */
	/** A connected peer other than `except` plays `seat`; this host's own bot does not count, as it never blocks the seat's player. */
	#seatPeerConnected(table: TableRecord, seat: Seat, except?: string): boolean {
		return [...this.#bindings].some(
			([boundPeer, bound]) =>
				boundPeer !== except &&
				boundPeer !== this.#localPeer(seat) &&
				bound.seat === seat &&
				this.#connected.has(boundPeer) &&
				this.#current(table, bound),
		);
	}

	/**
	 * Free; held by the asking holder with no connected peer on the seat, so a reopened page gets its seat back at
	 * once; or held by an offline holder past the grace period (plan §4.6). A seat of this host's bots is never free for
	 * another holder, also before the bot starts.
	 */
	#available(table: TableRecord, seat: Seat, holder: string): boolean {
		const row = seatRow(table, seat);
		if (this.#localBots.has(seat) && row.holder !== holder) return false;
		return (
			row.holder === null ||
			(row.holder === holder && !this.#seatPeerConnected(table, seat)) ||
			this.#gracePassed(table, seat)
		);
	}

	#lobby(table: TableRecord, peer: string): Lobby {
		const holder = this.#holders.get(peer) ?? null;
		return {
			k: "lobby",
			auth: this.#deps.auth,
			config: playerConfig(table),
			idleMs: idleMs(table.lastActivityAt, this.#deps.clock.wall()),
			seats: SEATS.map((seat) => {
				const row = seatRow(table, seat);
				return {
					seat,
					gen: row.gen,
					nameRevision: playersFor(table)[seat].rev,
					needsName: playersFor(table)[seat].askOnEntry,
					available: holder !== null && this.#available(table, seat, holder),
					online: this.#online(table, seat),
					mine: holder !== null && row.holder === holder,
					...(seat === this.#deps.log.seat
						? { host: true as const }
						: this.#localBots.has(seat)
							? { bot: true as const }
							: {}),
				};
			}),
		};
	}

	#lobbies(): void {
		const table = this.#deps.log.table;
		if (!table) return;
		for (const peer of this.#visitors) {
			if (this.#connected.has(peer))
				this.#deps.send.ctl(peer, this.#lobby(table, peer));
		}
	}

	#markRoster(): void {
		this.#rosterDue ??= this.#deps.clock.monotonic() + ROSTER_COALESCE_MS;
	}
}
