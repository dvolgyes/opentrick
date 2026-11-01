import { describe, expect, it } from "vitest";
import { SUITS } from "../../src/bridge/cards";
import {
	callMeaning,
	conventionCalls,
	fitsCall,
} from "../../src/bridge/conventions";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import { countHandPoints } from "../../src/bridge/hand-points";
import { SEATS } from "../../src/protocol";
import {
	calls,
	cardsText,
	GUIDE_ONLY,
	hand,
	RULE_SYSTEMS,
	seeded,
	suggested,
} from "./conventions-fixtures";

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
