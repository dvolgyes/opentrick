import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatModule, chatPayload } from "../../src/game/chat";
import { newCommandId } from "../../src/ids";
import { randomNonce } from "../../src/p2p/checks";
import { deriveHolder } from "../../src/p2p/keys";
import type { MeshDiagnostics, MeshHandlers } from "../../src/p2p/mesh";
import { TableController, type TableMesh } from "../../src/p2p/table";
import type { Seat } from "../../src/protocol";
import type { HoldOptions, SeatLocks } from "../../src/session";
import { settle, syncDigest, TestStorage, VirtualClock } from "./fake-mesh";
import { CONFIG, TABLE } from "./p2p-fixtures";

const CLIENT = "clientN-0123456789abcd";

const DIAGNOSTICS: MeshDiagnostics = {
	trackersOpen: 1,
	trackers: 1,
	nostrOpen: 0,
	nostrRelays: 0,
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

	/** `seat` is the URL seat (null: none); `remembered` is the seat that this browser reopens without one. */
	async start(
		seat: Seat | null | undefined,
		remembered?: Seat,
	): Promise<TableController> {
		const holder = await deriveHolder(TABLE, CLIENT);
		const mesh: TableMesh = {
			self: "self0000000000000000",
			peers: () => [],
			connection: () => undefined,
			online: () => true,
			diagnostics: () => DIAGNOSTICS,
			ctl: () => {},
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
			every: () => () => {},
			openMesh: (_handlers: MeshHandlers) => mesh,
			newId: newCommandId,
			nonce: randomNonce,
			creator: true,
			preferredSeat: seat,
			bootstrap: { config: CONFIG, host: seat ?? remembered ?? "N" },
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

describe("table controller seat lock", () => {
	it("hosts the seat whose lock it holds", async () => {
		const table = await rig.start("N");
		const view = table.view();
		expect(view.status).toBe("open");
		expect(view.seat).toBe("N");
		expect(view.hosting).toBe(true);
		expect(view.supersededBy).toBeNull();
		expect(rig.locks.held.has("N")).toBe(true);
	});

	it("stops at once and reports the other tab when another tab takes the seat lock", async () => {
		const table = await rig.start("N");
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
