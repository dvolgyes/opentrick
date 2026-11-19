import { describe, expect, it } from "vitest";
import { makeBoard, random } from "../../scripts/self-play/arena";
import { assignments, layoutKey } from "../../scripts/self-play/ending-oracle";
import {
	allocationSampler,
	combinationCount,
	stratifiedRanks,
} from "../../scripts/self-play/variance-sampling";
import { playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { cardKnowledge } from "../../src/bridge/card-knowledge";
import { randomBelowFrom } from "../../src/bridge/deal";
import { boardStatus } from "../../src/bridge/engine";

function position(seed: number, ply: number) {
	const board = makeBoard(seed, 1, ply);
	const actor = boardStatus(board).actor;
	if (!actor) throw new Error("missing actor");
	return playPosition(board, actor);
}

describe("variance sampler", () => {
	it("uses equally spaced distinct ranks with uniform marginals", () => {
		const marginal = Array.from({ length: 8 }, () => Array<number>(11).fill(0));
		for (let offset = 0; offset < 11; offset++) {
			const ranks = [...stratifiedRanks(11, 8, offset)];
			expect(new Set(ranks).size).toBe(8);
			for (const [j, rank] of ranks.entries()) {
				expect(rank).toBe((offset + Math.floor((j * 11) / 8)) % 11);
				const counts = marginal[j];
				if (counts) counts[rank] = (counts[rank] ?? 0) + 1;
			}
		}
		for (const counts of marginal) expect(counts).toEqual(Array(11).fill(1));
		expect(combinationCount(26, 13)).toBe(10400600);
	});

	it("matches the IID prefix, minimizes flexible overlap, and keeps forced cards", () => {
		let checked = 0;
		let unequal = 0;
		let withForced = 0;
		for (let seed = 1; seed <= 40; seed++) {
			const { view } = position(seed, 33);
			const knowledge = cardKnowledge(view);
			const first = knowledge.hidden[0];
			if (!first || knowledge.hidden.length !== 2)
				throw new Error("hidden hands");
			const iid = createHandSampler(view);
			if (iid.uniqueLayout) continue;
			const worlds = new Set([...assignments(view)].map(layoutKey));
			if (worlds.size <= 8) continue;
			const sample = allocationSampler(view, "antithetic", 8);
			const rng = random(seed);
			const a = sample(rng);
			const b = sample(rng);
			expect(a).toEqual(iid(random(seed)));
			expect(worlds.has(layoutKey(a))).toBe(true);
			expect(worlds.has(layoutKey(b))).toBe(true);
			const forced = knowledge.hidden.flatMap((hand) => hand.known);
			const total =
				knowledge.hidden.reduce((n, hand) => n + hand.remaining, 0) -
				forced.length;
			const k = first.remaining - first.known.length;
			expect(
				a[first.seat].filter(
					(card) => !forced.includes(card) && b[first.seat].includes(card),
				),
			).toHaveLength(Math.max(0, 2 * k - total));
			unequal += Number(2 * k !== total);
			withForced += Number(forced.length > 0);
			checked++;
		}
		expect(checked).toBeGreaterThan(20);
		expect(unequal).toBeGreaterThan(0);
		expect(withForced).toBeGreaterThan(0);
	});

	it("unranks the selected combinations against independent enumeration", () => {
		for (let seed = 70; seed < 90; seed++) {
			const { view } = position(seed, 29);
			const worlds = Array.from(assignments(view), layoutKey);
			if (worlds.length <= 8) continue;
			const rng = random(seed);
			const offset = randomBelowFrom(() => rng() * 2 ** 32)(worlds.length);
			const sample = allocationSampler(view, "stratified", 8);
			const samples = random(seed);
			const expected = [...stratifiedRanks(worlds.length, 8, offset)].map(
				(rank) => worlds[rank],
			);
			expect(
				Array.from({ length: 8 }, () => layoutKey(sample(samples))),
			).toEqual(expected);
		}
	});

	it("keeps exclusion cards out of both paired layouts", () => {
		const { view } = position(1, 0);
		const afterLead = position(1, 1).view;
		expect(cardKnowledge(view).hidden).toHaveLength(3);
		const [first, second] = cardKnowledge(afterLead).hidden;
		const card =
			first && createHandSampler(afterLead)(random(63))[first.seat][0];
		if (!card || !first || !second)
			throw new Error("missing exclusion fixture");
		const sample = allocationSampler(
			afterLead,
			"antithetic",
			8,
			new Map([[card, first.seat]]),
		);
		const rng = random(2398);
		for (let i = 0; i < 8; i++) {
			const hands = sample(rng);
			expect(hands[first.seat]).not.toContain(card);
			expect(hands[second.seat]).toContain(card);
		}
	});
});
