import { APP_ID, type MeshConfig } from "./config";
import {
	CALL_BYTES,
	CTL_BYTES,
	CTL_PER_SECOND,
	LINK_TARGET_MS,
	LINKS_MS,
	LOG_BYTES,
	MAX_PEERS,
	MAX_RECEIVE_BYTES,
	MESH_BYTES,
	NETWORK_REJOIN_MS,
	REJOIN_MAX_MS,
	REJOIN_MS,
	RELAY_SILENT_MS,
	TABLE_OFFERS,
} from "./limits";
import type { Clock, Send } from "./ports";
import { peerRendezvous, Rendezvous } from "./rendezvous";
import type {
	DataPayload,
	JoinError,
	JoinRoomCallbacks,
	MessageAction,
	RelayKind,
	SignalingRoomConfig,
} from "./signaling";
import { type ProbeStun, StunChecks, type StunStatus } from "./stun-probe";
import {
	type CallFrame,
	type CtlMessage,
	frame,
	isPeerId,
	type Links,
	type LogMessage,
	type Parsed,
	parseCall,
	parseCtl,
	parseLog,
	parseMesh,
	type Rejection,
} from "./wire";

/**
 * The page's Trystero table room (plan §4.2). Relays only introduce the peers; every message then goes over
 * the WebRTC data channels. Each action caps its size before Trystero buffers a message, and each message passes
 * the wire validators before a handler sees it. Messages from peers above MAX_PEERS, or from peers that are not
 * connected, never reach a handler.
 *
 * Mesh repair: every page sends its peer list (`links`) to its peers. A page that misses a listed peer, or that
 * misses the peer of a seat the controller names (`seek`), meets it in a two-page room (`rendezvous.ts`). A page
 * without links has no list and, as a visitor, no seat, so it joins the table room again (REJOIN_MS).
 *
 * Relay recovery (ADR 0004): after a network change, the page replaces each relay socket and, when alone, joins the
 * table room again as soon as a relay is open. A relay socket that is open and silent for RELAY_SILENT_MS is
 * replaced too.
 */

/** The part of a Trystero room that the mesh uses; the unit tests implement it without WebRTC. */
export interface MeshRoom {
	makeAction(namespace: string): MessageAction<DataPayload>;
	getPeers(): Record<string, RTCPeerConnection>;
	leave(): Promise<void>;
	onPeerJoin: ((peerId: string) => void) | null;
	onPeerLeave: ((peerId: string) => void) | null;
}

export type JoinMeshRoom = (
	config: SignalingRoomConfig,
	roomId: string,
	callbacks: JoinRoomCallbacks,
) => MeshRoom;

/** A relay socket as `relaySockets` of signaling.ts reports it. */
export interface RelaySocket {
	readonly readyState: number;
	addEventListener(type: "message", listener: () => void): void;
	removeEventListener(type: "message", listener: () => void): void;
}

/** A signalling relay and the evidence that it is alive: its socket is open, and when it last sent a message. */
export interface RelayStatus {
	readonly kind: RelayKind;
	readonly url: string;
	readonly open: boolean;
	/** Undefined until the relay sends its first message to this page. */
	readonly heardAgoMs: number | undefined;
}

const CONNECTING = 0;
const OPEN = 1;

export interface MeshDeps {
	readonly tableId: string;
	/** The link key K, used as the room password. Never logged. */
	readonly key: string;
	readonly config: MeshConfig;
	/** A Node-compatible WebRTC implementation; browsers use their global constructor. */
	readonly rtcPolyfill?: typeof RTCPeerConnection;
	readonly joinRoom: JoinMeshRoom;
	/** This page's Trystero peer id. */
	readonly self: string;
	/** The relay sockets of each kind by URL. */
	readonly relaySockets: () => Readonly<
		Record<RelayKind, Readonly<Record<string, RelaySocket>>>
	>;
	/** Replaces one relay's socket now. */
	readonly reconnectRelay: (kind: RelayKind, url: string) => void;
	/** Calls `onChange` at each network change until the returned function runs; a mesh without it does not watch. */
	readonly watchNetwork?: (onChange: () => void) => () => void;
	/** Asks one STUN server for this page's public address; a mesh without it does not check. */
	readonly probeStun?: ProbeStun;
	readonly clock: Clock;
}

export interface MeshHandlers {
	readonly join: (peer: string) => void;
	readonly leave: (peer: string) => void;
	readonly ctl: (peer: string, message: CtlMessage) => void;
	readonly log: (peer: string, message: LogMessage) => void;
	readonly call: (peer: string, message: CallFrame) => void;
	/** A diagnostics count changed. */
	readonly change: () => void;
}

/** Why a received message was dropped. `stranger`: the sender is not an admitted peer. */
export type DropReason = Rejection | "oversize" | "rate" | "stranger";

export interface MeshDiagnostics {
	readonly trackersOpen: number;
	readonly trackers: number;
	readonly nostrOpen: number;
	readonly nostrRelays: number;
	/** The configured trackers, then the configured Nostr relays, in configuration order. */
	readonly relays: readonly RelayStatus[];
	/** The configured STUN servers; null on a page that does not check them. */
	readonly stun: readonly StunStatus[] | null;
	/** Admitted peers with a data channel. */
	readonly peers: number;
	/** Pages with another key that tried to connect: strangers at the tracker, or a damaged link. */
	readonly wrongKey: number;
	/** Peers whose direct connection failed after the offer and answer were exchanged. */
	readonly unreachable: number;
	/** Peers above MAX_PEERS; each got `gone{full}`. */
	readonly refused: number;
	/** Peers that sent a message of another wire version or an unknown kind. */
	readonly incompatible: number;
	readonly dropped: Readonly<Record<DropReason, number>>;
	readonly sendFailures: number;
	/** Two-page rooms open now to repair missing links. */
	readonly pairRooms: number;
	/** Peers that a two-page room connected. */
	readonly repaired: number;
	/** Two-page rooms closed after PAIR_TIMEOUT_MS without a link. */
	readonly pairTimeouts: number;
	/** Of those, rooms that connected their peer, which the table room then did not admit. */
	readonly unattached: number;
	/** Times this page joined the table room again because it had no links. */
	readonly rejoins: number;
}

const ACTIONS = {
	ctl: "opentrick-ctl",
	log: "opentrick-log",
	call: "opentrick-call",
	mesh: "opentrick-mesh",
} as const;

type JoinErrorClass = "wrong-key" | "unreachable" | "other";

/** Sorts a Trystero join error by its message, which is the only field that tells the cases apart. */
export function classifyJoinError(error: string): JoinErrorClass {
	if (/incorrect (room )?password/.test(error)) return "wrong-key";
	if (/could not connect to peer/.test(error)) return "unreachable";
	return "other";
}

interface Window {
	start: number;
	count: number;
}

/** The table room and its actions; a rejoin replaces them together. */
interface TableRoom {
	readonly room: MeshRoom;
	readonly ctl: MessageAction<DataPayload>;
	readonly log: MessageAction<DataPayload>;
	readonly call: MessageAction<DataPayload>;
	readonly mesh: MessageAction<DataPayload>;
}

export class Mesh implements Send {
	readonly self: string;
	readonly #deps: MeshDeps;
	readonly #handlers: MeshHandlers;
	readonly #roomConfig: SignalingRoomConfig;
	#table: TableRoom;
	readonly #rendezvous: Rendezvous;
	/** Peers that a neighbour listed and this page has no link to, until when they stay repair targets. */
	readonly #targets = new Map<string, number>();
	/** Seat pairs to meet, each with the peer bound to the other seat (`seek`). */
	#seats: ReadonlyMap<string, string> = new Map();
	/** Since when this page has had no links; null while it has one. */
	#aloneSince: number | null;
	#rejoinWait = REJOIN_MS;
	/** Until when a page alone joins the table room again without the wait, after a network change. */
	#rejoinNowUntil = Number.NEGATIVE_INFINITY;
	#rejoins = 0;
	#linksAt = Number.NEGATIVE_INFINITY;
	readonly #admitted = new Set<string>();
	readonly #refused = new Set<string>();
	readonly #wrongKey = new Set<string>();
	readonly #unreachable = new Set<string>();
	readonly #incompatible = new Set<string>();
	readonly #windows = new Map<string, Window>();
	readonly #dropped: Record<DropReason, number> = {
		malformed: 0,
		incompatible: 0,
		foreign: 0,
		oversize: 0,
		rate: 0,
		stranger: 0,
	};
	#sendFailures = 0;
	#left = false;
	/** The listener on each relay's current socket, by "kind url"; a reconnect replaces the socket. */
	readonly #listening = new Map<
		string,
		{ readonly socket: RelaySocket; readonly listener: () => void }
	>();
	/** When each relay last sent a message, by "kind url"; it outlives the socket. */
	readonly #heardAt = new Map<string, number>();
	/** Since when the mesh has listened to each relay's socket, or when it last replaced the socket. */
	readonly #watchedAt = new Map<string, number>();
	readonly #stun: StunChecks | null;
	readonly #unwatchNetwork: () => void;

	constructor(deps: MeshDeps, handlers: MeshHandlers) {
		this.self = deps.self;
		this.#deps = deps;
		this.#handlers = handlers;
		const { config } = deps;
		const roomConfig: SignalingRoomConfig = {
			appId: APP_ID,
			password: deps.key,
			rtcConfig: config.rtc,
			trackerUrls: config.trackers,
			nostrRelayUrls: config.nostrRelays,
			maxReceiveBytes: MAX_RECEIVE_BYTES,
			...(deps.rtcPolyfill ? { rtcPolyfill: deps.rtcPolyfill } : {}),
		};
		this.#roomConfig = roomConfig;
		this.#table = this.#joinTable();
		this.#aloneSince = deps.clock.monotonic();
		this.#rendezvous = new Rendezvous({
			key: deps.key,
			join: (roomId) => deps.joinRoom(roomConfig, roomId, {}),
		});
		// The join opened the sockets, and a relay can answer before the first tick.
		this.#listenToRelays();
		this.#stun =
			deps.probeStun === undefined
				? null
				: new StunChecks(stunUrls(config.rtc), deps.probeStun, () =>
						this.#handlers.change(),
					);
		this.#stun?.tick(deps.clock.monotonic(), true);
		this.#unwatchNetwork =
			deps.watchNetwork?.(() => this.#networkChanged()) ?? (() => {});
	}

	/** Admitted peers that still have a data channel, in join order. */
	peers(): string[] {
		const connected = this.#table.room.getPeers();
		return [...this.#admitted].filter((peer) => peer in connected);
	}

	/** The peer's connection, for statistics; undefined when it is not an admitted peer. */
	connection(peer: string): RTCPeerConnection | undefined {
		return this.#admitted.has(peer)
			? this.#table.room.getPeers()[peer]
			: undefined;
	}

	/** A relay socket is open or a peer is connected (election rule 5). */
	online(): boolean {
		return this.#relaysOpen() > 0 || this.peers().length > 0;
	}

	diagnostics(): MeshDiagnostics {
		const repair = this.#rendezvous.counts();
		const relays = this.#relays();
		const openOf = (kind: RelayKind) =>
			relays.filter((relay) => relay.kind === kind && relay.open).length;
		return {
			trackersOpen: openOf("tracker"),
			trackers: this.#deps.config.trackers.length,
			nostrOpen: openOf("nostr"),
			nostrRelays: this.#deps.config.nostrRelays.length,
			relays,
			stun: this.#stun?.statuses() ?? null,
			peers: this.peers().length,
			wrongKey: this.#wrongKey.size,
			unreachable: this.#unreachable.size,
			refused: this.#refused.size,
			incompatible: this.#incompatible.size,
			dropped: { ...this.#dropped },
			sendFailures: this.#sendFailures,
			pairRooms: repair.open,
			repaired: repair.repaired,
			pairTimeouts: repair.timeouts,
			unattached: repair.unattached,
			rejoins: this.#rejoins,
		};
	}

	/**
	 * The seat pairs (`seatRendezvous`) whose peers this page misses now, each with the peer that the roster binds
	 * to the other seat, or "" without a binding; `tick` meets them.
	 */
	seek(seats: ReadonlyMap<string, string>): void {
		this.#seats = new Map(seats);
	}

	/**
	 * Replaces silent relay sockets, joins the table room again when alone, sends the peer list when it is due, and
	 * opens or closes the two-page rooms.
	 */
	tick(): void {
		if (this.#left) return;
		const now = this.#deps.clock.monotonic();
		this.#listenToRelays();
		this.#replaceSilentRelays(now);
		this.#rejoinWhenAlone(now);
		this.#stun?.tick(now, this.peers().length === 0);
		if (now - this.#linksAt >= LINKS_MS) this.#sendLinks(now);
		const admitted = new Set(this.peers());
		const wanted = new Map(this.#seats);
		for (const [peer, until] of this.#targets) {
			if (admitted.has(peer) || now >= until) {
				this.#targets.delete(peer);
				continue;
			}
			wanted.set(peerRendezvous(this.self, peer), "");
		}
		if (this.#rendezvous.tick(now, wanted, admitted)) this.#handlers.change();
	}

	ctl(to: string | null, message: CtlMessage): void {
		this.#send(this.#table.ctl, to, frame(this.#deps.tableId, message));
	}

	log(to: string | null, message: LogMessage): void {
		this.#send(this.#table.log, to, frame(this.#deps.tableId, message));
	}

	call(to: string | null, message: CallFrame): void {
		this.#send(this.#table.call, to, frame(this.#deps.tableId, message));
	}

	leave(): Promise<void> {
		if (this.#left) return Promise.resolve();
		this.#left = true;
		this.#unwatchNetwork();
		Mesh.#detach(this.#table);
		for (const { socket, listener } of this.#listening.values()) {
			socket.removeEventListener("message", listener);
		}
		this.#listening.clear();
		this.#stun?.close();
		this.#admitted.clear();
		this.#rendezvous.close();
		return this.#table.room.leave();
	}

	// -------------------------------------------------------------------------------------------------------

	/** Joins the table room and makes its actions. */
	#joinTable(): TableRoom {
		const config = { ...this.#roomConfig, offersPerAnnounce: TABLE_OFFERS };
		const room = this.#deps.joinRoom(config, this.#deps.tableId, {
			onJoinError: (error) => this.#joinError(error),
		});
		const table: TableRoom = {
			room,
			ctl: this.#action(room, ACTIONS.ctl, CTL_BYTES, true, parseCtl, (p, m) =>
				this.#handlers.ctl(p, m),
			),
			log: this.#action(room, ACTIONS.log, LOG_BYTES, false, parseLog, (p, m) =>
				this.#handlers.log(p, m),
			),
			call: this.#action(
				room,
				ACTIONS.call,
				CALL_BYTES,
				false,
				parseCall,
				(p, m) => this.#handlers.call(p, m),
			),
			mesh: this.#action(
				room,
				ACTIONS.mesh,
				MESH_BYTES,
				true,
				parseMesh,
				(p, m) => this.#links(p, m),
			),
		};
		room.onPeerJoin = (peer) => this.#join(peer);
		room.onPeerLeave = (peer) => this.#leave(peer);
		return table;
	}

	/** After this, the room's late events reach no handler. */
	static #detach({ room, ctl, log, call, mesh }: TableRoom): void {
		room.onPeerJoin = null;
		room.onPeerLeave = null;
		for (const action of [ctl, log, call, mesh]) action.onMessage = null;
	}

	/**
	 * A page alone for REJOIN_MS leaves and joins the table room again, which makes a new offer and repeats
	 * Trystero's first announces; the wait doubles up to REJOIN_MAX_MS and starts again at the next link. The peer
	 * id stays, so the relays count the page once. A handshake in progress in the old room is lost. Until
	 * NETWORK_REJOIN_MS after a network change, the first rejoin does not wait.
	 */
	#rejoinWhenAlone(now: number): void {
		if (this.peers().length > 0) {
			this.#aloneSince = null;
			this.#rejoinWait = REJOIN_MS;
			return;
		}
		this.#aloneSince ??= now;
		const afterNetworkChange = now < this.#rejoinNowUntil;
		if (!afterNetworkChange && now - this.#aloneSince < this.#rejoinWait)
			return;
		if (this.#relaysOpen() === 0) return;
		const old = this.#table;
		Mesh.#detach(old);
		for (const peer of [...this.#admitted]) this.#leave(peer);
		// Trystero's leave() releases the room id before it returns, so the join below makes a new room.
		void old.room.leave();
		this.#table = this.#joinTable();
		this.#aloneSince = now;
		if (afterNetworkChange) {
			this.#rejoinNowUntil = Number.NEGATIVE_INFINITY;
			this.#rejoinWait = REJOIN_MS;
		} else this.#rejoinWait = Math.min(REJOIN_MAX_MS, this.#rejoinWait * 2);
		this.#rejoins++;
		this.#handlers.change();
	}

	#action<M>(
		room: MeshRoom,
		namespace: string,
		cap: number,
		limited: boolean,
		parse: (value: unknown, tableId: string) => Parsed<M>,
		deliver: (peer: string, message: M) => void,
	): MessageAction<DataPayload> {
		const action = room.makeAction(namespace);
		// Runs before Trystero buffers the message; a refused message never takes memory.
		action.onReceive = ({ peerId, byteLength }) => {
			if (!this.#admitted.has(peerId)) return this.#drop("stranger");
			if (byteLength > cap) return this.#drop("oversize");
			return true;
		};
		action.onMessage = (data, { peerId }) => {
			if (!this.#admitted.has(peerId)) {
				this.#drop("stranger");
				return;
			}
			if (limited && !this.#withinRate(peerId)) {
				this.#drop("rate");
				return;
			}
			const parsed = parse(data, this.#deps.tableId);
			if (!parsed.ok) {
				if (parsed.reason === "incompatible") this.#incompatible.add(peerId);
				this.#drop(parsed.reason);
				return;
			}
			deliver(peerId, parsed.message);
		};
		return action;
	}

	#join(peer: string): void {
		if (this.#admitted.has(peer) || this.#refused.has(peer)) return;
		if (!isPeerId(peer) || this.#admitted.size >= MAX_PEERS) {
			this.#refused.add(peer);
			this.#post(
				this.#table.ctl,
				[peer],
				frame(this.#deps.tableId, { k: "gone", reason: "full" }),
			);
			this.#handlers.change();
			return;
		}
		this.#admitted.add(peer);
		this.#unreachable.delete(peer);
		this.#targets.delete(peer);
		this.#handlers.join(peer);
		this.#handlers.change();
		this.#sendLinks(this.#deps.clock.monotonic());
	}

	#leave(peer: string): void {
		this.#refused.delete(peer);
		this.#windows.delete(peer);
		if (!this.#admitted.delete(peer)) return;
		this.#handlers.leave(peer);
		this.#handlers.change();
		this.#sendLinks(this.#deps.clock.monotonic());
	}

	#sendLinks(now: number): void {
		this.#linksAt = now;
		const links: Links = { k: "links", peers: this.peers() };
		this.#send(this.#table.mesh, null, frame(this.#deps.tableId, links));
	}

	/** A neighbour's peers that this page has no link to become repair targets (`tick`). */
	#links(from: string, { peers }: Links): void {
		const now = this.#deps.clock.monotonic();
		const admitted = new Set(this.peers());
		for (const peer of peers) {
			if (peer !== from) this.#target(peer, now, admitted);
		}
	}

	/**
	 * A failed link also becomes a repair target on both sides. Trystero reports the failure about 23 s after the
	 * exchange and tries the table room again only at a later announce, and a page without peers gets no
	 * neighbour's list.
	 */
	#joinError({ error, peerId }: JoinError): void {
		const kind = classifyJoinError(error);
		if (kind === "wrong-key") this.#wrongKey.add(peerId);
		else if (kind === "unreachable" && !this.#admitted.has(peerId)) {
			this.#unreachable.add(peerId);
			this.#target(peerId, this.#deps.clock.monotonic(), new Set(this.peers()));
		} else return;
		this.#handlers.change();
	}

	/** `peer` is a repair target until LINK_TARGET_MS from now, unless it has a link or cannot be admitted. */
	#target(peer: string, now: number, admitted: ReadonlySet<string>): void {
		if (peer === this.self || admitted.has(peer) || !isPeerId(peer)) return;
		if (this.#refused.has(peer) || this.#wrongKey.has(peer)) return;
		const full = admitted.size + this.#targets.size >= MAX_PEERS;
		if (full && !this.#targets.has(peer)) return;
		this.#targets.set(peer, now + LINK_TARGET_MS);
	}

	/** At most CTL_PER_SECOND control messages per peer in each one-second window. */
	#withinRate(peer: string): boolean {
		const now = this.#deps.clock.monotonic();
		const window = this.#windows.get(peer);
		if (!window || now - window.start >= 1_000) {
			this.#windows.set(peer, { start: now, count: 1 });
			return true;
		}
		window.count++;
		return window.count <= CTL_PER_SECOND;
	}

	#drop(reason: DropReason): false {
		this.#dropped[reason]++;
		return false;
	}

	/** The configured relays: the trackers, then the Nostr relays. */
	#configuredRelays(): { readonly kind: RelayKind; readonly url: string }[] {
		const { trackers, nostrRelays } = this.#deps.config;
		return [
			...trackers.map((url) => ({ kind: "tracker" as const, url })),
			...nostrRelays.map((url) => ({ kind: "nostr" as const, url })),
		];
	}

	/**
	 * Listens to each relay's current socket for the time of its messages, not their content, which Trystero reads.
	 * A replaced socket loses its listener.
	 */
	#listenToRelays(): void {
		const sockets = this.#deps.relaySockets();
		for (const { kind, url } of this.#configuredRelays()) {
			const key = `${kind} ${url}`;
			const socket = sockets[kind][url];
			const current = this.#listening.get(key);
			if (current?.socket === socket) continue;
			current?.socket.removeEventListener("message", current.listener);
			this.#listening.delete(key);
			if (socket === undefined) continue;
			const listener = () =>
				this.#heardAt.set(key, this.#deps.clock.monotonic());
			socket.addEventListener("message", listener);
			this.#listening.set(key, { socket, listener });
			this.#watchedAt.set(key, this.#deps.clock.monotonic());
		}
	}

	/** A socket that is open or opening, and silent for RELAY_SILENT_MS, is replaced; a closed one retries by itself. */
	#replaceSilentRelays(now: number): void {
		const sockets = this.#deps.relaySockets();
		for (const { kind, url } of this.#configuredRelays()) {
			const key = `${kind} ${url}`;
			const state = sockets[kind][url]?.readyState;
			if (state !== OPEN && state !== CONNECTING) continue;
			const since = Math.max(
				this.#heardAt.get(key) ?? Number.NEGATIVE_INFINITY,
				this.#watchedAt.get(key) ?? now,
			);
			if (now - since < RELAY_SILENT_MS) continue;
			this.#watchedAt.set(key, now);
			this.#deps.reconnectRelay(kind, url);
		}
	}

	/** Replaces each relay socket, and lets a page alone join the table room again without the wait. */
	#networkChanged(): void {
		if (this.#left) return;
		const now = this.#deps.clock.monotonic();
		for (const { kind, url } of this.#configuredRelays()) {
			this.#watchedAt.set(`${kind} ${url}`, now);
			this.#deps.reconnectRelay(kind, url);
		}
		this.#rejoinNowUntil = now + NETWORK_REJOIN_MS;
	}

	#relays(): RelayStatus[] {
		if (!this.#left) this.#listenToRelays();
		const now = this.#deps.clock.monotonic();
		const sockets = this.#deps.relaySockets();
		return this.#configuredRelays().map(({ kind, url }) => {
			const heardAt = this.#heardAt.get(`${kind} ${url}`);
			return {
				kind,
				url,
				open: sockets[kind][url]?.readyState === OPEN,
				heardAgoMs: heardAt === undefined ? undefined : now - heardAt,
			};
		});
	}

	#relaysOpen(): number {
		const sockets = this.#deps.relaySockets();
		return this.#configuredRelays().filter(
			({ kind, url }) => sockets[kind][url]?.readyState === OPEN,
		).length;
	}

	#send(
		action: MessageAction<DataPayload>,
		to: string | null,
		message: object,
	): void {
		if (this.#left) return;
		const peers = this.peers();
		const targets =
			to === null ? peers : peers.includes(to) ? [to] : ([] as string[]);
		this.#post(action, targets, message);
	}

	#post(
		action: MessageAction<DataPayload>,
		targets: string[],
		message: object,
	): void {
		if (targets.length === 0) return;
		// Wire messages are plain JSON objects by construction (src/p2p/wire.ts).
		action.send(message as DataPayload, { target: targets }).catch(() => {
			this.#sendFailures++;
		});
	}
}

/** The STUN URLs of an ICE configuration (src/call/ice.ts puts them in one entry). */
function stunUrls(rtc: RTCConfiguration): string[] {
	return (rtc.iceServers ?? []).flatMap(({ urls }) =>
		typeof urls === "string" ? [urls] : urls,
	);
}
