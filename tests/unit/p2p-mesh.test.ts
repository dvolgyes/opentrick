import { describe, expect, it } from "vitest";
import { rtcConfiguration } from "../../src/call/ice";
import { REJOIN_MS, RELAY_SILENT_MS, TABLE_OFFERS } from "../../src/p2p/limits";
import {
	type JoinMeshRoom,
	Mesh,
	type MeshHandlers,
	type MeshRoom,
	type RelaySocket,
} from "../../src/p2p/mesh";
import { seatRendezvous } from "../../src/p2p/rendezvous";
import type { SignalingRoomConfig } from "../../src/p2p/signaling";
import type { ProbeStun, StunAnswer } from "../../src/p2p/stun-probe";
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
			config: { trackers: ["wss://tracker.test"], nostrRelays: [], rtc: {} },
			joinRoom,
			self: "0123456789AbCdEfGhIj",
			relaySockets: () => ({ tracker: {}, nostr: {} }),
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

/**
 * A mesh over the given trackers and Nostr relays, with sockets, a clock, a network and a STUN probe that the test
 * controls. `reconnects` records each socket that the mesh replaces, as "kind url".
 */
function statusMesh(
	trackers: readonly string[],
	stun: { readonly urls: readonly string[]; readonly probe?: ProbeStun } = {
		urls: [],
	},
	nostrRelays: readonly string[] = [],
) {
	const sockets: Record<string, FakeSocket> = {};
	const nostrSockets: Record<string, FakeSocket> = {};
	const clock = { now: 0 };
	const joins: SignalingRoomConfig[] = [];
	const reconnects: string[] = [];
	const network = { change: () => {}, watching: false };
	const mesh = new Mesh(
		{
			tableId: TABLE,
			key: KEY,
			config: { trackers, nostrRelays, rtc: rtcConfiguration(stun.urls) },
			joinRoom: (config) => {
				joins.push(config);
				return emptyRoom();
			},
			self: "0123456789AbCdEfGhIj",
			relaySockets: () => ({ tracker: sockets, nostr: nostrSockets }),
			reconnectRelay: (kind, url) => reconnects.push(`${kind} ${url}`),
			watchNetwork: (onChange) => {
				network.change = onChange;
				network.watching = true;
				return () => {
					network.watching = false;
				};
			},
			clock: { monotonic: () => clock.now, wall: () => clock.now },
			...(stun.probe === undefined ? {} : { probeStun: stun.probe }),
		},
		handlers,
	);
	return { mesh, sockets, nostrSockets, clock, joins, reconnects, network };
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
				config: { trackers: [A], nostrRelays: [], rtc: {} },
				// Trystero opens its sockets during the join, and the reply can come before the first tick.
				joinRoom: () => {
					sockets[A] = new FakeSocket();
					return emptyRoom();
				},
				self: "0123456789AbCdEfGhIj",
				relaySockets: () => ({ tracker: sockets, nostr: {} }),
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
	it("replaces an open relay socket that is silent for RELAY_SILENT_MS, once for each silence", () => {
		const { mesh, sockets, nostrSockets, clock, reconnects } = statusMesh(
			[A],
			undefined,
			[N],
		);
		sockets[A] = new FakeSocket();
		nostrSockets[N] = new FakeSocket();
		mesh.tick();
		clock.now = RELAY_SILENT_MS - 1_000;
		sockets[A].message();
		clock.now = RELAY_SILENT_MS;
		mesh.tick();
		expect(reconnects).toEqual([`nostr ${N}`]);
		clock.now = RELAY_SILENT_MS + 1_000;
		mesh.tick();
		expect(reconnects).toEqual([`nostr ${N}`]);
		clock.now = 2 * RELAY_SILENT_MS - 1_000;
		mesh.tick();
		expect(reconnects).toEqual([`nostr ${N}`, `tracker ${A}`]);
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
