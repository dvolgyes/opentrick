import { describe, expect, it } from "vitest";
import type { Authority, Position } from "../../src/p2p/authority";
import {
	type ElectionEffect,
	initElection,
	type Seating,
	seedsFirst,
} from "../../src/p2p/election";
import { makeTag } from "../../src/p2p/keys";
import {
	BEAT_MS,
	BUTTON_MS,
	CLAIM_PULL_MS,
	HOST_LOST_MS,
	LATE_TICK_MS,
	MAX_TERM,
	RESUME_ONLINE_MS,
	TICK_MS,
	VOLUNTEER_MS,
} from "../../src/p2p/limits";
import type { Beat } from "../../src/p2p/wire";
import type { Seat } from "../../src/protocol";
import {
	creator,
	facts,
	followerBeat,
	HOLDER_S,
	HOLDER_W,
	hearsay,
	leaderBeat,
	ofType,
	Page,
	POS,
	type Source,
	seating,
	TAG_W,
	VISITOR,
	VISITOR_WITNESS,
	west,
} from "./p2p-election-fixtures";
import { AUTH_1, AUTH_2, HOLDER_E, HOLDER_N } from "./p2p-fixtures";

describe("the handover to a seat closer to the link's host seat (rule 12)", () => {
	// host=S: the order is S, W, N, E.
	const AUTH_W2: Authority = { term: 2, tag: TAG_W, inc: 1 };
	const POS_W: Position = { rev: 4, lastAuth: AUTH_W2 };

	function south(pos: Position): Page {
		return new Page({
			...facts(HOLDER_S, seating("S", { pos, host: AUTH_W2 })),
			pref: "S",
		});
	}

	function host(auth: Authority, pos: Position, pref?: Seat): Beat {
		return {
			...leaderBeat(auth, "host", pos),
			...(pref === undefined ? {} : { pref }),
		};
	}

	it("takes over at once from a host farther from the link's host seat, and pulls from it at an equal position", () => {
		const page = south(POS_W);
		const effects = page.hear("pW", host(AUTH_W2, POS_W, "S"));

		const claim = { term: 3, tag: makeTag(HOLDER_S, "S"), inc: 1 };
		expect(page.state.mode).toMatchObject({ kind: "claiming", auth: claim });
		expect(ofType(effects, "pull")).toEqual([
			{ type: "pull", auth: claim, peer: "pW" },
		]);
		expect(ofType(effects, "store")).toEqual([]);
	});

	it("follows the host until its replica has every entry that the host's beat shows", () => {
		const page = south({ rev: 3, lastAuth: AUTH_W2 });
		const effects = page.hear("pW", host(AUTH_W2, POS_W, "S"));
		expect(page.mode).toBe("idle");
		expect(ofType(effects, "follow")).toEqual([
			{ type: "follow", host: { auth: AUTH_W2, peer: "pW" } },
		]);

		page.step({
			type: "self",
			now: page.now,
			self: {
				...facts(HOLDER_S, seating("S", { pos: POS_W, host: AUTH_W2 })),
				pref: "S",
			},
		});
		expect(page.mode).toBe("claiming");
	});

	it("keeps following a host closer to the link's host seat", () => {
		const auth: Authority = { term: 2, tag: makeTag(HOLDER_S, "S"), inc: 1 };
		const pos = { rev: 4, lastAuth: auth };
		const page = new Page({
			...facts(HOLDER_W, seating("W", { pos, host: auth })),
			pref: "S",
		});
		page.run(VOLUNTEER_MS, [{ peer: "pS", beat: host(auth, pos, "S") }]);
		expect(page.mode).toBe("idle");
	});

	it("keeps following a host whose link names another host seat or none", () => {
		for (const pref of ["N", undefined] as const) {
			const page = south(POS_W);
			page.run(VOLUNTEER_MS, [
				{ peer: "pW", beat: host(AUTH_W2, POS_W, pref) },
			]);
			expect(page.mode, String(pref)).toBe("idle");
		}
	});
});

describe("the merge of two tables with diverged logs (rule 13)", () => {
	// host=S: the order is S, W, N, E. W and N each started a table; N's has the better authority.
	const AUTH_W2: Authority = { term: 2, tag: TAG_W, inc: 1 };
	const AUTH_N3: Authority = { term: 3, tag: makeTag(HOLDER_N, "N"), inc: 1 };
	const CLAIM_W: Authority = { term: 4, tag: TAG_W, inc: 2 };

	function page(holder: string, seat: Seat, rev: number, pref?: Seat): Page {
		const pos = { rev, lastAuth: AUTH_W2 };
		return new Page({
			...facts(holder, seating(seat, { pos, host: AUTH_W2, inc: 1 })),
			...(pref === undefined ? {} : { pref }),
		});
	}

	/** `pref` null: the host's link names no host seat. */
	function hostN(rev: number, pref: Seat | null = "S"): Beat {
		return {
			...leaderBeat(AUTH_N3, "host", { rev, lastAuth: AUTH_N3 }),
			...(pref === null ? {} : { pref }),
		};
	}

	it("claims at once, without a pull, when its replica has more entries than the host's", () => {
		const west = page(HOLDER_W, "W", 6, "S");
		const effects = west.hear("pN", hostN(2));
		expect(west.state.mode).toMatchObject({ kind: "claiming", auth: CLAIM_W });
		expect(ofType(effects, "pull")).toEqual([]);
		expect(ofType(effects, "store")).toEqual([
			{ type: "store", auth: CLAIM_W },
		]);
		expect(ofType(effects, "follow")).toEqual([]);
	});

	it("at an equal number of entries, claims only from a seat closer to the link's host seat", () => {
		const west = page(HOLDER_W, "W", 2, "S");
		west.hear("pN", hostN(2));
		expect(west.state.mode).toMatchObject({ kind: "claiming", auth: CLAIM_W });

		const east = page(HOLDER_E, "E", 2, "S");
		const effects = east.hear("pN", hostN(2));
		expect(east.mode).toBe("idle");
		expect(ofType(effects, "follow")).toEqual([
			{ type: "follow", host: { auth: AUTH_N3, peer: "pN" } },
		]);
	});

	it("follows the host when its replica has fewer entries", () => {
		const west = page(HOLDER_W, "W", 1, "S");
		const effects = west.hear("pN", hostN(2));
		expect(west.mode).toBe("idle");
		expect(ofType(effects, "follow")).toHaveLength(1);
	});

	it("follows the host when the links name different host seats or none", () => {
		for (const [own, other] of [
			["S", "N"],
			[undefined, null],
			["S", null],
		] as const) {
			const west = page(HOLDER_W, "W", 6, own);
			west.hear("pN", hostN(2, other));
			expect(west.mode, `${own} ${other}`).toBe("idle");
		}
	});

	it("keeps following a host of its own line when its replica is ahead of the host's last beat", () => {
		// The host's beat can be a beat period old, so a follower can have more entries than it shows.
		const pos = { rev: 6, lastAuth: AUTH_N3 };
		const east = new Page({
			...facts(HOLDER_E, seating("E", { pos, host: AUTH_N3, inc: 1 })),
			pref: "S",
		});
		east.run(VOLUNTEER_MS, [{ peer: "pN", beat: hostN(4) }]);
		expect(east.mode).toBe("idle");
	});

	it("a host that steps down for a host with fewer entries claims in the same step and never follows it", () => {
		const pos = { rev: 6, lastAuth: AUTH_W2 };
		const host = new Page(
			{
				...facts(HOLDER_W, seating("W", { pos, host: AUTH_W2, inc: 1 })),
				pref: "S",
			},
			{ creator: true },
		);
		const effects = host.hear("pN", hostN(2), 100);
		expect(ofType(effects, "step-down")).toEqual([
			{ type: "step-down", auth: AUTH_W2 },
		]);
		expect(host.state.mode).toMatchObject({ kind: "claiming", auth: CLAIM_W });
		expect(ofType(effects, "follow")).toEqual([]);
	});
});

describe("the seed of a table that nobody has (rule 14)", () => {
	// host=S: the order is S, W, N, E. None of the pages has a table.
	const EMPTY: Position = { rev: 0, lastAuth: null };

	function empty(holder: string, seat: Seat, pref?: Seat): Page {
		return new Page({
			...facts(holder, seating(seat, { pos: EMPTY, host: null })),
			...(pref === undefined ? {} : { pref }),
		});
	}

	function peer(holder: string, seat: Seat, pref?: Seat, elig = true) {
		return followerBeat(holder, seat, {
			pos: EMPTY,
			elig,
			...(pref === undefined ? {} : { pref }),
		});
	}

	it("seeds from the seat highest in the order of the pages that it hears", () => {
		const west = empty(HOLDER_W, "W", "S");
		west.hear("pN", peer(HOLDER_N, "N", "S"));
		west.hear("pE", peer(HOLDER_E, "E", "S"));
		expect(seedsFirst(west.state)).toBe(true);

		const north = empty(HOLDER_N, "N", "S");
		north.hear("pW", peer(HOLDER_W, "W", "S"));
		expect(seedsFirst(north.state)).toBe(false);
	});

	it("seeds again when the higher seat is not heard for HOST_LOST_MS", () => {
		const north = empty(HOLDER_N, "N", "S");
		north.hear("pW", peer(HOLDER_W, "W", "S"));
		north.run(HOST_LOST_MS - TICK_MS);
		expect(seedsFirst(north.state)).toBe(false);
		north.run(TICK_MS);
		expect(seedsFirst(north.state)).toBe(true);
	});

	it("does not wait for a page that cannot host or whose link names another host seat or none", () => {
		for (const [pref, elig] of [
			["S", false],
			["N", true],
			[undefined, true],
		] as const) {
			const north = empty(HOLDER_N, "N", "S");
			north.hear("pW", peer(HOLDER_W, "W", pref, elig));
			expect(seedsFirst(north.state), `${pref} ${elig}`).toBe(true);
		}
	});

	it("says in its beats that it can host while it may seed its seat, so that the pages after it wait", () => {
		const elig = (seed: boolean, overrides: Partial<Seating> = {}) => {
			const page = new Page({
				...facts(
					HOLDER_W,
					seating("W", { pos: EMPTY, host: null, bound: false, ...overrides }),
				),
				pref: "S",
				seed,
			});
			const beats = ofType(page.run(BEAT_MS), "beat");
			expect(beats.length).toBeGreaterThan(0);
			return beats.every(({ beat }) => beat.elig);
		};
		expect(elig(true)).toBe(true);
		expect(elig(false)).toBe(false);
		expect(elig(true, { persistent: false })).toBe(false);
		expect(elig(true, { writable: false })).toBe(false);
		expect(elig(true, { pos: POS, host: AUTH_1 })).toBe(false);
	});

	it("never seeds without a seat or without a host seat in its link", () => {
		expect(
			seedsFirst(new Page({ ...facts(VISITOR, null), pref: "S" }).state),
		).toBe(false);
		expect(seedsFirst(empty(HOLDER_S, "S").state)).toBe(false);
	});
});

describe("a claim (rule 9)", () => {
	function clicked(page: Page, sources: readonly Source[]): ElectionEffect[] {
		page.run(BUTTON_MS, sources);
		return [...page.step({ type: "click", now: page.now })];
	}

	it("takes the next term above every known authority and the next incarnation", () => {
		const page = west({ inc: 3 });
		const known = { term: 5, tag: makeTag(HOLDER_S, "S"), inc: 2 };
		const effects = clicked(page, [
			{
				peer: "pE",
				beat: followerBeat(HOLDER_E, "E", { report: hearsay(known) }),
			},
		]);
		const claim = { term: 6, tag: TAG_W, inc: 4 };
		expect(ofType(effects, "store")).toEqual([{ type: "store", auth: claim }]);
		expect(ofType(effects, "pull")).toEqual([]);
	});

	it("pulls from the peer with a strictly better position, then stores at the deadline", () => {
		const page = west();
		const better = {
			peer: "pN",
			beat: followerBeat(HOLDER_N, "N", {
				report: hearsay(AUTH_1),
				pos: { rev: 3, lastAuth: AUTH_1 },
			}),
		};
		const equal = {
			peer: "pE",
			beat: followerBeat(HOLDER_E, "E", { report: hearsay(AUTH_1) }),
		};
		const effects = clicked(page, [equal, better]);
		const claim = { term: 2, tag: TAG_W, inc: 1 };
		expect(ofType(effects, "pull")).toEqual([
			{ type: "pull", auth: claim, peer: "pN" },
		]);
		expect(ofType(effects, "store")).toEqual([]);
		expect(ofType(page.run(CLAIM_PULL_MS - TICK_MS), "store")).toEqual([]);
		expect(ofType(page.run(TICK_MS), "store")).toEqual([
			{ type: "store", auth: claim },
		]);
		expect(ofType(page.run(CLAIM_PULL_MS), "store")).toEqual([]);
	});

	it("stores when the pull for this claim is over, and ignores the result of another claim", () => {
		const page = west();
		const better = {
			peer: "pN",
			beat: followerBeat(HOLDER_N, "N", {
				pos: { rev: 3, lastAuth: AUTH_1 },
			}),
		};
		clicked(page, [better]);
		const claim = { term: 2, tag: TAG_W, inc: 1 };
		const other = { ...claim, inc: 7 };
		expect(page.step({ type: "pulled", now: page.now, auth: other })).toEqual(
			[],
		);
		expect(
			page.step({ type: "stored", now: page.now, auth: claim, ok: true }),
		).toEqual([]);
		expect(page.step({ type: "pulled", now: page.now, auth: claim })).toEqual([
			{ type: "store", auth: claim },
		]);
		expect(
			page.step({ type: "stored", now: page.now, auth: other, ok: true }),
		).toEqual([]);
		expect(page.mode).toBe("claiming");
	});

	it("starts hosting when the claim is stored", () => {
		const page = west();
		clicked(page, [VISITOR_WITNESS]);
		const claim = { term: 2, tag: TAG_W, inc: 1 };
		const effects = page.step({
			type: "stored",
			now: page.now,
			auth: claim,
			ok: true,
		});
		expect(effects[0]).toEqual({ type: "host", auth: claim });
		expect(ofType(effects, "beat")[0]?.beat).toMatchObject({
			role: "host",
			auth: claim,
			seat: "W",
			elig: true,
		});
		expect(page.view).toEqual({ phase: "host" });
	});

	it("goes back to waiting when the store fails", () => {
		const page = west();
		clicked(page, [VISITOR_WITNESS]);
		const claim = { term: 2, tag: TAG_W, inc: 1 };
		const effects = page.step({
			type: "stored",
			now: page.now,
			auth: claim,
			ok: false,
		});
		expect(ofType(effects, "host")).toEqual([]);
		expect(page.view).toEqual({
			phase: "waiting-for-host",
			absentMs: BUTTON_MS,
			button: { enabled: true },
		});
	});

	it("lets the lower tag win two claims for the same term", () => {
		const south = new Page(facts(HOLDER_S, seating("S")));
		const east = new Page(facts(HOLDER_E, seating("E")));
		const southClaim = { term: 2, tag: makeTag(HOLDER_S, "S"), inc: 1 };
		const eastClaim = { term: 2, tag: makeTag(HOLDER_E, "E"), inc: 1 };
		south.run(BUTTON_MS, [{ peer: "east", beat: followerBeat(HOLDER_E, "E") }]);
		east.run(BUTTON_MS, [{ peer: "south", beat: followerBeat(HOLDER_S, "S") }]);
		const southEffects = south.step({ type: "click", now: south.now });
		const eastEffects = east.step({ type: "click", now: east.now });
		const southBeat = ofType(southEffects, "beat")[0]?.beat;
		const eastBeat = ofType(eastEffects, "beat")[0]?.beat;
		if (!southBeat || !eastBeat) throw new Error("no claim beat");

		expect(ofType(east.hear("south", southBeat), "step-down")).toEqual([]);
		south.hear("east", eastBeat);
		expect(south.mode).toBe("idle");
		expect(south.view).toEqual({ phase: "becoming-host", self: false });
		south.step({ type: "stored", now: south.now, auth: southClaim, ok: true });
		east.step({ type: "stored", now: east.now, auth: eastClaim, ok: true });
		expect([south.view, east.view]).toEqual([
			{ phase: "becoming-host", self: false },
			{ phase: "host" },
		]);
		expect(south.hear("east", leaderBeat(eastClaim))).toContainEqual({
			type: "follow",
			host: { auth: eastClaim, peer: "east" },
		});
	});
});

describe("resume and create (rules 10–11)", () => {
	const RESUMED = { ...AUTH_1, inc: 2 };

	function host(): Page {
		return new Page(facts(HOLDER_N, seating("N", { inc: 1 })), {
			online: false,
		});
	}

	it("resumes the stored term after RESUME_ONLINE_MS online, without a witness or a pull", () => {
		const page = host();
		page.run(5_000);
		page.step({ type: "network", now: 5_000, online: true });
		expect(page.run(RESUME_ONLINE_MS - TICK_MS)).not.toContainEqual(
			expect.objectContaining({ type: "store" }),
		);
		const effects = page.run(TICK_MS);
		expect(ofType(effects, "store")).toEqual([
			{ type: "store", auth: RESUMED },
		]);
		expect(ofType(effects, "pull")).toEqual([]);
	});

	it("does not resume when a better authority is known", () => {
		const page = host();
		page.step({ type: "network", now: 0, online: true });
		page.hear(
			"pE",
			followerBeat(HOLDER_E, "E", { report: hearsay(AUTH_2) }),
			1_000,
		);
		page.run(RESUME_ONLINE_MS + BUTTON_MS);
		expect(page.mode).toBe("idle");
		expect(page.state.resumePending).toBe(false);
	});

	it("resumes a solo host offline, but hosts only after its new incarnation is stored", () => {
		const page = new Page(
			{ ...facts(HOLDER_N, seating("N", { inc: 1 })), solo: true },
			{ online: false },
		);
		const effects = page.run(TICK_MS);
		expect(ofType(effects, "store")).toEqual([
			{ type: "store", auth: RESUMED },
		]);
		expect(ofType(effects, "host")).toEqual([]);
		expect(page.mode).toBe("claiming");
		const stored = page.step({
			type: "stored",
			now: page.now,
			auth: RESUMED,
			ok: true,
		});
		expect(ofType(stored, "host")).toEqual([{ type: "host", auth: RESUMED }]);
	});

	it.each([
		{ bound: false },
		{ persistent: false },
		{ writable: false },
		{ inc: MAX_TERM },
	])("does not bypass host eligibility for a solo table: %j", (overrides) => {
		const page = new Page(
			{
				...facts(HOLDER_N, seating("N", { inc: 1, ...overrides })),
				solo: true,
			},
			{ online: false },
		);
		expect(ofType(page.run(TICK_MS), "store")).toEqual([]);
		expect(page.mode).toBe("idle");
	});

	it("does not resume a solo host over a better known authority", () => {
		const page = new Page(
			{ ...facts(HOLDER_N, seating("N", { inc: 1 })), solo: true },
			{ online: false },
		);
		const effects = page.hear(
			"pE",
			followerBeat(HOLDER_E, "E", { report: hearsay(AUTH_2) }),
		);
		expect(ofType(effects, "store")).toEqual([]);
		expect(page.mode).toBe("idle");
		expect(page.state.resumePending).toBe(false);
	});

	it("does not resume after a freeze before RESUME_ONLINE_MS more online time", () => {
		const page = host();
		page.step({ type: "network", now: 0, online: true });
		page.run(RESUME_ONLINE_MS - TICK_MS);
		page.tick(page.now + LATE_TICK_MS + 1);
		expect(page.mode).toBe("idle");
		page.run(RESUME_ONLINE_MS - TICK_MS);
		expect(page.mode).toBe("idle");
		page.run(TICK_MS);
		expect(page.state.mode).toMatchObject({ kind: "claiming", auth: RESUMED });
	});

	it("makes the creator host of the stored term 1 at once", () => {
		const page = creator();
		expect(page.initial[0]).toEqual({ type: "host", auth: AUTH_1 });
		expect(ofType(page.initial, "beat")[0]?.beat).toMatchObject({
			role: "host",
			auth: AUTH_1,
		});
		expect(page.view).toEqual({ phase: "host" });
	});

	it("refuses a creator that does not host its own stored authority", () => {
		expect(() =>
			initElection({
				now: 0,
				self: facts(HOLDER_E, seating("E")),
				creator: true,
			}),
		).toThrow(/creator/);
		expect(() =>
			initElection({
				now: 0,
				self: facts(HOLDER_N, seating("N", { persistent: false })),
				creator: true,
			}),
		).toThrow(/creator/);
	});
});

describe("beats", () => {
	it("beats to all every BEAT_MS and at once to a peer that joins", () => {
		const page = west();
		const beats = ofType(page.run(3 * BEAT_MS), "beat");
		expect(beats.map((effect) => effect.to)).toEqual([null, null, null]);
		expect(page.step({ type: "join", now: page.now, peer: "pX" })).toEqual([
			{ type: "beat", to: "pX", beat: expect.objectContaining({ k: "beat" }) },
		]);
	});

	it("beats at once when it hears the host, so that a peer's report of the host is at most a beat period old", () => {
		// With a beat a period after the host's beat, the next page could hold a report two beat periods old: the
		// host's beat would be lost for it, though no beat was lost.
		const page = west();
		page.run(BEAT_MS);
		const relayed = ofType(
			page.hear("pN", leaderBeat(AUTH_1), BEAT_MS + 500),
			"beat",
		);
		expect(relayed.map(({ beat }) => beat)).toEqual([
			expect.objectContaining({ auth: AUTH_1, seenAgoMs: 0 }),
		]);
		expect(ofType(page.tick(2 * BEAT_MS + 500 - 1), "beat")).toEqual([]);
		expect(ofType(page.tick(2 * BEAT_MS + 500), "beat")).toHaveLength(1);
	});

	it("reports the age of the last direct beat from the known authority, in whole milliseconds", () => {
		const page = west();
		const [first] = ofType(page.run(BEAT_MS), "beat");
		expect(first?.beat).toEqual({
			k: "beat",
			role: "follower",
			holder: HOLDER_W,
			seat: "W",
			pos: POS,
			elig: true,
			auth: AUTH_1,
			seenAgoMs: MAX_TERM,
		});
		page.hear("pN", leaderBeat(AUTH_1), BEAT_MS + 500);
		const [later] = ofType(page.tick(2 * BEAT_MS + 500.75), "beat");
		expect(later?.beat).toMatchObject({
			auth: AUTH_1,
			seenAgoMs: BEAT_MS,
		});
	});

	it("sends a visitor beat without a seat, and with a report once it knows an authority", () => {
		const page = new Page(facts(VISITOR, null));
		expect(ofType(page.run(BEAT_MS), "beat")[0]?.beat).toEqual({
			k: "beat",
			role: "visitor",
			holder: VISITOR,
			elig: false,
		});
		page.hear("pE", followerBeat(HOLDER_E, "E", { report: hearsay(AUTH_2) }));
		expect(ofType(page.run(BEAT_MS), "beat")[0]?.beat).toEqual({
			k: "beat",
			role: "visitor",
			holder: VISITOR,
			elig: false,
			auth: AUTH_2,
			seenAgoMs: MAX_TERM,
		});
	});

	it("rejects time that goes back", () => {
		const page = west();
		page.tick(1_000);
		expect(() => page.tick(999)).toThrow(/time/);
	});
});
