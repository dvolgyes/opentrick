import {
	type Authority,
	compareAuthority,
	comparePosition,
	EMPTY_POSITION,
	type Position,
	sameAuthority,
} from "../../src/p2p/authority";
import {
	type ElectionEffect,
	type ElectionEvent,
	electionView,
	followedHost,
	initElection,
	stepElection,
} from "../../src/p2p/election";
import { makeTag, tagSeat } from "../../src/p2p/keys";
import { CTL_PER_SECOND, HOST_LOST_MS, TICK_MS } from "../../src/p2p/limits";
import { type Beat, frame, parseCtl } from "../../src/p2p/wire";
import { SEATS, type Seat } from "../../src/protocol";
import {
	Agenda,
	APPEND_CHANCE,
	authKey,
	type Browser,
	CHECK_MS,
	CONNECT_MS,
	clockwise,
	DISTURB_MS,
	DUPLICATE_MS,
	diameterOf,
	FREEZE_MS,
	type Group,
	generator,
	isEligible,
	isHosting,
	LEAVE_MS,
	LIVE_MS,
	LOAD_MS,
	MAX_DELAY_MS,
	MIN_DELAY_MS,
	NOISY_MS,
	ONLINE_MS,
	OUTAGE_MS,
	type Outage,
	OVERLAP_MS,
	PARTITION_MS,
	type Page,
	PULL_MS,
	pairKey,
	type Range,
	randomHolder,
	SETTLE_MS,
	START_MS,
	STORE_FAILURE,
	STORE_MS,
	type Stats,
	sameLine,
	selfFacts,
	shuffled,
	TICK_JITTER_MS,
	termKey,
} from "./p2p-election-sim-model";
import { TABLE } from "./p2p-fixtures";

class World {
	readonly violations: string[] = [];
	readonly #seed: number;
	readonly #stats: Stats;
	readonly #random: () => number;
	readonly #agenda = new Agenda();
	readonly #browsers: Browser[] = [];
	/** Outages per browser pair; a link is up when its count is 0. */
	readonly #down = new Map<string, number>();
	readonly #outages: Outage[] = [];
	/** The last delivery time per directed page pair: a data channel keeps order. */
	readonly #fifo = new Map<string, number>();
	readonly #hostedBy = new Map<string, string>();
	readonly #claimedTerms = new Set<string>();
	readonly #overlaps = new Map<string, number>();
	readonly #reported = new Set<string>();
	readonly #hostless = new Map<string, number>();
	#now = 0;
	#pages = 0;
	#quiet = false;
	#quietAt = 0;
	#endAt = 0;
	/** A beat storm ends the run, whose later state proves nothing. */
	#stopped = false;

	constructor(seed: number, stats: Stats) {
		this.#seed = seed;
		this.#stats = stats;
		this.#random = generator(seed);
	}

	run(): void {
		const size = 4 + this.#int(3);
		const seats = shuffled(SEATS, this.#random);
		const weak = this.#random() < 0.3 ? 1 + this.#int(3) : -1;
		const prefs = this.#prefs(size);
		const holders = new Set<string>();
		for (let index = 0; index < size; index++) {
			let holder = randomHolder(this.#random);
			while (holders.has(holder)) holder = randomHolder(this.#random);
			holders.add(holder);
			this.#browsers.push({
				index,
				holder,
				seat: seats[index] ?? null,
				persistent: index !== weak,
				pref: prefs[index],
				replica: null,
				page: null,
				followed: null,
			});
		}
		const creator = this.#browser(0);
		if (creator.seat === null) throw new Error("the creator needs a seat");
		const first: Authority = {
			term: 1,
			tag: makeTag(creator.holder, creator.seat),
			inc: 1,
		};
		for (const browser of this.#browsers) {
			if (browser.seat === null) continue;
			browser.replica = {
				pos: { rev: 1, lastAuth: first },
				host: first,
				inc: browser === creator ? 1 : 0,
			};
		}
		this.#claimedTerms.add(termKey(first));
		this.#open(creator, true);
		for (const browser of this.#browsers) {
			if (browser === creator) continue;
			this.#after(this.#between(...START_MS), () => this.#open(browser, false));
		}
		this.#quietAt = this.#between(...NOISY_MS);
		this.#endAt = this.#quietAt + LIVE_MS + 5_000;
		this.#after(START_MS[1], () => this.#disturb());
		this.#after(this.#quietAt, () => this.#beginQuiet());
		while (!this.#stopped) {
			const job = this.#agenda.next(this.#endAt);
			if (job === undefined) break;
			this.#now = job.at;
			job.run();
		}
		if (this.#stopped) return;
		this.#now = this.#endAt;
		this.#finish();
	}

	#open(browser: Browser, creator: boolean): void {
		const init = initElection({
			now: this.#now,
			self: selfFacts(browser, true),
			creator,
		});
		const page: Page = {
			id: `p${++this.#pages}`,
			browser,
			state: init.state,
			alive: true,
			frozen: false,
			freezes: 0,
			ticks: 0,
			queue: [],
			writable: true,
			connected: new Set(),
			witnessAt: null,
			followed: null,
			claimed: null,
			second: 0,
			sent: 0,
		};
		browser.page = page;
		this.#handle(page, init.effects);
		this.#after(this.#between(...ONLINE_MS), () =>
			this.#toPage(page, () =>
				this.#step(page, { type: "network", now: this.#now, online: true }),
			),
		);
		this.#startTicks(page, this.#between(0, TICK_MS));
		for (const other of this.#alivePages()) {
			if (other !== page) this.#connectLater(page, other);
		}
	}

	#step(page: Page, event: ElectionEvent): void {
		if (!page.alive) return;
		const next = stepElection(page.state, event);
		page.state = next.state;
		this.#handle(page, next.effects);
	}

	#handle(page: Page, effects: readonly ElectionEffect[]): void {
		for (const effect of effects) {
			switch (effect.type) {
				case "beat":
					this.#beat(page, effect.to, effect.beat);
					break;
				case "pull":
					this.#pull(page, effect.auth, effect.peer);
					break;
				case "store":
					this.#store(page, effect.auth);
					break;
				case "host":
					this.#host(page, effect.auth);
					break;
				case "step-down":
					this.#stats.stepDowns++;
					break;
				case "follow":
					if (effect.host)
						this.#follow(page, effect.host.auth, effect.host.peer);
					break;
			}
		}
	}

	/** Checks the rate (i), validates the beat, checks a claim (a), and sends it over the links that are up. */
	#beat(page: Page, to: string | null, beat: Beat): void {
		if (this.#stopped) return;
		const second = Math.floor(this.#now / 1_000);
		if (second !== page.second) {
			page.second = second;
			page.sent = 0;
		}
		if (++page.sent > CTL_PER_SECOND) {
			this.#violate(
				`${page.id} sends over ${CTL_PER_SECOND} beats in one second`,
			);
			this.#stopped = true;
			return;
		}
		const parsed = parseCtl(frame(TABLE, beat), TABLE);
		if (!parsed.ok) {
			this.#violate(`${page.id} sent a beat that is ${parsed.reason}`);
		}
		if (
			beat.role === "claiming" &&
			beat.auth &&
			!sameAuthority(beat.auth, page.claimed)
		) {
			page.claimed = beat.auth;
			this.#claimed(page, beat.auth);
		}
		for (const target of page.connected) {
			if (to !== null && target.id !== to) continue;
			if (!this.#linked(page.browser, target.browser)) continue;
			const key = `${page.id}>${target.id}`;
			const at = Math.max(
				this.#now + this.#between(MIN_DELAY_MS, MAX_DELAY_MS),
				this.#fifo.get(key) ?? 0,
			);
			this.#fifo.set(key, at);
			this.#agenda.add(at, () => this.#deliver(page, target, beat));
		}
	}

	#claimed(page: Page, auth: Authority): void {
		const host = page.state.self.seating?.host ?? null;
		const key = termKey(auth);
		if (host !== null && host.tag === auth.tag && host.term === auth.term) {
			this.#stats.resumes++;
			if (!this.#claimedTerms.has(key)) {
				this.#violate(`${page.id} resumed ${key}, which nobody claimed`);
			}
			return;
		}
		this.#stats.claims++;
		if (this.#quiet) this.#stats.quietClaims++;
		if (page.followed && this.#closer(page, page.followed.tag))
			this.#stats.handovers++;
		this.#claimedTerms.add(key);
		if (page.witnessAt === null || this.#now - page.witnessAt >= HOST_LOST_MS) {
			this.#violate(`${page.id} claimed ${key} without a witness`);
		}
	}

	#deliver(from: Page, target: Page, beat: Beat): void {
		if (!target.connected.has(from)) return;
		if (!this.#linked(from.browser, target.browser)) return;
		this.#toPage(target, () => {
			if (from.browser !== target.browser) target.witnessAt = this.#now;
			const claiming = target.state.mode.kind === "claiming";
			this.#step(target, {
				type: "beat",
				now: this.#now,
				peer: from.id,
				beat,
			});
			const replica = target.browser.replica;
			if (
				!claiming &&
				target.state.mode.kind === "claiming" &&
				beat.role === "host" &&
				replica !== null &&
				!sameLine(replica.pos, beat)
			) {
				this.#stats.merges++;
			}
			const followed = followedHost(target.state);
			if (followed?.peer === from.id && beat.role === "host" && beat.pos) {
				this.#checkMerge(target, from, beat.pos, beat);
				this.#adopt(target, beat.pos);
			}
		});
	}

	/** (k), before the page takes the host's log. */
	#checkMerge(page: Page, host: Page, pos: Position, beat: Beat): void {
		const { replica, pref } = page.browser;
		if (replica === null || pref === undefined || beat.pref !== pref) return;
		if (!isEligible(page) || host.browser === page.browser) return;
		if (sameLine(replica.pos, beat) || beat.auth === undefined) return;
		const { rev } = replica.pos;
		if (
			rev > pos.rev ||
			(rev === pos.rev && this.#closer(page, beat.auth.tag))
		) {
			this.#violate(
				`${page.id} at ${page.browser.seat} takes the diverged log of ${host.id} with ${pos.rev} entries for its ${rev}`,
			);
		}
	}

	/** A follower takes the log of the host it follows (extend or replace, plan §4.5). */
	#adopt(page: Page, pos: Position): void {
		const { replica } = page.browser;
		if (replica === null) return;
		if (
			replica.pos.rev === pos.rev &&
			sameAuthority(replica.pos.lastAuth, pos.lastAuth)
		) {
			return;
		}
		replica.pos = pos;
		this.#refresh(page);
	}

	#refresh(page: Page): void {
		this.#step(page, {
			type: "self",
			now: this.#now,
			self: selfFacts(page.browser, page.writable),
		});
	}

	/** The claim pull takes a strictly better log; with no answer, the claim deadline takes over. */
	#pull(page: Page, auth: Authority, peer: string): void {
		this.#after(this.#between(...PULL_MS), () => {
			const target = [...page.connected].find((other) => other.id === peer);
			if (target === undefined || !target.alive || target.frozen) return;
			if (!this.#linked(page.browser, target.browser)) return;
			const pos = target.browser.replica?.pos ?? null;
			this.#toPage(page, () => {
				const { mode } = page.state;
				if (
					mode.kind !== "claiming" ||
					mode.storing ||
					!sameAuthority(mode.auth, auth)
				) {
					return;
				}
				this.#stats.pulls++;
				const { replica } = page.browser;
				if (pos && replica && comparePosition(pos, replica.pos) > 0) {
					replica.pos = pos;
					this.#refresh(page);
				}
				this.#step(page, { type: "pulled", now: this.#now, auth });
			});
		});
	}

	/**
	 * The store keeps the better of the stored host and the claim, as a follower does, so the late write of a claim
	 * that lost changes nothing. The transaction completes while the page is frozen; the page hears of it on thaw.
	 */
	#store(page: Page, auth: Authority): void {
		this.#after(STORE_MS, () => {
			const { browser } = page;
			const { replica } = browser;
			if (browser.page !== page) return;
			if (replica === null) {
				this.#violate(`${page.id} stores a claim without a replica`);
				return;
			}
			const failed = !this.#quiet && this.#random() < STORE_FAILURE;
			const written = !failed && compareAuthority(auth, replica.host) > 0;
			if (written) {
				replica.host = auth;
				replica.inc = Math.max(replica.inc, auth.inc);
			}
			this.#toPage(page, () => {
				if (failed) {
					page.writable = false;
					this.#stats.storeFailures++;
				}
				this.#refresh(page);
				this.#step(page, {
					type: "stored",
					now: this.#now,
					auth,
					ok: written,
				});
			});
		});
	}

	/** (f) and (g). */
	#host(page: Page, auth: Authority): void {
		this.#stats.hosts++;
		const key = authKey(auth);
		const owner = this.#hostedBy.get(key);
		if (owner !== undefined && owner !== page.id) {
			this.#violate(`${page.id} hosts ${key}, which ${owner} hosted`);
		}
		this.#hostedBy.set(key, page.id);
		if (!sameAuthority(page.browser.replica?.host ?? null, auth)) {
			this.#violate(`${page.id} hosts ${key} before its replica stores it`);
		}
	}

	/** (b) and (h); the follower keeps the best followed authority as its replica's host (plan P5). */
	#follow(page: Page, auth: Authority, peer: string): void {
		const key = authKey(auth);
		if (this.#hostedBy.get(key) !== peer) {
			this.#violate(
				`${page.id} follows ${peer} as ${key}, which it never hosted`,
			);
		}
		if (compareAuthority(auth, page.followed) < 0) {
			this.#violate(`${page.id} follows ${key} after a better authority`);
		}
		page.followed = auth;
		const { browser } = page;
		const { replica } = browser;
		if (replica === null) return;
		if (browser.persistent) {
			if (compareAuthority(auth, browser.followed) < 0) {
				this.#violate(
					`browser ${browser.index} follows ${key} after a better authority`,
				);
			}
			browser.followed = auth;
		}
		if (compareAuthority(auth, replica.host) > 0) {
			replica.host = auth;
			this.#refresh(page);
		}
	}

	#startTicks(page: Page, delay: number): void {
		const ticks = ++page.ticks;
		const tick = (): void => {
			if (!page.alive || page.frozen || page.ticks !== ticks) return;
			this.#tick(page);
			this.#after(TICK_MS + this.#between(0, TICK_JITTER_MS), tick);
		};
		this.#after(delay, tick);
	}

	#tick(page: Page): void {
		this.#step(page, { type: "tick", now: this.#now });
		if (isHosting(page) && this.#random() < APPEND_CHANCE) this.#append(page);
	}

	/** A host commits one entry: (g) its replica must store it as the host. */
	#append(page: Page): void {
		const { mode } = page.state;
		const { replica } = page.browser;
		if (mode.kind !== "hosting" || replica === null) return;
		if (!sameAuthority(replica.host, mode.auth)) {
			this.#violate(
				`${page.id} appends as ${authKey(mode.auth)}, but its replica stores another host`,
			);
			return;
		}
		replica.pos = { rev: replica.pos.rev + 1, lastAuth: mode.auth };
		this.#refresh(page);
	}

	#toPage(page: Page, work: () => void): void {
		if (!page.alive) return;
		if (page.frozen) page.queue.push(work);
		else work();
	}

	#linked(a: Browser, b: Browser): boolean {
		return (this.#down.get(pairKey(a, b)) ?? 0) === 0;
	}

	#setDown(a: Browser, b: Browser, count: number): void {
		const was = this.#linked(a, b);
		this.#down.set(pairKey(a, b), count);
		const pa = a.page;
		const pb = b.page;
		if (pa === null || pb === null) return;
		if (was && count > 0 && pa.connected.has(pb)) {
			this.#after(this.#between(...LEAVE_MS), () => {
				if (!this.#linked(a, b)) this.#disconnect(pa, pb);
			});
		}
		if (!was && count === 0 && !pa.connected.has(pb)) {
			this.#connectLater(pa, pb);
		}
	}

	#connectLater(a: Page, b: Page): void {
		this.#after(this.#between(...CONNECT_MS), () => this.#connect(a, b));
	}

	#connect(a: Page, b: Page): void {
		if (!a.alive || !b.alive || a.connected.has(b)) return;
		if (!this.#linked(a.browser, b.browser)) return;
		// Signalling runs in the pages, so a frozen page connects after it thaws.
		if (a.frozen || b.frozen) return;
		a.connected.add(b);
		b.connected.add(a);
		this.#step(a, { type: "join", now: this.#now, peer: b.id });
		this.#step(b, { type: "join", now: this.#now, peer: a.id });
	}

	#disconnect(a: Page, b: Page): void {
		if (!a.connected.has(b)) return;
		a.connected.delete(b);
		b.connected.delete(a);
		this.#toPage(a, () =>
			this.#step(a, { type: "leave", now: this.#now, peer: b.id }),
		);
		this.#toPage(b, () =>
			this.#step(b, { type: "leave", now: this.#now, peer: a.id }),
		);
	}

	#kill(page: Page): void {
		page.alive = false;
		page.frozen = false;
		page.queue = [];
		if (page.browser.page === page) page.browser.page = null;
		for (const other of page.connected) {
			this.#after(this.#between(...LEAVE_MS), () =>
				this.#disconnect(page, other),
			);
		}
	}

	#forgetMemory(browser: Browser): void {
		if (!browser.persistent && browser.replica) {
			browser.replica = { pos: EMPTY_POSITION, host: null, inc: 0 };
		}
	}

	#reload(page: Page): void {
		const { browser } = page;
		this.#stats.reloads++;
		this.#kill(page);
		this.#after(this.#between(...LOAD_MS), () => {
			if (browser.page !== null) return;
			this.#forgetMemory(browser);
			this.#open(browser, false);
		});
	}

	/** A second tab tries the seat, but the active tab keeps it. */
	#duplicate(page: Page): void {
		const { browser } = page;
		this.#after(this.#between(...DUPLICATE_MS), () => {
			if (browser.page !== page) return;
			this.#stats.duplicates++;
		});
	}

	#freeze(page: Page): void {
		this.#stats.freezes++;
		page.frozen = true;
		const freezes = ++page.freezes;
		this.#after(this.#between(...FREEZE_MS), () => {
			if (page.freezes === freezes) this.#thaw(page);
		});
	}

	/** The late timer and the queued messages run in either order. */
	#thaw(page: Page): void {
		if (!page.alive || !page.frozen) return;
		page.frozen = false;
		const queued = page.queue;
		page.queue = [];
		const tickFirst = this.#random() < 0.5;
		if (tickFirst) this.#tick(page);
		for (const work of queued) work();
		if (!tickFirst) this.#tick(page);
		this.#startTicks(page, TICK_MS);
		for (const other of this.#alivePages()) {
			if (other !== page && !page.connected.has(other)) {
				this.#connectLater(page, other);
			}
		}
	}

	#click(page: Page): void {
		const before = page.claimed;
		this.#step(page, { type: "click", now: this.#now });
		if (page.claimed !== before) this.#stats.clickClaims++;
	}

	#disturb(): void {
		if (this.#quiet) return;
		const roll = this.#random();
		const page = this.#pick(this.#alivePages());
		if (roll < 0.3) {
			this.#outage([this.#randomPair()], OUTAGE_MS);
		} else if (roll < 0.4) {
			this.#partition();
		} else if (page !== undefined) {
			if (roll < 0.75 && !page.frozen) {
				if (roll < 0.55) this.#freeze(page);
				else this.#click(page);
			} else if (roll >= 0.75 && roll < 0.85) {
				this.#reload(page);
			} else if (roll >= 0.85 && roll < 0.93) {
				if (page.browser.seat !== null) this.#duplicate(page);
			} else if (roll >= 0.93 && !page.frozen) {
				this.#step(page, { type: "wake", now: this.#now });
			}
		}
		this.#after(this.#between(...DISTURB_MS), () => this.#disturb());
	}

	#outage(pairs: readonly (readonly [Browser, Browser])[], range: Range): void {
		const outage: Outage = { pairs, active: true };
		this.#outages.push(outage);
		for (const [a, b] of pairs) this.#setDown(a, b, this.#downCount(a, b) + 1);
		this.#after(this.#between(...range), () => {
			if (!outage.active) return;
			outage.active = false;
			for (const [a, b] of pairs) {
				this.#setDown(a, b, this.#downCount(a, b) - 1);
			}
		});
	}

	#partition(): void {
		this.#stats.partitions++;
		const order = shuffled(this.#browsers, this.#random);
		const cut = 1 + this.#int(order.length - 1);
		const pairs: [Browser, Browser][] = [];
		for (const a of order.slice(0, cut)) {
			for (const b of order.slice(cut)) pairs.push([a, b]);
		}
		this.#outage(pairs, PARTITION_MS);
	}

	/**
	 * Disturbances stop and frozen pages thaw; half of the seeds keep a quarter of the links down for good, and
	 * half of the seeds close every host page for good.
	 */
	#beginQuiet(): void {
		this.#quiet = true;
		for (const outage of this.#outages) outage.active = false;
		const sparse = this.#random() < 0.5;
		for (const a of this.#browsers) {
			for (const b of this.#browsers) {
				if (a.index >= b.index) continue;
				this.#setDown(a, b, sparse && this.#random() < 0.25 ? 1 : 0);
			}
		}
		for (const browser of this.#browsers) {
			if (browser.page?.frozen) this.#thaw(browser.page);
		}
		if (this.#random() < 0.5) {
			for (const page of this.#alivePages().filter(isHosting)) {
				this.#stats.hostCrashes++;
				this.#kill(page);
			}
		}
		this.#check();
	}

	/** (c) and the samples for (d), every CHECK_MS of the quiet phase. */
	#check(): void {
		const settled = this.#quietAt + SETTLE_MS;
		const overlapping = new Set<string>();
		for (const group of this.#groups()) {
			if (group.diameter > 2) continue;
			const hosts = group.pages.filter(isHosting);
			for (const [i, a] of hosts.entries()) {
				for (const b of hosts.slice(i + 1)) {
					const key = `${a.id}+${b.id}`;
					overlapping.add(key);
					let since = this.#overlaps.get(key);
					if (since === undefined) {
						since = this.#now;
						this.#overlaps.set(key, since);
						this.#stats.quietOverlaps++;
					}
					const together = this.#now - Math.max(since, settled);
					if (together > OVERLAP_MS && !this.#reported.has(key)) {
						this.#reported.add(key);
						this.#violate(`${key} host one group for over ${OVERLAP_MS} ms`);
					}
				}
			}
			if (
				hosts.length === 0 &&
				this.#now >= settled &&
				this.#qualifies(group)
			) {
				this.#hostless.set(group.key, this.#now);
			}
		}
		for (const key of this.#overlaps.keys()) {
			if (!overlapping.has(key)) this.#overlaps.delete(key);
		}
		if (this.#now + CHECK_MS <= this.#endAt) {
			this.#after(CHECK_MS, () => this.#check());
		}
	}

	/** (d) and (e). */
	#finish(): void {
		const live = this.#quietAt + LIVE_MS;
		for (const group of this.#groups()) {
			if (group.diameter > 2) continue;
			const hosts = group.pages.filter(isHosting);
			if (hosts.length > 1) {
				this.#violate(`group ${group.key} ends with ${hosts.length} hosts`);
			}
			if (!this.#qualifies(group)) continue;
			if (group.diameter === 2) this.#stats.twoHopGroups++;
			const [host] = hosts;
			if (host === undefined || host.state.mode.kind !== "hosting") {
				this.#violate(`group ${group.key} ends without a host`);
				continue;
			}
			const hostless = this.#hostless.get(group.key);
			if (hostless !== undefined && hostless >= live) {
				this.#violate(
					`group ${group.key} has no host at ${Math.round(hostless)} ms, after the bound ${Math.round(live)} ms`,
				);
			}
			const { auth } = host.state.mode;
			for (const page of group.pages) {
				if (page === host) continue;
				const knows = page.connected.has(host)
					? sameAuthority(followedHost(page.state)?.auth ?? null, auth)
					: electionView(page.state).phase === "host-unreachable" &&
						sameAuthority(page.state.known, auth);
				if (!knows) {
					this.#violate(`${page.id} neither follows nor knows host ${host.id}`);
				}
			}
			const pref = host.browser.pref;
			if (pref === undefined) continue;
			if (!group.pages.every((page) => page.browser.pref === pref)) continue;
			for (const page of group.pages) {
				if (!page.connected.has(host) || !isEligible(page)) continue;
				if (this.#closer(page, auth.tag)) {
					this.#violate(
						`${page.id} at ${page.browser.seat} is closer to ${pref} than host ${host.id} at ${tagSeat(auth.tag)}`,
					);
				}
			}
		}
	}

	/** Whether the page's seat is closer clockwise than the seat of `tag` to the host seat of both browsers' links. */
	#closer(page: Page, tag: string): boolean {
		const { pref, seat } = page.browser;
		const other = this.#browsers.find(
			(browser) => tag === makeTag(browser.holder, browser.seat ?? "N"),
		);
		if (pref === undefined || seat === null || other?.pref !== pref)
			return false;
		return clockwise(pref, seat) < clockwise(pref, tagSeat(tag));
	}

	/** One of three: no host seat, the same host seat for all, or the same one but for one browser. */
	#prefs(size: number): (Seat | undefined)[] {
		const kind = this.#int(3);
		const pref = SEATS[this.#int(SEATS.length)];
		if (kind === 0 || pref === undefined) return Array(size).fill(undefined);
		const prefs: (Seat | undefined)[] = Array(size).fill(pref);
		if (kind === 2) {
			const shift = 1 + this.#int(SEATS.length - 1);
			prefs[this.#int(size)] =
				SEATS[(SEATS.indexOf(pref) + shift) % SEATS.length];
		}
		return prefs;
	}

	#qualifies(group: Group): boolean {
		return group.pages.length >= 2 && group.pages.some(isEligible);
	}

	/** The connected groups of open pages, over the links that are up. */
	#groups(): Group[] {
		const edge = (a: Page, b: Page): boolean =>
			a.connected.has(b) && this.#linked(a.browser, b.browser);
		const seen = new Set<Page>();
		const groups: Group[] = [];
		for (const start of this.#alivePages()) {
			if (seen.has(start)) continue;
			seen.add(start);
			const members: Page[] = [];
			const stack = [start];
			for (let page = stack.pop(); page; page = stack.pop()) {
				members.push(page);
				for (const other of page.connected) {
					if (other.alive && !seen.has(other) && edge(page, other)) {
						seen.add(other);
						stack.push(other);
					}
				}
			}
			members.sort((a, b) => (a.id < b.id ? -1 : 1));
			groups.push({
				key: members.map((page) => page.id).join(","),
				pages: members,
				diameter: diameterOf(members, edge),
			});
		}
		return groups;
	}

	#alivePages(): Page[] {
		return this.#browsers.flatMap((browser) =>
			browser.page?.alive ? [browser.page] : [],
		);
	}

	#downCount(a: Browser, b: Browser): number {
		return this.#down.get(pairKey(a, b)) ?? 0;
	}

	#randomPair(): readonly [Browser, Browser] {
		const count = this.#browsers.length;
		const a = this.#int(count);
		const b = (a + 1 + this.#int(count - 1)) % count;
		return [this.#browser(a), this.#browser(b)];
	}

	#browser(index: number): Browser {
		const browser = this.#browsers[index];
		if (browser === undefined) throw new Error(`no browser ${index}`);
		return browser;
	}

	#after(delay: number, run: () => void): void {
		this.#agenda.add(this.#now + delay, run);
	}

	#between(low: number, high: number): number {
		return low + this.#random() * (high - low);
	}

	#int(count: number): number {
		return Math.floor(this.#random() * count);
	}

	#pick<T>(items: readonly T[]): T | undefined {
		return items[this.#int(items.length)];
	}

	#violate(message: string): void {
		if (this.violations.length >= 5) return;
		this.violations.push(
			`seed ${this.#seed} at ${Math.round(this.#now)} ms: ${message}`,
		);
	}
}

/** Runs one seed; an error from the reducer names the seed. */
export function simulate(seed: number, stats: Stats): readonly string[] {
	const world = new World(seed, stats);
	try {
		world.run();
	} catch (error) {
		throw new Error(`seed ${seed}: ${String(error)}`, { cause: error });
	}
	return world.violations;
}
