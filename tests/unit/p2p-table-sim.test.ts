import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatModule, chatPayload } from "../../src/game/chat";
import { deriveHolder, tagSeat } from "../../src/p2p/keys";
import { SEED_WAIT_MS } from "../../src/p2p/limits";
import type { MeshHandlers } from "../../src/p2p/mesh";
import {
	createTable,
	TableController,
	type TableMesh,
	type TableView,
} from "../../src/p2p/table";
import { SEATS, type Seat } from "../../src/protocol";
import type { SeatLocks } from "../../src/session";
import { FakeMesh, peerId, syncDigest, TestStorage } from "./fake-mesh";
import { CONFIG, commandId, DIAGNOSTICS, TABLE } from "./p2p-fixtures";

/**
 * Plan step 8: four table controllers over the fake mesh, with the real election, replication and host engine. In
 * half of the seeds a creator at a random seat has the table; in the other half the four pages open setup links
 * without one, and a page seeds it (election rule 14). The pages open at random times. A noisy phase brings chat
 * entries, closes, reloads, cleared site data and splits; in a third of the seeds one link names another host seat.
 * The quiet phase stops the noise, joins every split and opens the four seats again. At the end:
 *
 * (a) one page hosts, and every page shows it as the host;
 * (b) the table binds each seat to the browser at that seat now, and every page is ready;
 * (c) every page has the host's log;
 * (d) when the links name one host seat, the table has at least as many entries as the largest stored log at the
 *     start of the quiet phase: a merge (rule 13) never gives a game away to a table with fewer entries.
 */

const SEEDS = 48;
const OPEN_MS: Range = [200, 40_000];
const NOISY_MS: Range = [90_000, 150_000];
const DISTURB_MS: Range = [1_000, 6_000];
const RELOAD_MS: Range = [500, 3_000];
const AWAY_MS: Range = [2_000, 25_000];
const SPLIT_MS: Range = [8_000, 45_000];
/** Virtual time for the quiet phase to reach the end state. */
const QUIET_LIMIT_MS = 240_000;
const STEP_MS = 500;
/** How often a player at a page without a seat clicks the seat. */
const RETAKE_MS = 3_000;

type Range = readonly [number, number];

/** Site data that a reload keeps and clearing it loses: the client id (so the holder) and the stored replicas. */
interface Browser {
	readonly seat: Seat;
	/** The host seat that this browser's setup link names. */
	readonly pref: Seat;
	client: string;
	holder: string;
	storage: TestStorage;
	/** The next page opens as the creator of the stored table. */
	creator: boolean;
	clears: number;
	page: SimPage | null;
}

interface SimPage {
	readonly peer: string;
	readonly browser: Browser;
	readonly controller: TableController;
	alive: boolean;
}

/** One tab per browser: each lock is granted at once. */
const LOCKS: SeatLocks = {
	heldElsewhere: async () => new Set(),
	hold: (_roomId, _seat, options = {}) => {
		queueMicrotask(() => options.onAcquired?.());
		return () => {};
	},
};

/** The generator of the election simulation (mulberry32); its first numbers are not small for small seeds. */
function generator(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function pairKey(a: Seat, b: Seat): string {
	return a < b ? `${a}${b}` : `${b}${a}`;
}

/** What the end checks print about a page. */
function summary(page: SimPage | null): string {
	if (!page?.alive) return "closed";
	const view = page.controller.view();
	return [
		view.status,
		`seat ${view.seat}`,
		view.hosting ? "hosting" : `host ${view.hostSeat}`,
		`rev ${view.table?.rev ?? "-"}`,
		view.election?.phase ?? "-",
		view.follower ?? "-",
		view.ready ? "ready" : "not ready",
		view.seatError ?? "",
	].join(" ");
}

class Sim {
	readonly mesh = new FakeMesh(TABLE);
	readonly browsers: Browser[] = [];
	/** The seats of every host beat, in order. */
	readonly hostSeats: Seat[] = [];
	readonly #random: () => number;
	/** Pairs of seats whose link a split holds down. */
	readonly #cut = new Map<string, number>();
	#ids = 0;
	#nonces = 0;
	#pages = 0;
	#clients = 0;
	#quiet = false;

	constructor(seed: number) {
		this.#random = generator(seed);
		this.mesh.tap = (_from, _to, message) => {
			if (message.k === "beat" && message.role === "host" && message.auth) {
				const seat = tagSeat(message.auth.tag);
				if (this.hostSeats.at(-1) !== seat) this.hostSeats.push(seat);
			}
		};
	}

	async addBrowser(seat: Seat, pref: Seat): Promise<Browser> {
		const client = this.#newClient();
		const browser: Browser = {
			seat,
			pref,
			client,
			holder: await deriveHolder(TABLE, client),
			storage: new TestStorage(),
			creator: false,
			clears: 0,
			page: null,
		};
		this.browsers.push(browser);
		return browser;
	}

	/** Writes term 1 at the browser's seat; its next page hosts it at once. */
	async create(browser: Browser): Promise<void> {
		const created = await createTable({
			storage: browser.storage,
			identity: {
				tableId: TABLE,
				client: browser.client,
				holder: browser.holder,
			},
			seat: browser.seat,
			config: CONFIG,
			module: chatModule,
			newId: () => this.#newId(),
			clock: this.mesh.clock,
			memory: { remember: () => {} },
		});
		if (!created.ok) throw new Error(created.detail);
		browser.creator = true;
	}

	/** Opens the browser's link at its seat, and links the page with every open page that no split cuts off. */
	async open(browser: Browser): Promise<void> {
		if (browser.page?.alive) return;
		const peer = peerId(`${browser.seat.toLowerCase()}${++this.#pages}`);
		const { mesh } = this;
		const creator = browser.creator;
		browser.creator = false;
		const controller = new TableController({
			identity: {
				tableId: TABLE,
				client: browser.client,
				holder: browser.holder,
			},
			storage: browser.storage,
			locks: LOCKS,
			memory: {
				tabSeat: () => undefined,
				seatToReopen: () => undefined,
				remember: () => {},
				forget: () => {},
			},
			module: chatModule,
			clock: mesh.clock,
			every: (ms, run) => {
				let on = true;
				mesh.every(peer, ms, () => {
					if (on) run();
				});
				return () => {
					on = false;
				};
			},
			openMesh: (handlers) => this.#attach(peer, handlers),
			newId: () => this.#newId(),
			nonce: () => `nonce-${String(++this.#nonces).padStart(6, "0")}`,
			creator,
			preferredSeat: browser.seat,
			bootstrap: { config: CONFIG, host: browser.pref },
		});
		const page: SimPage = { peer, browser, controller, alive: true };
		browser.page = page;
		await controller.start();
		if (!page.alive) return;
		// The player takes the seat again when the page shows them as a visitor, for example when a page with cleared
		// data finds the seat still held by the old holder.
		mesh.every(peer, RETAKE_MS, () => {
			const view = controller.view();
			if (page.alive && view.status === "open" && view.seat === null) {
				void controller.choose(browser.seat);
			}
		});
		for (const other of this.browsers) {
			const peerPage = other.page;
			if (other === browser || !peerPage?.alive) continue;
			if (!this.#cut.has(pairKey(browser.seat, other.seat))) {
				mesh.connect(peer, peerPage.peer);
			}
		}
	}

	/** The tab dies without a word; the browser keeps its data. */
	crash(browser: Browser): void {
		const page = browser.page;
		if (!page?.alive) return;
		page.alive = false;
		this.mesh.remove(page.peer);
	}

	/** The player leaves the table, and the page says so. */
	close(browser: Browser): void {
		const page = browser.page;
		if (!page?.alive) return;
		page.alive = false;
		page.controller.stop();
	}

	/** The browser forgets this site: a new client id, so a new holder, and no stored replica. */
	async clear(browser: Browser): Promise<void> {
		this.crash(browser);
		browser.clears++;
		browser.client = this.#newClient();
		browser.holder = await deriveHolder(TABLE, browser.client);
		browser.storage = new TestStorage();
	}

	/** Holds the links between the two sides down for `ms`. */
	split(side: readonly Seat[], ms: number): void {
		const pairs: string[] = [];
		for (const a of side) {
			for (const b of SEATS) {
				if (!side.includes(b)) pairs.push(pairKey(a, b));
			}
		}
		for (const key of pairs) this.#cut.set(key, (this.#cut.get(key) ?? 0) + 1);
		for (const a of this.browsers) {
			for (const b of this.browsers) {
				if (
					a.page?.alive &&
					b.page?.alive &&
					pairs.includes(pairKey(a.seat, b.seat))
				) {
					this.mesh.disconnect(a.page.peer, b.page.peer);
				}
			}
		}
		this.mesh.after(ms, () => {
			for (const key of pairs) {
				const count = (this.#cut.get(key) ?? 1) - 1;
				if (count > 0) this.#cut.set(key, count);
				else this.#cut.delete(key);
			}
			this.#relink();
		});
	}

	/** The noisy phase: one disturbance now, the next after DISTURB_MS. */
	disturb(): void {
		if (this.#quiet) return;
		const browser = this.browsers[this.#int(this.browsers.length)];
		const roll = this.#random();
		if (browser === undefined) return;
		if (roll < 0.4) {
			const page = browser.page;
			if (page?.alive && page.controller.view().ready) {
				void page.controller.send(chatPayload(TABLE, `chat ${this.#ids}`));
			}
		} else if (roll < 0.55) {
			this.crash(browser);
			this.#later(RELOAD_MS, () => this.open(browser));
		} else if (roll < 0.65) {
			this.close(browser);
			this.#later(AWAY_MS, () => this.open(browser));
		} else if (roll < 0.72) {
			void this.clear(browser).then(() =>
				this.#later(RELOAD_MS, () => this.open(browser)),
			);
		} else if (roll < 0.85) {
			const side = SEATS.filter(() => this.#random() < 0.5);
			if (side.length > 0 && side.length < SEATS.length) {
				this.split(side, this.#between(SPLIT_MS));
			}
		}
		this.mesh.after(this.#between(DISTURB_MS), () => this.disturb());
	}

	/** Stops the noise, joins every split and opens every closed seat. */
	async quiet(): Promise<void> {
		this.#quiet = true;
		this.#cut.clear();
		this.#relink();
		for (const browser of this.browsers) await this.open(browser);
	}

	/** The largest number of entries that a browser stores. */
	async largestLog(): Promise<number> {
		let largest = 0;
		for (const browser of this.browsers) {
			const loaded = await browser.storage.load(TABLE, browser.seat);
			if (loaded.ok && loaded.value) {
				largest = Math.max(largest, loaded.value.table.rev);
			}
		}
		return largest;
	}

	/** Why the pages are not yet in the end state of (a)–(c), or null when they are. */
	unsettled(): string | null {
		const pages = this.browsers.map((browser) => browser.page);
		const views: TableView[] = [];
		for (const page of pages) {
			if (!page?.alive) return "a seat is closed";
			views.push(page.controller.view());
		}
		const hosts = views.filter((view) => view.hosting);
		if (hosts.length !== 1) return `${hosts.length} hosts`;
		const [host] = hosts;
		const table = host?.table;
		if (!host || !table) return "the host has no table";
		for (const [index, view] of views.entries()) {
			const browser = this.browsers[index];
			if (!browser) continue;
			if (view.status !== "open" || view.seat !== browser.seat) {
				return `${browser.seat} is ${view.status} at ${view.seat}`;
			}
			if (view.hostSeat !== host.seat) {
				return `${browser.seat} shows ${view.hostSeat} as the host`;
			}
			if (!view.ready) return `${browser.seat} is not ready`;
			const row = table.seats.find((item) => item.seat === browser.seat);
			if (row?.holder !== browser.holder) {
				return `the table does not bind ${browser.seat} to its browser`;
			}
			if (
				view.table?.rev !== table.rev ||
				view.table.lastAuth.tag !== table.lastAuth.tag ||
				view.table.lastAuth.term !== table.lastAuth.term
			) {
				return `${browser.seat} is at rev ${view.table?.rev}, the host at ${table.rev}`;
			}
		}
		return null;
	}

	/** The host's table. */
	hostTable(): TableView["table"] {
		return (
			this.browsers
				.map((browser) => browser.page?.controller.view())
				.find((view) => view?.hosting)?.table ?? null
		);
	}

	describe(): string {
		const table = this.hostTable();
		return this.browsers
			.map((browser) => {
				const row = table?.seats.find((item) => item.seat === browser.seat);
				const bound =
					row?.holder === browser.holder ? "own" : (row?.holder ?? "free");
				return `${browser.seat}: ${summary(browser.page)} (row ${bound} gen ${row?.gen}, ${browser.clears} clears)`;
			})
			.join("; ");
	}

	between(range: Range): number {
		return this.#between(range);
	}

	int(count: number): number {
		return this.#int(count);
	}

	#attach(peer: string, handlers: MeshHandlers): TableMesh {
		const { mesh } = this;
		mesh.add(peer, {
			receiveCtl: (from, message) => handlers.ctl(from, message),
			receiveLog: (from, message) => handlers.log(from, message),
			join: (other) => handlers.join(other),
			leave: (other) => handlers.leave(other),
		});
		const send = mesh.send(peer);
		return {
			self: peer,
			peers: () => mesh.peersOf(peer),
			connection: () => undefined,
			online: () => true,
			diagnostics: () => DIAGNOSTICS,
			ctl: (to, message) => send.ctl(to, message),
			log: (to, message) => send.log(to, message),
			call: () => {},
			leave: async () => {
				if (mesh.has(peer)) mesh.remove(peer);
			},
			seek: () => {},
			tick: () => {},
		};
	}

	#relink(): void {
		for (const a of this.browsers) {
			for (const b of this.browsers) {
				if (a.seat >= b.seat || !a.page?.alive || !b.page?.alive) continue;
				if (!this.#cut.has(pairKey(a.seat, b.seat))) {
					this.mesh.connect(a.page.peer, b.page.peer);
				}
			}
		}
	}

	#later(range: Range, run: () => Promise<void>): void {
		this.mesh.after(this.#between(range), () => {
			if (!this.#quiet) void run();
		});
	}

	#newId(): string {
		return commandId(++this.#ids);
	}

	#newClient(): string {
		return `client${String(++this.#clients).padStart(16, "0")}`;
	}

	/** Whole milliseconds, so the virtual wall clock stays a whole number, as `Date.now()` is. */
	#between([low, high]: Range): number {
		return Math.round(low + this.#random() * (high - low));
	}

	#int(count: number): number {
		return Math.floor(this.#random() * count);
	}
}

/** The seats in the order of priority from `pref`: clockwise N, E, S, W. */
function order(pref: Seat): Seat[] {
	const start = SEATS.indexOf(pref);
	return SEATS.map((_, i) => SEATS[(start + i) % SEATS.length] as Seat);
}

/** Runs one seed; returns the violations of (a)–(d). */
async function simulate(seed: number): Promise<string[]> {
	const sim = new Sim(seed);
	const kind = seed % 3;
	const pref = SEATS[sim.int(SEATS.length)] as Seat;
	const odd = kind === 2 ? SEATS[sim.int(SEATS.length)] : undefined;
	const created = seed % 2 === 0;
	for (const seat of SEATS) {
		const link =
			odd !== undefined && seat === odd
				? (order(pref)[1 + sim.int(3)] as Seat)
				: pref;
		await sim.addBrowser(seat, link);
	}
	if (created) {
		const creator = sim.browsers.find((browser) => browser.seat === pref);
		if (!creator) throw new Error("no creator");
		await sim.create(creator);
		await sim.open(creator);
	}
	for (const browser of sim.browsers) {
		sim.mesh.after(sim.between(OPEN_MS), () => void sim.open(browser));
	}
	sim.mesh.after(OPEN_MS[1], () => sim.disturb());
	await sim.mesh.advance(sim.between(NOISY_MS));
	const largest = await sim.largestLog();
	await sim.quiet();
	const violations: string[] = [];
	const name = `seed ${seed} (${created ? "created" : "seeded"}, ${odd ? "links disagree" : `host=${pref}`})`;
	try {
		await sim.mesh.until(
			() => sim.unsettled() === null,
			QUIET_LIMIT_MS,
			STEP_MS,
		);
	} catch {
		violations.push(`${name}: ${sim.unsettled()}; ${sim.describe()}`);
		return violations;
	}
	const rev = sim.hostTable()?.rev ?? 0;
	if (!odd && rev < largest) {
		violations.push(
			`${name}: the table has ${rev} entries, a browser stored ${largest}`,
		);
	}
	return violations;
}

let restoreDigest: () => void;
beforeEach(() => {
	restoreDigest = syncDigest();
});
afterEach(() => restoreDigest());

describe("four table controllers", () => {
	it("seed the table only from the seat first in the link's order when they meet before SEED_WAIT_MS", async () => {
		// host=S: the order is S, W, N, E.
		const sim = new Sim(1);
		for (const seat of SEATS) await sim.addBrowser(seat, "S");
		for (const browser of sim.browsers) await sim.open(browser);
		await sim.mesh.until(
			() => sim.unsettled() === null,
			2 * SEED_WAIT_MS + 60_000,
		);
		expect(sim.hostSeats).toEqual(["S"]);
	});

	it("give the table to the link's host seat when it joins after a page lower in the order seeded it", async () => {
		// host=S: West and North meet, and West seeds; South joins and takes the host role at once (rule 12).
		const sim = new Sim(1);
		for (const seat of SEATS) await sim.addBrowser(seat, "S");
		const [north, east, south, west] = sim.browsers;
		if (!north || !east || !south || !west) throw new Error("four browsers");
		await sim.open(west);
		await sim.open(north);
		await sim.mesh.until(
			() => west.page?.controller.view().hosting === true,
			2 * SEED_WAIT_MS,
		);
		await west.page?.controller.send(chatPayload(TABLE, "before South"));
		await sim.mesh.advance(5_000);

		await sim.open(south);
		await sim.open(east);
		await sim.mesh.until(() => sim.unsettled() === null, 2 * SEED_WAIT_MS);

		expect(sim.hostSeats).toEqual(["W", "S"]);
		expect(sim.hostTable()?.rev).toBeGreaterThanOrEqual(2);
	});

	it(`end with one host and four bound seats for ${SEEDS} seeds`, async () => {
		const violations: string[] = [];
		for (let seed = 1; seed <= SEEDS; seed++) {
			violations.push(...(await simulate(seed)));
		}
		expect(violations).toEqual([]);
	}, 600_000);
});
