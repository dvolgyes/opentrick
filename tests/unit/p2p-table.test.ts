import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatModule, chatPayload } from "../../src/game/chat";
import { newCommandId } from "../../src/ids";
import { randomNonce } from "../../src/p2p/checks";
import { deriveHolder, makeTag } from "../../src/p2p/keys";
import { BEAT_MS, SEED_WAIT_MS, TICK_MS } from "../../src/p2p/limits";
import { LINK_VERSION } from "../../src/p2p/link";
import { creationCommit, LocalLog } from "../../src/p2p/log";
import type { MeshDiagnostics, MeshHandlers } from "../../src/p2p/mesh";
import { TableController, type TableMesh } from "../../src/p2p/table";
import type { CtlMessage, Roster } from "../../src/p2p/wire";
import { SEATS, type Seat } from "../../src/protocol";
import type { HoldOptions, SeatLocks } from "../../src/session";
import { settle, syncDigest, TestStorage, VirtualClock } from "./fake-mesh";
import { CONFIG, TABLE } from "./p2p-fixtures";

const CLIENT = "clientN-0123456789abcd";

const DIAGNOSTICS: MeshDiagnostics = {
	trackersOpen: 1,
	trackers: 1,
	nostrOpen: 0,
	nostrRelays: 0,
	mqttOpen: 0,
	mqttBrokers: 0,
	relays: [],
	stun: null,
	webRtc: null,
	peers: 0,
	wrongKey: 0,
	unreachable: 0,
	refused: 0,
	incompatible: 0,
	dropped: {
		malformed: 0,
		incompatible: 0,
		foreign: 0,
		oversize: 0,
		rate: 0,
		stranger: 0,
	},
	sendFailures: 0,
	pairRooms: 0,
	repaired: 0,
	pairTimeouts: 0,
	unattached: 0,
	rejoins: 0,
	silentCloses: [],
};

let restoreDigest: () => void;
beforeEach(() => {
	restoreDigest = syncDigest();
});
afterEach(() => restoreDigest());

/** Web Locks as one tab sees them: each `hold` is granted at once, and the test can take it away. */
class FakeLocks implements SeatLocks {
	readonly held = new Map<Seat, HoldOptions>();
	released: Seat[] = [];

	async heldElsewhere(): Promise<ReadonlySet<Seat>> {
		return new Set();
	}

	hold(_roomId: string, seat: Seat, options: HoldOptions = {}): () => void {
		this.held.set(seat, options);
		queueMicrotask(() => options.onAcquired?.());
		return () => {
			this.released.push(seat);
			this.held.delete(seat);
		};
	}

	/** Another tab steals the lock, as `navigator.locks.request` with `steal` does. */
	steal(seat: Seat): void {
		const options = this.held.get(seat);
		this.held.delete(seat);
		options?.onLost?.();
	}
}

class Rig {
	readonly clock = new VirtualClock();
	readonly storage = new TestStorage();
	readonly locks = new FakeLocks();
	left = 0;
	controller: TableController | null = null;
	handlers: MeshHandlers | null = null;
	/** The peers that the mesh has when the page starts. */
	peers: string[] = [];
	/** Every control message that the page sent, with its receiver. */
	readonly sentTo: {
		readonly to: string | null;
		readonly message: CtlMessage;
	}[] = [];
	/** Every control message that the page sent. */
	readonly sentCtl: CtlMessage[] = [];
	#tick: () => void = () => {};

	/** Moves the clock by `ms`, one controller tick at a time. */
	async advance(ms: number): Promise<void> {
		for (let at = 0; at < ms; at += TICK_MS) {
			this.clock.now += TICK_MS;
			this.#tick();
			await settle();
		}
	}

	/**
	 * `seat` is the URL seat (null: none); `remembered` is the seat that this browser reopens without one; `host` is
	 * the setup link's host seat, by default the seat that the page opens.
	 */
	async start(
		seat: Seat | null | undefined,
		remembered?: Seat,
		host: Seat = seat ?? remembered ?? "N",
	): Promise<TableController> {
		const holder = await deriveHolder(TABLE, CLIENT);
		const mesh: TableMesh = {
			self: "self0000000000000000",
			peers: () => this.peers,
			connection: () => undefined,
			online: () => true,
			diagnostics: () => DIAGNOSTICS,
			ctl: (peer, message) => {
				this.sentCtl.push(message);
				this.sentTo.push({ to: peer, message });
			},
			log: () => {},
			call: () => {},
			leave: async () => {
				this.left++;
			},
			seek: () => {},
			tick: () => {},
		};
		const controller = new TableController({
			identity: { tableId: TABLE, client: CLIENT, holder },
			storage: this.storage,
			locks: this.locks,
			memory: {
				tabSeat: () => undefined,
				seatToReopen: () => remembered,
				remember: () => {},
				forget: () => {},
			},
			module: chatModule,
			clock: this.clock,
			every: (_ms, tick) => {
				this.#tick = tick;
				return () => {
					this.#tick = () => {};
				};
			},
			openMesh: (handlers: MeshHandlers) => {
				this.handlers = handlers;
				return mesh;
			},
			newId: newCommandId,
			nonce: randomNonce,
			creator: true,
			preferredSeat: seat,
			bootstrap: { config: CONFIG, host },
		});
		this.controller = controller;
		await controller.start();
		await settle();
		return controller;
	}
}

let rig: Rig;
beforeEach(() => {
	rig = new Rig();
});
afterEach(() => rig.controller?.stop());

describe("table controller seat from the URL", () => {
	it("reopens the remembered seat when the URL names no seat", async () => {
		const table = await rig.start(undefined, "N");
		expect(table.view().seat).toBe("N");
	});

	it("opens no seat, not even the remembered one, when the URL says none", async () => {
		const table = await rig.start(null, "N");
		expect(table.view().seat).toBeNull();
		expect(rig.locks.held.size).toBe(0);
	});
});

describe("table controller beats", () => {
	it("names the setup link's host seat in each beat, also before the page has a table", async () => {
		await rig.start("W", undefined, "S");
		await rig.advance(BEAT_MS);
		const beats = rig.sentCtl.filter((message) => message.k === "beat");
		expect(beats.length).toBeGreaterThan(0);
		for (const beat of beats) expect(beat).toMatchObject({ pref: "S" });
	});
});

describe("table controller seat lock", () => {
	it("hosts the seat whose lock it holds", async () => {
		const table = await rig.start("N");
		await rig.advance(SEED_WAIT_MS);
		const view = table.view();
		expect(view.status).toBe("open");
		expect(view.seat).toBe("N");
		expect(view.hosting).toBe(true);
		expect(view.supersededBy).toBeNull();
		expect(rig.locks.held.has("N")).toBe(true);
	});

	it("stops at once and reports the other tab when another tab takes the seat lock", async () => {
		const table = await rig.start("N");
		await rig.advance(SEED_WAIT_MS);
		expect(await table.send(chatPayload(TABLE, "before"))).toMatchObject({
			ok: true,
		});
		await settle();
		const commits = rig.storage.commits;

		rig.locks.steal("N");

		const view = table.view();
		expect(view.status).toBe("superseded");
		expect(view.supersededBy).toBe("tab");
		expect(view.seat).toBeNull();
		expect(view.hosting).toBe(false);
		expect(rig.left).toBe(1);
		// The page no longer holds the lock, so it must not release the lock that the other tab now holds.
		expect(rig.locks.released).toEqual([]);
		expect(await table.send(chatPayload(TABLE, "after"))).toEqual({
			ok: false,
			code: "conflict",
		});
		await settle();
		expect(rig.storage.commits).toBe(commits);
	});

	it("releases the lock and ignores a later loss when the page stops first", async () => {
		const table = await rig.start("N");
		const options = rig.locks.held.get("N");
		table.stop();
		expect(rig.locks.released).toEqual(["N"]);

		options?.onLost?.();

		expect(table.view().supersededBy).toBeNull();
		expect(table.view().status).toBe("starting");
	});
});

describe("table controller seeding from the setup link", () => {
	/** A beat of East's page, which has a replica of the table that North hosted. */
	async function eastBeat(): Promise<void> {
		const holder = await deriveHolder(TABLE, "clientE-0123456789abcd");
		const host = await deriveHolder(TABLE, "clientW-0123456789abcd");
		rig.handlers?.ctl("east000000000000000", {
			k: "beat",
			role: "follower",
			holder,
			seat: "E",
			elig: true,
			auth: { term: 1, tag: makeTag(host, "N"), inc: 1 },
			seenAgoMs: 60_000,
			pos: {
				rev: 4,
				lastAuth: { term: 1, tag: makeTag(host, "N"), inc: 1 },
			},
		});
		await settle();
	}

	it("seeds the host seat only after the page was alone for SEED_WAIT_MS", async () => {
		const table = await rig.start("N");
		expect(table.view().seat).toBe("N");
		expect(table.view().hosting).toBe(false);
		await rig.advance(SEED_WAIT_MS - 2 * TICK_MS);
		expect(table.view().hosting).toBe(false);
		expect(rig.storage.commits).toBe(0);

		await rig.advance(4 * TICK_MS);

		expect(table.view().hosting).toBe(true);
	});

	it("seeds the host seat that a visitor chooses only after the page was alone for SEED_WAIT_MS", async () => {
		const table = await rig.start(null);
		expect(await table.choose("N")).toEqual({ ok: true });
		await settle();
		expect(table.view().hosting).toBe(false);

		await rig.advance(SEED_WAIT_MS + 2 * TICK_MS);

		expect(table.view().hosting).toBe(true);
	});

	it("seeds no table while beats show that the table exists", async () => {
		const table = await rig.start("N");
		await rig.advance(5_000);
		for (let beats = 0; beats < (3 * SEED_WAIT_MS) / BEAT_MS; beats++) {
			await eastBeat();
			await rig.advance(BEAT_MS);
		}

		expect(table.view().seat).toBe("N");
		expect(table.view().hosting).toBe(false);
		expect(rig.storage.commits).toBe(0);
	});

	/** A beat of West's page, which has no table either; its link names S as the host seat. */
	async function westBeat(): Promise<void> {
		const holder = await deriveHolder(TABLE, "clientW-0123456789abcd");
		rig.handlers?.ctl("west000000000000000", {
			k: "beat",
			role: "follower",
			holder,
			seat: "W",
			elig: true,
			pos: { rev: 0, lastAuth: null },
			pref: "S",
		});
		await settle();
	}

	it("seeds from another seat than the link's host seat when no page higher in the order is there (rule 14)", async () => {
		// host=S: the order is S, W, N, E.
		const table = await rig.start("N", undefined, "S");
		await rig.advance(SEED_WAIT_MS + 2 * TICK_MS);
		expect(table.view().hosting).toBe(true);
	});

	it("does not seed while a page higher in the order is there, and seeds when it leaves", async () => {
		const table = await rig.start("N", undefined, "S");
		for (let beats = 0; beats < (2 * SEED_WAIT_MS) / BEAT_MS; beats++) {
			await westBeat();
			await rig.advance(BEAT_MS);
		}
		expect(table.view().hosting).toBe(false);
		expect(rig.storage.commits).toBe(0);

		rig.handlers?.leave("west000000000000000");
		await settle();
		await rig.advance(2 * TICK_MS);

		expect(table.view().hosting).toBe(true);
	});

	it("seeds the host seat SEED_WAIT_MS after the last beat that showed the table", async () => {
		const table = await rig.start("N");
		await rig.advance(5_000);
		await eastBeat();
		rig.handlers?.leave("east000000000000000");
		await settle();

		await rig.advance(SEED_WAIT_MS - 2 * TICK_MS);
		expect(table.view().hosting).toBe(false);
		expect(rig.storage.commits).toBe(0);

		await rig.advance(4 * TICK_MS);

		expect(table.view().hosting).toBe(true);
	});
});

describe("table controller after a failed seat claim", () => {
	const EAST = "east000000000000000";
	const SOUTH = "south00000000000000";

	it("hosts later with the peers that connected before the failed claim", async () => {
		// This browser created the table at N and still has its replica; East hosts a later term.
		const holder = await deriveHolder(TABLE, CLIENT);
		const log = new LocalLog(rig.storage, TABLE, "N");
		const written = await log.write(() =>
			creationCommit({
				tableId: TABLE,
				seat: "N",
				holder,
				config: CONFIG,
				state: chatModule.initialState(TABLE, CONFIG),
				auth: { term: 1, tag: makeTag(holder, "N"), inc: 1 },
				id: newCommandId(),
				now: rig.clock.wall(),
			}),
		);
		expect(written.ok).toBe(true);
		rig.peers = [EAST, SOUTH];
		const table = await rig.start(null);
		const eastHolder = await deriveHolder(TABLE, "clientE-0123456789abcd");
		const southHolder = await deriveHolder(TABLE, "clientS-0123456789abcd");
		const auth = { term: 2, tag: makeTag(eastHolder, "E"), inc: 1 };
		const eastBeat = (): void =>
			rig.handlers?.ctl(EAST, {
				k: "beat",
				role: "host",
				holder: eastHolder,
				seat: "E",
				elig: true,
				auth,
				pos: { rev: 5, lastAuth: auth },
			});
		const southBeat = (): void =>
			rig.handlers?.ctl(SOUTH, {
				k: "beat",
				role: "follower",
				holder: southHolder,
				seat: "S",
				elig: true,
				pos: { rev: 0, lastAuth: null },
			});
		eastBeat();
		await settle();
		rig.handlers?.ctl(EAST, { k: "welcome", status: "unseated", auth });
		rig.handlers?.ctl(EAST, {
			k: "lobby",
			auth,
			config: CONFIG,
			idleMs: 0,
			seats: SEATS.map((seat) => ({
				seat,
				available: seat === "S",
				online: seat !== "S",
				mine: false,
			})),
		});
		await settle();

		// East gives South away before this page's claim arrives.
		expect(await table.choose("S")).toEqual({ ok: true });
		await settle();
		const claim = rig.sentCtl.find((message) => message.k === "claim-seat");
		if (claim?.k !== "claim-seat") throw new Error("no claim");
		rig.handlers?.ctl(EAST, {
			k: "seat-result",
			req: claim.req,
			ok: false,
			code: "taken",
		});
		await settle();
		expect(table.view().seat).toBeNull();

		// East leaves; the page reopens its own seat and hosts with South as the witness.
		rig.handlers?.leave(EAST);
		await settle();
		expect(await table.choose("N")).toEqual({ ok: true });
		for (
			let at = 0;
			at < 3 * SEED_WAIT_MS && !table.view().hosting;
			at += BEAT_MS
		) {
			southBeat();
			await rig.advance(BEAT_MS);
		}
		expect(table.view().hosting).toBe(true);

		// South, connected all the time, takes its seat; the host counts it as present.
		rig.handlers?.ctl(SOUTH, {
			k: "hello",
			b: LINK_VERSION,
			client: "clientS-0123456789abcd",
			features: [],
		});
		await settle();
		rig.handlers?.ctl(SOUTH, { k: "claim-seat", req: 1, seat: "S" });
		await settle();
		southBeat();
		await rig.advance(4 * TICK_MS);
		const rosters = rig.sentTo.filter(
			(item): item is { to: string | null; message: Roster } =>
				item.message.k === "roster" && item.to === SOUTH,
		);
		expect(rosters.at(-1)?.message.peers).toContainEqual(
			expect.objectContaining({ peer: SOUTH, seat: "S" }),
		);
	});
});
