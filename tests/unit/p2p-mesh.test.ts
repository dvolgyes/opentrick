import { describe, expect, it } from "vitest";
import { rtcConfiguration } from "../../src/call/ice";
import {
	LATE_TICK_MS,
	NOSTR_SILENT_MS,
	REJOIN_MS,
	RELAY_CHECK_ANSWER_MS,
	RELAY_CHECK_MS,
	RELAY_SILENT_MS,
	SILENT_LINK_MS,
	TABLE_OFFERS,
} from "../../src/p2p/limits";
import {
	type JoinMeshRoom,
	Mesh,
	type MeshHandlers,
	type MeshRoom,
	type RelaySocket,
} from "../../src/p2p/mesh";
import type { RelayCheckAnswer } from "../../src/p2p/relay-check";
import { seatRendezvous } from "../../src/p2p/rendezvous";
import type {
	DataPayload,
	MessageAction,
	SignalingRoomConfig,
} from "../../src/p2p/signaling";
import type { ProbeStun, StunAnswer } from "../../src/p2p/stun-probe";
import type { CheckWebRtc, WebRtcReport } from "../../src/p2p/webrtc-check";
import { TABLE } from "./p2p-fixtures";

const KEY = "k".repeat(43);

/** A room without peers; actions send nothing. */
function emptyRoom(): MeshRoom {
	return {
		makeAction: () => ({
			send: async () => {},
			onMessage: null,
			onReceiveProgress: null,
			onReceive: null,
		}),
		getPeers: () => ({}),
		leave: async () => {},
		onPeerJoin: null,
		onPeerLeave: null,
	};
}

const handlers: MeshHandlers = {
	join: () => {},
	leave: () => {},
	ctl: () => {},
	log: () => {},
	call: () => {},
	change: () => {},
};

/** A mesh whose `joinRoom` records the room ID and config of each join. */
function recordingMesh(): {
	mesh: Mesh;
	joins: { roomId: string; config: SignalingRoomConfig }[];
} {
	const joins: { roomId: string; config: SignalingRoomConfig }[] = [];
	const joinRoom: JoinMeshRoom = (config, roomId) => {
		joins.push({ roomId, config });
		return emptyRoom();
	};
	const mesh = new Mesh(
		{
			tableId: TABLE,
			key: KEY,
			config: {
				trackers: ["wss://tracker.test"],
				nostrRelays: [],
				mqttBrokers: [],
				rtc: {},
			},
			joinRoom,
			self: "0123456789AbCdEfGhIj",
			relaySockets: () => ({ tracker: {}, nostr: {}, mqtt: {} }),
			reconnectRelay: () => {},
			clock: { monotonic: () => 0, wall: () => 0 },
		},
		handlers,
	);
	return { mesh, joins };
}

describe("the mesh's tracker offers", () => {
	it("asks for an offer to each other seat in each announce of the table room", () => {
		const { joins } = recordingMesh();
		expect(joins).toEqual([
			{
				roomId: TABLE,
				config: expect.objectContaining({ offersPerAnnounce: TABLE_OFFERS }),
			},
		]);
	});

	it("keeps Trystero's one offer in a pair room", async () => {
		const { mesh, joins } = recordingMesh();
		mesh.seek(new Map([[seatRendezvous("N", "E"), ""]]));
		await expect
			.poll(() => {
				mesh.tick();
				return joins.length;
			})
			.toBe(2);
		expect(joins[1]?.roomId).not.toBe(TABLE);
		expect(joins[1]?.config).not.toHaveProperty("offersPerAnnounce");
	});
});

/** A relay socket whose state and messages the test sets. */
class FakeSocket implements RelaySocket {
	readyState = 1;
	readonly listeners = new Set<() => void>();
	addEventListener(_type: "message", listener: () => void): void {
		this.listeners.add(listener);
	}
	removeEventListener(_type: "message", listener: () => void): void {
		this.listeners.delete(listener);
	}
	message(): void {
		for (const listener of this.listeners) listener();
	}
}

const A = "wss://a.test";
const B = "wss://b.test";
const C = "wss://c.test";
const N = "wss://n.test";

interface RelayCheckFake {
	on: boolean;
	readonly asked: {
		readonly url: string;
		readonly answer: (answer: RelayCheckAnswer) => void;
	}[];
}

/**
 * A mesh over the given trackers and Nostr relays, with sockets, a clock, a network and a STUN probe that the test
 * controls. `reconnects` records each socket that the mesh replaces, as "kind url". With `checks`, the mesh has the
 * frequent relay checks, turned on or off by `checks.on`; each check is in `checks.asked` until the test answers it.
 */
function statusMesh(
	trackers: readonly string[],
	stun: {
		readonly urls: readonly string[];
		readonly probe?: ProbeStun;
		readonly checkWebRtc?: CheckWebRtc;
	} = {
		urls: [],
	},
	nostrRelays: readonly string[] = [],
	checks?: RelayCheckFake,
) {
	const sockets: Record<string, FakeSocket> = {};
	const nostrSockets: Record<string, FakeSocket> = {};
	const clock = { now: 0 };
	const joins: SignalingRoomConfig[] = [];
	const reconnects: string[] = [];
	const resting = new Set<string>();
	const network = { change: () => {}, shown: () => {}, watching: false };
	const mesh = new Mesh(
		{
			tableId: TABLE,
			key: KEY,
			config: {
				trackers,
				nostrRelays,
				mqttBrokers: [],
				rtc: rtcConfiguration(stun.urls),
			},
			joinRoom: (config) => {
				joins.push(config);
				return emptyRoom();
			},
			self: "0123456789AbCdEfGhIj",
			relaySockets: () => ({
				tracker: sockets,
				nostr: nostrSockets,
				mqtt: {},
			}),
			reconnectRelay: (kind, url) => reconnects.push(`${kind} ${url}`),
			relayResting: (kind, url) => resting.has(`${kind} ${url}`),
			watchNetwork: (onChange, onShown) => {
				network.change = onChange;
				network.shown = onShown;
				network.watching = true;
				return () => {
					network.watching = false;
				};
			},
			clock: { monotonic: () => clock.now, wall: () => clock.now },
			...(stun.probe === undefined ? {} : { probeStun: stun.probe }),
			...(stun.checkWebRtc === undefined
				? {}
				: { checkWebRtc: stun.checkWebRtc }),
			...(checks === undefined
				? {}
				: {
						relayChecks: {
							on: () => checks.on,
							check: (url: string) =>
								new Promise<RelayCheckAnswer>((resolve) =>
									checks.asked.push({ url, answer: resolve }),
								),
						},
					}),
		},
		handlers,
	);
	return {
		mesh,
		sockets,
		nostrSockets,
		clock,
		joins,
		reconnects,
		resting,
		network,
	};
}

describe("the mesh's evidence that the trackers are alive", () => {
	it("reports each tracker's socket state and how long ago it last sent a message", () => {
		const { mesh, sockets, clock } = statusMesh([A, B, C]);
		sockets[A] = new FakeSocket();
		sockets[B] = new FakeSocket();
		const closed = new FakeSocket();
		closed.readyState = 3;
		sockets[C] = closed;
		mesh.tick();
		clock.now = 1_000;
		sockets[A].message();
		closed.message();
		clock.now = 4_000;
		expect(mesh.diagnostics().relays).toEqual([
			{ kind: "tracker", url: A, open: true, heardAgoMs: 3_000 },
			{ kind: "tracker", url: B, open: true, heardAgoMs: undefined },
			{ kind: "tracker", url: C, open: false, heardAgoMs: 3_000 },
		]);
		expect(mesh.diagnostics().trackersOpen).toBe(2);
	});

	it("hears a tracker's first reply on a socket that the join opened", () => {
		const sockets: Record<string, FakeSocket> = {};
		const mesh = new Mesh(
			{
				tableId: TABLE,
				key: KEY,
				config: { trackers: [A], nostrRelays: [], mqttBrokers: [], rtc: {} },
				// Trystero opens its sockets during the join, and the reply can come before the first tick.
				joinRoom: () => {
					sockets[A] = new FakeSocket();
					return emptyRoom();
				},
				self: "0123456789AbCdEfGhIj",
				relaySockets: () => ({ tracker: sockets, nostr: {}, mqtt: {} }),
				reconnectRelay: () => {},
				clock: { monotonic: () => 0, wall: () => 0 },
			},
			handlers,
		);
		sockets[A]?.message();
		expect(mesh.diagnostics().relays[0]?.heardAgoMs).toBe(0);
	});

	it("listens on the new socket after a reconnect, and lets go of the old one", () => {
		const { mesh, sockets, clock } = statusMesh([A]);
		const old = new FakeSocket();
		sockets[A] = old;
		mesh.tick();
		expect(old.listeners.size).toBe(1);
		const renewed = new FakeSocket();
		sockets[A] = renewed;
		mesh.tick();
		expect(old.listeners.size).toBe(0);
		clock.now = 2_000;
		renewed.message();
		clock.now = 2_500;
		expect(mesh.diagnostics().relays[0]?.heardAgoMs).toBe(500);
	});

	it("removes its listeners when it leaves", async () => {
		const { mesh, sockets } = statusMesh([A]);
		sockets[A] = new FakeSocket();
		mesh.tick();
		await mesh.leave();
		expect(sockets[A].listeners.size).toBe(0);
	});

	it("joins no relay when the trackers and the Nostr relays are off", () => {
		const { mesh, joins } = statusMesh([]);
		expect(joins[0]).toMatchObject({ trackerUrls: [], nostrRelayUrls: [] });
		expect(mesh.diagnostics().relays).toEqual([]);
	});
});

describe("the mesh's evidence that the Nostr relays are alive", () => {
	it("reports the trackers, then the Nostr relays, and counts the open sockets of each kind", () => {
		const { mesh, sockets, nostrSockets, clock, joins } = statusMesh(
			[A],
			undefined,
			[N],
		);
		expect(joins[0]).toMatchObject({ trackerUrls: [A], nostrRelayUrls: [N] });
		sockets[A] = new FakeSocket();
		nostrSockets[N] = new FakeSocket();
		mesh.tick();
		clock.now = 1_000;
		nostrSockets[N].message();
		clock.now = 1_500;
		expect(mesh.diagnostics().relays).toEqual([
			{ kind: "tracker", url: A, open: true, heardAgoMs: undefined },
			{ kind: "nostr", url: N, open: true, heardAgoMs: 500 },
		]);
		expect(mesh.diagnostics()).toMatchObject({
			trackersOpen: 1,
			trackers: 1,
			nostrOpen: 1,
			nostrRelays: 1,
		});
	});

	it("is online with only a Nostr relay open", () => {
		const { mesh, nostrSockets } = statusMesh([], undefined, [N]);
		expect(mesh.online()).toBe(false);
		nostrSockets[N] = new FakeSocket();
		expect(mesh.online()).toBe(true);
	});
});

describe("the mesh's recovery of its relays", () => {
	it("replaces an open tracker socket that is silent for RELAY_SILENT_MS, once for each silence", () => {
		const { mesh, sockets, clock, reconnects } = statusMesh([A, B]);
		sockets[A] = new FakeSocket();
		sockets[B] = new FakeSocket();
		mesh.tick();
		clock.now = NOSTR_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([]);
		clock.now = RELAY_SILENT_MS - 1_000;
		sockets[A].message();
		clock.now = RELAY_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([`tracker ${B}`]);
		clock.now = RELAY_SILENT_MS + 1_000;
		mesh.tick();
		expect(reconnects).toEqual([`tracker ${B}`]);
		clock.now = 2 * RELAY_SILENT_MS - 1_000;
		mesh.tick();
		expect(reconnects).toEqual([`tracker ${B}`, `tracker ${A}`]);
	});

	it("replaces an open Nostr socket that is silent for NOSTR_SILENT_MS, once for each silence", () => {
		const { mesh, nostrSockets, clock, reconnects } = statusMesh(
			[],
			undefined,
			[N],
		);
		nostrSockets[N] = new FakeSocket();
		mesh.tick();
		clock.now = NOSTR_SILENT_MS - 1;
		mesh.tick();
		expect(reconnects).toEqual([]);
		clock.now = NOSTR_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([`nostr ${N}`]);
		clock.now = 2 * NOSTR_SILENT_MS - 1;
		mesh.tick();
		expect(reconnects).toEqual([`nostr ${N}`]);
		clock.now = 2 * NOSTR_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([`nostr ${N}`, `nostr ${N}`]);
	});

	it("leaves a relay that rests after a rate limit, and counts its silence from the end of the rest", () => {
		const { mesh, nostrSockets, clock, reconnects, resting } = statusMesh(
			[],
			undefined,
			[N],
		);
		nostrSockets[N] = new FakeSocket();
		resting.add(`nostr ${N}`);
		mesh.tick();
		clock.now = 3 * NOSTR_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([]);
		resting.clear();
		mesh.tick();
		clock.now = 4 * NOSTR_SILENT_MS - 1;
		mesh.tick();
		expect(reconnects).toEqual([]);
		clock.now = 4 * NOSTR_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([`nostr ${N}`]);
	});

	describe("with the frequent relay checks", () => {
		/** Lets the mesh take a check's answer. */
		const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

		function checkedMesh(on: boolean) {
			const checks: RelayCheckFake = { on, asked: [] };
			const made = statusMesh([A], undefined, [N], checks);
			made.sockets[A] = new FakeSocket();
			made.nostrSockets[N] = new FakeSocket();
			made.mesh.tick();
			return { ...made, checks };
		}

		it("sends no check while the setting is off", () => {
			const { mesh, clock, reconnects, checks } = checkedMesh(false);
			clock.now = NOSTR_SILENT_MS - 1;
			mesh.tick();
			expect(checks.asked).toEqual([]);
			expect(reconnects).toEqual([]);
			clock.now = NOSTR_SILENT_MS;
			mesh.tick();
			expect(reconnects).toEqual([`nostr ${N}`]);
		});

		it("checks a Nostr relay silent for RELAY_CHECK_MS, once at a time, and replaces it when the check gets no answer", async () => {
			const { mesh, clock, reconnects, checks } = checkedMesh(true);
			clock.now = RELAY_CHECK_MS - 1;
			mesh.tick();
			expect(checks.asked).toEqual([]);
			clock.now = RELAY_CHECK_MS;
			mesh.tick();
			clock.now = RELAY_CHECK_MS + 5_000;
			mesh.tick();
			expect(checks.asked.map((check) => check.url)).toEqual([N]);
			checks.asked[0]?.answer("silent");
			await settle();
			clock.now = RELAY_CHECK_MS + RELAY_CHECK_ANSWER_MS;
			mesh.tick();
			expect(reconnects).toEqual([`nostr ${N}`]);
			// The new socket gets its first check after RELAY_CHECK_MS of its own silence.
			clock.now += RELAY_CHECK_MS - 1;
			mesh.tick();
			expect(checks.asked).toHaveLength(1);
			clock.now += 1;
			mesh.tick();
			expect(checks.asked).toHaveLength(2);
		});

		it("keeps a relay that answers, and checks it again after the next silence", async () => {
			const { mesh, nostrSockets, clock, reconnects, checks } =
				checkedMesh(true);
			clock.now = RELAY_CHECK_MS;
			mesh.tick();
			clock.now = RELAY_CHECK_MS + 100;
			nostrSockets[N]?.message();
			checks.asked[0]?.answer("answered");
			await settle();
			mesh.tick();
			clock.now = 2 * RELAY_CHECK_MS + 99;
			mesh.tick();
			expect(checks.asked).toHaveLength(1);
			clock.now = 2 * RELAY_CHECK_MS + 100;
			mesh.tick();
			expect(checks.asked).toHaveLength(2);
			expect(reconnects).toEqual([]);
		});

		it("keeps a relay whose check got no answer when the relay sent something after the check", async () => {
			const { mesh, nostrSockets, clock, reconnects, checks } =
				checkedMesh(true);
			clock.now = RELAY_CHECK_MS;
			mesh.tick();
			clock.now = RELAY_CHECK_MS + 1_000;
			nostrSockets[N]?.message();
			checks.asked[0]?.answer("silent");
			await settle();
			clock.now = RELAY_CHECK_MS + RELAY_CHECK_ANSWER_MS;
			mesh.tick();
			expect(reconnects).toEqual([]);
		});

		it("does not check again a relay that refused a check, and keeps NOSTR_SILENT_MS for it", async () => {
			const { mesh, clock, reconnects, checks } = checkedMesh(true);
			clock.now = RELAY_CHECK_MS;
			mesh.tick();
			checks.asked[0]?.answer("refused");
			await settle();
			clock.now = NOSTR_SILENT_MS - 1;
			mesh.tick();
			expect(checks.asked).toHaveLength(1);
			expect(reconnects).toEqual([]);
			clock.now = NOSTR_SILENT_MS;
			mesh.tick();
			expect(reconnects).toEqual([`nostr ${N}`]);
		});

		it("does not check a tracker, or a relay that rests the page", () => {
			const { mesh, clock, resting, checks } = checkedMesh(true);
			resting.add(`nostr ${N}`);
			clock.now = 2 * RELAY_CHECK_MS;
			mesh.tick();
			expect(checks.asked).toEqual([]);
		});
	});

	it("leaves a closed socket to its own retries", () => {
		const { mesh, sockets, clock, reconnects } = statusMesh([A]);
		const closed = new FakeSocket();
		closed.readyState = 3;
		sockets[A] = closed;
		mesh.tick();
		clock.now = 3 * RELAY_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([]);
	});

	it("replaces each relay socket when the network changes, and a page alone joins the table room again at once", () => {
		const { mesh, sockets, clock, reconnects, network, joins } = statusMesh(
			[A],
			undefined,
			[N],
		);
		sockets[A] = new FakeSocket();
		mesh.tick();
		clock.now = 2_000;
		mesh.tick();
		expect(mesh.diagnostics().rejoins).toBe(0);
		network.change();
		expect(reconnects).toEqual([`tracker ${A}`, `nostr ${N}`]);
		mesh.tick();
		expect(mesh.diagnostics().rejoins).toBe(1);
		expect(joins).toHaveLength(2);
		// Only the first rejoin after the change is at once; the next one waits REJOIN_MS again.
		clock.now = 2_000 + REJOIN_MS - 1;
		mesh.tick();
		expect(mesh.diagnostics().rejoins).toBe(1);
		clock.now = 2_000 + REJOIN_MS;
		mesh.tick();
		expect(mesh.diagnostics().rejoins).toBe(2);
	});

	it("waits for an open relay before the rejoin after a network change", () => {
		const { mesh, sockets, clock, network } = statusMesh([A]);
		const socket = new FakeSocket();
		socket.readyState = 0;
		sockets[A] = socket;
		mesh.tick();
		network.change();
		clock.now = 1_000;
		mesh.tick();
		expect(mesh.diagnostics().rejoins).toBe(0);
		socket.readyState = 1;
		clock.now = 1_500;
		mesh.tick();
		expect(mesh.diagnostics().rejoins).toBe(1);
	});

	it("reconnects its closed relays at once when the page is shown again, and a page alone joins the table room again at once", () => {
		const { mesh, sockets, nostrSockets, clock, reconnects, network } =
			statusMesh([A, B], undefined, [N]);
		sockets[A] = new FakeSocket();
		const closed = new FakeSocket();
		closed.readyState = 3;
		sockets[B] = closed;
		nostrSockets[N] = new FakeSocket();
		mesh.tick();
		clock.now = 1_000;
		mesh.tick();
		network.shown();
		// Trystero opens a closed socket again only after its retry wait, up to 60 s; an open socket stays.
		expect(reconnects).toEqual([`tracker ${B}`]);
		mesh.tick();
		expect(mesh.diagnostics().rejoins).toBe(1);
	});

	it("replaces each relay socket when the page is shown again after its timers stopped, as after a network change", () => {
		const { mesh, sockets, clock, reconnects, network } = statusMesh(
			[A],
			undefined,
			[N],
		);
		sockets[A] = new FakeSocket();
		mesh.tick();
		// A phone can suspend a hidden page; its sockets can look open and deliver nothing.
		clock.now = LATE_TICK_MS + 1;
		network.shown();
		expect(reconnects).toEqual([`tracker ${A}`, `nostr ${N}`]);
	});

	it("stops watching the network when it leaves", async () => {
		const { mesh, network, reconnects } = statusMesh([A]);
		expect(network.watching).toBe(true);
		await mesh.leave();
		expect(network.watching).toBe(false);
		expect(reconnects).toEqual([]);
	});
});

describe("the mesh's STUN checks", () => {
	it("asks each STUN server at the start and reports the answers", async () => {
		const asked: string[] = [];
		const answers: Record<string, StunAnswer> = {
			"stun:a.test": "answered",
			"stun:b.test": "no-answer",
		};
		const { mesh } = statusMesh([A], {
			urls: Object.keys(answers),
			probe: async (url) => {
				asked.push(url);
				return answers[url] ?? "no-answer";
			},
		});
		expect(asked).toEqual(["stun:a.test", "stun:b.test"]);
		expect(mesh.diagnostics().stun).toEqual([
			{ url: "stun:a.test", state: "checking" },
			{ url: "stun:b.test", state: "checking" },
		]);
		await expect
			.poll(() => mesh.diagnostics().stun)
			.toEqual([
				{ url: "stun:a.test", state: "answered" },
				{ url: "stun:b.test", state: "no-answer" },
			]);
	});

	it("reports no STUN result on a page that does not check", () => {
		const { mesh } = statusMesh([A], { urls: ["stun:a.test"] });
		expect(mesh.diagnostics().stun).toBeNull();
	});
});

describe("the mesh's WebRTC check", () => {
	const report = (candidates: string[]): WebRtcReport => ({
		kind: "checked",
		candidates,
		channel: "open",
	});

	it("checks WebRTC at the start and again after a network change, and reports the newest result", async () => {
		const pending: ((report: WebRtcReport) => void)[] = [];
		const { mesh, network } = statusMesh([A], {
			urls: [],
			checkWebRtc: () => new Promise((resolve) => pending.push(resolve)),
		});
		expect(pending).toHaveLength(1);
		expect(mesh.diagnostics().webRtc).toBeNull();
		pending[0]?.(report(["host IPv4", "srflx IPv4"]));
		await expect
			.poll(() => mesh.diagnostics().webRtc)
			.toEqual(report(["host IPv4", "srflx IPv4"]));

		network.change();
		expect(pending).toHaveLength(2);
		pending[1]?.(report(["host IPv6"]));
		await expect
			.poll(() => mesh.diagnostics().webRtc)
			.toEqual(report(["host IPv6"]));
	});

	it("keeps the result of the newest check when an older check ends later", async () => {
		const pending: ((report: WebRtcReport) => void)[] = [];
		const { mesh, network } = statusMesh([A], {
			urls: [],
			checkWebRtc: () => new Promise((resolve) => pending.push(resolve)),
		});
		network.change();
		pending[1]?.(report(["host IPv6"]));
		await expect
			.poll(() => mesh.diagnostics().webRtc)
			.toEqual(report(["host IPv6"]));
		pending[0]?.(report(["host IPv4"]));
		await Promise.resolve();
		expect(mesh.diagnostics().webRtc).toEqual(report(["host IPv6"]));
	});

	it("reports no WebRTC result on a page that does not check", () => {
		const { mesh } = statusMesh([A]);
		expect(mesh.diagnostics().webRtc).toBeNull();
	});
});

/** A peer connection that records the close and the events that the mesh dispatches on it. */
class FakeLink {
	closed = false;
	readonly events: string[] = [];
	close(): void {
		this.closed = true;
	}
	dispatchEvent(event: Event): boolean {
		this.events.push(event.type);
		return true;
	}
}

/** A table room whose peers, and the messages that they send, the test controls. */
class LinkRoom implements MeshRoom {
	readonly links: Record<string, FakeLink> = {};
	readonly #actions: MessageAction<DataPayload>[] = [];
	onPeerJoin: ((peerId: string) => void) | null = null;
	onPeerLeave: ((peerId: string) => void) | null = null;
	makeAction(): MessageAction<DataPayload> {
		const action: MessageAction<DataPayload> = {
			send: async () => {},
			onMessage: null,
			onReceiveProgress: null,
			onReceive: null,
		};
		this.#actions.push(action);
		return action;
	}
	getPeers(): Record<string, RTCPeerConnection> {
		return this.links as unknown as Record<string, RTCPeerConnection>;
	}
	async leave(): Promise<void> {}
	connect(peer: string): void {
		this.links[peer] = new FakeLink();
		this.onPeerJoin?.(peer);
	}
	/** The start of a message from the peer on the action with this index (ctl, log, call, mesh). */
	receive(peer: string, index: number): void {
		void this.#actions[index]?.onReceive?.({
			peerId: peer,
			byteLength: 10,
			kind: "message",
			signal: new AbortController().signal,
		});
	}
}

const P = "PPPPPPPPPPPPPPPPPPPP";
const Q = "QQQQQQQQQQQQQQQQQQQQ";

/** A mesh in one LinkRoom; `silent.on` turns the close of silent links on, and `left` records each leave. */
function linkMesh(on = true) {
	const room = new LinkRoom();
	const clock = { now: 0 };
	const silent = { on };
	const left: string[] = [];
	const mesh = new Mesh(
		{
			tableId: TABLE,
			key: KEY,
			config: { trackers: [A], nostrRelays: [], mqttBrokers: [], rtc: {} },
			joinRoom: () => room,
			self: "0123456789AbCdEfGhIj",
			relaySockets: () => ({ tracker: {}, nostr: {}, mqtt: {} }),
			reconnectRelay: () => {},
			silentLinks: () => silent.on,
			clock: { monotonic: () => clock.now, wall: () => 1_000_000 + clock.now },
		},
		{ ...handlers, leave: (peer) => left.push(peer) },
	);
	/** Ticks every 500 ms, as the table does, until `to`. */
	const advance = (to: number) => {
		while (clock.now < to) {
			clock.now = Math.min(to, clock.now + 500);
			mesh.tick();
		}
	};
	return { mesh, room, clock, silent, left, advance };
}

describe("the mesh's close of a silent link", () => {
	it("closes a link that sent nothing for SILENT_LINK_MS, and keeps a link that sent any message", () => {
		const { mesh, room, left, advance } = linkMesh();
		room.connect(P);
		room.connect(Q);
		advance(5_000);
		room.receive(Q, 0);
		advance(10_000);
		room.receive(Q, 1);
		advance(14_000);
		room.receive(Q, 2);
		advance(SILENT_LINK_MS - 500);
		expect(left).toEqual([]);
		expect(room.links[P]?.closed).toBe(false);
		advance(SILENT_LINK_MS);
		// Trystero sees the close only at a connection state change, which a local close does not fire.
		expect(room.links[P]).toMatchObject({
			closed: true,
			events: ["connectionstatechange"],
		});
		expect(left).toEqual([P]);
		expect(mesh.peers()).toEqual([Q]);
		expect(mesh.diagnostics().silentCloses).toEqual([
			{ peer: P, at: 1_000_000 + SILENT_LINK_MS, silentMs: SILENT_LINK_MS },
		]);
		room.receive(Q, 3);
		advance(2 * SILENT_LINK_MS - 500);
		expect(room.links[Q]?.closed).toBe(false);
		advance(2 * SILENT_LINK_MS);
		expect(left).toEqual([P, Q]);
	});

	it("keeps every link while the setting is off, and closes a silent one when it is turned on", () => {
		const { mesh, room, silent, left, advance } = linkMesh(false);
		room.connect(P);
		advance(4 * SILENT_LINK_MS);
		expect(left).toEqual([]);
		expect(room.links[P]?.closed).toBe(false);
		expect(mesh.diagnostics().silentCloses).toEqual([]);
		silent.on = true;
		advance(4 * SILENT_LINK_MS + 500);
		expect(left).toEqual([P]);
	});

	it("keeps every link after a tick as late as LATE_TICK_MS, because this page was paused, not its peers", () => {
		const { mesh, room, clock, left, advance } = linkMesh();
		room.connect(P);
		advance(1_000);
		clock.now = 1_000 + LATE_TICK_MS + 1;
		mesh.tick();
		advance(clock.now + SILENT_LINK_MS - 500);
		expect(left).toEqual([]);
		advance(clock.now + 500);
		expect(left).toEqual([P]);
	});

	it("ignores a message from a peer that it did not admit", () => {
		const { mesh, room, left, advance } = linkMesh();
		room.connect(P);
		advance(SILENT_LINK_MS);
		expect(left).toEqual([P]);
		// The closed peer's late message neither admits it again nor counts as a link.
		room.receive(P, 0);
		advance(2 * SILENT_LINK_MS);
		expect(left).toEqual([P]);
		expect(mesh.diagnostics().silentCloses).toHaveLength(1);
	});
});
