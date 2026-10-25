import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card } from "../../src/bridge/cards";
import { SUITS } from "../../src/bridge/cards";
import {
	type PointRange,
	RANGES,
	type RangeKey,
	type RuleSystem,
} from "../../src/bridge/convention-rules";
import { callMeaning, conventionCalls } from "../../src/bridge/conventions";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import { countHandPoints } from "../../src/bridge/hand-points";
import type { Call } from "../../src/bridge/rules";
import { SEATS } from "../../src/protocol";
import { guideName } from "../../src/ui/bidding-guide";

/** A hand as "spades.hearts.diamonds.clubs", for example "AQ4.KJ5.Q862.K73"; "-" is a void. */
function hand(text: string): Card[] {
	const suits = text.split(".");
	if (suits.length !== 4) throw new Error(`a hand needs four suits: ${text}`);
	const result = SUITS.flatMap((suit, index) =>
		[...(suits[index] === "-" ? "" : (suits[index] ?? ""))].map(
			(rank) => `${suit}${rank}` as Card,
		),
	);
	if (result.length !== 13) throw new Error(`a hand needs 13 cards: ${text}`);
	return result;
}

function calls(text: string): Call[] {
	return text === "" ? [] : (text.split(" ") as Call[]);
}

function suggested(
	system: Parameters<typeof conventionCalls>[0],
	cardsText: string,
	auction: string,
): Call[] | undefined {
	return conventionCalls(system, hand(cardsText), calls(auction))?.map(
		({ call }) => call,
	);
}

/** A small seeded generator, so that a failure can be repeated. */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state;
	};
}

const RULE_SYSTEMS: readonly RuleSystem[] = [
	"hcp",
	"hcp-corrected",
	"vienna",
	"reith",
	"four-aces",
];

describe("guide calls for a hand", () => {
	it.each([
		["AQ4.KJ5.Q862.K73", ["1NT"]], // 15, balanced
		["K4.AQJ73.K82.K65", ["1NT"]], // 16, 5332 with five hearts
		["AQ872.KJ965.4.K3", ["1S"]], // 13, two five-card suits: the higher
		["K53.A4.KQ62.J872", ["1D"]], // 13, 4–4 in the minors
		["AJ53.K42.Q73.K62", ["1C"]], // 13, 3–3 in the minors
		["AQ872.4.5.KQJ862", ["1C"]], // 12, the longest suit
		["AQ4.AKJ5.KQ2.Q73", ["2NT"]], // 21, balanced
		["AK4.AKJ5.KQ2.QJ3", ["2C"]], // 23, balanced
		["AKQ.AKJ5.KQ2.QJ3", ["3NT"]], // 25, balanced
		["AKQJ862.AK4.AK.4", ["2C"]], // 24, not balanced
		["84.KQT973.J52.63", ["P", "2H"]], // 6, weak two
		["8642.KQT973.J5.3", ["P"]], // 6, a four-card side major
		["AQJ8642.73.J52.4", ["P", "3S"]], // 8, preempt
		["84.QT9873.KJ2.63", ["P"]], // 6, the suit is not good enough for a weak two
		["8642.Q73.J52.643", ["P"]], // 3
	])("opens %s with %j in HCP", (cardsText, expected) => {
		expect(suggested("hcp", cardsText, "")).toEqual(expected);
	});

	it("opens in the fourth seat as in the first", () => {
		expect(suggested("hcp", "AQ4.KJ5.Q862.K73", "P P P")).toEqual(["1NT"]);
	});

	it("counts the points of the bidder's own system", () => {
		// 17 HCP, 29 Vienna, 26 Reith and 12½ Four Aces points.
		const cardsText = "AJ4.A54.A54.A543";
		expect(suggested("hcp", cardsText, "")).toEqual(["1NT"]);
		expect(suggested("hcp-corrected", cardsText, "")).toEqual(["1NT"]);
		expect(suggested("vienna", cardsText, "")).toEqual(["1C"]);
		expect(suggested("reith", cardsText, "")).toEqual(["1NT"]);
		expect(suggested("four-aces", cardsText, "")).toEqual(["1C"]);
	});

	it.each([
		["1H P", "K84.Q73.J652.Q64", ["2H"]], // 8, three hearts: raise
		["1H P", "KJ84.73.Q652.J64", ["1S", "1NT"]], // 7, a new suit at the one level
		["1S P", "84.KJ73.Q652.J64", ["1NT"]], // 7, no new suit at the one level
		["1H P", "K84.Q73.86.AJ652", ["2C", "3H"]], // 10, invitational
		["1H P", "AQ84.73.K65.KJ62", ["1S", "2C"]], // 13, game forcing
		["1H P", "8642.73.J652.Q64", ["P"]], // 3
		["1NT P", "84.QT973.J52.632", ["P", "2D"]], // 3, five hearts
		["1NT P", "KJ84.A73.Q65.643", ["2C", "3NT"]], // 10, four spades
		["1NT P", "84.73.QT9873.J52", ["P", "2S"]], // 3, six diamonds
		["1NT P", "K84.Q73.A652.643", ["2NT"]], // 9
		["1NT P", "KJ842.Q973.A5.64", ["2C", "2H", "3NT"]], // 10, five spades and four hearts
		["2C P", "8642.K73.J52.643", ["2D"]], // 4
		["2C P", "84.KQJ73.A52.643", ["2H", "2NT"]], // 10, a good five-card suit, balanced
		["2C P", "K842.Q73.A52.J64", ["2NT"]], // 10, balanced
	])("answers %s with %s by %j in HCP", (auction, cardsText, expected) => {
		expect(suggested("hcp", cardsText, auction)).toEqual(expected);
	});

	it.each([
		["other", "", "AQ4.KJ5.Q862.K73"],
		["hcp", "", "KQT98732.4.J52.6"], // an eight-card suit
		["hcp", "1H X", "K84.Q73.J652.Q64"],
		["hcp", "1H 1S", "K84.Q73.J652.Q64"],
		["hcp", "1H", "K84.Q73.J652.Q64"], // an overcall
		["hcp", "P 1H", "K84.Q73.J652.Q64"],
		["hcp", "1H P 1S 2C", "K84.Q73.J652.Q64"], // the rebid after an overcall
		["hcp", "1H P 2H P", "K84.Q73.J652.Q64"], // the rebid after a raise
		["hcp", "1H P 1S P 2C P", "K84.Q73.J652.Q64"], // responder's second call
		["hcp", "1H P 1S P", "A4.KQJ73.K82.Q65"], // 15, balanced: no rebid fits
		["hcp", "2S P", "K8.Q73.J652.Q643"], // no support, too weak for [2NT]
		["hcp", "3S P", "K84.Q73.J652.Q64"],
		["hcp", "2NT P", "K84.Q73.J652.Q64"],
		["hcp", "3NT P", "K84.Q73.J652.Q64"],
	] as const)(
		"does not describe %s after %j with %s",
		(system, auction, cardsText) => {
			expect(suggested(system, cardsText, auction)).toBeUndefined();
		},
	);

	it.each([
		["1H P 1S P", "K4.AQJ73.K82.J65", ["1NT"]], // 14, balanced
		["1H P 1S P", "KJ84.AQJ73.K8.65", ["2S"]], // 14, four spades
		["1H P 1S P", "KJ84.AKJ73.K8.65", ["3S"]], // 15, four spades
		["1H P 1S P", "K4.AKJ873.K8.Q65", ["3H"]], // 16, six hearts
		["1H P 1S P", "A4.AKJ73.AQ82.65", ["3D"]], // 18, four diamonds
		["1H P 1S P", "K4.AKJ73.AQ8.Q65", ["2NT"]], // 19, balanced
		["1NT P 2C P", "AQ4.KJ5.Q862.K73", ["2D"]], // no four-card major
		["1NT P 2C P", "AQ84.KJ52.Q8.K73", ["2H", "2S"]], // both majors
		["1NT P 2D P", "AQ4.KJ5.Q862.K73", ["2H"]],
		["1NT P 2S P", "AQ4.KJ5.Q862.K73", ["3C"]],
		["1NT P 2S P 3C P", "84.73.QT9873.J52", ["3D"]], // six diamonds
		["1NT P 2S P 3C P", "84.73.J52.QT9873", ["P"]], // six clubs
		["2C P 2D P", "AK4.AKJ5.KQ2.QJ3", ["2NT"]], // 23, balanced
		["2H P", "K84.Q73.J652.Q64", ["3H", "4H"]], // three hearts
		["2H P", "AK84.Q7.AJ52.K64", ["2NT"]], // 17
		["1H", "KQJ73.84.J52.A64", ["1S"]], // 11, a good five-card suit
		["P 1S", "84.A4.KQJ73.Q652", ["2D"]], // 12, at the two level
		["1H", "A84.4.KQ52.KJ643", ["X"]], // 13, short in hearts
		["1H", "AQ4.KJ5.Q862.K73", ["1NT"]], // 15, balanced, KJ5 stops hearts
		["1H X", "AQ4.84.Q862.K732", ["XX"]], // 11
		["1H P 3H P 4NT P", "AQ4.KJ5.Q862.K73", ["5D"]], // one ace
		["1H P 3H P 4NT P", "KQ4.KJ5.Q862.K73", ["5C"]], // no ace
	] as const)(
		"continues %s with %s by %j in HCP",
		(auction, cardsText, expected) => {
			expect(suggested("hcp", cardsText, auction)).toEqual(expected);
		},
	);

	it("does not suggest the [4NT] ask, which only has a meaning", () => {
		expect(callMeaning("hcp", calls("2H P 4NT"), 2)).toEqual({
			shape: { kind: "blackwood", small: { min: 33 }, grand: { min: 37 } },
		});
		// 17, three hearts
		expect(suggested("hcp", "AK4.Q73.AJ52.K64", "2H P")).toEqual([
			"2NT",
			"3H",
			"4H",
		]);
	});

	it.each([
		["2C P", "86542.K732.A5.Q6"], // 9, no good suit and not balanced
		["1H P", "AQ4.K732.KJ5.Q62"], // 15, four hearts but no other four-card suit
	])("describes %s but gives no call for %s", (auction, cardsText) => {
		expect(suggested("hcp", cardsText, auction)).toEqual([]);
	});
});

describe("guide meaning of a call", () => {
	it.each([
		[
			"hcp",
			"1NT",
			{ range: { min: 15, max: 17 }, shape: { kind: "balanced" } },
		],
		[
			"vienna",
			"P 1C",
			{
				range: { min: 19, max: 34 },
				shape: { kind: "cards", suit: "C", min: 3 },
			},
		],
		[
			"hcp",
			"1S",
			{
				range: { min: 12, max: 21 },
				shape: { kind: "cards", suit: "S", min: 5 },
			},
		],
		["hcp", "2C", { range: { min: 22 }, shape: { kind: "artificial" } }],
		[
			"hcp",
			"2H",
			{
				range: { min: 5, max: 11 },
				shape: { kind: "weak-two", suit: "H", length: 6 },
			},
		],
		[
			"four-aces",
			"3D",
			{
				range: { min: 3.5, max: 7 },
				shape: { kind: "preempt", suit: "D", length: 7 },
			},
		],
		["reith", "P", { range: { min: 0, max: 18 }, shape: { kind: "none" } }],
		["hcp", "1H P P", { range: { min: 0, max: 5 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1H P 2H",
			{
				range: { min: 6, max: 9 },
				shape: { kind: "support", suit: "H", min: 3 },
			},
		],
		[
			"hcp",
			"1H P 3H",
			{
				range: { min: 10, max: 12 },
				shape: { kind: "support", suit: "H", min: 3 },
			},
		],
		[
			"reith",
			"1H P 1S",
			{ range: { min: 10 }, shape: { kind: "cards", suit: "S", min: 4 } },
		],
		[
			"hcp",
			"1H P 2C",
			{ range: { min: 10 }, shape: { kind: "cards", suit: "C", min: 4 } },
		],
		["hcp", "1H P 1NT", { range: { min: 6, max: 9 }, shape: { kind: "none" } }],
		["hcp", "1NT P P", { range: { min: 0, max: 7 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1NT P 2C",
			{ range: { min: 8 }, shape: { kind: "stayman", min: 4 } },
		],
		["vienna", "1NT P 2D", { shape: { kind: "transfer", suit: "H", min: 5 } }],
		["hcp", "1NT P 2H", { shape: { kind: "transfer", suit: "S", min: 5 } }],
		[
			"hcp",
			"1NT P 2S",
			{ range: { min: 0, max: 7 }, shape: { kind: "weak-minor", min: 6 } },
		],
		[
			"hcp",
			"1NT P 2NT",
			{ range: { min: 8, max: 9 }, shape: { kind: "none" } },
		],
		[
			"vienna",
			"1NT P 3NT",
			{ range: { min: 16, max: 25 }, shape: { kind: "none" } },
		],
		[
			"four-aces",
			"2C P 2D",
			{ range: { min: 0, max: 4.5 }, shape: { kind: "waiting" } },
		],
		[
			"hcp",
			"2C P 3C",
			{ range: { min: 8 }, shape: { kind: "good-suit", suit: "C", min: 5 } },
		],
		["hcp", "2C P 2NT", { range: { min: 8 }, shape: { kind: "balanced" } }],
	] as const)("reads %s %s", (system, auction, expected) => {
		const all = calls(auction);
		expect(callMeaning(system, all, all.length - 1)).toEqual(expected);
	});

	it.each([
		["other", "1NT"],
		["hcp", "1H X 2H"],
		["hcp", "1H P 1S P"],
		["hcp", "1H P 4H"], // a jump to game
		["hcp", "1H P 3C"], // a jump in a new suit
		["hcp", "1C P 2C"], // a minor raise
		["hcp", "2C P P"],
		["hcp", "4S"],
	] as const)(
		"has no guide meaning for the last call of %s %s",
		(system, auction) => {
			const all = calls(auction);
			expect(callMeaning(system, all, all.length - 1)).toBeUndefined();
		},
	);

	it.each([
		[
			"hcp",
			"1H P 1S P 1NT",
			{ range: { min: 12, max: 14 }, shape: { kind: "balanced" } },
		],
		[
			"hcp",
			"1H P 1S P 2S",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "support", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1H P 1S P 3S",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "support", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1H P 1S P 2H",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1H P 1S P 3H",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1H P 1S P 3D",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "cards", suit: "D", min: 4 },
			},
		],
		[
			"hcp",
			"1H P 1S P 2NT",
			{ range: { min: 18, max: 19 }, shape: { kind: "balanced" } },
		],
		[
			"hcp",
			"1S P 2C P 3C",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "support", suit: "C", min: 4 },
			},
		],
		[
			"vienna",
			"1H P 1NT P 2H",
			{
				range: { min: 19, max: 23 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		["hcp", "1NT P 2C P 2D", { shape: { kind: "no-major", min: 4 } }],
		["hcp", "1NT P 2C P 2S", { shape: { kind: "cards", suit: "S", min: 4 } }],
		["hcp", "1NT P 2D P 2H", { shape: { kind: "accept", suit: "H" } }],
		["hcp", "1NT P 2H P 2S", { shape: { kind: "accept", suit: "S" } }],
		["hcp", "1NT P 2S P 3C", { shape: { kind: "relay" } }],
		[
			"hcp",
			"1NT P 2S P 3C P P",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "cards", suit: "C", min: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2S P 3C P 3D",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "cards", suit: "D", min: 6 },
			},
		],
		[
			"four-aces",
			"2C P 2D P 2NT",
			{ range: { min: 14.5, max: 16 }, shape: { kind: "balanced" } },
		],
		["hcp", "2H P 3H", { shape: { kind: "support", suit: "H", min: 3 } }],
		["hcp", "2S P 4S", { shape: { kind: "support", suit: "S", min: 3 } }],
		["hcp", "2H P 2NT", { range: { min: 15 }, shape: { kind: "ask" } }],
		[
			"hcp",
			"1H 1S",
			{
				range: { min: 8, max: 16 },
				shape: { kind: "good-suit", suit: "S", min: 5 },
			},
		],
		[
			"hcp",
			"1H 2C",
			{
				range: { min: 10, max: 16 },
				shape: { kind: "good-suit", suit: "C", min: 5 },
			},
		],
		[
			"reith",
			"1H P P 2D",
			{
				range: { min: 16, max: 26 },
				shape: { kind: "good-suit", suit: "D", min: 5 },
			},
		],
		[
			"hcp",
			"P 1H 1NT",
			{ range: { min: 15, max: 18 }, shape: { kind: "stopper", suit: "H" } },
		],
		[
			"hcp",
			"1H X",
			{
				range: { min: 12 },
				shape: { kind: "takeout", suit: "H", strong: { min: 17 } },
			},
		],
		[
			"four-aces",
			"1D P P X",
			{
				range: { min: 8 },
				shape: { kind: "takeout", suit: "D", strong: { min: 11 } },
			},
		],
		["hcp", "1H X XX", { range: { min: 10 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1H P 3H P 4NT",
			{ shape: { kind: "blackwood", small: { min: 33 }, grand: { min: 37 } } },
		],
		[
			"vienna",
			"1H 1S 3H P 4NT",
			{ shape: { kind: "blackwood", small: { min: 53 }, grand: { min: 59 } } },
		],
		[
			"four-aces",
			"1H P 3H P 4NT",
			{
				shape: { kind: "blackwood", small: { min: 21.5 }, grand: { min: 24 } },
			},
		],
		["hcp", "1H P 3H P 4NT P 5C", { shape: { kind: "aces", counts: [0, 4] } }],
		["hcp", "1H P 3H P 4NT P 5D", { shape: { kind: "aces", counts: [1] } }],
		["hcp", "1H P 3H P 4NT P 5S", { shape: { kind: "aces", counts: [3] } }],
	] as const)("reads the later call %s %s", (system, auction, expected) => {
		const all = calls(auction);
		expect(callMeaning(system, all, all.length - 1)).toEqual(expected);
	});

	it.each([
		["hcp", "1H P 1S P P"],
		["hcp", "1H P 1S P 2C"], // a new suit without a jump
		["hcp", "1H P 1S P 4S"],
		["hcp", "1H P 2H P 3H"], // the rebid after a raise
		["hcp", "1H P 1S 2C 2S"], // the rebid after an overcall
		["hcp", "1H 2H"], // a cue bid
		["hcp", "1H 2S"], // a jump overcall
		["hcp", "1H P"],
		["hcp", "1H 1S 2H"],
		["hcp", "1NT 2C"],
		["hcp", "1NT X"],
		["hcp", "2H 2S"],
		["hcp", "2H P 3C"],
		["hcp", "1NT P 4NT"], // not an ace ask after partner's notrump
		["hcp", "1NT P 2C P 2D P 4NT"],
		["hcp", "4NT"],
		["hcp", "1H P 3H P 4NT X 5D"],
		["hcp", "1H P 3H P 4NT P 6H"],
	] as const)(
		"has no guide meaning for the later call %s %s",
		(system, auction) => {
			const all = calls(auction);
			expect(callMeaning(system, all, all.length - 1)).toBeUndefined();
		},
	);

	it("reads an earlier call of the auction by its index", () => {
		expect(callMeaning("hcp", calls("1NT P 2C P"), 0)?.range).toEqual({
			min: 15,
			max: 17,
		});
	});
});

describe("guide calls and meanings agree", () => {
	it("gives each suggested call the meaning of that call, and the hand is in its range", () => {
		const auctions = [
			"",
			"P",
			"P P P",
			"1C P",
			"1H P",
			"1S P",
			"1NT P",
			"2C P",
			"2H P",
			"1D P 1H P",
			"1H P 1S P",
			"1S P 2C P",
			"1C P 1NT P",
			"1NT P 2C P",
			"1NT P 2H P",
			"1NT P 2S P",
			"1NT P 2S P 3C P",
			"2C P 2D P",
			"1H",
			"P 1S",
			"1D P P",
			"1H X",
			"1H P 3H P 4NT P",
		];
		let checked = 0;
		for (let game = 0; game < 60; game += 1) {
			const deal = dealCards(randomBelowFrom(seeded(game + 1)));
			for (const seat of SEATS)
				for (const system of RULE_SYSTEMS)
					for (const auction of auctions) {
						const before = calls(auction);
						const guide = conventionCalls(system, deal[seat], before);
						for (const { call, meaning } of guide ?? []) {
							checked += 1;
							expect(
								callMeaning(system, [...before, call], before.length),
							).toEqual(meaning);
							const points = countHandPoints(system, deal[seat]).total;
							expect(points).toBeGreaterThanOrEqual(meaning.range?.min ?? 0);
							expect(points).toBeLessThanOrEqual(
								meaning.range?.max ?? Infinity,
							);
						}
						if (before.every((call) => call === "P"))
							expect(
								(guide !== undefined && guide.length > 0) ||
									Math.max(
										...SUITS.map(
											(suit) =>
												deal[seat].filter((card) => card[0] === suit).length,
										),
									) >= 8,
								`${system} ${seat} ${game}: every opening hand has a guide call`,
							).toBe(true);
					}
		}
		expect(checked).toBeGreaterThan(1000);
	});
});

/** "15–17" or "22 or more", with half points as "½", as the English guides write a range. */
function pointsNumber(value: number): string {
	return Number.isInteger(value) ? `${value}` : `${Math.floor(value)}½`;
}

function rangeText({ min, max }: PointRange): string {
	return max === undefined
		? `${pointsNumber(min)} or more`
		: `${pointsNumber(min)}–${pointsNumber(max)}`;
}

/**
 * The section and the part of the guide line that states each range; {range} is the range text, {min} only its
 * minimum.
 */
const GUIDE_LINES: Readonly<Record<RangeKey, readonly [string, string]>> = {
	"open-pass": ["Opening bids", "- {range} points: [P]"],
	"open-weak-two": ["Opening bids", "- {range} points: weak two"],
	"open-preempt": ["Opening bids", "- {range} points: preempt"],
	"open-suit": ["Opening bids", "- {range} points: [1C] [1D] [1H] [1S]"],
	"open-1NT": ["Opening bids", "- {range} points: [1NT]"],
	"open-2NT": ["Opening bids", "- {range} points: [2NT]"],
	"open-2C": ["Opening bids", "- {range} points: [2C]"],
	"open-3NT": ["Opening bids", "- {range} points: [3NT]"],
	"suit-pass": ["Responses to one of a suit", "- {range} points: [P]"],
	"suit-low": ["Responses to one of a suit", "- {range} points: raise"],
	"suit-invite": [
		"Responses to one of a suit",
		"- {range} points: invitational",
	],
	"suit-force": [
		"Responses to one of a suit",
		"- {range} points: game forcing",
	],
	"nt-weak": ["Responses to [1NT]", "- {range} points: [P], or a transfer"],
	"nt-stayman": ["Responses to [1NT]", "- [2C] (Stayman): {range} points"],
	"nt-2NT": ["Responses to [1NT]", "- [2NT]: {range} points"],
	"nt-3NT": ["Responses to [1NT]", "- [3NT]: {range} points"],
	"2c-waiting": ["Responses to [2C]", "- [2D]: waiting, {range} points"],
	"2c-positive": ["Responses to [2C]", "- [2H] [2S] [3C] [3D]: {range} points"],
	"2c-2NT": ["Responses to [2C]", "- [2NT]: {range} points"],
	"2c-rebid-2NT": [
		"Opening bids",
		"With a balanced {range} points, rebid [2NT]",
	],
	"rebid-low": [
		"Opener's rebid",
		"- {range} points: [1NT] with a balanced hand",
	],
	"rebid-mid": ["Opener's rebid", "- {range} points: a jump raise"],
	"rebid-high": ["Opener's rebid", "- {range} points: a jump in a new suit"],
	"rebid-2NT": ["Opener's rebid", "[2NT] with a balanced {range} points."],
	"weak-2NT": ["Responses to a weak two", "- [2NT]: {range} points, asks"],
	"overcall-one": [
		"Competitive bids",
		"- An overcall at the one level: {range} points",
	],
	"overcall-two": ["Competitive bids", "At the two level: {range} points."],
	"overcall-1NT": ["Competitive bids", "- [1NT] overcall: {range} points"],
	takeout: ["Competitive bids", "- [X] (takeout): {range} points"],
	"takeout-strong": ["Competitive bids", "or any hand with {range} points."],
	redouble: [
		"Competitive bids",
		"- [XX] after partner's opening is doubled: {range} points.",
	],
	"slam-small": ["Targets for the partnership", "- {min} points: small slam."],
	"slam-grand": ["Targets for the partnership", "- {min} points: grand slam."],
};

function guideText(system: RuleSystem, locale: string): string {
	return readFileSync(
		new URL(
			`../../src/guides/${guideName(system)}_${locale}.txt`,
			import.meta.url,
		),
		"utf8",
	);
}

function sectionLines(text: string, section: string): string[] {
	const lines = text.split("\n");
	const start = lines.indexOf(`## ${section}`);
	if (start < 0) throw new Error(`no section "## ${section}"`);
	const end = lines.findIndex(
		(line, index) => index > start && line.startsWith("## "),
	);
	return lines.slice(start + 1, end < 0 ? undefined : end);
}

describe("convention rules agree with the guides", () => {
	it.each(RULE_SYSTEMS)(
		"states each %s range in its English guide line",
		(system) => {
			const text = guideText(system, "en");
			for (const [key, range] of Object.entries(RANGES[system]) as [
				RangeKey,
				PointRange,
			][]) {
				const [section, line] = GUIDE_LINES[key];
				const expected = line
					.replace("{range}", rangeText(range))
					.replace("{min}", pointsNumber(range.min));
				expect(
					sectionLines(text, section).some((candidate) =>
						candidate.includes(expected),
					),
					`${key} in convention-rules.ts does not match src/guides/${guideName(system)}_en.txt: no line "${expected}" in "## ${section}"`,
				).toBe(true);
			}
			// A new suit at the two level has the invitational minimum.
			expect(
				sectionLines(text, "Responses to one of a suit").join("\n"),
			).toContain(
				`A new suit at the two level needs ${rangeText({ min: RANGES[system]["suit-invite"].min })} points.`,
			);
		},
	);

	it.each(
		RULE_SYSTEMS.flatMap((system) =>
			["de", "hu", "no", "es", "pt", "fr", "it", "nl"].map(
				(locale) => [system, locale] as const,
			),
		),
	)(
		"gives the %s guide in %s the same numbers as the English guide",
		(system, locale) => {
			const numbers = (text: string) => (text.match(/\d+½?|½/g) ?? []).sort();
			expect(
				numbers(guideText(system, locale)),
				`src/guides/${guideName(system)}_${locale}.txt has other numbers than ${guideName(system)}_en.txt`,
			).toEqual(numbers(guideText(system, "en")));
		},
	);
});
