import { describe, expect, it } from "vitest";
import { rtcConfiguration } from "../../src/call/ice";
import { TABLE_OFFERS } from "../../src/p2p/limits";
import {
	type JoinMeshRoom,
	Mesh,
	type MeshHandlers,
	type MeshRoom,
	type TrackerSocket,
} from "../../src/p2p/mesh";
import { seatRendezvous } from "../../src/p2p/rendezvous";
import type { ProbeStun, StunAnswer } from "../../src/p2p/stun-probe";
import type { TorrentRoomConfig } from "../../src/p2p/torrent";
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
	joins: { roomId: string; config: TorrentRoomConfig }[];
} {
	const joins: { roomId: string; config: TorrentRoomConfig }[] = [];
	const joinRoom: JoinMeshRoom = (config, roomId) => {
		joins.push({ roomId, config });
		return emptyRoom();
	};
	const mesh = new Mesh(
		{
			tableId: TABLE,
			key: KEY,
			config: { trackers: ["wss://tracker.test"], rtc: {} },
			joinRoom,
			self: "0123456789AbCdEfGhIj",
			trackerSockets: () => ({}),
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

/** A tracker socket whose state and messages the test sets. */
class FakeSocket implements TrackerSocket {
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

/** A mesh over the given trackers, with sockets, a clock and a STUN probe that the test controls. */
function statusMesh(
	trackers: readonly string[],
	stun: { readonly urls: readonly string[]; readonly probe?: ProbeStun } = {
		urls: [],
	},
) {
	const sockets: Record<string, FakeSocket> = {};
	const clock = { now: 0 };
	const joins: TorrentRoomConfig[] = [];
	const mesh = new Mesh(
		{
			tableId: TABLE,
			key: KEY,
			config: { trackers, rtc: rtcConfiguration(stun.urls) },
			joinRoom: (config) => {
				joins.push(config);
				return emptyRoom();
			},
			self: "0123456789AbCdEfGhIj",
			trackerSockets: () => sockets,
			clock: { monotonic: () => clock.now, wall: () => clock.now },
			...(stun.probe === undefined ? {} : { probeStun: stun.probe }),
		},
		handlers,
	);
	return { mesh, sockets, clock, joins };
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
				config: { trackers: [A], rtc: {} },
				// Trystero opens its sockets during the join, and the reply can come before the first tick.
				joinRoom: () => {
					sockets[A] = new FakeSocket();
					return emptyRoom();
				},
				self: "0123456789AbCdEfGhIj",
				trackerSockets: () => sockets,
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

	it("joins no tracker, and Trystero none of its own, when the trackers are off", () => {
		const { mesh, joins } = statusMesh([]);
		expect(joins[0]?.relayConfig).toEqual({ urls: [], redundancy: 0 });
		expect(mesh.diagnostics().relays).toEqual([]);
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
