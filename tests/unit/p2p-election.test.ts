import { describe, expect, it } from "vitest";
import { followedHost } from "../../src/p2p/election";
import {
	BEAT_MS,
	BUTTON_MS,
	HOST_LOST_MS,
	LATE_TICK_MS,
	MAX_TERM,
	NOBODY_MS,
	RESUME_ONLINE_MS,
	STAGGER_MS,
	TICK_MS,
	VOLUNTEER_MS,
} from "../../src/p2p/limits";
import type { Seat } from "../../src/protocol";
import {
	AUTH_E2_RESUMED,
	AUTH_S2,
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
	visitorBeat,
	west,
} from "./p2p-election-fixtures";
import { AUTH_1, AUTH_2, HOLDER_E, HOLDER_N } from "./p2p-fixtures";

describe("following a host (rules 1–3)", () => {
	it("follows the best authority that a host beat shows", () => {
		const page = west();
		expect(page.hear("pS", leaderBeat(AUTH_S2), 100)).toContainEqual({
			type: "follow",
			host: { auth: AUTH_S2, peer: "pS" },
		});
		expect(ofType(page.hear("pE", leaderBeat(AUTH_2), 200), "follow")).toEqual([
			{ type: "follow", host: { auth: AUTH_2, peer: "pE" } },
		]);
		const resumed = page.hear("pE2", leaderBeat(AUTH_E2_RESUMED), 300);
		expect(ofType(resumed, "follow")).toEqual([
			{ type: "follow", host: { auth: AUTH_E2_RESUMED, peer: "pE2" } },
		]);
		expect(ofType(page.hear("pN", leaderBeat(AUTH_1), 400), "follow")).toEqual(
			[],
		);
		expect(followedHost(page.state)).toEqual({
			auth: AUTH_E2_RESUMED,
			peer: "pE2",
		});
		expect(page.view).toEqual({ phase: "live" });
	});

	it("never goes back to an authority older than one it knows", () => {
		const page = west({ pos: { rev: 3, lastAuth: AUTH_2 } });
		page.hear("pN", leaderBeat(AUTH_1), 100);
		expect(followedHost(page.state)).toBeNull();
		expect(page.view).toMatchObject({ phase: "waiting-for-host" });
	});

	it("loses a host whose last beat is HOST_LOST_MS old", () => {
		const page = west();
		page.hear("pN", leaderBeat(AUTH_1), 1_000);
		page.tick(1_000 + HOST_LOST_MS - 1);
		expect(page.view).toEqual({ phase: "live" });
		expect(page.tick(1_000 + HOST_LOST_MS)).toContainEqual({
			type: "follow",
			host: null,
		});
		expect(page.view).toMatchObject({ phase: "waiting-for-host" });
	});

	it("shows an unreachable host while a peer reports a fresh beat from it", () => {
		const page = west();
		const report = { auth: AUTH_1, seenAgoMs: 1_000 };
		page.hear("pE", followerBeat(HOLDER_E, "E", { report }), 100);
		expect(page.view).toEqual({ phase: "host-unreachable" });
		expect(followedHost(page.state)).toBeNull();
		page.tick(100 + HOST_LOST_MS - 1_000 - 1);
		expect(page.view).toEqual({ phase: "host-unreachable" });
		page.tick(100 + HOST_LOST_MS - 1_000);
		expect(page.view).toMatchObject({ phase: "waiting-for-host" });
	});

	it("shows a claimer as becoming host and a host to an unseated page as the lobby", () => {
		const page = west();
		page.hear("pE", leaderBeat(AUTH_2, "claiming"), 100);
		expect(page.view).toEqual({ phase: "becoming-host", self: false });
		expect(followedHost(page.state)).toBeNull();
		const visitor = new Page(facts(VISITOR, null));
		visitor.hear("pE", leaderBeat(AUTH_2), 100);
		expect(visitor.view).toEqual({ phase: "lobby" });
	});
});

describe("stepping down (rule 4)", () => {
	it("steps down at a beat from a better host and follows it", () => {
		const page = creator();
		const effects = page.hear("pE", leaderBeat(AUTH_2), 100);
		expect(ofType(effects, "step-down")).toEqual([
			{ type: "step-down", auth: AUTH_1 },
		]);
		expect(ofType(effects, "beat")[0]?.beat).toMatchObject({
			role: "follower",
			auth: AUTH_2,
			seenAgoMs: 0,
		});
		expect(ofType(effects, "follow")).toEqual([
			{ type: "follow", host: { auth: AUTH_2, peer: "pE" } },
		]);
	});

	it("steps down at a report of a better authority", () => {
		const page = creator();
		const report = { auth: AUTH_2, seenAgoMs: 1_000 };
		const effects = page.hear("pS", followerBeat(HOLDER_S, "S", { report }));
		expect(ofType(effects, "step-down")).toHaveLength(1);
		expect(page.view).toEqual({ phase: "host-unreachable" });
	});

	it("steps down at a log position written by a better authority", () => {
		const page = creator();
		const pos = { rev: 5, lastAuth: AUTH_2 };
		const effects = page.hear(
			"pS",
			followerBeat(HOLDER_S, "S", { report: hearsay(AUTH_1), pos }),
		);
		expect(ofType(effects, "step-down")).toHaveLength(1);
		expect(page.view).toMatchObject({ phase: "waiting-for-host" });
	});

	it("keeps hosting at a beat from a worse authority", () => {
		const page = new Page(
			facts(HOLDER_E, seating("E", { host: AUTH_2, inc: 1 })),
			{ creator: true },
		);
		expect(ofType(page.hear("pN", leaderBeat(AUTH_1)), "step-down")).toEqual(
			[],
		);
		expect(page.view).toEqual({ phase: "host" });
	});

	it("steps down when the page stops being eligible", () => {
		const page = creator();
		const broken = facts(HOLDER_N, seating("N", { inc: 1, writable: false }));
		const effects = page.step({ type: "self", now: 100, self: broken });
		expect(ofType(effects, "step-down")).toEqual([
			{ type: "step-down", auth: AUTH_1 },
		]);
		expect(page.mode).toBe("idle");
	});

	it("lets the newer of two tabs with the same tag win; the old tab steps down and is superseded", () => {
		const old = creator();
		const fresh = new Page(facts(HOLDER_N, seating("N", { inc: 1 })));
		fresh.run(RESUME_ONLINE_MS);
		const resumed = { ...AUTH_1, inc: 2 };
		expect(fresh.state.mode).toMatchObject({ kind: "claiming", auth: resumed });
		fresh.step({ type: "stored", now: fresh.now, auth: resumed, ok: true });
		expect(fresh.view).toEqual({ phase: "host" });

		expect(fresh.hear("old", leaderBeat(AUTH_1))).not.toContainEqual(
			expect.objectContaining({ type: "step-down" }),
		);
		const effects = old.hear("fresh", leaderBeat(resumed), fresh.now);
		expect(ofType(effects, "step-down")).toEqual([
			{ type: "step-down", auth: AUTH_1 },
		]);
		expect(ofType(effects, "follow")).toEqual([]);
		expect(old.step({ type: "lock-lost", now: old.now })).toEqual([]);
		expect(old.view).toEqual({ phase: "superseded" });
	});

	it("makes a host that loses its seat lock superseded, and ignores every later event", () => {
		const page = creator();
		expect(page.step({ type: "lock-lost", now: 100 })).toEqual([
			{ type: "step-down", auth: AUTH_1 },
		]);
		expect(page.view).toEqual({ phase: "superseded" });
		expect(page.run(VOLUNTEER_MS, [VISITOR_WITNESS])).toEqual([]);
		expect(page.step({ type: "join", now: page.now, peer: "pX" })).toEqual([]);
		expect(page.view).toEqual({ phase: "superseded" });
	});
});

describe("the absence clock (rule 5)", () => {
	function absent(page: Page): number {
		return page.state.absentMs;
	}

	it("counts online time without host evidence", () => {
		const page = west();
		page.run(4_000);
		expect(absent(page)).toBe(4_000);
		expect(page.view).toMatchObject({ phase: "waiting-for-host" });
	});

	it("stops while offline and starts again when the page is back online", () => {
		const page = west();
		page.run(4_000);
		page.step({ type: "network", now: 4_000, online: false });
		page.run(4_000);
		expect(absent(page)).toBe(4_000);
		expect(page.view).toEqual({ phase: "connecting" });
		page.step({ type: "network", now: 8_000, online: true });
		expect(absent(page)).toBe(0);
	});

	it("starts again on wake and stays at zero while host evidence is fresh", () => {
		const page = west();
		page.run(4_000);
		page.step({ type: "wake", now: 4_000 });
		expect(absent(page)).toBe(0);
		page.run(4_000);
		page.hear("pE", leaderBeat(AUTH_2, "claiming"));
		expect(absent(page)).toBe(0);
		page.run(HOST_LOST_MS - TICK_MS);
		expect(absent(page)).toBe(0);
		page.run(TICK_MS);
		expect(absent(page)).toBeGreaterThan(0);
	});

	it("starts again after a tick more than LATE_TICK_MS late", () => {
		const page = west();
		page.run(1_000);
		page.tick(page.now + LATE_TICK_MS);
		expect(absent(page)).toBe(1_000 + LATE_TICK_MS);
		page.tick(page.now + LATE_TICK_MS + 1);
		expect(absent(page)).toBe(0);
	});
});

describe("the Make me the host button (rules 6–7)", () => {
	it("appears after BUTTON_MS and is enabled with a witness", () => {
		const page = west();
		page.run(BUTTON_MS - TICK_MS, [VISITOR_WITNESS]);
		expect(page.view).toEqual({
			phase: "waiting-for-host",
			absentMs: BUTTON_MS - TICK_MS,
			button: null,
		});
		page.step({ type: "click", now: page.now });
		expect(page.mode).toBe("idle");
		page.run(TICK_MS, [VISITOR_WITNESS]);
		expect(page.view).toEqual({
			phase: "waiting-for-host",
			absentMs: BUTTON_MS,
			button: { enabled: true },
		});
		const effects = page.step({ type: "click", now: page.now });
		const claim = { term: 2, tag: TAG_W, inc: 1 };
		expect(page.state.mode).toMatchObject({ kind: "claiming", auth: claim });
		expect(ofType(effects, "beat")[0]?.beat).toMatchObject({
			role: "claiming",
			auth: claim,
		});
		expect(page.view).toEqual({ phase: "becoming-host", self: true });
	});

	it.each([
		["witness", {}, []],
		["storage", { persistent: false }, [VISITOR_WITNESS]],
		["storage", { writable: false }, [VISITOR_WITNESS]],
		["seat", { bound: false }, [VISITOR_WITNESS]],
		[
			"limit",
			{ host: { ...AUTH_1, term: MAX_TERM }, pos: POS },
			[VISITOR_WITNESS],
		],
		["limit", { inc: MAX_TERM }, [VISITOR_WITNESS]],
	] as const)("is disabled for %s (%j)", (reason, overrides, sources) => {
		const page = west(overrides);
		page.run(VOLUNTEER_MS + STAGGER_MS * 4, sources);
		expect(page.view).toEqual({
			phase: "waiting-for-host",
			absentMs: VOLUNTEER_MS + STAGGER_MS * 4,
			button: { enabled: false, reason },
		});
		page.step({ type: "click", now: page.now });
		expect(page.mode).toBe("idle");
	});

	it("does not count another tab of the same browser as a witness", () => {
		const page = west();
		const sibling = { peer: "pW2", beat: visitorBeat(HOLDER_W) };
		page.run(BUTTON_MS, [sibling]);
		expect(page.view).toMatchObject({
			button: { enabled: false, reason: "witness" },
		});
	});

	it("is disabled for an unseated page, which shows nobody-here when it is alone", () => {
		const visitor = new Page(facts(VISITOR, null));
		visitor.run(NOBODY_MS - TICK_MS);
		expect(visitor.view).toMatchObject({ phase: "waiting-for-host" });
		visitor.run(TICK_MS);
		expect(visitor.view).toEqual({ phase: "nobody-here" });
		const witness = { peer: "pE", beat: followerBeat(HOLDER_E, "E") };
		visitor.run(BEAT_MS, [witness]);
		expect(visitor.view).toMatchObject({
			button: { enabled: false, reason: "seat" },
		});
	});

	it.each([
		["seed", true],
		["copy", false],
	] as const)(
		"is disabled for %s on a seated page that has no table yet",
		(reason, seed) => {
			const page = new Page({
				...facts(
					HOLDER_W,
					seating("W", {
						pos: { rev: 0, lastAuth: null },
						host: null,
						bound: false,
					}),
				),
				seed,
			});
			page.run(BUTTON_MS, [VISITOR_WITNESS]);
			expect(page.view).toMatchObject({
				phase: "waiting-for-host",
				button: { enabled: false, reason },
			});
		},
	);
});

describe("the automatic volunteer (rule 8)", () => {
	it("does not elect an automated client that cannot deal boards", () => {
		const bot = new Page({
			...facts(HOLDER_W, seating("W")),
			hostEligible: false,
		});
		const effects = bot.run(VOLUNTEER_MS + 4 * STAGGER_MS);

		expect(bot.mode).toBe("idle");
		expect(bot.view).toMatchObject({
			phase: "waiting-for-host",
			button: { enabled: false, reason: "ineligible" },
		});
		expect(
			ofType(effects, "beat").every((effect) => effect.beat.elig === false),
		).toBe(true);
	});

	it("claims at VOLUNTEER_MS when no eligible peer goes first", () => {
		const page = west();
		page.run(VOLUNTEER_MS - TICK_MS, [VISITOR_WITNESS]);
		expect(page.mode).toBe("idle");
		page.run(TICK_MS, [VISITOR_WITNESS]);
		expect(page.mode).toBe("claiming");
	});

	it("waits one STAGGER_MS per eligible peer with a better position or a lower tag", () => {
		const page = west();
		const equal = {
			peer: "pN",
			beat: followerBeat(HOLDER_N, "N", { report: hearsay(AUTH_1) }),
		};
		const ahead = {
			peer: "pS",
			beat: followerBeat(HOLDER_S, "S", {
				report: hearsay(AUTH_1),
				pos: { rev: 2, lastAuth: AUTH_1 },
			}),
		};
		const behind = {
			peer: "pE",
			beat: followerBeat(HOLDER_E, "E", {
				report: hearsay(AUTH_1),
				pos: { rev: 0, lastAuth: null },
			}),
		};
		const notEligible = {
			peer: "pE2",
			beat: followerBeat(HOLDER_E, "E", {
				report: hearsay(AUTH_1),
				pos: { rev: 9, lastAuth: AUTH_1 },
				elig: false,
			}),
		};
		const sources = [equal, ahead, behind, notEligible];
		page.run(VOLUNTEER_MS + 2 * STAGGER_MS - TICK_MS, sources);
		expect(page.mode).toBe("idle");
		page.run(TICK_MS, sources);
		expect(page.mode).toBe("claiming");
	});

	describe("with the host seat of the link (host=S: S, W, N, E)", () => {
		function linked(holder: string, seat: Seat): Page {
			return new Page({ ...facts(holder, seating(seat)), pref: "S" });
		}

		function peer(holder: string, seat: Seat, pref?: Seat): Source {
			return {
				peer: `p${seat}`,
				beat: followerBeat(holder, seat, {
					report: hearsay(AUTH_1),
					...(pref === undefined ? {} : { pref }),
				}),
			};
		}

		it("lets the seat closer clockwise to the link's host seat go first at an equal position, not the lower tag", () => {
			// W has the highest tag, but it comes right after S.
			const page = linked(HOLDER_W, "W");
			page.run(VOLUNTEER_MS, [
				peer(HOLDER_N, "N", "S"),
				peer(HOLDER_E, "E", "S"),
			]);
			expect(page.mode).toBe("claiming");

			// A holder whose stored host is not its own, so it does not resume.
			const north = linked(HOLDER_S, "N");
			const sources = [peer(HOLDER_W, "W", "S"), peer(HOLDER_E, "E", "S")];
			north.run(VOLUNTEER_MS + STAGGER_MS - TICK_MS, sources);
			expect(north.mode).toBe("idle");
			north.run(TICK_MS, sources);
			expect(north.mode).toBe("claiming");
		});

		it("falls back to the tag for a peer that names another host seat or none", () => {
			for (const pref of ["N", undefined] as const) {
				const page = linked(HOLDER_W, "W");
				const sources = [peer(HOLDER_N, "N", pref)];
				page.run(VOLUNTEER_MS + STAGGER_MS - TICK_MS, sources);
				expect(page.mode, String(pref)).toBe("idle");
				page.run(TICK_MS, sources);
				expect(page.mode, String(pref)).toBe("claiming");
			}
		});

		it("names the link's host seat in every beat", () => {
			const page = linked(HOLDER_W, "W");
			const effects = page.run(BEAT_MS);
			const beats = ofType(effects, "beat");
			expect(beats.length).toBeGreaterThan(0);
			for (const { beat } of beats) expect(beat.pref).toBe("S");
		});
	});
});
