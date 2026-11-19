import assert from "node:assert/strict";
import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import type { CardEvaluation, PlayAnalysis } from "../../src/bot/play-engine";
import type { PlayPosition } from "../../src/bot/play-position";
import type { VisiblePlay } from "../../src/bridge/card-knowledge";
import {
	type Card,
	DECK,
	RANKS,
	rankOf,
	type Suit,
	suitOf,
} from "../../src/bridge/cards";
import { scoreContract } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS } from "../../src/protocol";

type Hands = Parameters<DoubleDummySolver["solve"]>[0];

export const METRICS = [
	"expectedTricks",
	"expectedScore",
	"successProbability",
	"utility",
] as const;

export function* assignments(view: VisiblePlay): IterableIterator<Hands> {
	assert.ok(view.dummyCards);
	const hidden = SEATS.filter(
		(seat) => seat !== view.seat && seat !== view.dummy,
	);
	const [firstSeat, secondSeat] = hidden;
	assert.ok(hidden.length === 2 && firstSeat && secondSeat);
	const remaining = { N: 13, E: 13, S: 13, W: 13 };
	const voids = {
		N: new Set<Suit>(),
		E: new Set<Suit>(),
		S: new Set<Suit>(),
		W: new Set<Suit>(),
	};
	const leaders = new Map<number, Suit>();
	const seen = new Set<Card>([...view.own, ...view.dummyCards]);
	for (const { seat, trick, card } of view.plays) {
		remaining[seat]--;
		seen.add(card);
		const led = leaders.get(trick);
		if (led === undefined) leaders.set(trick, suitOf(card));
		else if (suitOf(card) !== led) voids[seat].add(led);
	}
	const unseen = DECK.filter((card) => !seen.has(card));
	assert.equal(unseen.length, remaining[firstSeat] + remaining[secondSeat]);
	const hands: Hands = { N: [], E: [], S: [], W: [] };
	hands[view.seat] = view.own;
	hands[view.dummy] = view.dummyCards;
	const first: Card[] = [];
	const second: Card[] = [];
	const assign = function* (index: number): IterableIterator<Hands> {
		const card = unseen[index];
		if (card === undefined) {
			yield { ...hands, [firstSeat]: [...first], [secondSeat]: [...second] };
			return;
		}
		const suit = suitOf(card);
		if (first.length < remaining[firstSeat] && !voids[firstSeat].has(suit)) {
			first.push(card);
			yield* assign(index + 1);
			first.pop();
		}
		if (second.length < remaining[secondSeat] && !voids[secondSeat].has(suit)) {
			second.push(card);
			yield* assign(index + 1);
			second.pop();
		}
	};
	yield* assign(0);
}

export function layoutKey(hands: Hands): string {
	return SEATS.map((seat) => [...hands[seat]].sort().join("")).join("/");
}

function northSouth(seat: PlayPosition["turn"]): boolean {
	return seat === "N" || seat === "S";
}

export function oracle(
	position: PlayPosition,
	worlds: readonly Hands[],
	solver: DoubleDummySolver,
) {
	const { contract, vulnerability } = position;
	const remaining = 13 - Math.floor(position.view.plays.length / 4);
	const target = contract.level + 6;
	const sign = northSouth(position.turn) ? 1 : -1;
	const declaring = northSouth(position.turn) === northSouth(contract.declarer);
	const referenceScore = scoreContract(contract, vulnerability, target);
	const totals = position.legal.map((card) => ({
		card,
		expectedTricks: 0,
		expectedScore: 0,
		successProbability: 0,
		utility: 0,
	}));
	for (const hands of worlds) {
		const scores = solver.solve(hands, contract.strain, position.current);
		assert.equal(
			scores.size,
			position.legal.length,
			"DDS returned the wrong number of legal cards",
		);
		for (const total of totals) {
			const tricks = scores.get(total.card);
			assert.ok(tricks !== undefined, `DDS omitted ${total.card}`);
			const final =
				position.declarerTricks + (declaring ? tricks : remaining - tricks);
			const score = scoreContract(contract, vulnerability, final);
			total.expectedTricks += tricks;
			total.expectedScore += sign * score;
			total.successProbability += Number(final >= target === declaring);
			total.utility += scoreDifferenceToImps(sign * (score - referenceScore));
		}
	}
	for (const total of totals)
		for (const metric of METRICS) total[metric] /= worlds.length;
	return totals.sort(
		(a, b) =>
			b.utility - a.utility ||
			b.expectedScore - a.expectedScore ||
			RANKS.indexOf(rankOf(b.card)) - RANKS.indexOf(rankOf(a.card)),
	);
}

export function compare(
	analysis: PlayAnalysis,
	reference: readonly CardEvaluation[],
) {
	const errors = Object.fromEntries(
		METRICS.map((metric) => [metric, 0]),
	) as Record<(typeof METRICS)[number], number>;
	const actual = new Map(
		analysis.evaluations.map((value) => [value.card, value]),
	);
	assert.equal(actual.size, reference.length);
	assert.equal(analysis.evaluations.length, reference.length);
	assert.equal(analysis.card, analysis.evaluations[0]?.card);
	for (const expected of reference) {
		const value = actual.get(expected.card);
		assert.ok(value, `analysis omitted ${expected.card}`);
		for (const metric of METRICS) {
			assert.ok(Number.isFinite(value[metric]));
			errors[metric] = Math.max(
				errors[metric],
				Math.abs(value[metric] - expected[metric]),
			);
		}
	}
	const best = reference[0];
	const chosen = reference.find(({ card }) => card === analysis.card);
	assert.ok(best && chosen);
	return {
		card: chosen.card,
		maxError: errors,
		utilityRegret: best.utility - chosen.utility,
		sameRanking: reference.every(
			({ card }, i) => card === analysis.evaluations[i]?.card,
		),
	};
}
