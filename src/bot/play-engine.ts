import { type Card, RANKS, rankOf, SUITS, suitOf } from "../bridge/cards";
import { countHandPoints } from "../bridge/hand-points";
import { scoreContract } from "../bridge/rules";
import type { DoubleDummySolver } from "./dds-solver";
import type { PlayPosition } from "./play-position";
import { createHandSampler, type RemainingHands } from "./play-sampling";

export interface PlayOptions {
	readonly samples?: number;
	readonly timeMs?: number;
	readonly random?: () => number;
	readonly onProgress?: (analysis: PlayAnalysis) => void;
}

export interface CardEvaluation {
	readonly card: Card;
	readonly expectedTricks: number;
	readonly expectedScore: number;
	readonly successProbability: number;
	readonly utility: number;
}

export interface PlayAnalysis {
	readonly card: Card;
	readonly samples: number;
	readonly effectiveSamples: number;
	readonly elapsedMs: number;
	readonly evaluations: readonly CardEvaluation[];
}

const IMP_THRESHOLDS = [
	20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300,
	1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000,
];

function imps(difference: number): number {
	return (
		Math.sign(difference) *
		IMP_THRESHOLDS.filter((threshold) => Math.abs(difference) >= threshold)
			.length
	);
}

/** Auction meanings are fallible evidence; they never make a legal layout impossible. */
function layoutWeight(position: PlayPosition, hands: RemainingHands): number {
	let penalty = 0;
	for (const hint of position.hints) {
		if (
			hint.seat === position.view.seat ||
			(hint.seat === position.view.dummy && position.view.dummyCards)
		)
			continue;
		const original = [
			...hands[hint.seat],
			...position.view.plays
				.filter((play) => play.seat === hint.seat)
				.map((play) => play.card),
		];
		const points = countHandPoints(hint.system, original).total;
		const { range, shape } = hint.meaning;
		if (range) {
			const distance = Math.max(
				0,
				range.min - points,
				points - (range.max ?? 40),
			);
			penalty += (distance / 3) ** 2;
		}
		if ("suit" in shape && ("min" in shape || "length" in shape)) {
			const minimum = "min" in shape ? shape.min : shape.length;
			const length = original.filter(
				(card) => suitOf(card) === shape.suit,
			).length;
			penalty += Math.max(0, minimum - length) ** 2;
		}
		if (shape.kind === "balanced" || shape.kind === "stopper") {
			const lengths = SUITS.map(
				(suit) => original.filter((card) => suitOf(card) === suit).length,
			);
			penalty +=
				lengths.filter((length) => length < 2).length * 2 +
				Math.max(0, Math.max(...lengths) - 5);
		}
	}
	return Math.exp(-Math.min(12, penalty / 2));
}

/** Perfect-information Monte Carlo: every candidate sees the same sampled worlds. */
export function analyzePlay(
	position: PlayPosition,
	solver: DoubleDummySolver,
	options: PlayOptions = {},
): PlayAnalysis {
	const samples = options.samples ?? 96;
	const timeMs = options.timeMs ?? 1200;
	if (
		!Number.isInteger(samples) ||
		samples < 1 ||
		samples > 4096 ||
		!Number.isFinite(timeMs) ||
		timeMs <= 0 ||
		timeMs > 60_000
	)
		throw new Error(
			"play budget requires 1..4096 samples and 0..60000 milliseconds",
		);
	const only = position.legal[0];
	if (!only) throw new Error("card engine has no legal play");
	const start = performance.now();
	if (position.legal.length === 1)
		return {
			card: only,
			samples: 0,
			effectiveSamples: 0,
			elapsedMs: performance.now() - start,
			evaluations: [],
		};
	const sampler = createHandSampler(position.view);
	const random = options.random ?? Math.random;
	const declarerSide =
		(position.turn === "N" || position.turn === "S") ===
		(position.contract.declarer === "N" || position.contract.declarer === "S");
	const remainingTricks = 13 - Math.floor(position.view.plays.length / 4);
	const target = position.contract.level + 6;
	// scoreContract is signed North-South; convert it to the acting partnership.
	const sign = position.turn === "N" || position.turn === "S" ? 1 : -1;
	const reference =
		sign * scoreContract(position.contract, position.vulnerability, target);
	const totals = position.legal.map((card) => ({
		card,
		tricks: 0,
		score: 0,
		success: 0,
		utility: 0,
	}));
	let weightSum = 0;
	let weightSquares = 0;
	let count = 0;
	let lastProgress = start - 50;
	const snapshot = (): PlayAnalysis => {
		const evaluations = totals.map((total) => ({
			card: total.card,
			expectedTricks: total.tricks / weightSum,
			expectedScore: total.score / weightSum,
			successProbability: total.success / weightSum,
			utility: total.utility / weightSum,
		}));
		evaluations.sort(
			(a, b) =>
				b.utility - a.utility ||
				b.expectedScore - a.expectedScore ||
				RANKS.indexOf(rankOf(b.card)) - RANKS.indexOf(rankOf(a.card)),
		);
		return {
			card: evaluations[0]?.card ?? only,
			samples: count,
			effectiveSamples: weightSum ** 2 / weightSquares,
			elapsedMs: performance.now() - start,
			evaluations,
		};
	};
	while (
		count < samples &&
		(count === 0 || performance.now() - start < timeMs)
	) {
		const hands = sampler(random);
		const weight = layoutWeight(position, hands);
		const scores = solver.solve(
			hands,
			position.contract.strain,
			position.current,
		);
		for (const total of totals) {
			const tricks = scores.get(total.card);
			if (tricks === undefined)
				throw new Error(`DDS omitted legal card ${total.card}`);
			const declarerTricks =
				position.declarerTricks +
				(declarerSide ? tricks : remainingTricks - tricks);
			const score =
				sign *
				scoreContract(
					position.contract,
					position.vulnerability,
					declarerTricks,
				);
			total.tricks += weight * tricks;
			total.score += weight * score;
			total.success +=
				weight *
				Number(
					declarerSide ? declarerTricks >= target : declarerTricks < target,
				);
			total.utility += weight * imps(score - reference);
		}
		weightSum += weight;
		weightSquares += weight * weight;
		count++;
		if (options.onProgress && performance.now() - lastProgress >= 50) {
			options.onProgress(snapshot());
			lastProgress = performance.now();
		}
	}
	return snapshot();
}
