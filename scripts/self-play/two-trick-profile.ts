import assert from "node:assert/strict";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { obviousPlay } from "../../src/bot/obvious-play";
import { analyzeLocalPlay, analyzePlay } from "../../src/bot/play-engine";
import type { PlayPosition } from "../../src/bot/play-position";
import { makeBoard, playTable, random as seededRandom } from "./arena";

const boards = Array.from({ length: 32 }, (_, i) =>
	makeBoard(12500400 + i, i + 1, 0),
);
const dds = await DdsSolver.create();
const budget = { samples: 16, exactLimit: 256, timeMs: 60_000 };
function preflight() {
	const work = Array.from({ length: 4 }, () => ({
		decisions: 0,
		obvious: 0,
		native: 0,
		distinct: 0,
	}));
	let totalNative = 0;
	for (const [i, board] of boards.entries()) {
		const policy: Parameters<typeof playTable>[1] = (position, random) => {
			const ply = position.view.plays.length;
			const count = ply >= 44 && ply < 48 ? work[ply - 44] : undefined;
			if (count) count.decisions++;
			const obvious = obviousPlay(position);
			if (obvious !== undefined) {
				if (count) count.obvious++;
				return obvious;
			}
			const seen = new Set<string>();
			const counted: DoubleDummySolver = {
				solve(...args) {
					if (count) {
						count.native++;
						seen.add(JSON.stringify(args[0]));
					}
					totalNative++;
					return dds.solve(...args);
				},
			};
			const result = analyzePlay(position, counted, { ...budget, random });
			assert.ok(result.elapsedMs < budget.timeMs);
			if (count) count.distinct += seen.size;
			return result.card;
		};
		playTable(board, policy, policy, 12500800 + i);
	}
	console.log(JSON.stringify({ work, totalNative }));
	assert.ok(work.some(({ native }) => native > 0));
}

type Mode = 0 | 1;

async function profile() {
	const eligible: { position: PlayPosition; seed: number }[] = [];
	const rounds = 9;
	const totals: [number, number] = [0, 0];
	const exactCalls: [number, number] = [0, 0];
	const msPairs: [number, number][] = [];
	const solvers = [dds, await DdsSolver.create()] as const;
	const engines = [analyzePlay, analyzeLocalPlay] as const;
	for (const [index, solver] of solvers.entries()) {
		const mode = index as Mode;
		const native = solver.solve.bind(solver);
		solver.solve = (...args) => {
			totals[mode]++;
			return native(...args);
		};
	}
	function table(
		board: (typeof boards)[number],
		mode: Mode,
		seed: number,
		capture: boolean,
	) {
		const analyses: unknown[] = [];
		const solver = solvers[mode];
		const analyze = engines[mode];
		const policy: Parameters<typeof playTable>[1] = (position, random) => {
			const card = obviousPlay(position);
			if (card !== undefined) return card;
			const ply = position.view.plays.length;
			if (capture && ply >= 44 && ply < 48) {
				const nextSeed = seed ^ Math.imul(ply + 1, 0xc2b2ae35);
				eligible.push({ position, seed: nextSeed });
			}
			const before = totals[mode];
			const { elapsedMs, ...result } = analyze(position, solver, {
				...budget,
				random,
			});
			const nativeCalls = totals[mode] - before;
			const expectedNative =
				mode === 1 && ply >= 44 && ply < 48 ? 0 : result.samples;
			assert.equal(nativeCalls, expectedNative);
			exactCalls[mode] += result.samples - nativeCalls;
			assert.ok(elapsedMs < budget.timeMs);
			analyses.push(result);
			return result.card;
		};
		const begin = performance.now();
		const result = playTable(board, policy, policy, seed);
		return { ms: performance.now() - begin, trace: { ...result, analyses } };
	}
	const warm = makeBoard(12500399, 33, 0);
	table(warm, 0, 12500799, false);
	table(warm, 1, 12500799, false);
	totals.fill(0);
	exactCalls.fill(0);
	for (const [i, board] of boards.entries()) {
		const first = (i % 2) as Mode;
		const a = table(board, first, 12500800 + i, first === 0);
		const b = table(board, (1 - first) as Mode, 12500800 + i, first === 1);
		assert.deepEqual(a.trace, b.trace, `board ${i + 1}`);
		if (i < rounds) msPairs.push(first === 0 ? [a.ms, b.ms] : [b.ms, a.ms]);
	}
	assert.equal(exactCalls[0], 0);
	assert.equal(totals[0], totals[1] + exactCalls[1]);
	assert.ok(exactCalls[1] > 0);
	const counts = {
		pairedGames: boards.length,
		eligible: eligible.length,
		totals: [...totals],
		exactCalls: [...exactCalls],
	};
	console.log(JSON.stringify({ counts, wholeTableMs: msPairs }));

	const references = eligible.map(({ position, seed }) => {
		const { elapsedMs, ...result } = analyzePlay(position, solvers[0], {
			...budget,
			random: seededRandom(seed),
		});
		assert.ok(elapsedMs < budget.timeMs);
		const { elapsedMs: candidateElapsed, ...candidate } = analyzeLocalPlay(
			position,
			solvers[1],
			{ ...budget, random: seededRandom(seed) },
		);
		assert.ok(candidateElapsed < budget.timeMs);
		assert.deepEqual(candidate, result);
		return result.samples;
	});
	const expected = references.reduce((sum, value) => sum + value, 0);
	const measure = (mode: Mode, repeats: number) => {
		const solver = solvers[mode];
		const analyze = engines[mode];
		let samples = 0;
		const begin = performance.now();
		for (let i = 0; i < repeats; i++) {
			for (const { position, seed } of eligible) {
				samples += analyze(position, solver, {
					...budget,
					random: seededRandom(seed),
				}).samples;
			}
		}
		const ms = performance.now() - begin;
		assert.equal(samples, expected * repeats);
		return ms;
	};
	for (const mode of [0, 1, 1, 0] as const) measure(mode, 20);
	const eligibleMs: [number, number][] = [];
	for (let i = 0; i < rounds; i++) {
		const a = measure((i % 2) as Mode, 160);
		const b = measure((1 - (i % 2)) as Mode, 160);
		eligibleMs.push(i % 2 === 0 ? [a, b] : [b, a]);
	}
	console.log(JSON.stringify({ eligibleMs, samplesPerRepeat: expected }));
}

if (process.argv.includes("--preflight")) preflight();
else await profile();
