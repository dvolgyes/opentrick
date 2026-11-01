import {
	type Authority,
	type Position,
	sameAuthority,
} from "../../src/p2p/authority";
import type { ElectionState, Seating, SelfFacts } from "../../src/p2p/election";
import {
	BEAT_MS,
	CLAIM_PULL_MS,
	HOST_LOST_MS,
	STAGGER_MS,
	TICK_MS,
	VOLUNTEER_MS,
} from "../../src/p2p/limits";
import type { Beat } from "../../src/p2p/wire";
import { SEATS, type Seat } from "../../src/protocol";

/**
 * Seeded simulation of the host election (plan §8, P4). 4–6 browsers share one table: four hold the seats, the
 * others are visitors. A noisy phase brings link loss, partitions, freezes, clicks, reloads and tab duplicates; a
 * quiet phase then keeps the links fixed, and in half of the seeds every host closes as it starts. The simulation
 * plays the controllers: it delivers beats with delays, runs
 * the claim pull and the store, and keeps one replica per browser. It checks these invariants:
 *
 * (a) a claim of a new term has a witness: a beat from another browser in the last HOST_LOST_MS;
 * (b) the authorities that a page follows never get worse, nor those of a browser with a persistent replica;
 * (c) in the quiet phase, two hosts in one group of diameter ≤ 2 overlap for at most OVERLAP_MS;
 * (d) such a group with an eligible page and a witness has a host from LIVE_MS after the quiet phase starts;
 * (e) at the end, that group has one host, and every other page in it follows the host or knows of it;
 * (f) no two pages host the same authority;
 * (g) a page hosts, and appends entries, only as the authority that its replica stores;
 * (h) a page follows only a peer that hosted that authority;
 * (i) a page sends at most CTL_PER_SECOND beats in one second, the receive rate limit; a storm ends the run;
 * (j) at the end, when the links of a group name one host seat, no eligible page linked to the host is closer
 *     clockwise to that seat than the host;
 * (k) an eligible page takes a diverged log from a host whose link names the same host seat only when that log has
 *     more entries, or as many and the host's seat is closer clockwise to that seat.
 *
 * A third of the seeds have links without a host seat, a third one host seat for every browser, and a third one
 * browser whose link names another host seat.
 * and every beat passes the wire validator. A violation names its seed, so the run replays.
 */

export const SEEDS = 500;
export const MIN_DELAY_MS = 5;
export const MAX_DELAY_MS = 150;
export const TICK_JITTER_MS = 100;
export const STORE_MS = 5;
/** Only in the noisy phase; a failed write makes the page ineligible until it reloads. */
export const STORE_FAILURE = 0.02;
export const APPEND_CHANCE = 0.25;
export const CHECK_MS = 250;

export type Range = readonly [number, number];
export const LOAD_MS: Range = [500, 3_000];
export const DUPLICATE_MS: Range = [300, 1_500];
export const ONLINE_MS: Range = [100, 300];
export const CONNECT_MS: Range = [300, 900];
export const LEAVE_MS: Range = [200, 4_000];
export const PULL_MS: Range = [20, 400];
export const START_MS: Range = [200, 5_000];
export const NOISY_MS: Range = [60_000, 120_000];
export const DISTURB_MS: Range = [1_000, 5_000];
export const OUTAGE_MS: Range = [2_000, 30_000];
export const PARTITION_MS: Range = [8_000, 45_000];
export const FREEZE_MS: Range = [5_000, 40_000];

/** A page that loads or connects as the quiet phase starts is in the mesh by then. */
export const SETTLE_MS = LOAD_MS[1] + CONNECT_MS[1] + 100;
/** Two beat periods and two deliveries: from one host through a shared neighbour to the other host. */
export const OVERLAP_MS =
	2 * (BEAT_MS + TICK_MS + TICK_JITTER_MS + MAX_DELAY_MS);

/** Two ticks of the absence clock, the store, and two deliveries: the claim beat and the host beat. */
export const SLACK_MS =
	2 * (TICK_MS + TICK_JITTER_MS) + STORE_MS + 2 * MAX_DELAY_MS;
/**
 * Evidence of an old host expires, the absence clock reaches the volunteer time of the last of the three other
 * seats, and the claim pull ends.
 */
export const LIVE_MS =
	SETTLE_MS +
	HOST_LOST_MS +
	VOLUNTEER_MS +
	STAGGER_MS * (SEATS.length - 1) +
	CLAIM_PULL_MS +
	SLACK_MS;

export const HOLDER_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface Stats {
	/** Claims of a new term, by a click or by the automatic volunteer. */
	claims: number;
	resumes: number;
	clickClaims: number;
	hosts: number;
	stepDowns: number;
	storeFailures: number;
	pulls: number;
	reloads: number;
	duplicates: number;
	freezes: number;
	partitions: number;
	/** Hosts that close for good as the quiet phase starts, so that the others must elect. */
	hostCrashes: number;
	/** Claims of a new term in the quiet phase. */
	quietClaims: number;
	/** Pairs of hosts seen together in one group of diameter ≤ 2 in the quiet phase. */
	quietOverlaps: number;
	/** Groups at the end with diameter 2 that must have a host. */
	twoHopGroups: number;
	/** Claims by a page that followed a host farther from the host seat of both links (rule 12). */
	handovers: number;
	/** Claims at a host beat whose log diverged from the page's replica (rule 13). */
	merges: number;
}

export function emptyStats(): Stats {
	return {
		claims: 0,
		resumes: 0,
		clickClaims: 0,
		hosts: 0,
		stepDowns: 0,
		storeFailures: 0,
		pulls: 0,
		reloads: 0,
		duplicates: 0,
		freezes: 0,
		partitions: 0,
		hostCrashes: 0,
		quietClaims: 0,
		quietOverlaps: 0,
		twoHopGroups: 0,
		handovers: 0,
		merges: 0,
	};
}

export interface Replica {
	pos: Position;
	host: Authority | null;
	inc: number;
}

export interface Browser {
	readonly index: number;
	readonly holder: string;
	/** Null for a visitor. */
	readonly seat: Seat | null;
	/** False for a memory replica, which a reload loses. */
	readonly persistent: boolean;
	/** The host seat that the browser's link names; undefined for a link without one. */
	readonly pref: Seat | undefined;
	replica: Replica | null;
	/** The open page; null while a reload is under way. */
	page: Page | null;
	/** The best authority that a page of this browser followed. */
	followed: Authority | null;
}

export interface Page {
	/** The Trystero peer id: new on every page load. */
	readonly id: string;
	readonly browser: Browser;
	state: ElectionState;
	alive: boolean;
	frozen: boolean;
	freezes: number;
	ticks: number;
	/** Work that arrived while the page was frozen; it runs in order when the page thaws. */
	queue: (() => void)[];
	writable: boolean;
	readonly connected: Set<Page>;
	/** When this page last received a beat from another browser. */
	witnessAt: number | null;
	followed: Authority | null;
	claimed: Authority | null;
	/** The beats that this page sent in the current second of simulated time. */
	second: number;
	sent: number;
}

export interface Group {
	readonly key: string;
	readonly pages: readonly Page[];
	/** 3 stands for any diameter above 2. */
	readonly diameter: number;
}

export interface Outage {
	readonly pairs: readonly (readonly [Browser, Browser])[];
	active: boolean;
}

export interface Job {
	readonly at: number;
	readonly order: number;
	readonly run: () => void;
}

/** A binary heap of jobs by time; jobs at the same time run in the order they were added. */
export class Agenda {
	readonly #heap: Job[] = [];
	#order = 0;

	add(at: number, run: () => void): void {
		const heap = this.#heap;
		heap.push({ at, order: this.#order++, run });
		let i = heap.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (!earlier(heap[i], heap[parent])) break;
			swap(heap, i, parent);
			i = parent;
		}
	}

	/** The next job at or before `until`, removed from the heap. */
	next(until: number): Job | undefined {
		const heap = this.#heap;
		const top = heap[0];
		if (top === undefined || top.at > until) return undefined;
		const last = heap.pop();
		if (last === undefined || heap.length === 0) return top;
		heap[0] = last;
		let i = 0;
		while (true) {
			const left = 2 * i + 1;
			let least = i;
			if (earlier(heap[left], heap[least])) least = left;
			if (earlier(heap[left + 1], heap[least])) least = left + 1;
			if (least === i) return top;
			swap(heap, i, least);
			i = least;
		}
	}
}

export function earlier(a: Job | undefined, b: Job | undefined): boolean {
	if (a === undefined || b === undefined) return false;
	return a.at < b.at || (a.at === b.at && a.order < b.order);
}

export function swap<T>(items: T[], i: number, j: number): void {
	const a = items[i];
	const b = items[j];
	if (a === undefined || b === undefined) return;
	items[i] = b;
	items[j] = a;
}

/** mulberry32: a small seeded generator, so that a seed replays the same run. */
export function generator(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		swap(out, i, Math.floor(random() * (i + 1)));
	}
	return out;
}

export function randomHolder(random: () => number): string {
	let holder = "";
	for (let i = 0; i < 16; i++) {
		holder += HOLDER_ALPHABET.charAt(Math.floor(random() * 64));
	}
	return holder;
}

export function selfFacts(browser: Browser, writable: boolean): SelfFacts {
	const { seat, replica } = browser;
	const seating: Seating | null =
		seat === null || replica === null
			? null
			: {
					seat,
					pos: replica.pos,
					host: replica.host,
					inc: replica.inc,
					bound: true,
					persistent: browser.persistent,
					writable,
				};
	return {
		holder: browser.holder,
		seating,
		...(browser.pref === undefined ? {} : { pref: browser.pref }),
	};
}

/** The beat's log and the replica are on one line, as the election tells it (rule 12). */
export function sameLine(pos: Position, beat: Beat): boolean {
	return (
		sameAuthority(pos.lastAuth, beat.pos?.lastAuth ?? null) ||
		sameAuthority(pos.lastAuth, beat.auth ?? null)
	);
}

/** The number of seats from `from` to `seat`, going clockwise. */
export function clockwise(from: Seat, seat: Seat): number {
	return (
		(SEATS.indexOf(seat) - SEATS.indexOf(from) + SEATS.length) % SEATS.length
	);
}

export function termKey(auth: Authority): string {
	return `${auth.term}/${auth.tag}`;
}

export function authKey(auth: Authority): string {
	return `${auth.term}/${auth.tag}/${auth.inc}`;
}

export function pairKey(a: Browser, b: Browser): string {
	return a.index < b.index ? `${a.index}-${b.index}` : `${b.index}-${a.index}`;
}

export function isHosting(page: Page): boolean {
	return page.state.mode.kind === "hosting";
}

export function isEligible(page: Page): boolean {
	return page.browser.seat !== null && page.browser.persistent && page.writable;
}

export function diameterOf(
	pages: readonly Page[],
	edge: (a: Page, b: Page) => boolean,
): number {
	let diameter = 0;
	for (const a of pages) {
		for (const b of pages) {
			if (a === b) continue;
			if (edge(a, b)) {
				diameter = Math.max(diameter, 1);
			} else if (pages.some((c) => edge(a, c) && edge(c, b))) {
				diameter = 2;
			} else {
				return 3;
			}
		}
	}
	return diameter;
}
