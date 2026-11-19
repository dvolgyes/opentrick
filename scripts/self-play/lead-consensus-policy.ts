import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import type { analyzePlay, PlayAnalysis } from "../../src/bot/play-engine";
import { type Card, RANKS, rankOf } from "../../src/bridge/cards";
import { applyPrior } from "./defensive-search";

type WeightedRoot = PlayAnalysis & { readonly weightSum: number };

/** Observe the normalization constant without editing the measured engine. */
export async function loadWeightedOpening() {
	const url = new URL("../../src/bot/play-engine.ts", import.meta.url);
	const source = readFileSync(url, "utf8");
	const marker = "effectiveSamples: weightSum ** 2 / weightSquares,";
	if (source.split(marker).length !== 2)
		throw new Error("Expected one opening weight snapshot");
	const instrumented = source
		.replace(marker, `${marker}\n\t\t\tweightSum,`)
		.replace(
			/ from "(\.\.?\/[^"\n]+)"/g,
			(_, path: string) =>
				` from ${JSON.stringify(new URL(`${path}.ts`, url).href)}`,
		);
	const { code } = transformSync(instrumented, { loader: "ts", format: "esm" });
	const loaded = await import(
		`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
	);
	return loaded.analyzePlay as (
		...args: Parameters<typeof analyzePlay>
	) => WeightedRoot;
}

export function chooseConsensus(
	legal: readonly Card[],
	a: WeightedRoot,
	b: WeightedRoot,
	suggested: Card | undefined,
) {
	const total = a.weightSum + b.weightSum;
	if (!(a.weightSum > 0 && b.weightSum > 0 && Number.isFinite(total)))
		throw new Error("Both opening batches need a positive finite weight sum");
	if (
		a.evaluations.length !== legal.length ||
		b.evaluations.length !== legal.length
	)
		throw new Error("Opening batches must score all legal leads");
	const first = new Map(a.evaluations.map((e) => [e.card, e]));
	const second = new Map(b.evaluations.map((e) => [e.card, e]));
	const merge = (x: number, y: number) =>
		(x * a.weightSum + y * b.weightSum) / total;
	const merged = legal
		.map((card) => {
			const x = first.get(card);
			const y = second.get(card);
			if (!x || !y) throw new Error(`Missing scored opening lead ${card}`);
			return {
				card,
				utility: merge(x.utility, y.utility),
				expectedScore: merge(x.expectedScore, y.expectedScore),
			};
		})
		.sort(
			(x, y) =>
				y.utility - x.utility ||
				y.expectedScore - x.expectedScore ||
				RANKS.indexOf(rankOf(y.card)) - RANKS.indexOf(rankOf(x.card)),
		);
	const best = merged[0];
	if (!best) throw new Error("No opening candidates");
	const standard = applyPrior(merged, suggested).card;
	const gap = (scores: readonly { card: Card; utility: number }[]) => {
		if (suggested === undefined) return null;
		const alternative = scores.find(({ card }) => card === suggested);
		const winner = scores[0];
		if (!winner || !alternative)
			throw new Error("Missing proposed opening lead");
		return winner.utility - alternative.utility;
	};
	const gapA = gap(a.evaluations);
	const gapB = gap(b.evaluations);
	const passes = gapA !== null && gapB !== null && gapA <= 1 && gapB <= 1;
	return {
		incumbent: best.card,
		standard,
		consensus: passes ? (suggested ?? best.card) : best.card,
		decision:
			suggested === undefined ? "abstained" : passes ? "accepted" : "vetoed",
		gaps: [gapA, gapB, gap(merged)],
		merged,
	};
}

export function replayLeads<T>(
	cards: readonly Card[],
	replay: (card: Card) => T,
) {
	return [...new Set(cards)].map((card) => ({ card, result: replay(card) }));
}
