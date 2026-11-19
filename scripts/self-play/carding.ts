import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import {
	createHandSampler,
	type RemainingHands,
} from "../../src/bot/play-sampling";
import type { VisiblePlay } from "../../src/bridge/card-knowledge";
import { type Card, RANKS, rankOf, suitOf } from "../../src/bridge/cards";
import type { Seat } from "../../src/protocol";
import type { PlayPolicy } from "./arena";
import { policy } from "./policy";

function conditionalLayouts(view: VisiblePlay, trustedFromPly: number) {
	if (view.plays.length <= trustedFromPly) return undefined;
	const visible = new Set([
		...view.own,
		...(view.dummyCards ?? []),
		...view.plays.map(({ card }) => card),
	]);
	const forbidden = new Map<Card, Seat>();
	for (let ply = trustedFromPly; ply < view.plays.length; ply++) {
		const play = view.plays[ply];
		if (!play || play.seat === view.seat || play.seat === view.dummy) continue;
		const lower = RANKS[RANKS.indexOf(rankOf(play.card)) + 1];
		if (!lower) continue;
		const card: Card = `${suitOf(play.card)}${lower}`;
		if (!visible.has(card)) forbidden.set(card, play.seat);
	}
	if (forbidden.size === 0) return undefined;

	const conditional = createHandSampler(view, forbidden);
	return {
		unique: conditional.uniqueLayout,
		substitute(hands: RemainingHands, random: () => number): RemainingHands {
			for (const [card, seat] of forbidden)
				if (hands[seat].includes(card)) return conditional(random);
			return hands;
		},
	};
}

/** Benchmark only: trustedFromPly is the zero-based index of the first bot play. */
export function cardingPolicy(
	solver: DoubleDummySolver,
	budget: { samples: number } | { timeMs: number },
	trustedFromPly: number,
): PlayPolicy {
	if (!Number.isInteger(trustedFromPly) || trustedFromPly < 0)
		throw new Error("trustedFromPly must be a nonnegative integer");
	const incumbent = policy("incumbent", solver, budget);
	return (position, random) => {
		if (position.hints.length !== 0)
			throw new Error("benchmark carding does not support auction hints");
		const conditional = conditionalLayouts(position.view, trustedFromPly);
		if (!conditional) return incumbent(position, random);
		const wrapped: DoubleDummySolver = {
			solve(hands, trump, current) {
				return solver.solve(
					conditional.substitute(hands, random),
					trump,
					current,
				);
			},
		};
		const samples = "samples" in budget ? budget.samples : undefined;
		const exact =
			conditional.unique &&
			(samples === undefined ||
				(Number.isInteger(samples) && samples >= 1 && samples <= 4096));
		const result = analyzePlay(position, wrapped, {
			timeMs: 60_000,
			...budget,
			exactLimit: 0,
			...(exact ? { samples: 1 } : {}),
			random,
		});
		if (
			samples !== undefined &&
			result.samples < samples &&
			position.legal.length !== 1 &&
			!(exact && result.samples === 1)
		)
			throw new Error(
				`Search returned ${result.samples} of ${samples} layouts`,
			);
		return result.card;
	};
}
