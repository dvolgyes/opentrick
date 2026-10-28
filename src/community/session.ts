import { isHolder } from "../p2p/keys";
import { isTableKey } from "../p2p/link";
import {
	isObject,
	isPlayerName,
	isSeat,
	type LocalBidder,
	parseBotSetup,
	parseRoomConfig,
	type RoomConfig,
	SEATS,
	type Seat,
} from "../protocol";
import {
	Directory,
	type ListedGroup,
	OFFER_TTL_MS,
	REFRESH_MS,
} from "./directory";
import {
	type Group,
	MAX_WAIT_MS,
	type Merge,
	type OpenSeats,
	openSeats,
	permits,
	placements,
	proposeMerge,
	sameGroup,
	validId,
	validOpen,
} from "./formation";
import { parseGroup, parseMerge, TransferJournal } from "./journal";
import {
	parseReplacementOffer,
	REPLACEMENT_OFFER_TTL_MS,
	type ReplacementOffer,
} from "./replacement";
import {
	type CommunityChannel,
	DISCOVERY_ROOM,
	type OpenCommunity,
} from "./transport";

export interface GameStart {
	readonly id: string;
	readonly group: Group;
	readonly config: RoomConfig;
}

export interface CommunitySaved {
	/** Legacy games retain their browser identity; new searches isolate each participant. */
	readonly identityScope?: "member";
	readonly bidder?: LocalBidder;
	readonly self: string;
	readonly name: string;
	readonly key: string;
	readonly owner: string;
	readonly expected: readonly Seat[];
	readonly group?: Group;
	readonly ready: boolean;
	readonly allowBots: boolean;
	readonly waitMs: number;
	readonly waitedMs: number;
	readonly start?: GameStart;
	readonly playing?: boolean;
	readonly open?: OpenSeats;
	readonly preferredSeat?: Seat;
	readonly names?: Readonly<Partial<Record<Seat, string>>>;
}

interface Presence {
	readonly bidder: LocalBidder;
	readonly receivedAt: number;
	readonly id: string;
	readonly name: string;
	readonly holder: string;
	readonly ready: boolean;
	readonly allowBots: boolean;
	readonly waitMs: number;
	readonly waitedMs: number;
	readonly groupId?: string;
	readonly revision?: number;
	readonly preferredSeat?: Seat;
}

interface Pending {
	readonly merge: Merge;
	readonly key: string;
	readonly peers: ReadonlyMap<string, string>;
	readonly accepts: Set<string>;
	readonly votes: Set<string>;
	readonly since: number;
}

export interface SessionDeps {
	readonly store: Pick<Storage, "getItem" | "setItem">;
	readonly open: OpenCommunity;
	readonly now: () => number;
	readonly id: () => string;
	readonly random: (length: number) => number;
	readonly identity: (
		key: string,
	) => Promise<{ readonly tableId: string; readonly holder: string }>;
	readonly change: () => void;
	readonly play: (key: string, start: GameStart, self: string) => Promise<void>;
}

const prefix = "opentrick.community.room.";
const TIMEOUT_MS = 25_000;

export function parseStart(value: unknown): GameStart | undefined {
	if (!isObject(value) || !validId(value.id)) return undefined;
	const group = parseGroup(value.group);
	const config = parseRoomConfig(value.config);
	if (
		!group ||
		!config?.community ||
		group.members.some((member) => config.names[member.seat] !== member.name) ||
		(config.community.recruitment !== undefined &&
			group.members.some(
				(member) =>
					config.community?.recruitment?.[member.seat] !==
					(member.recruitment ?? "online"),
			)) ||
		SEATS.some(
			(seat) =>
				Boolean(config.community?.holders[seat]) !==
				group.members.some((member) => member.seat === seat),
		)
	)
		return undefined;
	return { id: value.id, group, config };
}

function parsePresence(value: unknown, now: number): Presence | undefined {
	if (
		!isObject(value) ||
		!validId(value.id) ||
		!isPlayerName(value.name) ||
		!isHolder(value.holder) ||
		(value.bidder !== undefined &&
			!parseBotSetup({ seats: [], bidder: value.bidder })) ||
		typeof value.ready !== "boolean" ||
		typeof value.allowBots !== "boolean" ||
		typeof value.waitMs !== "number" ||
		!Number.isFinite(value.waitMs) ||
		value.waitMs < 0 ||
		value.waitMs > MAX_WAIT_MS ||
		typeof value.waitedMs !== "number" ||
		!Number.isFinite(value.waitedMs) ||
		value.waitedMs < 0 ||
		value.waitedMs > MAX_WAIT_MS
	)
		return undefined;
	return {
		receivedAt: now,
		bidder: parseBotSetup({ seats: [], bidder: value.bidder })?.bidder ?? "sl",
		...(isSeat(value.preferredSeat)
			? { preferredSeat: value.preferredSeat }
			: {}),
		id: value.id,
		name: value.name,
		holder: value.holder,
		ready: value.ready,
		allowBots: value.allowBots,
		waitMs: value.waitMs,
		waitedMs: value.waitedMs,
		...(validId(value.groupId) && Number.isSafeInteger(value.revision)
			? { groupId: value.groupId, revision: Number(value.revision) }
			: {}),
	};
}

export function readCommunity(
	store: SessionDeps["store"],
	key: string,
	member?: string,
): CommunitySaved | undefined {
	const text =
		(member ? store.getItem(`${prefix}${key}.${member}`) : null) ??
		store.getItem(prefix + key);
	if (!text || text.length > 32_768) return undefined;
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
	if (
		!isObject(raw) ||
		!validId(raw.self) ||
		(member !== undefined && raw.self !== member) ||
		(raw.identityScope !== undefined && raw.identityScope !== "member") ||
		!isPlayerName(raw.name) ||
		!isTableKey(raw.key) ||
		!validId(raw.owner) ||
		!Array.isArray(raw.expected) ||
		raw.expected.length < 1 ||
		raw.expected.length > 4 ||
		!raw.expected.every(isSeat) ||
		new Set(raw.expected).size !== raw.expected.length ||
		typeof raw.ready !== "boolean" ||
		typeof raw.allowBots !== "boolean" ||
		typeof raw.waitMs !== "number" ||
		!Number.isFinite(raw.waitMs) ||
		raw.waitMs < 0 ||
		raw.waitMs > MAX_WAIT_MS ||
		typeof raw.waitedMs !== "number" ||
		!Number.isFinite(raw.waitedMs) ||
		raw.waitedMs < 0 ||
		raw.waitedMs > MAX_WAIT_MS
	)
		return undefined;
	const group = raw.group === undefined ? undefined : parseGroup(raw.group);
	const start = raw.start === undefined ? undefined : parseStart(raw.start);
	if (
		(raw.group !== undefined && !group) ||
		(raw.start !== undefined && !start) ||
		(raw.playing === true && !start) ||
		(raw.bidder !== undefined &&
			!parseBotSetup({ seats: [], bidder: raw.bidder })) ||
		(raw.open !== undefined && !validOpen(raw.open)) ||
		(raw.preferredSeat !== undefined && !isSeat(raw.preferredSeat)) ||
		(raw.names !== undefined &&
			(!isObject(raw.names) ||
				Object.entries(raw.names).some(
					([seat, name]) => !isSeat(seat) || !isPlayerName(name),
				)))
	)
		return undefined;
	return {
		self: raw.self,
		...(raw.identityScope === "member"
			? { identityScope: "member" as const }
			: {}),
		name: raw.name,
		key: raw.key,
		owner: raw.owner,
		expected: raw.expected,
		ready: raw.ready,
		allowBots: raw.allowBots,
		waitMs: raw.waitMs,
		waitedMs: raw.waitedMs,
		...(group ? { group } : {}),
		...(start ? { start } : {}),
		...(raw.playing === true ? { playing: true } : {}),
		bidder: parseBotSetup({ seats: [], bidder: raw.bidder })?.bidder ?? "sl",
		...(validOpen(raw.open) ? { open: raw.open } : {}),
		...(isSeat(raw.preferredSeat) ? { preferredSeat: raw.preferredSeat } : {}),
		...(isObject(raw.names)
			? { names: raw.names as Partial<Record<Seat, string>> }
			: {}),
	};
}

/** One browser's formation protocol. No bridge actions or lobby timers are required once play starts. */
export class CommunitySession {
	readonly #deps: SessionDeps;
	readonly #journal: TransferJournal;
	readonly #directory = new Directory();
	readonly #presence = new Map<string, Presence>();
	readonly #targetPresence = new Map<string, Presence>();
	readonly #startVotes = new Set<string>();
	readonly #replacementOffers = new Map<string, ReplacementOffer>();
	#saved: CommunitySaved;
	#room: CommunityChannel | undefined;
	#lobby: CommunityChannel | undefined;
	#target: CommunityChannel | undefined;
	#pending: Pending | undefined;
	#holder = "";
	#targetHolder = "";
	#sequence = 0;
	#lastTick: number;
	#lastRefresh = -Infinity;
	#lastSearch = -Infinity;
	#stopped = false;
	#playing = false;
	#problem: string | undefined;
	#busyOpening = false;

	constructor(deps: SessionDeps, saved: CommunitySaved) {
		this.#deps = deps;
		this.#saved = saved;
		this.#journal = new TransferJournal(deps.store, saved.self);
		this.#lastTick = deps.now();
		if (saved.start) this.#startVotes.add(saved.self);
	}

	get saved(): CommunitySaved {
		return this.#saved;
	}
	get problem(): string | undefined {
		return this.#problem;
	}
	get proposal(): Merge | undefined {
		return this.#pending?.merge;
	}
	get prepared(): boolean {
		return this.#journal.record?.phase === "prepared";
	}
	get accepted(): boolean {
		return this.#pending?.accepts.has(this.#saved.self) ?? false;
	}
	get waitingGroups(): readonly ListedGroup[] {
		return this.#directory
			.groups(this.#deps.now())
			.filter((item) => item.group.id !== this.#saved.group?.id);
	}
	get replacementOffers(): readonly ReplacementOffer[] {
		return [...this.#replacementOffers.values()];
	}
	get searching(): boolean {
		return this.#completeParty() && !this.#pending && !this.#saved.start;
	}

	async start(): Promise<void> {
		if (!this.#journal.valid)
			return this.#fail("Saved matchmaking data could not be read.");
		const record = this.#journal.record;
		if (
			record?.phase === "committed" &&
			record.destinationKey &&
			this.#saved.group &&
			(sameGroup(this.#saved.group, record.merge.source) ||
				sameGroup(this.#saved.group, record.merge.destination))
		) {
			this.#saved = {
				...this.#saved,
				key: record.destinationKey,
				group: record.merge.result,
				owner: record.merge.result.host,
				expected: record.merge.result.members.map((member) => member.seat),
			};
		}
		const identity = await this.#deps.identity(this.#saved.key);
		if (this.#stopped) return;
		this.#holder = identity.holder;
		if (!this.#saved.group && this.#saved.owner === this.#saved.self) {
			const seat = this.#saved.expected[0];
			if (!seat) return this.#fail("The party has no seats.");
			this.#saved = {
				...this.#saved,
				group: {
					id: identity.tableId,
					revision: 0,
					host: this.#saved.self,
					members: [
						{
							id: this.#saved.self,
							name: this.#saved.name,
							seat,
							recruitment: "online",
						},
					],
					...(this.#saved.open === undefined ? {} : { open: this.#saved.open }),
				},
			};
		}
		if (!this.#save()) return;
		if (this.#saved.playing && this.#saved.start) {
			this.#room = this.#openRoom(this.#saved.key, false);
			this.#startVotes.add(this.#saved.self);
			this.#play(this.#saved.start);
			this.#refresh();
			return;
		}
		this.#room = this.#openRoom(this.#saved.key, false);
		if (record?.phase === "prepared" && record.destinationKey) {
			this.#pending = {
				merge: record.merge,
				key: record.destinationKey,
				peers: new Map(),
				accepts: new Set([
					record.merge.source.host,
					record.merge.destination.host,
				]),
				votes: new Set([this.#saved.self]),
				since: this.#deps.now(),
			};
			await this.#openTarget();
		}
		this.tick();
	}

	setPreferences(ready: boolean, allowBots: boolean, waitMs: number): void {
		if (
			this.#pending ||
			this.#saved.start ||
			!Number.isFinite(waitMs) ||
			waitMs < 0 ||
			waitMs > MAX_WAIT_MS
		)
			return;
		this.#saved = { ...this.#saved, ready, allowBots, waitMs };
		if (this.#save()) this.#refresh();
	}

	accept(): void {
		const pending = this.#pending;
		if (
			!pending ||
			![pending.merge.source.host, pending.merge.destination.host].includes(
				this.#saved.self,
			)
		)
			return;
		pending.accepts.add(this.#saved.self);
		this.#sendPublic(
			{ k: "accept", id: pending.merge.id, member: this.#saved.self },
			[...pending.peers.values()],
		);
		void this.#openTarget();
		this.#deps.change();
	}

	decline(): void {
		const pending = this.#pending;
		const group = this.#saved.group;
		if (!pending || !group || !this.#journal.decline(pending.merge, group))
			return;
		const message = {
			k: "decline",
			id: pending.merge.id,
			member: this.#saved.self,
		};
		this.#sendPublic(message, [...pending.peers.values()]);
		this.#target?.send(message);
		this.#cancelPending();
	}

	tick(): void {
		if (this.#stopped || this.#problem) return;
		const now = this.#deps.now();
		// Opening the bridge screen is not admission. Keep the agreed start alive until play() confirms the mesh.
		if (this.#playing) {
			if (now - this.#lastRefresh >= REFRESH_MS) {
				this.#lastRefresh = now;
				this.#refresh();
			}
			return;
		}
		for (const people of [this.#presence, this.#targetPresence])
			for (const [peer, row] of people)
				if (now - row.receivedAt >= OFFER_TTL_MS) people.delete(peer);
		for (const [peer, offer] of this.#replacementOffers)
			if (now - offer.receivedAt >= REPLACEMENT_OFFER_TTL_MS)
				this.#replacementOffers.delete(peer);
		const elapsed = Math.max(0, now - this.#lastTick);
		this.#lastTick = now;
		if (this.#completeParty())
			this.#saved = {
				...this.#saved,
				waitedMs: Math.min(MAX_WAIT_MS, this.#saved.waitedMs + elapsed),
			};
		if (
			this.#pending &&
			now - this.#pending.since > TIMEOUT_MS &&
			!this.prepared
		)
			this.decline();
		if (now - this.#lastRefresh >= REFRESH_MS) {
			this.#lastRefresh = now;
			if (this.#save()) this.#refresh();
		}
		if (this.#pending) this.#prepare();
		else if (this.#completeParty()) {
			if (this.#saved.group?.members.length === 4 || this.#allAllowBots())
				this.#offerStart();
			else if (now - this.#lastSearch >= 2_000) {
				this.#lastSearch = now;
				this.#search();
			}
		}
		if (this.#pending && !this.accepted) this.accept();
		this.#deps.change();
	}

	stop(): void {
		if (this.#stopped) return;
		this.#stopped = true;
		void this.#lobby?.leave();
		void this.#room?.leave();
		if (this.#target !== this.#room) void this.#target?.leave();
	}

	#save(previousKey?: string): boolean {
		const text = JSON.stringify(this.#saved);
		for (const key of new Set([
			this.#saved.key,
			...(previousKey ? [previousKey] : []),
		])) {
			const name = `${prefix}${key}.${this.#saved.self}`;
			this.#deps.store.setItem(name, text);
			if (this.#deps.store.getItem(name) !== text) {
				this.#fail("This browser could not save matchmaking progress.");
				return false;
			}
			// Last-used fallback for old links. Another tab may legitimately replace it immediately.
			this.#deps.store.setItem(prefix + key, text);
		}
		return true;
	}

	#fail(message: string): void {
		this.#problem = message;
		this.#deps.change();
	}

	#own(target = false): Presence {
		const saved = this.#saved;
		return {
			receivedAt: this.#deps.now(),
			id: saved.self,
			name: saved.name,
			holder: target ? this.#targetHolder : this.#holder,
			ready: saved.ready,
			allowBots: saved.allowBots,
			bidder: saved.bidder ?? "sl",
			waitMs: saved.waitMs,
			waitedMs: saved.waitedMs,
			...(saved.preferredSeat ? { preferredSeat: saved.preferredSeat } : {}),
			...(saved.group
				? { groupId: saved.group.id, revision: saved.group.revision }
				: {}),
		};
	}

	#openRoom(key: string, target: boolean): CommunityChannel {
		return this.#deps.open(`party-${key}`, key, {
			message: (peer, value) => this.#private(peer, value, target),
			join: () => this.#refresh(),
			leave: (peer) => {
				(target && this.#pending
					? this.#targetPresence
					: this.#presence
				).delete(peer);
				this.#refresh();
			},
			problem: () =>
				this.#fail(
					"The connection could not complete. Reload to recover your group.",
				),
		});
	}

	#refresh(): void {
		if (this.#stopped) return;
		this.#room?.send({ k: "hello", presence: this.#own() });
		if (this.#target && this.#target !== this.#room)
			this.#target.send({ k: "hello", presence: this.#own(true) });
		const group = this.#saved.group;
		if (group?.host === this.#saved.self && !this.#pending)
			this.#room?.send({ k: "state", group, expected: this.#saved.expected });
		if (this.#saved.start) {
			this.#room?.send({ k: "start", start: this.#saved.start });
			if (this.#startVotes.has(this.#saved.self))
				this.#room?.send({
					k: "start-vote",
					id: this.#saved.start.id,
					member: this.#saved.self,
				});
		}
		if (this.#completeParty() && !this.#saved.start) {
			this.#ensureLobby();
			// A proposal can arrive before a member's offer. Keep its evidence fresh for these participants only.
			this.#advertise(
				this.#pending ? [...this.#pending.peers.values()] : undefined,
			);
		}
		if (this.#pending) {
			const pending = this.#pending;
			if (pending.merge.destination.host === this.#saved.self)
				this.#sendProposal(pending);
			if (pending.accepts.has(this.#saved.self))
				this.#sendPublic(
					{ k: "accept", id: pending.merge.id, member: this.#saved.self },
					[...pending.peers.values()],
				);
			if (this.prepared)
				this.#target?.send({
					k: "vote",
					id: pending.merge.id,
					member: this.#saved.self,
				});
		}
		this.#deps.change();
	}

	#ensureLobby(): void {
		if (this.#lobby) return;
		this.#lobby = this.#deps.open(DISCOVERY_ROOM, undefined, {
			message: (peer, value) => this.#public(peer, value),
			join: () => this.#advertise(),
			leave: (peer) => {
				this.#directory.remove(peer);
				this.#replacementOffers.delete(peer);
			},
			problem: () =>
				this.#fail(
					"Discovery is busy or disconnected. Your group is saved; reload to retry.",
				),
		});
	}

	#advertise(peers?: readonly string[]): void {
		const group = this.#saved.group;
		if (
			!this.#lobby ||
			!group ||
			!this.#completeParty() ||
			(this.#pending && peers === undefined) ||
			this.#saved.start
		)
			return;
		const offer = {
			k: "offer",
			groupId: group.id,
			revision: group.revision,
			member: this.#saved.self,
			sequence: ++this.#sequence,
			...(group.host === this.#saved.self ? { group } : {}),
		};
		this.#directory.receive(this.#lobby.self, offer, this.#deps.now());
		this.#lobby.send(
			offer,
			peers?.filter((peer) => peer !== this.#lobby?.self),
		);
	}

	#completeParty(): boolean {
		const group = this.#saved.group;
		return Boolean(
			group &&
				group.members.length === this.#saved.expected.length &&
				group.members.every((member) => {
					const presence =
						member.id === this.#saved.self
							? this.#own()
							: [...this.#presence.values()].find(
									(row) => row.id === member.id,
								);
					return (
						presence?.ready &&
						presence.groupId === group.id &&
						presence.revision === group.revision
					);
				}),
		);
	}

	#allAllowBots(): boolean {
		const group = this.#saved.group;
		if (!group) return false;
		const vacant = SEATS.filter(
			(seat) => !group.members.some((member) => member.seat === seat),
		);
		const choices = openSeats(group);
		if (!vacant.every((seat) => permits(choices[seat], "bot"))) return false;
		return Boolean(
			this.#saved.group?.members.every((member) => {
				const row =
					member.id === this.#saved.self
						? this.#own()
						: [...this.#presence.values()].find(
								(item) => item.id === member.id,
							);
				return row?.allowBots && row.waitedMs >= row.waitMs;
			}),
		);
	}

	#search(): void {
		const group = this.#saved.group;
		if (
			!group ||
			group.host !== this.#saved.self ||
			this.#pending ||
			this.#saved.start
		)
			return;
		const listed = this.#directory.groups(this.#deps.now());
		const own = listed.find((item) => sameGroup(item.group, group));
		if (!own) return;
		const choices = listed.filter(
			(item) => placements(group, item.group).length > 0,
		);
		const largest = Math.max(
			0,
			...choices.map((item) => item.group.members.length),
		);
		const preferred = choices.filter(
			(item) => item.group.members.length === largest,
		);
		if (preferred.length === 0) return;
		const other = preferred[this.#deps.random(preferred.length)];
		if (!other) return;
		const proposal = proposeMerge(this.#deps.id(), group, other.group);
		if (!proposal || proposal.destination.host !== this.#saved.self) return;
		const variants = placements(proposal.destination, proposal.source);
		const merge = proposeMerge(
			proposal.id,
			group,
			other.group,
			this.#deps.random(variants.length),
		);
		if (!merge) return;
		this.#pending = {
			merge,
			key: this.#saved.key,
			peers: new Map([...own.peers, ...other.peers]),
			accepts: new Set([this.#saved.self]),
			votes: new Set(),
			since: this.#deps.now(),
		};
		this.#directory.remove(this.#lobby?.self ?? "");
		this.#sendProposal(this.#pending);
		this.#refresh();
	}

	#sendProposal(pending: Pending): void {
		this.#sendPublic(
			{
				k: "proposal",
				merge: pending.merge,
				key: pending.key,
				peers: [...pending.peers],
			},
			[...pending.peers.values()],
		);
	}
	#sendPublic(value: unknown, peers: readonly string[]): void {
		this.#lobby?.send(
			value,
			peers.filter((peer) => peer !== this.#lobby?.self),
		);
	}

	#public(peer: string, value: unknown): void {
		if (this.#stopped || this.#problem || !isObject(value)) return;
		const replacement = parseReplacementOffer(value, this.#deps.now());
		if (replacement) {
			this.#replacementOffers.set(peer, replacement);
			this.#deps.change();
			return;
		}
		if (value.k === "offer") {
			this.#directory.receive(peer, value, this.#deps.now());
			return;
		}
		if (value.k === "proposal") {
			const merge = parseMerge(value.merge);
			const group = this.#saved.group;
			if (
				!merge ||
				!group ||
				!isTableKey(value.key) ||
				!Array.isArray(value.peers) ||
				value.peers.length !== merge.result.members.length ||
				this.#saved.start ||
				!this.#saved.ready
			)
				return;
			if (this.#pending) {
				if (this.#pending.merge.id === merge.id) this.#refresh();
				return;
			}
			if (
				!sameGroup(group, merge.source) &&
				!sameGroup(group, merge.destination)
			)
				return;
			const peers = new Map<string, string>();
			for (const item of value.peers) {
				if (
					!Array.isArray(item) ||
					item.length !== 2 ||
					!validId(item[0]) ||
					!validId(item[1])
				)
					return;
				peers.set(item[0], item[1]);
			}
			const listed = this.#directory.groups(this.#deps.now());
			for (const side of [merge.destination, merge.source]) {
				const known = listed.find((item) => sameGroup(item.group, side));
				if (
					!known ||
					side.members.some(
						(member) => known.peers.get(member.id) !== peers.get(member.id),
					)
				)
					return;
			}
			if (
				peers.get(merge.destination.host) !== peer ||
				peers.get(this.#saved.self) !== this.#lobby?.self
			)
				return;
			const decision = this.#journal.records.find(
				(record) => record.merge.id === merge.id,
			);
			if (decision?.phase === "declined") {
				this.#sendPublic(
					{ k: "decline", id: merge.id, member: this.#saved.self },
					[...peers.values()],
				);
				return;
			}
			if (decision?.phase === "aborted") return;
			this.#pending = {
				merge,
				key: value.key,
				peers,
				accepts: new Set([merge.destination.host]),
				votes: new Set(),
				since: this.#deps.now(),
			};
			this.#directory.remove(this.#lobby?.self ?? "");
			this.#deps.change();
			return;
		}
		const pending = this.#pending;
		if (
			!pending ||
			value.id !== pending.merge.id ||
			typeof value.member !== "string" ||
			pending.peers.get(value.member) !== peer
		)
			return;
		if (
			value.k === "accept" &&
			[pending.merge.source.host, pending.merge.destination.host].includes(
				value.member,
			)
		) {
			pending.accepts.add(value.member);
			void this.#openTarget();
		} else if (value.k === "decline") this.#refused(value.member);
	}

	async #openTarget(): Promise<void> {
		const pending = this.#pending;
		if (
			!pending ||
			this.#target ||
			this.#busyOpening ||
			!pending.accepts.has(pending.merge.destination.host) ||
			!pending.accepts.has(pending.merge.source.host)
		)
			return;
		this.#busyOpening = true;
		const identity = await this.#deps.identity(pending.key);
		this.#busyOpening = false;
		if (this.#stopped || this.#pending !== pending) return;
		if (identity.tableId !== pending.merge.destination.id) {
			this.decline();
			return;
		}
		this.#targetHolder = identity.holder;
		if (pending.key === this.#saved.key) {
			this.#target = this.#room;
			for (const [peer, presence] of this.#presence)
				this.#targetPresence.set(peer, presence);
		} else this.#target = this.#openRoom(pending.key, true);
		this.#refresh();
	}

	#private(peer: string, value: unknown, target: boolean): void {
		if (this.#stopped || this.#problem || !isObject(value)) return;
		const destination = target || this.#target === this.#room;
		const people =
			destination && this.#pending ? this.#targetPresence : this.#presence;
		if (value.k === "hello") {
			const row = parsePresence(value.presence, this.#deps.now());
			if (
				!row ||
				row.id === this.#saved.self ||
				[...people].some(
					([other, member]) => other !== peer && member.id === row.id,
				)
			)
				return;
			if (
				this.#pending &&
				destination &&
				!this.#pending.merge.result.members.some(
					(member) => member.id === row.id,
				)
			)
				return;
			if (people.size >= 7 && !people.has(peer)) return;
			const first = !people.has(peer);
			people.set(peer, row);
			if (!this.#pending) this.#seatGuest(row);
			if (this.#pending) this.#prepare();
			const record = this.#journal.record;
			if (
				record?.phase === "committed" &&
				this.#saved.group &&
				sameGroup(record.merge.result, this.#saved.group)
			)
				this.#room?.send(
					{ k: "commit", id: record.merge.id, votes: record.votes },
					[peer],
				);
			if (first) this.#refresh();
			return;
		}
		const member = people.get(peer);
		if (!member) return;
		if (value.k === "state" && !this.#pending && !this.#saved.start) {
			const group = parseGroup(value.group);
			if (
				!group ||
				group.host !== member.id ||
				group.host !== (this.#saved.group?.host ?? this.#saved.owner) ||
				!group.members.some((row) => row.id === this.#saved.self) ||
				!Array.isArray(value.expected) ||
				value.expected.length > 4 ||
				!value.expected.every(isSeat) ||
				(this.#saved.group &&
					(group.id !== this.#saved.group.id ||
						group.revision <= this.#saved.group.revision))
			)
				return;
			this.#saved = { ...this.#saved, group, expected: value.expected };
			if (this.#save()) this.#refresh();
		} else if (
			this.#pending &&
			value.id === this.#pending.merge.id &&
			destination
		) {
			if (value.k === "vote" && value.member === member.id) {
				this.#pending.votes.add(member.id);
				this.#prepare();
			} else if (
				value.k === "commit" &&
				Array.isArray(value.votes) &&
				value.votes.every((id) => typeof id === "string")
			)
				this.#commit(value.votes);
			else if (value.k === "decline" && value.member === member.id)
				this.#refused(member.id);
		} else if (value.k === "start" && !this.#pending) {
			const start = parseStart(value.start);
			if (
				start &&
				(member.id === this.#saved.group?.host ||
					this.#saved.start?.id === start.id)
			)
				this.#acceptStart(start);
		} else if (
			value.k === "start-vote" &&
			value.id === this.#saved.start?.id &&
			value.member === member.id
		) {
			this.#startVotes.add(member.id);
			this.#finishStart();
		}
	}

	#seatGuest(row: Presence): void {
		const group = this.#saved.group;
		if (
			!group ||
			group.host !== this.#saved.self ||
			group.members.some((member) => member.id === row.id) ||
			this.#saved.start
		)
			return;
		const seat = this.#saved.expected.find(
			(choice) =>
				(!row.preferredSeat || choice === row.preferredSeat) &&
				!group.members.some((member) => member.seat === choice),
		);
		if (!seat) return;
		this.#saved = {
			...this.#saved,
			group: {
				...group,
				revision: group.revision + 1,
				members: [
					...group.members,
					{ id: row.id, name: row.name, seat, recruitment: "invited" },
				],
			},
		};
		if (this.#save()) this.#refresh();
	}

	#prepare(): void {
		const pending = this.#pending;
		const group = this.#saved.group;
		if (!pending || !group || !this.#target || !this.#saved.ready) return;
		const connected = pending.merge.result.members.every(
			(member) =>
				member.id === this.#saved.self ||
				[...this.#targetPresence.values()].some((row) => row.id === member.id),
		);
		if (!connected) return;
		if (!this.prepared) {
			if (!this.#journal.prepare(pending.merge, pending.key, group)) {
				this.#fail(
					"The merge could not be saved. Reload to recover your group.",
				);
				return;
			}
			pending.votes.add(this.#saved.self);
			this.#target.send({
				k: "vote",
				id: pending.merge.id,
				member: this.#saved.self,
			});
		}
		if (
			pending.merge.result.members.every((member) =>
				pending.votes.has(member.id),
			)
		)
			this.#commit([...pending.votes]);
	}

	#commit(votes: readonly string[]): void {
		const pending = this.#pending;
		if (
			!pending ||
			!this.#target ||
			!this.#journal.commit(pending.merge.id, votes)
		)
			return;
		this.#target.send({ k: "commit", id: pending.merge.id, votes });
		const oldKey = this.#saved.key;
		const oldRoom = this.#room;
		this.#saved = {
			...this.#saved,
			key: pending.key,
			owner: pending.merge.result.host,
			group: pending.merge.result,
			expected: pending.merge.result.members.map((member) => member.seat),
		};
		this.#holder = this.#targetHolder;
		this.#room = this.#target;
		this.#target = undefined;
		this.#presence.clear();
		for (const [peer, presence] of this.#targetPresence)
			this.#presence.set(peer, presence);
		this.#targetPresence.clear();
		this.#pending = undefined;
		if (oldRoom !== this.#room) void oldRoom?.leave();
		if (this.#save(oldKey)) this.#refresh();
	}

	#refused(member: string): void {
		if (!this.#pending) return;
		if (this.#pending.votes.has(member)) return;
		if (
			this.prepared &&
			!this.#journal.abortAfterRefusal(this.#pending.merge.id, member)
		)
			return;
		this.#cancelPending();
	}
	#cancelPending(): void {
		if (this.#target !== this.#room) void this.#target?.leave();
		this.#target = undefined;
		this.#targetPresence.clear();
		this.#pending = undefined;
		this.#lastSearch = this.#deps.now() + 10_000;
		this.#refresh();
	}

	#gameConfig(): RoomConfig | undefined {
		const group = this.#saved.group;
		if (!group) return undefined;
		const host =
			group.host === this.#saved.self
				? this.#own()
				: [...this.#presence.values()].find((row) => row.id === group.host);
		if (!host) return undefined;
		const names = {} as Record<Seat, string>;
		const holders: Partial<Record<Seat, string>> = {};
		const recruitment: Partial<Record<Seat, "invited" | "online">> = {};
		const bots: Seat[] = [];
		for (const seat of SEATS) {
			const member = group.members.find((row) => row.seat === seat);
			if (!member) {
				names[seat] = "bot";
				bots.push(seat);
				continue;
			}
			const presence =
				member.id === this.#saved.self
					? this.#own()
					: [...this.#presence.values()].find((row) => row.id === member.id);
			if (!presence) return undefined;
			names[seat] = member.name;
			holders[seat] = presence.holder;
			recruitment[seat] = member.recruitment ?? "online";
		}
		return parseRoomConfig({
			names,
			scoring: "duplicate",
			botSetup: { seats: bots, bidder: host.bidder },
			community: { v: 1, holders, recruitment },
		});
	}
	#offerStart(): void {
		const group = this.#saved.group;
		if (
			!group ||
			group.host !== this.#saved.self ||
			this.#saved.start ||
			this.#pending ||
			!this.#completeParty()
		)
			return;
		const config = this.#gameConfig();
		if (!config) return;
		this.#acceptStart({ id: this.#deps.id(), group, config });
	}
	#acceptStart(start: GameStart): void {
		if (
			!this.#saved.group ||
			!sameGroup(start.group, this.#saved.group) ||
			this.#pending ||
			!this.#completeParty() ||
			(this.#saved.start && this.#saved.start.id !== start.id) ||
			(start.group.members.length < 4 && !this.#allAllowBots()) ||
			JSON.stringify(start.config) !== JSON.stringify(this.#gameConfig())
		)
			return;
		const first = this.#saved.start === undefined;
		this.#saved = { ...this.#saved, start };
		if (!this.#save()) return;
		this.#startVotes.add(this.#saved.self);
		// A vote received before the start is deliberately ignored. Announce first on the ordered channel.
		if (first && start.group.host === this.#saved.self)
			this.#room?.send({ k: "start", start });
		this.#room?.send({
			k: "start-vote",
			id: start.id,
			member: this.#saved.self,
		});
		this.#finishStart();
	}
	#finishStart(): void {
		const start = this.#saved.start;
		if (
			!start?.group.members.every((member) => this.#startVotes.has(member.id))
		)
			return;
		this.#saved = { ...this.#saved, playing: true };
		if (this.#save()) this.#play(start);
	}
	#play(start: GameStart): void {
		if (this.#playing || this.#stopped) return;
		this.#playing = true;
		void this.#deps
			.play(this.#saved.key, start, this.#saved.self)
			.then(() => this.stop());
	}
}
