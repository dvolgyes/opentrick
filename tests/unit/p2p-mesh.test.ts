import { describe, expect, it } from "vitest";
import { rtcConfiguration } from "../../src/call/ice";
import {
	NOSTR_SILENT_MS,
	REJOIN_MS,
	RELAY_CHECK_ANSWER_MS,
	RELAY_CHECK_MS,
	RELAY_SILENT_MS,
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
	stun: { readonly urls: readonly string[]; readonly probe?: ProbeStun } = {
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
			relayResting: (kind, url) => resting.has(`${kind} ${url}`),
			watchNetwork: (onChange) => {
				network.change = onChange;
				network.watching = true;
				return () => {
					network.watching = false;
				};
			},
			clock: { monotonic: () => clock.now, wall: () => clock.now },
			...(stun.probe === undefined ? {} : { probeStun: stun.probe }),
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
