import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import type { PlayPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { type Card, RANKS, rankOf, suitOf } from "../../src/bridge/cards";
import { trickWinner } from "../../src/bridge/rules";
import { seatAfter } from "../../src/protocol";
import type { PlayPolicy } from "./arena";

export type Ranking = "incumbent" | "contract" | "cash";

function cash(position: PlayPosition, card: Card): boolean {
	const { current, turn } = position;
	if (current.cards.length === 3) {
		const winner = trickWinner(
			[...current.cards, card],
			current.leader,
			position.contract.strain,
		);
		return winner === turn || winner === seatAfter(turn, 2);
	}
	if (current.cards.length !== 0) return false;
	const suit = suitOf(card);
	for (const rank of RANKS) {
		if (rank === rankOf(card)) return true;
		if (!position.view.plays.some((play) => play.card === `${suit}${rank}`))
			return false;
	}
	return false;
}

export function policy(
	ranking: Ranking,
	solver: DoubleDummySolver,
	budget: { samples: number } | { timeMs: number },
): PlayPolicy {
	return (position, random) => {
		const result = analyzePlay(position, solver, {
			timeMs: 60_000,
			...budget,
			random,
		});
		if (
			"samples" in budget &&
			result.samples < budget.samples &&
			position.legal.length !== 1 &&
			!(result.samples === 1 && createHandSampler(position.view).uniqueLayout)
		)
			throw new Error(
				`Search returned ${result.samples} of ${budget.samples} layouts`,
			);
		const best = result.evaluations[0];
		if (!best || ranking === "incumbent") return result.card;
		if (ranking === "contract")
			return result.evaluations.reduce((a, b) =>
				a.successProbability >= b.successProbability ? a : b,
			).card;
		return (
			result.evaluations.find(
				(item) =>
					item.utility === best.utility &&
					item.expectedScore === best.expectedScore &&
					cash(position, item.card),
			)?.card ?? result.card
		);
	};
}
