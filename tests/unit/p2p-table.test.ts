import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { botSeatHolder } from "../../src/bot/seats";
import { chatModule, chatPayload } from "../../src/game/chat";
import { newCommandId } from "../../src/ids";
import { randomNonce } from "../../src/p2p/checks";
import { deriveHolder, makeTag } from "../../src/p2p/keys";
import {
	BEAT_MS,
	BUTTON_MS,
	HOSTED_SEED_WAIT_MS,
	RESUME_ONLINE_MS,
	SEED_WAIT_MS,
	TICK_MS,
} from "../../src/p2p/limits";
import { LINK_VERSION } from "../../src/p2p/link";
import { creationCommit, LocalLog } from "../../src/p2p/log";
import type { MeshHandlers } from "../../src/p2p/mesh";
import {
	createTable,
	TableController,
	type TableMesh,
} from "../../src/p2p/table";
import type { CtlMessage, Roster } from "../../src/p2p/wire";
import { type RoomConfig, SEATS, type Seat } from "../../src/protocol";
import type { HoldOptions, SeatLocks } from "../../src/session";
import { settle, syncDigest, TestStorage, VirtualClock } from "./fake-mesh";
import { CONFIG, DIAGNOSTICS, TABLE } from "./p2p-fixtures";

const CLIENT = "clientN-0123456789abcd";

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
	readonly newerBuilds: string[] = [];
	readonly version = {
		buildDate: "2026-10-24T12:00:00Z",
		onNewerBuild: (date: string) => {
			this.newerBuilds.push(date);
		},
	};
	readonly clock = new VirtualClock();
	readonly storage = new TestStorage();
	readonly locks = new FakeLocks();
	left = 0;
	controller: TableController | null = null;
	handlers: MeshHandlers | null = null;
	/** The peers that the mesh has when the page starts. */
	peers: string[] = [];
	online = true;
	creator = true;
	community = false;
	config: RoomConfig = CONFIG;
	/** The seat from which this browser hosted the table last (the host record of src/session.ts). */
	hosted: Seat | undefined;
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
			online: () => this.online,
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
			...this.version,
			identity: { tableId: TABLE, client: CLIENT, holder },
			storage: this.storage,
			locks: this.locks,
			memory: {
				tabSeat: () => undefined,
				seatToReopen: () => remembered,
				remember: () => {},
				forget: () => {},
				hostSeat: () => this.hosted,
				rememberHost: (_roomId, hosted) => {
					this.hosted = hosted;
				},
				forgetHost: () => {
					this.hosted = undefined;
				},
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
			creator: this.creator,
			community: this.community,
			preferredSeat: seat,
			bootstrap: { config: this.config, host },
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

describe("reconnect build dates", () => {
	it("announces its Git date on each connection and only the older page asks to reload", async () => {
		await rig.start(null);
		const peer = "peer0000000000000000";
		rig.handlers?.join(peer);
		expect(rig.sentTo).toContainEqual({
			to: peer,
			message: { k: "build-date", date: "2026-10-24T12:00:00Z" },
		});
		const announce = (date: string) =>
			rig.handlers?.ctl(peer, {
				k: "build-date",
				date,
			} as unknown as CtlMessage);
		announce("2026-10-23T12:00:00Z");
		announce("2026-10-24T14:00:00+02:00");
		expect(rig.newerBuilds).toEqual([]);
		announce("2026-10-25T12:00:00Z");
		expect(rig.newerBuilds).toEqual(["2026-10-25T12:00:00Z"]);
		rig.handlers?.leave(peer);
		rig.handlers?.join(peer);
		expect(
			rig.sentTo.filter((item) => item.message.k === "build-date"),
		).toHaveLength(2);
	});
});

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

	it("opens the only seat that a solo link does not give to a bot, and seeds it at once", async () => {
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["N", "E", "W"], bidder: "sl" },
		};
		const table = await rig.start(undefined, undefined, "S");
		expect(table.view().seat).toBe("S");

		await rig.advance(2 * TICK_MS);

		expect(table.view().hosting).toBe(true);
	});

	it("opens no seat by itself from a solo link that does not name its player, so the player gives a name", async () => {
		rig.config = {
			...CONFIG,
			names: { ...CONFIG.names, S: "player" },
			botSetup: { seats: ["N", "E", "W"], bidder: "sl" },
		};
		const table = await rig.start(undefined, undefined, "S");
		expect(table.view().seat).toBeNull();
	});

	it("opens no seat by itself from a link with more than one seat for a person", async () => {
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["N", "E"], bidder: "sl" },
		};
		const table = await rig.start(undefined, undefined, "S");
		expect(table.view().seat).toBeNull();
	});

	it("opens the seat from which this browser hosted last when the URL names no seat and no seat is remembered", async () => {
		rig.hosted = "E";
		const table = await rig.start(undefined, undefined, "N");
		expect(table.view().seat).toBe("E");
	});

	it("opens the remembered seat before the seat from which this browser hosted last", async () => {
		rig.hosted = "E";
		const table = await rig.start(undefined, "W", "N");
		expect(table.view().seat).toBe("W");
	});

	it("opens no seat from the host record of a community table", async () => {
		rig.community = true;
		rig.hosted = "E";
		const table = await rig.start(undefined, undefined, "N");
		expect(table.view().seat).toBeNull();
	});
});

describe("table controller host record", () => {
	const EAST = "east000000000000000";

	it("records the seat from which the page hosts", async () => {
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["N", "E", "W"], bidder: "sl" },
		};
		const table = await rig.start("S");
		await rig.advance(2 * TICK_MS);
		expect(table.view().hosting).toBe(true);
		expect(rig.hosted).toBe("S");
	});

	it("keeps no host record for a community table", async () => {
		rig.community = true;
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["N", "E", "W"], bidder: "sl" },
		};
		const table = await rig.start("S");
		await rig.advance(2 * TICK_MS);
		expect(table.view().hosting).toBe(true);
		expect(rig.hosted).toBeUndefined();
	});

	it.each([
		["another browser", "clientE-0123456789abcd", undefined],
		["another tab of this browser", CLIENT, "N"],
	] as const)(
		"follows a host in %s and keeps the record only for this browser",
		async (_, client, kept) => {
			rig.hosted = "N";
			rig.peers = [EAST];
			const table = await rig.start(null);
			const holder = await deriveHolder(TABLE, client);
			const auth = { term: 2, tag: makeTag(holder, "E"), inc: 1 };
			rig.handlers?.ctl(EAST, {
				k: "beat",
				role: "host",
				holder,
				seat: "E",
				elig: true,
				auth,
				pos: { rev: 5, lastAuth: auth },
			});
			await settle();

			expect(table.view().election).toMatchObject({ phase: "lobby" });
			expect(rig.hosted).toBe(kept);
		},
	);
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

describe("offline host recovery", () => {
	async function save(bots: readonly Seat[]): Promise<void> {
		rig.config = { ...CONFIG, botSetup: { seats: bots, bidder: "sl" } };
		const holder = await deriveHolder(TABLE, CLIENT);
		expect(
			await createTable({
				storage: rig.storage,
				identity: { tableId: TABLE, client: CLIENT, holder },
				seat: "N",
				config: rig.config,
				module: chatModule,
				newId: newCommandId,
				clock: rig.clock,
				memory: { remember: () => {} },
				hostBots: true,
			}),
		).toMatchObject({ ok: true });
		rig.creator = false;
		rig.online = false;
	}

	it("resumes its saved host and accepts actions without a relay when all other seats belong to local bots", async () => {
		await save(["E", "S", "W"]);
		const table = await rig.start("N");
		await rig.advance(TICK_MS);
		expect(table.view()).toMatchObject({
			hosting: true,
			hostSeat: "N",
			ready: true,
			allConnected: true,
		});
		expect(await table.send(chatPayload(TABLE, "offline"))).toMatchObject({
			ok: true,
		});
		await settle();
		expect(table.entries().at(-1)).toMatchObject({
			kind: "cmd",
			payload: chatPayload(TABLE, "offline"),
		});
	});

	it("does not treat a multiplayer table as solo merely because its link names three bots", async () => {
		await save(["E", "S"]);
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["E", "S", "W"], bidder: "sl" },
		};
		const table = await rig.start("N");
		await rig.advance(RESUME_ONLINE_MS + TICK_MS);
		expect(table.view().hosting).toBe(false);
		rig.online = true;
		await rig.advance(RESUME_ONLINE_MS + TICK_MS);
		expect(table.view().hosting).toBe(true);
	});

	it("keeps multiplayer recovery when a bot plays a seat owned by another browser", async () => {
		await save(["E", "S", "W"]);
		const original = await rig.start("N");
		await rig.advance(TICK_MS);
		expect(await original.setBotSeat("W", false)).toBe(true);
		const peer = "west0000000000000000";
		rig.peers = [peer];
		rig.handlers?.join(peer);
		rig.handlers?.ctl(peer, {
			k: "hello",
			b: LINK_VERSION,
			client: "clientW-0123456789abcd",
			features: [],
		});
		await settle();
		rig.handlers?.ctl(peer, { k: "claim-seat", req: 1, seat: "W" });
		await settle();
		expect(rig.sentTo).toContainEqual({
			to: peer,
			message: expect.objectContaining({ k: "seat-result", ok: true }),
		});
		expect(await original.setBotSeat("W", true)).toBe(true);
		original.stop();
		rig.peers = [];
		const reopened = await rig.start("N");
		await rig.advance(RESUME_ONLINE_MS + TICK_MS);
		expect(reopened.view().hosting).toBe(false);
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
	it("recreates the configured local bot seats together with the human host", async () => {
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["N", "E", "W"], bidder: "sl" },
		};
		const table = await rig.start("S");
		await rig.advance(SEED_WAIT_MS + 2 * TICK_MS);
		for (const seat of ["N", "E", "W"] as const)
			expect(
				table.view().table?.seats.find((row) => row.seat === seat)?.holder,
			).toBe(await botSeatHolder(TABLE, seat));
		expect(table.view()).toMatchObject({
			hosting: true,
			ready: true,
			allConnected: true,
			roster: { bots: ["N", "E", "W"] },
		});
	});

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

	it("seeds a link whose other seats are all bots at once, as no other page can host it", async () => {
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["N", "E", "W"], bidder: "sl" },
		};
		const table = await rig.start("S");

		await rig.advance(2 * TICK_MS);

		expect(table.view().hosting).toBe(true);
	});

	it("seeds no table from a link whose other seats are all bots while beats show that the table exists", async () => {
		rig.config = {
			...CONFIG,
			botSetup: { seats: ["N", "E", "W"], bidder: "sl" },
		};
		const table = await rig.start("S");
		for (let beats = 0; beats < (3 * SEED_WAIT_MS) / BEAT_MS; beats++) {
			await eastBeat();
			await rig.advance(BEAT_MS);
		}

		expect(table.view().hosting).toBe(false);
		expect(rig.storage.commits).toBe(0);
	});

	it("tells a seated page that waits to seed that the table starts again from the link", async () => {
		const table = await rig.start("N");

		await rig.advance(BUTTON_MS + TICK_MS);

		expect(table.view().hosting).toBe(false);
		expect(table.view().election).toMatchObject({
			phase: "waiting-for-host",
			button: { enabled: false, reason: "seed" },
		});
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

	it("seeds while the only beats come from pages without the table that report a host lost long ago", async () => {
		// The only replica was lost (its browser cleared its data); East remembers the host, but has no entry.
		const holder = await deriveHolder(TABLE, "clientE-0123456789abcd");
		const host = await deriveHolder(TABLE, "clientW-0123456789abcd");
		const table = await rig.start("N");
		for (let beats = 0; beats < (2 * SEED_WAIT_MS) / BEAT_MS; beats++) {
			rig.handlers?.ctl("east000000000000000", {
				k: "beat",
				role: "follower",
				holder,
				seat: "E",
				elig: false,
				auth: { term: 1, tag: makeTag(host, "N"), inc: 1 },
				seenAgoMs: 60_000 + beats * BEAT_MS,
				pos: { rev: 0, lastAuth: null },
			});
			await settle();
			await rig.advance(BEAT_MS);
		}

		expect(table.view().hosting).toBe(true);
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

	it("keeps hosting the table that it seeds while a witness lower in the order is there", async () => {
		// host=S: the order is S, W, N, E. North is a witness: without one, the page cannot volunteer a new term on
		// the log that it seeds, and the creator's term 1 would not have to step down. The rig's own client is clientN.
		const holder = await deriveHolder(TABLE, "clientX-0123456789abcd");
		const table = await rig.start("W", undefined, "S");
		for (let beats = 0; beats < (2 * SEED_WAIT_MS) / BEAT_MS; beats++) {
			rig.handlers?.ctl("north00000000000000", {
				k: "beat",
				role: "follower",
				holder,
				seat: "N",
				elig: true,
				pos: { rev: 0, lastAuth: null },
				pref: "S",
			});
			await settle();
			await rig.advance(BEAT_MS);
		}

		expect(table.view().hosting).toBe(true);
		expect(rig.storage.commits).toBe(1);
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

	it("seeds the seat from which this browser hosted last after HOSTED_SEED_WAIT_MS alone", async () => {
		rig.hosted = "N";
		const table = await rig.start("N");
		await rig.advance(HOSTED_SEED_WAIT_MS / 2);
		expect(table.view().hosting).toBe(false);

		await rig.advance(HOSTED_SEED_WAIT_MS / 2 + 2 * TICK_MS);

		expect(table.view().hosting).toBe(true);
	});

	it("waits SEED_WAIT_MS on another seat than the one from which this browser hosted last", async () => {
		rig.hosted = "E";
		const table = await rig.start("N");
		await rig.advance(2 * HOSTED_SEED_WAIT_MS);
		expect(table.view().hosting).toBe(false);
	});

	it("seeds no table from the seat that this browser hosted while beats show that the table exists", async () => {
		rig.hosted = "N";
		const table = await rig.start("N");
		for (let beats = 0; beats < (3 * SEED_WAIT_MS) / BEAT_MS; beats++) {
			await eastBeat();
			await rig.advance(BEAT_MS);
		}
		expect(table.view().hosting).toBe(false);
		expect(rig.storage.commits).toBe(0);
	});

	it("does not seed from the seat that this browser hosted while a page higher in the order is there (rule 14)", async () => {
		rig.hosted = "N";
		const table = await rig.start("N", undefined, "S");
		for (let beats = 0; beats < (2 * SEED_WAIT_MS) / BEAT_MS; beats++) {
			await westBeat();
			await rig.advance(BEAT_MS);
		}
		expect(table.view().hosting).toBe(false);
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
