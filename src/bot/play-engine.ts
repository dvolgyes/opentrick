import { type Card, RANKS, rankOf, type Suit, suitOf } from "../bridge/cards";
import { countHandPoints, type PointSystem } from "../bridge/hand-points";
import { scoreContract } from "../bridge/rules";
import { scoreDifferenceToImps } from "../bridge/scoring";
import type { Seat } from "../protocol";
import type { DoubleDummySolver } from "./dds-solver";
import { playTimeMs } from "./play-budget";
import type { PlayPosition } from "./play-position";
import {
	createHandSampler,
	MAX_ENUMERATED_LAYOUTS,
	type RemainingHands,
} from "./play-sampling";
import { mapLegalRankClasses } from "./rank-classes";

export interface PlayOptions {
	readonly samples?: number;
	/** Maximum population for exact search. Fixed-sample experiments default to sampling with replacement. */
	readonly exactLimit?: number;
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

/** Auction meanings are fallible evidence; they never make a legal layout impossible. */
function prepareLayoutWeight(position: PlayPosition) {
	if (position.hints.length === 0) return undefined;
	type HandEvidence = {
		played: Card[];
		points: Map<PointSystem, { total: number }>;
		playedLengths?: Record<Suit, number>;
		lengths?: Record<Suit, number>;
		needsBalance: boolean;
		balancePenalty: number;
	};
	const bySeat = new Map<Seat, HandEvidence>();
	const factorsInAuctionOrder = position.hints.flatMap(
		({ seat, meaning, system }) => {
			if (
				seat === position.view.seat ||
				(seat === position.view.dummy && position.view.dummyCards)
			)
				return [];
			const { range, shape } = meaning;
			const minimum =
				"suit" in shape && ("min" in shape || "length" in shape)
					? {
							suit: shape.suit,
							length: "min" in shape ? shape.min : shape.length,
						}
					: undefined;
			const balanced = shape.kind === "balanced" || shape.kind === "stopper";
			if (!range && !minimum && !balanced) return [];
			let hand = bySeat.get(seat);
			if (!hand) {
				hand = {
					played: [],
					points: new Map(),
					needsBalance: false,
					balancePenalty: 0,
				};
				bySeat.set(seat, hand);
			}
			let points = range ? hand.points.get(system) : undefined;
			if (range && !points) {
				points = { total: 0 };
				hand.points.set(system, points);
			}
			if ((minimum || balanced) && !hand.lengths) {
				hand.lengths = { S: 0, H: 0, D: 0, C: 0 };
				hand.playedLengths = { S: 0, H: 0, D: 0, C: 0 };
			}
			hand.needsBalance ||= balanced;
			return [{ hand, range, points, minimum, balanced }];
		},
	);
	if (factorsInAuctionOrder.length === 0) return undefined;
	for (const { seat, card } of position.view.plays) {
		const hand = bySeat.get(seat);
		if (!hand) continue;
		if (hand.points.size > 0) hand.played.push(card);
		if (hand.playedLengths) hand.playedLengths[suitOf(card)]++;
	}
	return (hands: RemainingHands) => {
		for (const [seat, hand] of bySeat) {
			const remaining = hands[seat];
			if (hand.points.size > 0) {
				const original = hand.played.length
					? [...remaining, ...hand.played]
					: remaining;
				for (const [system, points] of hand.points)
					points.total = countHandPoints(system, original).total;
			}
			const { lengths, playedLengths } = hand;
			if (lengths && playedLengths) {
				lengths.S = playedLengths.S;
				lengths.H = playedLengths.H;
				lengths.D = playedLengths.D;
				lengths.C = playedLengths.C;
				for (const card of remaining) lengths[suitOf(card)]++;
				if (hand.needsBalance) {
					const { S, H, D, C } = lengths;
					hand.balancePenalty =
						(Number(S < 2) + Number(H < 2) + Number(D < 2) + Number(C < 2)) *
							2 +
						Math.max(0, Math.max(S, H, D, C) - 5);
				}
			}
		}
		let penalty = 0;
		for (const {
			hand,
			range,
			points,
			minimum,
			balanced,
		} of factorsInAuctionOrder) {
			if (range && points) {
				const distance = Math.max(
					0,
					range.min - points.total,
					points.total - (range.max ?? 40),
				);
				penalty += (distance / 3) ** 2;
			}
			if (minimum && hand.lengths)
				penalty +=
					Math.max(0, minimum.length - hand.lengths[minimum.suit]) ** 2;
			if (balanced) penalty += hand.balancePenalty;
		}
		return Math.exp(-Math.min(12, penalty / 2));
	};
}

/** Perfect-information Monte Carlo: every candidate sees the same sampled worlds. */
export function analyzePlay(
	position: PlayPosition,
	solver: DoubleDummySolver,
	options: PlayOptions = {},
): PlayAnalysis {
	const samples = options.samples;
	const timeMs = playTimeMs(options.timeMs);
	const exactLimit =
		options.exactLimit ?? (samples === undefined ? MAX_ENUMERATED_LAYOUTS : 0);
	if (
		!Number.isInteger(exactLimit) ||
		exactLimit < 0 ||
		exactLimit > MAX_ENUMERATED_LAYOUTS
	)
		throw new Error(
			`exact layout limit must be an integer from 0 to ${MAX_ENUMERATED_LAYOUTS}`,
		);
	if (
		samples !== undefined &&
		(!Number.isInteger(samples) || samples < 1 || samples > 4096)
	)
		throw new Error(
			"an explicit play sample limit must be an integer from 1 to 4096",
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
	const weightLayout = sampler.uniqueLayout
		? undefined
		: prepareLayoutWeight(position);
	const sampleLimit = sampler.uniqueLayout ? 1 : samples;
	const random = options.random ?? Math.random;
	const worlds =
		!sampler.uniqueLayout && exactLimit > 0
			? sampler
					.enumerate(Math.min(exactLimit, samples ?? exactLimit), random)
					?.[Symbol.iterator]()
			: undefined;
	const declarerSide =
		(position.turn === "N" || position.turn === "S") ===
		(position.contract.declarer === "N" || position.contract.declarer === "S");
	const remainingTricks = 13 - Math.floor(position.view.plays.length / 4);
	const target = position.contract.level + 6;
	// scoreContract is signed North-South; convert it to the acting partnership.
	const sign = position.turn === "N" || position.turn === "S" ? 1 : -1;
	const reference =
		sign * scoreContract(position.contract, position.vulnerability, target);
	const makeTotal = (card: Card) => ({
		card,
		tricks: 0,
		score: 0,
		success: 0,
		utility: 0,
	});
	const totals = new Map<number, ReturnType<typeof makeTotal>>();
	const legalTotals = mapLegalRankClasses(position, (card, key) => {
		let total = totals.get(key);
		if (total === undefined) {
			total = makeTotal(card);
			totals.set(key, total);
		}
		return { card, total };
	});
	const outcomes: { score: number; success: number; utility: number }[] = [];
	const scoreOutcome = (tricks: number) => {
		const declarerTricks =
			position.declarerTricks +
			(declarerSide ? tricks : remainingTricks - tricks);
		const score =
			declarerTricks === target
				? reference
				: sign *
					scoreContract(
						position.contract,
						position.vulnerability,
						declarerTricks,
					);
		return {
			score,
			success: Number(
				declarerSide ? declarerTricks >= target : declarerTricks < target,
			),
			utility: scoreDifferenceToImps(score - reference),
		};
	};
	let weightSum = 0;
	let weightSquares = 0;
	let count = 0;
	let lastProgress = start - 50;
	const snapshot = (): PlayAnalysis => {
		const evaluations = legalTotals.map(({ card, total }) => ({
			card,
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
		(sampleLimit === undefined || count < sampleLimit) &&
		(count === 0 || performance.now() - start < timeMs)
	) {
		const next = worlds?.next();
		if (next?.done) break;
		const hands = next ? next.value : sampler(random);
		const weight = weightLayout?.(hands) ?? 1;
		const scores = solver.solve(
			hands,
			position.contract.strain,
			position.current,
		);
		for (const total of totals.values()) {
			const tricks = scores.get(total.card);
			if (tricks === undefined)
				throw new Error(`DDS omitted legal card ${total.card}`);
			let outcome = outcomes[tricks];
			if (outcome === undefined) {
				outcome = scoreOutcome(tricks);
				outcomes[tricks] = outcome;
			}
			total.tricks += weight * tricks;
			total.score += weight * outcome.score;
			total.success += weight * outcome.success;
			total.utility += weight * outcome.utility;
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
