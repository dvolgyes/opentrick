import assert from "node:assert/strict";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { obviousPlay } from "../../src/bot/obvious-play";
import { analyzePlay } from "../../src/bot/play-engine";
import { makeBoard, type PlayPolicy, playPair, random } from "./arena";

/** Compare the shipped decision shortcuts with an independently loaded historical engine. */
export async function checkShortcuts(original: typeof analyzePlay) {
	const solver = await DdsSolver.create();
	const seed = 479300;
	const rng = random(723609);
	const samples = 4;
	const deals = 40;
	const total = {
		baseline: 0,
		optimized: 0,
		equivalent: 0,
		known: 0,
		decisions: 0,
	};
	for (let i = 0; i < deals; i++) {
		const counts = {
			baseline: 0,
			optimized: 0,
			equivalent: 0,
			known: 0,
			decisions: 0,
		};
		const instrument = (side: "baseline" | "optimized"): DoubleDummySolver => ({
			solve(...args) {
				counts[side]++;
				return solver.solve(...args);
			},
		});
		const before = instrument("baseline");
		const after = instrument("optimized");
		const baseline: PlayPolicy = (p, random) => {
			const a = original(p, before, { samples, timeMs: 60_000, random });
			assert.equal(a.samples, p.legal.length === 1 ? 0 : samples);
			return a.card;
		};
		const optimized: PlayPolicy = (p, random) => {
			counts.decisions++;
			const card = obviousPlay(p);
			if (card !== undefined) {
				if (p.legal.length > 1) counts.equivalent++;
				return card;
			}
			const a = analyzePlay(p, after, { samples, timeMs: 60_000, random });
			if (a.samples === 1) counts.known++;
			else assert.equal(a.samples, samples);
			return a.card;
		};
		const pair = playPair(
			makeBoard(seed + i, i + 1, 0),
			baseline,
			optimized,
			Math.floor(rng() * 2 ** 32),
		);
		assert.deepEqual(pair.candidateNS, pair.candidateEW);
		assert.equal(pair.imps, 0);
		assert.equal(
			counts.baseline - counts.optimized,
			counts.equivalent * samples + counts.known * (samples - 1),
		);
		for (const key of Object.keys(total) as (keyof typeof total)[])
			total[key] += counts[key];
	}
	assert.ok(total.equivalent > 0 && total.known > 0);
	return total;
}
