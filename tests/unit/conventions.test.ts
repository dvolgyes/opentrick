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
import {
	callMeaning,
	conventionCalls,
	fitsCall,
} from "../../src/bridge/conventions";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import {
	countHandPoints,
	type PointSystem,
} from "../../src/bridge/hand-points";
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

const RULE_SYSTEMS: readonly RuleSystem[] = ["hcp", "hcp-corrected"];

/** The scales that have a guide but no rules: only their guide text. */
const GUIDE_ONLY: readonly PointSystem[] = ["vienna", "reith", "four-aces"];

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
		// 15 HCP, and 14 corrected HCP for the 4333 shape.
		const cardsText = "AQ4.KJ5.Q86.K732";
		expect(suggested("hcp", cardsText, "")).toEqual(["1NT"]);
		expect(suggested("hcp-corrected", cardsText, "")).toEqual(["1C"]);
	});

	it.each(GUIDE_ONLY)(
		"gives no calls, no meanings and no hand check on the %s scale, which has only its guide",
		(system) => {
			const cards = hand("AQ4.KJ5.Q862.K73");
			expect(conventionCalls(system, cards, [])).toBeUndefined();
			expect(conventionCalls(system, cards, calls("1H P"))).toBeUndefined();
			expect(fitsCall(system, cards, [], "1NT")).toBeUndefined();
			expect(fitsCall(system, cards, [], "7NT")).toBeUndefined();
			for (const auction of ["1NT", "P 1C", "1H P 3H P 4NT"]) {
				const all = calls(auction);
				expect(callMeaning(system, all, all.length - 1)).toBeUndefined();
			}
		},
	);

	it.each([
		["1H P", "K84.Q73.J652.Q64", ["2H"]], // 8, three hearts: raise
		["1H P", "KJ84.73.Q652.J64", ["1S"]], // 7, a new suit at the one level: [1NT] denies four spades
		["1S P", "84.KJ73.Q652.J64", ["1NT"]], // 7, no new suit at the one level
		["1H P", "K84.Q73.86.AJ652", ["2H", "3H"]], // 10, three hearts: the single and the limit raise overlap
		["1H P", "Q84.73.K86.AJ652", ["1NT"]], // 10, a new suit at the two level needs 11
		["1H P", "Q84.73.K86.AQ652", ["2C"]], // 11, five clubs
		["1S P", "K84.Q73.J652.Q64", ["2S"]], // 8, three spades: raise, not [1NT]
		["1D P", "K84.73.QJ65.Q642", ["1NT", "2D"]], // 8, four diamonds
		["1D P", "K84.73.QJ652.A64", ["1NT", "2D", "3D"]], // 10, five diamonds
		["1C P", "K84.73.Q65.QJ642", ["1NT", "2C"]], // 8, five clubs
		["1C P", "K84.73.Q652.QJ64", ["1D", "1NT"]], // 8, four clubs do not raise [1C]
		["1C P", "K84.QJ73.Q65.Q64", ["1H"]], // 10, a four-card major: not [1NT]
		["1H P", "AQ84.73.K65.KJ62", ["1S", "2C"]], // 13, game forcing
		["1H P", "K5.KQ74.A963.J84", ["2NT"]], // 13, four hearts: Jacoby 2NT, not a new suit
		["1H P", "AQ4.K732.KJ5.Q62", ["2NT"]], // 15, four hearts and no other four-card suit
		["1H P", "5.KJ754.Q9632.84", ["4H"]], // 6, five hearts and a singleton: preemptive
		["1S P", "KQ.Q74.AJ63.K842", ["2C", "2D", "3NT"]], // 15, balanced, two spades
		["1C P", "KQ4.Q73.AJ6.K842", ["2NT"]], // 15, balanced, no four-card major
		["1C P", "AQ4.K73.AJ6.Q842", ["3NT"]], // 16, balanced, no four-card major
		["1H P", "AKJ84.A3.KQ6.Q42", ["2S"]], // 19, a good five-card suit: jump shift
		["1D P", "A3.KQ6.Q42.AKJ84", ["3C"]], // 19, a good five-card suit: jump shift
		["1H P", "J9842.A3.KQ6.AKQ", ["1S"]], // 19, the suit is not good
		["1H P 2NT P", "A4.KJ763.K52.Q42", ["4H"]], // 13, no singleton or void
		["1H P 2NT P", "AQ4.KJ763.K52.Q4", ["3NT"]], // 15
		["1H P 2NT P", "AK4.AKJ63.K52.Q4", ["3H"]], // 20
		["1H P 2NT P", "AK4.AKJ63.K852.4", ["3C"]], // 18, a singleton club
		["1H P 2NT P", "4.AKJ763.5.KQ842", ["3D"]], // 13, two singletons: the lower one
		["1C 1H", "KJ84.73.Q652.J64", ["X"]], // 7, exactly four spades: negative double
		["1C 1D", "KJ84.Q973.65.J64", ["X"]], // 7, four cards in both majors
		["1D 1S", "84.KJ73.Q652.J64", ["X"]], // 7, four hearts
		["1D 1S", "84.KJ732.Q65.J64", ["X"]], // 7, five hearts: too weak for [2H]
		["1D 1S", "84.KJ732.A65.Q64", ["X", "2H"]], // 10, five hearts: both fit
		["1D 1S", "84.AKJ73.Q65.K64", ["2H"]], // 13, five hearts: a new suit, not [X]
		["1H 2C", "KJ84.73.Q652.Q64", ["X"]], // 8, four spades after a two-level overcall
		["1D 2C", "KJ842.Q973.A5.64", ["X", "2S"]], // 10, five spades and four hearts
		["1C 1H X P", "AQ84.K73.Q65.Q64", ["1S"]], // 13, four spades
		["1C 1H X P", "AQ84.K7.KQ5.Q642", ["2S"]], // 16, four spades: a jump
		["1C 1H X P", "AQ84.K7.AKQ5.Q64", ["2H"]], // 20: the opponents' suit
		["1C 1D X P", "AQ84.K732.Q6.Q64", ["1H", "1S"]], // 13, four cards in both majors
		["1D 1S X P", "A4.KQ73.KJ65.Q64", ["2H"]], // 15, four hearts
		["1D 1S X P", "A4.KQ73.AJ65.Q64", ["3H"]], // 16, four hearts: a jump
		["1H P", "8642.73.J652.Q64", ["P"]], // 3
		["1NT P", "84.QT973.J52.632", ["2D"]], // 3, five hearts: a transfer, not a pass
		["1NT P", "8432.732.Q98.J52", ["P"]], // 3, no five-card suit
		["1NT P", "Q842.J73.Q52.643", ["P"]], // 5, a four-card major is not enough for Stayman
		["1NT P", "84.QT973.J5432.6", ["2D"]], // 3, five hearts and five diamonds: the major first
		["1NT P", "KJ84.A73.Q65.643", ["2C"]], // 10, four spades: Stayman, not [3NT]
		["1NT P", "84.73.QT9873.J52", ["2S"]], // 3, six diamonds
		["1NT P", "84.73.QT987.J752", ["2S"]], // 3, five diamonds, not 5-3-3-2
		["1NT P", "84.732.QT987.J52", ["P"]], // 3, five diamonds in a 5-3-3-2 hand
		["1NT P", "J842.Q973.T9852.-", ["2C"]], // 3, weak Stayman: no clubs, also with five diamonds
		["1NT P", "J842.Q973.T985.2", ["2C"]], // 3, weak Stayman: 4-4-4-1
		["1NT P", "J842.Q973.T9.852", ["P"]], // 3, two clubs: not weak Stayman
		["1NT P", "K84.Q73.A652.643", ["2NT"]], // 9
		["1NT P", "84.Q3.AQT873.J52", ["3D"]], // 9, six diamonds: [3D], not [2NT]
		["1NT P", "AKQ842.KQ3.A5.64", ["3S"]], // 18, six spades: slam interest
		["1NT P", "A4.K3.AKQ873.Q52", ["4C"]], // 18, unbalanced: Gerber
		["1NT P", "AQ4.KJ3.KQ852.Q4", ["4NT"]], // 17, a balanced 5-3-3-2 hand: not Gerber
		["1NT P", "K84.Q73.AQ52.643", ["3NT"]], // 11
		["1NT P", "K84.Q73.AQJ52.64", ["3NT"]], // 12, a five-card minor and no four-card major
		["1NT P", "AQ4.KJ3.KQ52.Q43", ["4NT"]], // 17: invites a slam
		["1NT P", "AQ4.KQ3.AQ52.Q43", ["6NT"]], // 19
		["1NT P", "AK4.AK3.AQ52.KQ3", ["7NT"]], // 25
		["1NT P", "KJ842.Q973.A5.64", ["2C"]], // 10, five spades and four hearts: Stayman, not a transfer
		["1NT P", "KJ842.Q973.85.64", ["2H"]], // 6, five spades and four hearts: a transfer, weak
		["2NT P", "A4.K3.KQ8732.Q52", ["4C"]], // 14, unbalanced: Gerber
		["1NT P", "KQ842.QJ973.5.64", ["2D"]], // 8, five-five in the majors: hearts, then [2S]
		["1NT P", "KQ842.J9732.5.64", ["2H"]], // 6, five-five in the majors: spades
		["1NT P", "KQ842.AJ973.5.64", ["2H"]], // 10, five-five in the majors: spades, then [3H]
		["1NT P", "KQ84.QJ9732.5.64", ["2D"]], // 8, six hearts and four spades: the longer major
		["1NT X", "84.QT973.J52.632", ["2D"]], // 3, the same responses after a double
		["2C P", "8642.K73.J52.643", ["2D"]], // 4
		["2C P", "84.KQJ73.A52.643", ["2H", "2NT"]], // 10, a good five-card suit, balanced
		["2C P", "K842.Q73.A52.J64", ["2NT"]], // 10, balanced
	])("answers %s with %s by %j in HCP", (auction, cardsText, expected) => {
		expect(suggested("hcp", cardsText, auction)).toEqual(expected);
	});

	it("passes [1NT] with a 4333 hand without honours, which counts -1 in corrected HCP", () => {
		expect(suggested("hcp-corrected", "642.952.8762.865", "1NT P")).toEqual([
			"P",
		]);
	});

	it.each([
		["other", "", "AQ4.KJ5.Q862.K73"],
		["hcp", "", "KQT98732.4.J52.6"], // an eight-card suit
		["hcp", "1H 1S", "K84.Q73.J652.Q64"],
		["hcp", "1C 1H", "KJ842.73.Q65.J64"], // five spades: [1S] after an overcall is not in the guide
		["hcp", "1C 1H X P", "AQ8.K73.KQ5.Q642"], // 16, three spades: no answer to the negative double fits
		["hcp", "1H P 1S 2C", "K84.Q73.J652.Q64"], // the rebid after an overcall
		["hcp", "1D P 2D P", "K84.Q73.J652.Q64"], // the rebid after a minor raise
		["hcp", "1H P 1S P 2C P", "K84.Q73.J652.Q64"], // responder's second call
		["hcp", "1H P 1S P", "A4.KQJ73.K82.Q65"], // 15, balanced: no rebid fits
		["hcp", "1H P 1S P", "A2.KQ952.K3.Q432"], // 14, not balanced, after a forcing new suit
		["hcp", "2C P 2D P", "AKQ2.AKQ52.K3.Q4"], // 24, not balanced
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
		["1NT P 2C P", "AQ84.KJ52.Q8.K73", ["2H"]], // both majors: hearts first
		["1NT P 2C P", "AQ84.KJ5.Q82.K73", ["2S"]], // four spades
		["1NT P 2D P", "AQ4.KJ5.Q862.K73", ["2H"]],
		["1NT P 2H P", "AQ4.KJ5.Q862.K73", ["2S"]],
		["1NT P 2D P", "AQ4.KQ52.Q86.A73", ["3H"]], // 17, four hearts: super-accept
		["1NT P 2H P", "AQ84.KQ5.Q86.A73", ["3S"]], // 17, four spades: super-accept
		["1NT P 2D P", "AQ4.KJ52.Q86.A73", ["2H"]], // 16, four hearts
		["1NT P 2D P 2H P", "84.QT973.J52.632", ["P"]], // 3
		["1NT P 2D P 2H P", "84.KQ973.J52.Q32", ["2NT"]], // 8, five hearts
		["1NT P 2D P 2H P", "84.KQ9732.J52.Q3", ["3H"]], // 8, six hearts
		["1NT P 2D P 2H P", "84.KQ973.A52.Q32", ["3NT"]], // 11, 5-3-3-2
		["1NT P 2D P 2H P", "84.KQ973.A5.Q432", ["3NT"]], // 11, 5-4-2-2
		["1NT P 2D P 2H P", "8.KQ973.A52.Q432", ["3C"]], // 11, four clubs and a singleton
		["1NT P 2D P 2H P", "-.KQ973.A542.Q432", ["3C"]], // 11, two four-card minors: the lower
		["1NT P 2D P 2H P", "8.KQ973.A5432.Q2", ["3D"]], // 11, the longer minor
		["1NT P 2D P 2H P", "84.KQ9732.A52.Q3", ["4H"]], // 11, six hearts
		["1NT P 2D P 2H P", "KQ842.QJ973.5.64", ["2S"]], // 8, five-five in the majors
		["1NT P 2D P 2H P", "AK4.KQ973.A52.Q3", []], // 18, five hearts: no guide call
		["1NT P 2H P 2S P", "KQ842.AJ973.5.64", ["3H"]], // 10, five-five in the majors
		["1NT P 2D P 3H P", "84.QT973.J52.Q32", ["P"]], // 5
		["1NT P 2D P 3H P", "84.QT973.K52.Q32", ["4H"]], // 7
		["1NT P 2D P 2H P 2NT P", "AQ4.KJ5.Q862.K73", ["3H"]], // 15, three hearts
		["1NT P 2D P 2H P 2NT P", "AQ43.KJ.Q862.K73", ["P"]], // 15, two hearts
		["1NT P 2D P 2H P 2NT P", "AQ4.KJ5.Q862.A73", ["4H"]], // 16, three hearts
		["1NT P 2D P 2H P 2NT P", "AQ43.KJ.Q862.A73", ["3NT"]], // 16, two hearts
		["1NT P 2D P 2H P 3H P", "AQ43.KJ.Q862.K73", ["P"]], // 15
		["1NT P 2D P 2H P 3H P", "AQ43.KJ.Q862.A73", ["4H"]], // 16
		["1NT P 2D P 2H P 3NT P", "AQ4.KJ5.Q862.K73", ["4H"]], // three hearts
		["1NT P 2D P 2H P 3NT P", "AQ43.KJ.Q862.A73", ["P"]], // two hearts
		["1NT P 2D P 2H P 2S P", "AQ4.KJ5.Q862.K73", ["P"]], // 15, three spades, three hearts
		["1NT P 2D P 2H P 2S P", "AQ.KJ.Q8652.K973", ["P"]], // 15, two spades, two hearts
		["1NT P 2D P 2H P 2S P", "AQ.KJ52.Q862.K73", ["3H"]], // 15, more hearts
		["1NT P 2D P 2H P 2S P", "AQ.KJ52.Q862.A73", ["4H"]], // 16, more hearts
		["1NT P 2D P 2H P 2S P", "AQ4.KJ5.Q862.A73", ["4S"]], // 16, three spades, three hearts
		["1NT P 2C P 2D P", "QJ84.KQ973.52.32", ["2H"]], // 8, five hearts, four spades
		["1NT P 2C P 2D P", "KQ973.QJ84.52.32", ["2S"]], // 8, five spades, four hearts
		["1NT P 2C P 2D P", "J984.KQ973.A2.32", ["3H"]], // 10, five hearts, four spades
		["1NT P 2C P 2D P", "KJ84.QJ84.52.Q32", ["2NT"]], // 9, four-four
		["1NT P 2C P 2D P", "KJ84.Q84.A52.Q32", ["3NT"]], // 12
		["1NT P 2C P 2D P", "J984.T843.J9852.-", ["P"]], // 2, weak Stayman
		["1NT P 2C P 2D P", "AK84.KQ84.A52.32", []], // 16: no guide call
		["1NT P 2C P 2H P", "QJ84.KQ84.52.532", ["3H"]], // 8, four hearts
		["1NT P 2C P 2H P", "QJ84.KQ84.A2.532", ["4H"]], // 12, four hearts
		["1NT P 2C P 2H P", "KJ84.Q84.J52.Q32", ["2NT"]], // 9, four spades
		["1NT P 2C P 2H P", "KJ84.Q84.A52.Q32", ["3NT"]], // 12, four spades
		["1NT P 2C P 2H P", "KQ973.QJ84.52.32", ["3H"]], // 8, five spades, four hearts
		["1NT P 2C P 2S P", "KJ84.Q84.J52.Q32", ["3S"]], // 9, four spades
		["1NT P 2C P 2S P", "Q84.KJ84.J52.Q32", ["2NT"]], // 9, four hearts
		["1NT P 2C P 2S P", "Q84.KJ84.A52.Q32", ["3NT"]], // 12, four hearts
		["1NT P 2C P 2S P", "KJ84.Q84.A52.Q32", ["4S"]], // 12, four spades
		["1NT P 2C P 2D P 2H P", "AQ4.KJ5.Q862.K73", ["P"]], // 15, three hearts
		["1NT P 2C P 2D P 2H P", "AQ4.KJ.Q8652.K73", ["2NT"]], // 15, two hearts
		["1NT P 2C P 2D P 2H P", "AQ4.KJ5.Q862.A73", ["4H"]], // 16, three hearts
		["1NT P 2C P 2D P 2H P", "AQ4.KJ.Q8652.A73", ["3NT"]], // 16, two hearts
		["1NT P 2C P 2D P 3S P", "AQ4.KJ5.Q862.K73", ["4S"]], // three spades
		["1NT P 2C P 2D P 3S P", "AQ.KJ5.Q8652.K73", ["3NT"]], // two spades
		["1NT P 2C P 2D P 2NT P", "AQ4.KJ5.Q862.K73", ["P"]], // 15
		["1NT P 2C P 2D P 2NT P", "AQ4.KJ5.Q862.A73", ["3NT"]], // 16
		["1NT P 2C P 2D P 3NT P", "AQ4.KJ5.Q862.A73", ["P"]],
		["1NT P 2C P 2H P 2NT P", "AQ84.KJ52.Q8.K73", ["3S"]], // 15, four spades
		["1NT P 2C P 2H P 2NT P", "AQ84.KJ52.Q8.A73", ["4S"]], // 16, four spades
		["1NT P 2C P 2H P 2NT P", "AQ4.KJ52.Q86.K73", ["P"]], // 15
		["1NT P 2C P 2H P 2NT P", "AQ4.KJ52.Q86.A73", ["3NT"]], // 16
		["1NT P 2C P 2H P 3NT P", "AQ84.KJ52.Q8.K73", ["4S"]], // four spades
		["1NT P 2C P 2H P 3NT P", "AQ4.KJ52.Q86.K73", ["P"]],
		["1NT P 2C P 2H P 3H P", "AQ4.KJ52.Q86.K73", ["P"]], // 15
		["1NT P 2C P 2H P 3H P", "AQ4.KJ52.Q86.A73", ["4H"]], // 16
		["1NT P 2C P 2S P 2NT P", "AQ84.KJ5.Q82.K73", ["P"]], // 15
		["1NT P 2C P 2S P 3S P", "AQ84.KJ5.Q82.A73", ["4S"]], // 16
		["1NT P 2S P", "AQ4.KJ5.Q862.K73", ["3C"]],
		["1NT P 2S P 3C P", "84.73.QT9873.J52", ["3D"]], // six diamonds
		["1NT P 2S P 3C P", "84.732.QT987.J52", ["3D"]], // five diamonds
		["1NT P 2S P 3C P", "84.73.J52.QT9873", ["P"]], // six clubs
		["1NT P 2NT P", "AQ4.KJ5.Q862.K73", ["P"]], // 15
		["1NT P 2NT P", "AQ4.KJ5.Q862.A73", ["3NT"]], // 16
		["1NT P 4NT P", "AQ4.KJ5.Q862.K73", ["P"]], // 15
		["1NT P 4NT P", "AQ4.KJ5.Q862.A73", ["6NT"]], // 16
		["1NT P 3D P", "AQ4.KJ5.Q862.K73", ["P"]], // 15
		["1NT P 3C P", "AQ4.KJ5.Q862.A73", ["3NT"]], // 16
		["1NT P 3S P", "AQ4.KJ5.Q862.K73", ["4S"]], // 15
		["1NT P 3S P", "AQ.KJ52.Q862.A73", ["4S"]], // 16, two spades
		["1NT P 3S P", "AQ4.KJ5.Q862.A73", ["4NT"]], // 16, three spades: Blackwood
		["1NT P 3H P 4NT P", "AQ4.KJ5.Q862.K73", ["5D"]], // one ace
		["1NT P 4C P", "AQ4.KJ5.Q862.K73", ["4H"]], // one ace
		["2NT P 4C P", "AK4.AQ5.KQ62.K73", ["4S"]], // two aces
		["1NT P 4C P 4H P 5C P", "AQ4.KJ5.Q862.K73", ["5S"]], // two kings
		["2C P 2D P", "AK4.AKJ5.KQ2.QJ3", ["2NT"]], // 23, balanced
		["2H P", "K84.Q73.J652.Q64", ["3H", "4H"]], // three hearts
		["2H P", "AK84.Q7.AJ52.K64", ["2NT"]], // 17
		["1H", "KQJ73.84.J52.A64", ["1S"]], // 11, a good five-card suit
		["P 1S", "84.A4.KQJ73.Q652", ["2D"]], // 12, at the two level
		["1H", "A84.4.KQ52.KJ643", ["X"]], // 13, short in hearts
		["1H", "AQ4.KJ5.Q862.K73", ["1NT"]], // 15, balanced, KJ5 stops hearts
		["1H X", "AQ4.84.Q862.K732", ["XX"]], // 11
		["1H X", "K84.Q73.J652.Q64", ["P"]], // 8: no other guide call fits
		["1H", "K84.Q73.J652.Q64", ["P"]], // 8, no five-card suit: no overcall fits
		["P 1H", "K84.Q73.J652.Q64", ["P"]],
		["1H P P", "K84.Q73.J652.Q64", ["P"]],
		["2S P", "K8.Q73.J652.Q643", ["P"]], // no support, too weak for [2NT]
		["1H P 1NT P", "A2.KQ952.K3.Q432", ["P"]], // 14, not balanced, five hearts
		["1H P 3H P 4NT P", "AQ4.KJ5.Q862.K73", ["5D"]], // one ace
		["1H P 3H P 4NT P", "KQ4.KJ5.Q862.K73", ["5C"]], // no ace
		["1H P 2H P", "K4.AQJ73.K82.J65", ["P"]], // 14
		["1H P 2H P", "K4.AKJ73.K82.J65", ["3H"]], // 15: a game try
		["1H P 2H P", "A4.AKJ73.AQ82.65", ["4H"]], // 18
		["1H P 2H 2S", "K4.AQJ873.K8.J65", ["3H"]], // 14, six hearts: competitive
		["1H P 2H X", "K4.AKJ873.K8.Q65", ["3H"]], // 16, six hearts
		["1H P 2H 2S", "K4.AQJ73.K82.J65", ["P"]], // 14, five hearts: no other guide call fits
		["1S P 2S 3H", "AKJ73.A4.AQ82.65", ["4S"]], // 18
		["1H P 3H P", "K4.AQJ73.K82.J65", ["P"]], // 14: at most 26 together
		["1H P 3H P", "K4.AKJ73.K82.J65", ["4H"]], // 15: at least 25 together
		["2H P 2NT P", "84.KQT973.J52.63", ["3H"]], // 6: minimum
		["2H P 2NT P", "84.AKJT73.Q52.63", ["3NT"]], // 10, no side ace or king
		["2H P 2NT P", "K4.KQT973.J52.63", ["3S"]], // 9, spade feature
		["2H P 2NT P", "K4.KQT973.K52.63", ["3D"]], // 11, two features: the lower one
		["2H P 2NT P", "A4.KQT973.K52.63", []], // 12: not a weak two
		["2D P 2NT P", "84.63.KQT973.A52", ["3C"]], // 9, club feature below the suit
		["2D P 2NT P", "87.K6.KQT743.JT8", ["3H"]], // 9, heart feature: W2 in docs/bidding-reference.md
		["2S P 2NT P", "KQT973.A52.84.63", ["3H"]], // 9, heart feature
		["2S P 2NT P", "KQT973.852.84.Q3", ["3S"]], // 7: minimum
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
	])("describes %s but gives no call for %s", (auction, cardsText) => {
		expect(suggested("hcp", cardsText, auction)).toEqual([]);
	});
});

describe("a hand against the meaning of one call", () => {
	it.each([
		// 8, two spades: the overcall needs a good five-card suit. The guide gives this hand no call over [1H].
		["hcp-corrected", "Q2.KJ92.Q874.432", "1H", "1S", false],
		["hcp", "KQJ74.92.Q87.432", "1H", "1S", true], // 8, a good five-card suit
		["hcp", "Q2.KJ92.Q874.432", "1H", "7NT", false], // the guide has no 7NT over an opening
		["hcp", "Q2.KJ92.Q874.432", "1H", "P", true], // a pass is the call of a hand that fits no guide call
		["hcp", "KQ974.92.A87.432", "1H", "P", true], // also with a good overcall: a pass fits any hand here
		["hcp", "A2.KQ952.K3.Q432", "1H P 1S P", "P", false], // the new suit forces a rebid
		["hcp", "AKQ2.AKQ52.K3.Q4", "2C P 2D P", "P", false], // [2C] forces to game
		["hcp", "AQ4.84.Q862.K732", "2C P", "P", false], // the guide always answers [2C]
		["hcp", "Q2.KJ92.Q874.432", "1H 1S", "7NT", undefined], // the guide describes only some calls after an overcall
		["hcp", "Q2.KJ92.Q874.432", "1H 1S", "2C", false], // 7, three clubs: the new suit needs five cards and 10 points
		["hcp", "Q2.KJ92.Q874.432", "1H 1S", "X", undefined], // no major that no one has bid
		["hcp", "KJ84.73.Q652.J64", "1H 2C", "X", false], // 7: after a two-level overcall [X] needs 8
		["hcp", "Q2.KJ92.Q874.432", "1H P 3H P", "4NT", true], // the ask fits any hand
		["hcp", "A2.KJ92.Q874.432", "2NT P", "3NT", undefined], // after [2NT] the guide describes only Gerber
		["hcp", "A2.K92.KQ8743.43", "2NT P", "4C", true], // 12, unbalanced: Gerber
		["hcp", "A2.KJ92.Q874.432", "2NT P", "4C", false], // a four-card major
		["hcp", "Q2.KJ92.Q874.432", "1NT P 4C P 4H P", "5C", true], // the king ask fits any hand
		["other", "Q2.KJ92.Q874.432", "1H", "1S", undefined],
	] as const)(
		"%s: %s after %s, %s fits: %s",
		(system, cardsText, auction, call, fits) => {
			expect(fitsCall(system, hand(cardsText), calls(auction), call)).toBe(
				fits,
			);
		},
	);
});

describe("guide meaning of a call", () => {
	it.each([
		[
			"hcp",
			"1NT",
			{ range: { min: 15, max: 17 }, shape: { kind: "balanced" } },
		],
		[
			"hcp-corrected",
			"P 1C",
			{
				range: { min: 12, max: 21 },
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
			"hcp-corrected",
			"3D",
			{
				range: { min: 5, max: 10 },
				shape: { kind: "preempt", suit: "D", length: 7 },
			},
		],
		[
			"hcp-corrected",
			"P",
			{ range: { min: 0, max: 11 }, shape: { kind: "none" } },
		],
		["hcp", "1H P P", { range: { min: 0, max: 5 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1H P 2H",
			{
				range: { min: 6, max: 10 },
				shape: { kind: "support", suit: "H", min: 3 },
			},
		],
		[
			"hcp",
			"1D P 2D",
			{
				range: { min: 6, max: 10 },
				shape: { kind: "support", suit: "D", min: 4 },
			},
		],
		[
			"hcp-corrected",
			"1C P 3C",
			{
				range: { min: 10, max: 12 },
				shape: { kind: "support", suit: "C", min: 5 },
			},
		],
		[
			"hcp",
			"1C P 1NT",
			{ range: { min: 6, max: 10 }, shape: { kind: "no-major", min: 4 } },
		],
		[
			"hcp",
			"1S P 1NT",
			{
				range: { min: 6, max: 10 },
				shape: { kind: "at-most", suit: "S", max: 2 },
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
			"hcp",
			"1S P 2NT",
			{ range: { min: 13 }, shape: { kind: "support", suit: "S", min: 4 } },
		],
		[
			"hcp",
			"1H P 3NT",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "balanced-with", suit: "H", length: 2 },
			},
		],
		[
			"hcp",
			"1C P 2NT",
			{
				range: { min: 13, max: 15 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1D P 3NT",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1H P 2S",
			{ range: { min: 19 }, shape: { kind: "good-suit", suit: "S", min: 5 } },
		],
		[
			"hcp",
			"1D P 3C",
			{ range: { min: 19 }, shape: { kind: "good-suit", suit: "C", min: 5 } },
		],
		[
			"hcp",
			"1C 1H X",
			{ range: { min: 6 }, shape: { kind: "negative", suits: ["S"] } },
		],
		[
			"hcp",
			"1C 1D X",
			{ range: { min: 6 }, shape: { kind: "negative", suits: ["S", "H"] } },
		],
		[
			"hcp",
			"1D 1S X",
			{
				range: { min: 6 },
				shape: { kind: "negative", suits: ["H"], five: { min: 6, max: 10 } },
			},
		],
		[
			"hcp",
			"1H 2C X",
			{
				range: { min: 8 },
				shape: { kind: "negative", suits: ["S"], five: { min: 6, max: 10 } },
			},
		],
		[
			"hcp",
			"1H 1S 2C",
			{ range: { min: 10 }, shape: { kind: "cards", suit: "C", min: 5 } },
		],
		[
			"hcp",
			"1C 1H X P 1S",
			{
				range: { min: 12, max: 15 },
				shape: { kind: "cards", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1C 1H X P 2S",
			{
				range: { min: 16, max: 18 },
				shape: { kind: "cards", suit: "S", min: 4 },
			},
		],
		["hcp", "1C 1H X P 2H", { range: { min: 19 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1S P 4S",
			{
				range: { min: 6, max: 9 },
				shape: { kind: "short-support", suit: "S", min: 5 },
			},
		],
		[
			"hcp",
			"1H P 2NT P 3S",
			{ shape: { kind: "shortness", suit: "S", trumps: "H" } },
		],
		[
			"hcp",
			"1S P 2NT P 4S",
			{ range: { min: 12, max: 14 }, shape: { kind: "no-shortness" } },
		],
		[
			"hcp",
			"1S P 2NT P 3NT",
			{ range: { min: 15, max: 17 }, shape: { kind: "no-shortness" } },
		],
		[
			"hcp",
			"1H P 2NT P 3H",
			{ range: { min: 18, max: 21 }, shape: { kind: "no-shortness" } },
		],
		[
			"hcp-corrected",
			"1H P 1S",
			{ range: { min: 6 }, shape: { kind: "cards", suit: "S", min: 4 } },
		],
		[
			"hcp",
			"1H P 2C",
			{ range: { min: 11 }, shape: { kind: "cards", suit: "C", min: 4 } },
		],
		[
			"hcp",
			"1H P 1NT",
			{
				range: { min: 6, max: 10 },
				shape: {
					kind: "at-most-both",
					suit: "H",
					max: 2,
					other: "S",
					otherMax: 3,
				},
			},
		],
		[
			"hcp",
			"1NT P P",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "nt-pass", min: 5, long: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2C",
			{
				shape: {
					kind: "stayman",
					min: 4,
					strong: { min: 8 },
					weak: { min: 0, max: 7 },
					clubs: 1,
				},
			},
		],
		[
			"hcp-corrected",
			"1NT P 2D",
			{ shape: { kind: "transfer", suit: "H", min: 5 } },
		],
		["hcp", "1NT P 2H", { shape: { kind: "transfer", suit: "S", min: 5 } }],
		[
			"hcp",
			"1NT P 2S",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "weak-minor", min: 5, long: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2NT",
			{ range: { min: 8, max: 9 }, shape: { kind: "no-major", min: 4 } },
		],
		[
			"hcp",
			"1NT P 3D",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "invite", suit: "D", min: 6 },
			},
		],
		[
			"hcp",
			"1NT P 3S",
			{ range: { min: 16 }, shape: { kind: "slam-try", suit: "S", min: 6 } },
		],
		[
			"hcp",
			"1NT P 4C",
			{ range: { min: 16 }, shape: { kind: "gerber", min: 4 } },
		],
		[
			"hcp",
			"2NT P 4C",
			{ range: { min: 12 }, shape: { kind: "gerber", min: 4 } },
		],
		[
			"hcp-corrected",
			"1NT P 3NT",
			{ range: { min: 10, max: 15 }, shape: { kind: "no-major", min: 4 } },
		],
		[
			"hcp",
			"1NT P 4NT",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1NT P 6NT",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1NT P 7NT",
			{
				range: { min: 22 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1NT P 3D P P",
			{ range: { min: 15, max: 15 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 3C P 3NT",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 3S P 4S",
			{
				shape: {
					kind: "slam-decline",
					suit: "S",
					short: 2,
					points: { min: 15, max: 15 },
				},
			},
		],
		[
			"hcp",
			"1NT P 3H P 4NT",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "ace-ask", suit: "H", min: 3 },
			},
		],
		["hcp", "1NT P 3H P 4NT P 5H", { shape: { kind: "aces", counts: [2] } }],
		["hcp", "1NT P 4C P 4D", { shape: { kind: "aces", counts: [0, 4] } }],
		["hcp", "2NT P 4C P 4NT", { shape: { kind: "aces", counts: [3] } }],
		["hcp", "1NT P 4C P 4H P 5C", { shape: { kind: "king-ask" } }],
		[
			"hcp",
			"1NT P 4C P 4H P 5C P 5S",
			{ shape: { kind: "kings", counts: [2] } },
		],
		["hcp", "1NT X 2D", { shape: { kind: "transfer", suit: "H", min: 5 } }],
		[
			"hcp-corrected",
			"2C P 2D",
			{ range: { min: 0, max: 7 }, shape: { kind: "waiting" } },
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
		["hcp", "1H P 4S"], // a jump to game in a new suit
		["hcp", "1H P 4C"], // a double jump in a new suit
		["hcp", "1C P 4C"], // a minor raise past the jump raise
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
			"hcp-corrected",
			"1H P 1NT P 2H",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		["hcp", "1NT P 2C P 2D", { shape: { kind: "no-major", min: 4 } }],
		["hcp", "1NT P 2C P 2S", { shape: { kind: "cards", suit: "S", min: 4 } }],
		["hcp", "1NT P 2D P 2H", { shape: { kind: "accept", suit: "H" } }],
		["hcp", "1NT P 2H P 2S", { shape: { kind: "accept", suit: "S" } }],
		[
			"hcp",
			"1NT P 2D P 3H",
			{
				range: { min: 17, max: 17 },
				shape: { kind: "support", suit: "H", min: 4 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 3H P P",
			{ range: { min: 0, max: 5 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2D P 3H P 4H",
			{ range: { min: 6 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2D P 2H P P",
			{ range: { min: 0, max: 7 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2NT",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "exact", suit: "H", length: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3S",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "cards", suit: "S", min: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 3NT",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "exact", suit: "H", length: 5, flat: true },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 4H",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2S",
			{
				range: { min: 8, max: 9 },
				shape: {
					kind: "second-suit",
					major: "H",
					length: 5,
					suit: "S",
					min: 5,
				},
			},
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3H",
			{
				range: { min: 10, max: 15 },
				shape: {
					kind: "second-suit",
					major: "S",
					length: 5,
					suit: "H",
					min: 4,
				},
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2NT P P",
			{
				range: { min: 15, max: 15 },
				shape: { kind: "at-most", suit: "H", max: 2 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2NT P 4H",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "support", suit: "H", min: 3 },
			},
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3S P 4S",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3NT P P",
			{ shape: { kind: "at-most", suit: "S", max: 2 } },
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2S P P",
			{
				range: { min: 15, max: 15 },
				shape: { kind: "longer-major", suit: "S", other: "H", ties: true },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2S P 4H",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "longer-major", suit: "H", other: "S", ties: false },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2D P 2H",
			{
				range: { min: 8, max: 9 },
				shape: {
					kind: "two-suits",
					suit: "H",
					length: 5,
					other: "S",
					otherLength: 4,
				},
			},
		],
		[
			"hcp",
			"1NT P 2C P 2D P 3NT",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "no-major", min: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2H P P",
			{ range: { min: 0, max: 7 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2C P 2H P 2NT",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "at-most", suit: "H", max: 3 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2S P 4S",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "support", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2H P 2NT P 3S",
			{
				range: { min: 15, max: 15 },
				shape: { kind: "cards", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2D P 3H P 3NT",
			{ shape: { kind: "at-most", suit: "H", max: 2 } },
		],
		["hcp", "1NT P 2S P 3C", { shape: { kind: "relay" } }],
		[
			"hcp",
			"1NT P 2S P 3C P P",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "cards", suit: "C", min: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2S P 3C P 3D",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "cards", suit: "D", min: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2NT P P",
			{ range: { min: 15, max: 15 }, shape: { kind: "none" } },
		],
		[
			"hcp-corrected",
			"1NT P 2NT P 3NT",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 4NT P P",
			{ range: { min: 15, max: 15 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 4NT P 6NT",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp-corrected",
			"2C P 2D P 2NT",
			{ range: { min: 22, max: 24 }, shape: { kind: "balanced" } },
		],
		["hcp", "2H P 3H", { shape: { kind: "support", suit: "H", min: 3 } }],
		["hcp", "2S P 4S", { shape: { kind: "support", suit: "S", min: 3 } }],
		["hcp", "2H P 2NT", { range: { min: 15 }, shape: { kind: "ask" } }],
		[
			"hcp",
			"2H P 2NT P 3H",
			{ range: { min: 5, max: 8 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"2H P 2NT P 3D",
			{
				range: { min: 9, max: 11 },
				shape: { kind: "feature", suit: "D", trumps: "H" },
			},
		],
		[
			"hcp",
			"2D P 2NT P 3C",
			{
				range: { min: 9, max: 11 },
				shape: { kind: "feature", suit: "C", trumps: "D" },
			},
		],
		[
			"hcp",
			"2S P 2NT P 3NT",
			{
				range: { min: 9, max: 11 },
				shape: { kind: "no-feature", trumps: "S" },
			},
		],
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
			"hcp-corrected",
			"1H P P 2D",
			{
				range: { min: 10, max: 16 },
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
			"hcp-corrected",
			"1D P P X",
			{
				range: { min: 12 },
				shape: { kind: "takeout", suit: "D", strong: { min: 17 } },
			},
		],
		["hcp", "1H X XX", { range: { min: 10 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1H P 3H P 4NT",
			{ shape: { kind: "blackwood", small: { min: 33 }, grand: { min: 37 } } },
		],
		[
			"hcp-corrected",
			"1H 1S 3H P 4NT",
			{ shape: { kind: "blackwood", small: { min: 33 }, grand: { min: 37 } } },
		],
		["hcp", "1H P 3H P 4NT P 5C", { shape: { kind: "aces", counts: [0, 4] } }],
		["hcp", "1H P 3H P 4NT P 5D", { shape: { kind: "aces", counts: [1] } }],
		["hcp", "1H P 3H P 4NT P 5S", { shape: { kind: "aces", counts: [3] } }],
		[
			"hcp",
			"1H P 2H P P",
			{ range: { min: 12, max: 14 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1H P 2H P 3H",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "game-try", suit: "H", min: 5 },
			},
		],
		[
			"hcp-corrected",
			"1S P 2S P 4S",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "cards", suit: "S", min: 5 },
			},
		],
		[
			"hcp",
			"1H P 2H 2S 3H",
			{
				range: { min: 12, max: 17 },
				shape: { kind: "competitive", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1S P 2S X 3S",
			{
				range: { min: 12, max: 17 },
				shape: { kind: "competitive", suit: "S", min: 6 },
			},
		],
		[
			"hcp",
			"1H P 2H 3S 4H",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "cards", suit: "H", min: 5 },
			},
		],
		["hcp", "1H P 2H 2S P", { shape: { kind: "rest" } }],
		[
			"hcp",
			"1H P 3H P P",
			{ range: { min: 12, max: 14 }, shape: { kind: "none" } },
		],
		[
			"hcp-corrected",
			"1S P 3S P 4S",
			{
				range: { min: 15, max: 21 },
				shape: { kind: "cards", suit: "S", min: 5 },
			},
		],
	] as const)("reads the later call %s %s", (system, auction, expected) => {
		const all = calls(auction);
		expect(callMeaning(system, all, all.length - 1)).toEqual(expected);
	});

	it.each([
		["hcp", "1H P 1S P P"],
		["hcp", "1H P 1S P 2C"], // a new suit without a jump
		["hcp", "1H P 1S P 4S"],
		["hcp", "1H P 2H P 2S"], // a new-suit game try
		["hcp", "1H P 2H P 3NT"],
		["hcp", "1H P 2H 2S X"],
		["hcp", "1D P 2D P 3D"], // opener's re-raise of a minor is not in the guide
		["hcp", "1H P 3H P 3NT"],
		["hcp", "1H P 3H 3S 4H"], // after a jump raise and an opponent's call
		["hcp", "1H P 1S 2C 2S"], // the rebid after an overcall
		["hcp", "1H 2H"], // a cue bid
		["hcp", "1H 2S"], // a jump overcall
		["hcp", "1H 1S 2H"],
		["hcp", "1H 1S X"], // no major that no one has bid
		["hcp", "1C 1H 2S"], // a jump in a new suit after an overcall
		["hcp", "1C 1H X 1S 2S"], // the fourth player did not pass
		["hcp", "1NT 2C"],
		["hcp", "1NT X"],
		["hcp", "2H 2S"],
		["hcp", "2H P 3C"],
		["hcp", "2H P 2NT P 4H"], // above the answers to the ask
		["hcp", "2H P 2NT X 3H"], // after an opponent's call
		["hcp", "2H P 2NT P 3S P 4H"], // responder's call after the answer
		["hcp", "1NT P 2C P 2D P 4NT"], // not an ace ask after partner's notrump
		["hcp", "1NT P 2NT P 4NT"],
		["hcp", "1NT P 4NT P 5C"], // no ace answer to a [4NT] that invites [6NT]
		["hcp", "1NT P 2D P 2H P 3S"], // a jump in the other major after the transfer
		["hcp", "1NT P 2C P 2H P 2S"], // five spades after Stayman: the guide leaves it out
		["hcp", "1NT P 2C P 2S P 3H"],
		["hcp", "1NT P 3NT P 4NT"],
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
			"2D P 2NT P",
			"2H P 2NT P",
			"2S P 2NT P",
			"1D P 1H P",
			"1H P 1S P",
			"1S P 2C P",
			"1C P 1NT P",
			"1NT P 2C P",
			"1NT P 2H P",
			"1NT P 2S P",
			"1NT P 2S P 3C P",
			"1NT P 2D P 2H P",
			"1NT P 2H P 2S P",
			"1NT P 2D P 3H P",
			"1NT P 2D P 2H P 2NT P",
			"1NT P 2D P 2H P 2S P",
			"1NT P 2H P 2S P 3S P",
			"1NT P 2H P 2S P 3NT P",
			"1NT P 2C P 2D P",
			"1NT P 2C P 2H P",
			"1NT P 2C P 2S P",
			"1NT P 2C P 2D P 2H P",
			"1NT P 2C P 2D P 3S P",
			"1NT P 2C P 2H P 2NT P",
			"1NT P 2C P 2H P 3NT P",
			"1NT P 2NT P",
			"1NT P 3C P",
			"1NT P 3H P",
			"1NT P 3S P 4NT P",
			"1NT P 4C P",
			"1NT P 4C P 4S P 5C P",
			"1NT P 4NT P",
			"1NT X",
			"2NT P",
			"2NT P 4C P",
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
		// About 2.5 s alone; the pre-commit hook runs it beside the browser tests.
	}, 30_000);

	it("gives each hand exactly one call after [1NT], and the [1NT] opener exactly one answer", () => {
		const responses = ["1NT P", "1NT X"];
		const answers = [
			"1NT P 2C P",
			"1NT P 2D P",
			"1NT P 2H P",
			"1NT P 2S P",
			"1NT P 2NT P",
			"1NT P 3C P",
			"1NT P 3D P",
			"1NT P 3H P",
			"1NT P 3S P",
			"1NT P 3H P 4NT P",
			"1NT P 4C P",
			"1NT P 4C P 4D P 5C P",
			"1NT P 4NT P",
			"1NT P 2D P 2H P 2NT P",
			"1NT P 2D P 2H P 3H P",
			"1NT P 2D P 2H P 3NT P",
			"1NT P 2D P 2H P 2S P",
			"1NT P 2H P 2S P 2NT P",
			"1NT P 2H P 2S P 3S P",
			"1NT P 2H P 2S P 3NT P",
			"1NT P 2C P 2D P 2H P",
			"1NT P 2C P 2D P 2S P",
			"1NT P 2C P 2D P 2NT P",
			"1NT P 2C P 2D P 3H P",
			"1NT P 2C P 2D P 3S P",
			"1NT P 2C P 2D P 3NT P",
			"1NT P 2C P 2H P 2NT P",
			"1NT P 2C P 2H P 3H P",
			"1NT P 2C P 2H P 3NT P",
			"1NT P 2C P 2S P 2NT P",
			"1NT P 2C P 2S P 3S P",
			"1NT P 2C P 2S P 3NT P",
		];
		const counts = { responses: 0, answers: 0 };
		for (let game = 0; game < 400; game += 1) {
			const deal = dealCards(randomBelowFrom(seeded(game + 1)));
			for (const seat of SEATS)
				for (const system of RULE_SYSTEMS) {
					const cards = deal[seat];
					const opener =
						suggested(system, cardsText(cards), "")?.join() === "1NT";
					for (const auction of [...responses, ...(opener ? answers : [])]) {
						const guide = conventionCalls(system, cards, calls(auction));
						// The guide does not check a hand with a suit longer than seven cards.
						if (guide === undefined) continue;
						counts[
							opener && answers.includes(auction) ? "answers" : "responses"
						] += 1;
						expect(
							guide.map(({ call }) => call),
							`${system} ${cardsText(cards)} after ${auction}`,
						).toHaveLength(1);
					}
				}
		}
		expect(counts.responses).toBeGreaterThan(3000);
		expect(counts.answers).toBeGreaterThan(300);
		// About 1.5 s alone; the pre-commit hook runs it beside the browser tests.
	}, 30_000);

	it("gives the transfer bidder exactly one second call up to 15 points, and none above", () => {
		const counts = { accepted: 0, superAccepted: 0, above: 0 };
		for (let game = 0; game < 400; game += 1) {
			const deal = dealCards(randomBelowFrom(seeded(game + 1)));
			for (const seat of SEATS)
				for (const system of RULE_SYSTEMS) {
					const cards = deal[seat];
					const transfer = suggested(system, cardsText(cards), "1NT P")?.join();
					if (transfer !== "2D" && transfer !== "2H") continue;
					const major = transfer === "2D" ? "H" : "S";
					const points = countHandPoints(system, cards).total;
					const accepted = suggested(
						system,
						cardsText(cards),
						`1NT P ${transfer} P 2${major} P`,
					);
					expect(
						accepted,
						`${system} ${cardsText(cards)} after the acceptance`,
					).toHaveLength(points <= 15 ? 1 : 0);
					counts[points <= 15 ? "accepted" : "above"] += 1;
					expect(
						suggested(
							system,
							cardsText(cards),
							`1NT P ${transfer} P 3${major} P`,
						),
						`${system} ${cardsText(cards)} after the super-accept`,
					).toHaveLength(1);
					counts.superAccepted += 1;
				}
		}
		expect(counts.accepted).toBeGreaterThan(300);
		expect(counts.superAccepted).toBeGreaterThan(300);
		expect(counts.above).toBeGreaterThan(0);
	}, 30_000);

	it("gives the Stayman bidder exactly one second call after each answer up to 15 points, and none above", () => {
		const counts = { answered: 0, above: 0 };
		for (let game = 0; game < 400; game += 1) {
			const deal = dealCards(randomBelowFrom(seeded(game + 1)));
			for (const seat of SEATS)
				for (const system of RULE_SYSTEMS) {
					const cards = deal[seat];
					if (suggested(system, cardsText(cards), "1NT P")?.join() !== "2C")
						continue;
					const points = countHandPoints(system, cards).total;
					for (const answer of ["2D", "2H", "2S"]) {
						expect(
							suggested(system, cardsText(cards), `1NT P 2C P ${answer} P`),
							`${system} ${cardsText(cards)} after ${answer}`,
						).toHaveLength(points <= 15 ? 1 : 0);
						counts[points <= 15 ? "answered" : "above"] += 1;
					}
				}
		}
		expect(counts.answered).toBeGreaterThan(300);
		expect(counts.above).toBeGreaterThan(0);
	}, 30_000);

	it("gives the weak-two opener exactly one answer to the [2NT] ask", () => {
		let answered = 0;
		for (let game = 0; game < 400; game += 1) {
			const deal = dealCards(randomBelowFrom(seeded(game + 1)));
			for (const seat of SEATS)
				for (const system of RULE_SYSTEMS) {
					const text = cardsText(deal[seat]);
					const opening = suggested(system, text, "")?.find((call) =>
						["2D", "2H", "2S"].includes(call),
					);
					if (opening === undefined) continue;
					expect(
						suggested(system, text, `${opening} P 2NT P`),
						`${system} ${text} after ${opening}`,
					).toHaveLength(1);
					answered += 1;
				}
		}
		expect(answered).toBeGreaterThan(30);
	}, 30_000);

	it("gives the major-suit opener exactly one answer to Jacoby [2NT]", () => {
		let answered = 0;
		for (let game = 0; game < 200; game += 1) {
			const deal = dealCards(randomBelowFrom(seeded(game + 1)));
			for (const seat of SEATS)
				for (const system of RULE_SYSTEMS) {
					const text = cardsText(deal[seat]);
					const opening = suggested(system, text, "")?.find((call) =>
						["1H", "1S"].includes(call),
					);
					if (opening === undefined) continue;
					expect(
						suggested(system, text, `${opening} P 2NT P`),
						`${system} ${text} after ${opening}`,
					).toHaveLength(1);
					answered += 1;
				}
		}
		expect(answered).toBeGreaterThan(30);
	}, 30_000);
});

/** The inverse of hand(): "AQ4.KJ5.Q862.K73". */
function cardsText(cards: readonly Card[]): string {
	return SUITS.map(
		(suit) =>
			cards
				.filter((card) => card[0] === suit)
				.map((card) => card[1])
				.join("") || "-",
	).join(".");
}

/** "15–17" or "22 or more", with half points as "½", as the English guides write a range. */
function pointsNumber(value: number): string {
	return Number.isInteger(value) ? `${value}` : `${Math.floor(value)}½`;
}

function rangeText({ min, max }: PointRange): string {
	if (max === undefined) return `${pointsNumber(min)} or more`;
	return min === max
		? pointsNumber(min)
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
	"suit-two-level": [
		"Responses to one of a suit",
		"A new suit at the two level needs {range} points.",
	],
	"suit-force": [
		"Responses to one of a suit",
		"- {range} points: game forcing",
	],
	"nt-weak": ["Responses to [1NT]", "- {range} points: [P], unless"],
	"nt-stayman": ["Responses to [1NT]", "- [2C] (Stayman): {range} points"],
	"nt-weak-stayman": [
		"Responses to [1NT]",
		"- Weak Stayman: [2C] also with {range} points",
	],
	"nt-2NT": ["Responses to [1NT]", "- [2NT]: {range} points"],
	"nt-3m": ["Responses to [1NT]", "- [3C] [3D]: {range} points"],
	"nt-3NT": ["Responses to [1NT]", "- [3NT]: {range} points"],
	"nt-3M": ["Responses to [1NT]", "- [3H] [3S]: {range} points"],
	"nt-slam-decline": [
		"Responses to [1NT]",
		"Opener bids four of the major with {range} points",
	],
	"nt-slam-accept": [
		"Responses to [1NT]",
		"with {range} points and three or more cards, [4NT]",
	],
	"nt-gerber": ["Responses to [1NT]", "- [4C] (Gerber): {range} points"],
	"nt-4NT": ["Responses to [1NT]", "- [4NT]: {range} points"],
	"nt-6NT": ["Responses to [1NT]", "- [6NT]: {range} points"],
	"nt-7NT": ["Responses to [1NT]", "[7NT]: {range} points"],
	"nt-invite-pass": ["Responses to [1NT]", "Opener passes with {range} points"],
	"nt-invite-accept": [
		"Responses to [1NT]",
		"and bids [3NT] with {range} points",
	],
	"nt-super-accept": [
		"Responses to [1NT]",
		"jumps to three of it with {range} points",
	],
	"transfer-pass": [
		"Responses to [1NT]",
		"- After the transfer, responder bids [P] with {range} points",
	],
	"transfer-invite": [
		"Responses to [1NT]",
		"[2NT] with exactly five cards and {range} points",
	],
	"transfer-game": [
		"Responses to [1NT]",
		"no singleton or void, and {range} points",
	],
	"nt-super-pass": [
		"Responses to [1NT]",
		"After the super-accept, responder passes with {range} points",
	],
	"nt-super-game": [
		"Responses to [1NT]",
		"bids four of the major with {range} points",
	],
	"stayman-invite": [
		"Responses to [1NT]",
		"four cards in the other major and {range} points",
	],
	"stayman-game": [
		"Responses to [1NT]",
		"[3H] or [3S] in the same way with {range} points",
	],
	"2nt-gerber": ["Responses to [2NT]", "- [4C] (Gerber): {range} points"],
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
	"reraise-pass": ["Opener's rebid", "[P] with {range} points;"],
	"reraise-try": ["Opener's rebid", "[3H] with {range} points is a game try"],
	"reraise-game": ["Opener's rebid", "[4H] with {range} points."],
	"reraise-compete": [
		"Opener's rebid",
		"[3H] with {range} points and six or more cards",
	],
	"jump-raise-pass": ["Opener's rebid", "otherwise [P] with {range} points."],
	"jump-raise-game": ["Opener's rebid", "[4H] with {range} points (25"],
	"weak-2NT": ["Responses to a weak two", "- [2NT]: {range} points, asks"],
	"weak-2NT-minimum": [
		"Responses to a weak two",
		"opener bids three of the suit with {range} points",
	],
	"weak-2NT-maximum": [
		"Responses to a weak two",
		"With {range} points, opener bids three of the lowest side suit",
	],
	"suit-jacoby": [
		"Responses to one of a suit",
		"- [2NT] over [1H] or [1S] (Jacoby 2NT): {range} points",
	],
	"suit-3NT": [
		"Responses to one of a suit",
		"- [3NT] over [1H] or [1S]: {range} points",
	],
	"suit-game": [
		"Responses to one of a suit",
		"- Four of partner's major ([1H] – [4H]): {range} points",
	],
	"suit-2NT-minor": [
		"Responses to one of a suit",
		"- [2NT] over [1C] or [1D]: {range} points",
	],
	"suit-3NT-minor": [
		"Responses to one of a suit",
		"[3NT] over [1C] or [1D]: {range} points",
	],
	"suit-jump-shift": [
		"Responses to one of a suit",
		"[1D] – [3C]): {range} points and a good five-card suit",
	],
	"jacoby-minimum": ["Opener's rebid", "Without one, [4H] with {range} points"],
	"jacoby-middle": ["Opener's rebid", ", [3NT] with {range} points"],
	"jacoby-maximum": ["Opener's rebid", "or [3H] with {range} points."],
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
	"negative-one": [
		"Competitive bids",
		"{range} points after an overcall at the one level",
	],
	"negative-two": [
		"Competitive bids",
		"{range} points after an overcall at the two level",
	],
	"negative-five": ["Competitive bids", "or five cards with {range} points"],
	"contested-new-suit": [
		"Competitive bids",
		"without a jump: five or more cards and {range} points",
	],
	"negative-minimum": [
		"Competitive bids",
		"at the lowest level with {range} points",
	],
	"negative-jump": ["Competitive bids", "one level higher with {range} points"],
	"negative-cuebid": [
		"Competitive bids",
		"With {range} points, bid the opponents' suit",
	],
	"slam-small": ["Targets for the partnership", "- {min} points: small slam."],
	"slam-grand": ["Targets for the partnership", "- {min} points: grand slam."],
};

function guideText(system: PointSystem, locale: string): string {
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
		},
	);

	it.each(
		[...RULE_SYSTEMS, ...GUIDE_ONLY].flatMap((system) =>
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
