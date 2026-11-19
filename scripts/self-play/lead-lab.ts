import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import type { PlayPosition } from "../../src/bot/play-position";
import {
	type Card,
	RANKS,
	rankOf,
	SUITS,
	sortCards,
	suitOf,
} from "../../src/bridge/cards";
import { seatAfter } from "../../src/protocol";
import type { PlayPolicy } from "./arena";
import { policy } from "./policy";

export const TREATMENTS = [
	"nt-fourth",
	"long-low",
	"sequence",
	"suit-singleton",
	"sequence-or-shape",
] as const;

export type LeadTreatment = (typeof TREATMENTS)[number];

function sequenceTop(
	holding: readonly Card[],
	length: number,
): Card | undefined {
	const top = holding[0];
	if (!top || holding.length < length) return undefined;
	const rank = RANKS.indexOf(rankOf(top));
	if (rank > RANKS.indexOf("T")) return undefined;
	for (let i = 1; i < length; i++) {
		if (holding[i]?.[1] !== RANKS[rank + i]) return undefined;
	}
	return top;
}

function chooseLead(
	treatment: LeadTreatment,
	position: PlayPosition,
	tied: readonly Card[],
): Card | undefined {
	const trump = position.contract.strain;
	const sorted = sortCards(position.view.own);
	const holdings = SUITS.map((suit) =>
		sorted.filter((card) => suitOf(card) === suit),
	);
	const longest = Math.max(...holdings.map((holding) => holding.length));
	const prefer = (cards: readonly (Card | undefined)[]) =>
		tied.find((card) => cards.includes(card));
	if (treatment === "sequence" || treatment === "sequence-or-shape") {
		const top = prefer(
			holdings.map((holding) => sequenceTop(holding, trump === "NT" ? 3 : 2)),
		);
		if (top || treatment === "sequence") return top;
	}
	if (treatment === "long-low")
		return prefer(
			holdings.map((holding) =>
				holding.length === longest ? holding.at(-1) : undefined,
			),
		);
	if (
		trump === "NT" &&
		(treatment === "nt-fourth" || treatment === "sequence-or-shape")
	)
		return prefer(
			holdings.map((holding) =>
				holding.length === longest ? holding[3] : undefined,
			),
		);
	if (
		trump !== "NT" &&
		(treatment === "suit-singleton" || treatment === "sequence-or-shape")
	)
		return prefer(
			holdings.map((holding) => {
				const card = holding[0];
				return holding.length === 1 && card && suitOf(card) !== trump
					? card
					: undefined;
			}),
		);
	return undefined;
}

export function leadPolicy(
	treatment: LeadTreatment,
	solver: DoubleDummySolver,
	budget: { samples: number } | { timeMs: number },
): PlayPolicy {
	const incumbent = policy("incumbent", solver, budget);
	return (position, random) => {
		if (
			position.view.plays.length !== 0 ||
			position.current.cards.length !== 0 ||
			position.turn !== seatAfter(position.contract.declarer, 1)
		)
			return incumbent(position, random);
		const result = analyzePlay(position, solver, {
			timeMs: 60_000,
			...budget,
			random,
		});
		if (
			"samples" in budget &&
			result.samples < budget.samples &&
			position.legal.length !== 1
		)
			throw new Error(
				`Search returned ${result.samples} of ${budget.samples} layouts`,
			);
		const best = result.evaluations[0];
		if (!best) return result.card;
		const tied = result.evaluations
			.filter(
				({ utility, expectedScore }) =>
					utility === best.utility && expectedScore === best.expectedScore,
			)
			.map(({ card }) => card);
		if (tied.length < 2) return result.card;
		return chooseLead(treatment, position, tied) ?? result.card;
	};
}
