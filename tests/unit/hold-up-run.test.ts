import { describe, expect, it } from "vitest";
import { holdUpFork, makeHoldUpBoard } from "../../scripts/self-play/hold-up";
import { runHoldUp } from "../../scripts/self-play/hold-up-run";
import type { PlayPosition } from "../../src/bot/play-position";
import { SUITS, suitOf } from "../../src/bridge/cards";
import { boardStatus } from "../../src/bridge/engine";
import { countHandPoints } from "../../src/bridge/hand-points";
import { scoreContract } from "../../src/bridge/rules";

const position: PlayPosition = {
	view: {
		seat: "N",
		declarer: "N",
		dummy: "S",
		trump: "NT",
		own: ["SA", "S4", "S3"],
		dummyCards: ["S5"],
		plays: [
			{ seat: "E", card: "SK", trick: 1 },
			{ seat: "S", card: "S2", trick: 1 },
			{ seat: "W", card: "SJ", trick: 1 },
		],
	},
	turn: "N",
	current: { leader: "E", cards: ["SK", "S2", "SJ"] },
	contract: { declarer: "N", level: 3, strain: "NT", doubling: "" },
	vulnerability: "none",
	declarerTricks: 0,
	legal: ["S4", "SA", "S3"],
	hints: [],
};

describe("notrump hold-up experiment", () => {
	it("finds the lowest losing follower when only the ace wins", () => {
		expect(holdUpFork(position)).toEqual({ ace: "SA", duck: "S3", bias: true });
		expect(holdUpFork({ ...position, legal: ["SA"] })).toBeUndefined();
		expect(
			holdUpFork({
				...position,
				current: { leader: "E", cards: ["S6", "SK", "SJ"] },
			}),
		).toBeUndefined();
		expect(
			holdUpFork({
				...position,
				current: { leader: "E", cards: ["S6", "S2", "SJ"] },
				legal: ["SA", "SK", "S3"],
			}),
		).toBeUndefined();
	});

	it("excludes late tricks, defense, unexposed dummy, and other contracts", () => {
		expect(holdUpFork({ ...position, turn: "E" })).toBeUndefined();
		expect(
			holdUpFork({
				...position,
				contract: { ...position.contract, strain: "S" },
			}),
		).toBeUndefined();
		expect(
			holdUpFork({
				...position,
				view: { ...position.view, dummyCards: undefined },
			}),
		).toBeUndefined();
		expect(
			holdUpFork({
				...position,
				view: {
					...position.view,
					plays: Array.from({ length: 5 }, () => position.view.plays).flat(),
				},
			}),
		).toBeUndefined();
	});

	it("keeps unbiased forks when an honor is held, a defender is void, or length is outside the bias gate", () => {
		for (const dummyCards of [["SQ"], ["S5", "S6", "S7", "S8"]] as const) {
			expect(
				holdUpFork({ ...position, view: { ...position.view, dummyCards } })
					?.bias,
			).toBe(false);
		}
		expect(
			holdUpFork({
				...position,
				current: { leader: "E", cards: ["SK", "S2", "H2"] },
			})?.bias,
		).toBe(false);
	});

	it("uses the same gate when declarer plays from dummy", () => {
		expect(
			holdUpFork({
				...position,
				turn: "S",
				current: { leader: "W", cards: ["SK", "S2", "SJ"] },
				view: {
					...position.view,
					own: ["S5"],
					dummyCards: ["SA", "S4", "S3"],
				},
			}),
		).toEqual({ ace: "SA", duck: "S3", bias: true });
	});

	it("builds a reproducible balanced North 3NT fixture with no prescribed play", () => {
		const board = makeHoldUpBoard(3, 42);
		expect(board).toEqual(makeHoldUpBoard(3, 42));
		expect(board.number).toBe(13);
		expect(board.cards).toEqual([]);
		const north = countHandPoints("hcp", board.deal.N).total;
		const south = countHandPoints("hcp", board.deal.S).total;
		expect([15, 16, 17]).toContain(north);
		expect([25, 26, 27]).toContain(north + south);
		expect(["4333", "4432", "5332"]).toContain(
			SUITS.map(
				(suit) => board.deal.N.filter((card) => suitOf(card) === suit).length,
			)
				.sort((a, b) => b - a)
				.join(""),
		);
		expect(board.calls[2]).toBe(south < 10 ? "2NT" : "3NT");
		expect(boardStatus(board).contract).toEqual(position.contract);
	});

	it("refuses to use reserved seeds through the development entry point", () => {
		const options = { dealSeed: 42, searchSeed: 43, timeMs: 1 };
		expect(() => runHoldUp(0, { ...options, dealSeed: 1_680_000_000 })).toThrow(
			/reserved/,
		);
		expect(() =>
			runHoldUp(0, { ...options, searchSeed: 1_681_000_000 }),
		).toThrow(/reserved/);
	});

	it("records actual duplicate scores and couples equal root choices", async () => {
		const row = await runHoldUp(3, {
			dealSeed: 42,
			searchSeed: 43,
			timeMs: 1,
			iterations: 3,
		});
		expect(row).toMatchObject({ index: 3, seed: 42, contract: "3NT" });
		expect(row.distribution).toMatch(/^[a-f0-9]{64}$/);
		const outcomes = new Map();
		for (const arm of [row.base, row.take, row.plain, row.biased]) {
			expect(arm.score).toBe(
				scoreContract(position.contract, row.vulnerability, arm.declarerTricks),
			);
			expect(arm.made).toBe(arm.declarerTricks >= 9);
			if (outcomes.has(arm.card))
				expect(arm.score).toBe(outcomes.get(arm.card));
			outcomes.set(arm.card, arm.score);
		}
		if (row.fork) {
			expect(row.take.card).toBe(row.forkData?.ace);
			expect(row.plain.iterations).toBeGreaterThan(0);
			expect(row.biased.iterations).toBeGreaterThan(0);
		} else {
			expect(row.forkData).toBeNull();
			expect(row.base.card).toBeNull();
			expect(row.take).toEqual(row.base);
			expect(row.plain).toEqual(row.base);
			expect(row.biased).toEqual(row.base);
		}
	}, 30_000);
});
