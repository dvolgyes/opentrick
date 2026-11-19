import { describe, expect, it } from "vitest";
import { applyPrior } from "../../scripts/self-play/defensive-search";
import {
	contrast,
	partscoreDeal,
	suitOnly,
} from "../../scripts/self-play/partscore-leads";
import type { CardEvaluation } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import {
	type Card,
	isDeal,
	rankOf,
	SUITS,
	sortCards,
	suitOf,
} from "../../src/bridge/cards";
import { boardStatus } from "../../src/bridge/engine";
import { SEATS, seatAfter } from "../../src/protocol";

const hcp = (hand: readonly Card[]) =>
	hand.reduce((total, card) => total + ("JQKA".indexOf(rankOf(card)) + 1), 0);

function evaluation(card: Card, utility: number): CardEvaluation {
	return {
		card,
		utility,
		expectedTricks: 0,
		expectedScore: 0,
		successProbability: 0,
	};
}

const corpus = Array.from({ length: 128 }, (_, i) =>
	partscoreDeal(9_400_000 + i, i + 1),
);

describe("partscore lead experiment", () => {
	it("preflights the complete frozen corpus with no changed seeds or duplicate deals", () => {
		const unique = new Set<string>();
		const contracts = new Set<string>();
		for (const [index, fixture] of corpus.entries()) {
			const { board, hints, opened } = fixture;
			const { dealer, deal } = board;
			const overcaller = seatAfter(dealer, 1);
			const leader = seatAfter(dealer, 2);
			const advancer = seatAfter(dealer, 3);
			const trump = opened === "H" ? "S" : "H";
			const contract = trump === "S" ? "2S" : "3H";
			const openLength = deal[dealer].filter(
				(card) => suitOf(card) === opened,
			).length;
			const overcallHolding = deal[overcaller].filter(
				(card) => suitOf(card) === trump,
			);
			expect(isDeal(deal)).toBe(true);
			expect(board.number).toBe(index + 1);
			expect(fixture.seed).toBe(9_400_000 + index);
			expect(hcp(deal[dealer])).toBeGreaterThanOrEqual(12);
			expect(hcp(deal[dealer])).toBeLessThanOrEqual(16);
			expect(openLength).toBeGreaterThanOrEqual(5);
			expect(openLength).toBe(
				Math.max(
					...SUITS.map(
						(suit) =>
							deal[dealer].filter((card) => suitOf(card) === suit).length,
					),
				),
			);
			expect(hcp(deal[overcaller])).toBeGreaterThanOrEqual(9);
			expect(hcp(deal[overcaller])).toBeLessThanOrEqual(14);
			expect(overcallHolding.length).toBeGreaterThanOrEqual(5);
			expect(
				overcallHolding.filter((card) => "AKQ".includes(rankOf(card))).length >=
					2 ||
					overcallHolding.filter((card) => "AKQJT".includes(rankOf(card)))
						.length >= 3,
			).toBe(true);
			expect(hcp(deal[leader])).toBe(fixture.leaderPoints);
			expect(fixture.leaderPoints).toBeGreaterThanOrEqual(
				index % 2 === 0 ? 0 : 4,
			);
			expect(fixture.leaderPoints).toBeLessThanOrEqual(index % 2 === 0 ? 3 : 7);
			if (fixture.leaderPoints >= 6)
				expect(fixture.holding.length).toBeLessThan(3);
			expect(hcp(deal[advancer])).toBeGreaterThanOrEqual(trump === "S" ? 6 : 7);
			expect(hcp(deal[advancer])).toBeLessThanOrEqual(9);
			expect(
				deal[advancer].filter((card) => suitOf(card) === trump).length,
			).toBeGreaterThanOrEqual(3);
			expect(board.calls).toEqual([
				`1${opened}`,
				trump === "S" ? "1S" : "2H",
				"P",
				contract,
				"P",
				"P",
				"P",
			]);
			expect(boardStatus(board)).toMatchObject({
				phase: "play",
				actor: leader,
				contract: { declarer: overcaller, strain: trump },
			});
			expect(hints).toMatchObject([
				{
					seat: dealer,
					system: "hcp",
					meaning: { shape: { kind: "cards", suit: opened, min: 5 } },
				},
			]);
			unique.add(SEATS.map((seat) => sortCards(deal[seat]).join("")).join("|"));
			contracts.add(contract);
		}
		expect(unique.size).toBe(128);
		expect(contracts).toEqual(new Set(["2S", "3H"]));
	});

	it("chooses the highest ranked card in the public suit and leaves the guard intact", () => {
		const fixture = corpus.find(({ holding }) => holding.length >= 2);
		if (!fixture) throw new Error("expected a partner-suit holding");
		const { board, hints, opened } = fixture;
		const position = {
			...playPosition(board, seatAfter(board.dealer, 2)),
			hints,
		};
		const [top, lower] = sortCards(fixture.holding);
		const incumbent = position.legal.find((card) => suitOf(card) !== opened);
		if (!top || !lower || !incumbent)
			throw new Error("expected a rank opportunity");
		const ranked = [
			evaluation(incumbent, 2),
			evaluation(lower, 1),
			evaluation(top, 0),
		];
		const advice = suitOnly(position, incumbent, ranked);
		expect(advice).toBe(lower);
		expect(applyPrior(ranked, advice)).toEqual({
			card: lower,
			decision: "changed",
		});
		expect(
			applyPrior([evaluation(incumbent, 2.01), ...ranked.slice(1)], advice),
		).toEqual({ card: incumbent, decision: "veto" });
		expect(
			suitOnly({ ...position, hints: [] }, incumbent, ranked),
		).toBeUndefined();
		expect(
			suitOnly(
				{
					...position,
					legal: position.legal.filter((card) => suitOf(card) !== opened),
				},
				incumbent,
				ranked.slice(0, 1),
			),
		).toBeUndefined();
		expect(
			suitOnly(
				{ ...position, current: { ...position.current, cards: [incumbent] } },
				incumbent,
				ranked,
			),
		).toBeUndefined();
	});

	it("converts signed raw score differences before counting IMPs", () => {
		expect(contrast(90, 40)).toBe(2);
		expect(contrast(40, 90)).toBe(-2);
		expect(contrast(-40, -90)).toBe(2);
		expect(contrast(90, 90)).toBe(0);
		expect(contrast(null, 90)).toBe(0);
	});
});
