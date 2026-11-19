import assert from "node:assert/strict";
import {
	createHandSampler,
	type RemainingHands,
} from "../../src/bot/play-sampling";
import {
	cardKnowledge,
	type VisiblePlay,
} from "../../src/bridge/card-knowledge";
import { type Card, DECK, suitOf } from "../../src/bridge/cards";
import { randomBelowFrom, shuffle } from "../../src/bridge/deal";
import type { Seat } from "../../src/protocol";

export type Candidate = "antithetic" | "stratified";

export function combinationCount(n: number, k: number): number {
	let count = 1;
	for (let i = 1; i <= Math.min(k, n - k); i++) {
		count = (count * (n + 1 - i)) / i;
		assert.ok(Number.isSafeInteger(count));
	}
	return count;
}

export function* stratifiedRanks(
	population: number,
	samples: number,
	offset: number,
) {
	for (let j = 0; j < samples; j++) {
		yield (offset + Math.floor((j * population) / samples)) % population;
	}
}

export function allocationSampler(
	view: VisiblePlay,
	candidate: Candidate,
	budget: number,
	excluded?: ReadonlyMap<Card, Seat>,
): ReturnType<typeof createHandSampler> {
	const iid = createHandSampler(view, excluded);
	if (!view.dummyCards || iid.uniqueLayout) return iid;
	const { hidden } = cardKnowledge(view);
	const [first, second] = hidden;
	assert.ok(hidden.length === 2 && first && second);
	const seen = new Set([
		...view.own,
		...view.dummyCards,
		...view.plays.map(({ card }) => card),
	]);
	const flexible: Card[] = [];
	const fixedFirst: Card[] = [];
	const fixedSecond: Card[] = [];
	for (const card of DECK) {
		if (seen.has(card)) continue;
		const suit = suitOf(card);
		const exclude = excluded?.get(card);
		if (first.seat === exclude || first.lengths[suit].max === 0)
			fixedSecond.push(card);
		else if (second.seat === exclude || second.lengths[suit].max === 0)
			fixedFirst.push(card);
		else flexible.push(card);
	}
	const k = first.remaining - fixedFirst.length;
	const n = flexible.length;
	assert.equal(n - k, second.remaining - fixedSecond.length);
	const population = combinationCount(n, k);
	if (population <= budget) return iid;
	const known: RemainingHands = { N: [], E: [], S: [], W: [] };
	known[view.seat] = view.own;
	known[view.dummy] = view.dummyCards;
	const layout = (a: Card[], b: Card[]): RemainingHands => ({
		...known,
		[first.seat]: [...fixedFirst, ...a],
		[second.seat]: [...fixedSecond, ...b],
	});
	let pair: Card[] | undefined;
	let ranks: IterableIterator<number> | undefined;
	return Object.assign(
		(random: () => number): RemainingHands => {
			if (candidate === "antithetic") {
				if (pair) {
					const reversed = layout(pair.slice(n - k), pair.slice(0, n - k));
					pair = undefined;
					return reversed;
				}
				pair = shuffle(flexible, (bound) => Math.floor(random() * bound));
				return layout(pair.slice(0, k), pair.slice(k));
			}
			ranks ??= stratifiedRanks(
				population,
				budget,
				randomBelowFrom(() => random() * 2 ** 32)(population),
			);
			const next = ranks.next();
			assert.ok(!next.done);
			let rank = next.value;
			let completions = population;
			let spaces = k;
			let remaining = n;
			const a: Card[] = [];
			const b: Card[] = [];
			for (const card of flexible) {
				const including = (completions * spaces) / remaining--;
				assert.ok(Number.isSafeInteger(including));
				if (rank < including) {
					a.push(card);
					spaces--;
					completions = including;
				} else {
					b.push(card);
					rank -= including;
					completions -= including;
				}
			}
			assert.ok(rank === 0 && spaces === 0 && completions === 1);
			return layout(a, b);
		},
		{ uniqueLayout: iid.uniqueLayout, enumerate: iid.enumerate },
	);
}
