import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import {
	analyzePlay,
	type CardEvaluation,
	type PlayAnalysis,
} from "../../src/bot/play-engine";
import type { PlayPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import type { Card } from "../../src/bridge/cards";
import type { PlayPolicy } from "./arena";

export type Advice = (
	position: PlayPosition,
	incumbent: Card,
	ranked: readonly CardEvaluation[],
) => Card | undefined;

export function applyPrior(
	scores: readonly Pick<CardEvaluation, "card" | "utility">[],
	suggested: Card | undefined,
) {
	const best = scores[0];
	if (!best) throw new Error("no scored legal cards");
	if (suggested === undefined)
		return { card: best.card, decision: "abstained" } as const;
	if (suggested === best.card)
		return { card: best.card, decision: "agreed" } as const;
	const alternative = scores.find((a) => a.card === suggested);
	if (!alternative) throw new Error(`${suggested} is not a scored legal card`);
	return best.utility - alternative.utility <= 1
		? ({ card: suggested, decision: "changed" } as const)
		: ({ card: best.card, decision: "veto" } as const);
}

/** Share identical seeded searches across rooms for one board, not across deals or budgets. */
export function boardSearch(
	solver: DoubleDummySolver,
	samples: number,
	hints: PlayPosition["hints"],
) {
	const cache = new Map<string, PlayAnalysis>();
	const work = { searches: 0, ddsCalls: 0 };
	const counted: DoubleDummySolver = {
		solve(...args) {
			work.ddsCalls++;
			return solver.solve(...args);
		},
	};
	function policy(advice?: Advice) {
		const counts = {
			decisions: 0,
			layouts: 0,
			agreed: 0,
			changed: 0,
			veto: 0,
			abstained: 0,
		};
		const play: PlayPolicy = (raw, random) => {
			const only = raw.legal[0];
			if (!only) throw new Error("empty legal list");
			if (raw.legal.length === 1) return only;
			const position = hints.length ? { ...raw, hints } : raw;
			const key =
				position.view.seat + position.view.plays.map((p) => p.card).join("");
			let result = cache.get(key);
			if (!result) {
				result = analyzePlay(position, counted, {
					samples,
					timeMs: 60000,
					random,
				});
				if (
					result.samples !== samples &&
					!(
						result.samples === 1 &&
						createHandSampler(position.view).uniqueLayout
					)
				)
					throw new Error(
						`Incomplete search in ${key}: ${result.samples} of ${samples} layouts`,
					);
				cache.set(key, result);
				work.searches++;
			}
			counts.decisions++;
			counts.layouts += result.samples;
			if (!advice) return result.card;
			const chosen = applyPrior(
				result.evaluations,
				advice(position, result.card, result.evaluations),
			);
			counts[chosen.decision]++;
			return chosen.card;
		};
		return { play, counts };
	}
	return { policy, work };
}
