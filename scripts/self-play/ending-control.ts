import assert from "node:assert/strict";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";
import { makeBoard, type PlayPolicy, playPair, random } from "./arena";
import {
	assignments,
	compare,
	layoutKey,
	METRICS,
	oracle,
} from "./ending-oracle";
import { summarize } from "./statistics";

const ACCURACY = {
	seed: 7_510_000,
	deals: 96,
	exactLimit: 64,
	firstPly: 40,
	lastPly: 47,
};
const PAIRED = { seed: 7_610_000, deals: 256, samples: 16, ply: 36 };
const TIME_MS = 60_000;
const TOLERANCE = 1e-10;

function accuracy(solver: DoubleDummySolver) {
	const { seed, deals, exactLimit, firstPly, lastPly } = ACCURACY;
	const coverage = { forced: 0, known: 0, aboveLimit: 0, qualifying: 0 };
	const trials = Array.from({ length: deals }, (_, index) => {
		const ply = firstPly + (index % (lastPly - firstPly + 1));
		const board = makeBoard(seed + index, index + 1, ply);
		const { actor } = boardStatus(board);
		assert.ok(actor);
		const position = playPosition(board, actor);
		assert.equal(position.hints.length, 0);
		const worlds = Array.from(assignments(position.view));
		assert.ok(worlds.length > 0);
		const expectedWorlds = new Set(worlds.map(layoutKey));
		assert.equal(expectedWorlds.size, worlds.length);
		const reference = oracle(position, worlds, solver);
		const best = reference[0];
		assert.ok(best);
		const population = worlds.length;
		const forced = position.legal.length === 1;
		const status = forced
			? "forced"
			: population === 1
				? "known"
				: population > exactLimit
					? "aboveLimit"
					: "qualifying";
		coverage[status]++;
		const trial = {
			index,
			ply,
			population,
			legal: reference.length,
			status,
			oracleCard: best.card,
			oracleUtility: best.utility,
			utilitySpread:
				best.utility - Math.min(...reference.map(({ utility }) => utility)),
		};
		const search = (limit: number) => {
			const visited = new Set<string>();
			let calls = 0;
			const result = analyzePlay(
				position,
				{
					solve(...args) {
						calls++;
						const key = layoutKey(args[0]);
						assert.ok(expectedWorlds.has(key), `deal ${index}: illegal layout`);
						if (limit && population <= limit)
							assert.ok(
								!visited.has(key),
								`deal ${index}: duplicate exact layout`,
							);
						visited.add(key);
						return solver.solve(...args);
					},
				},
				{
					exactLimit: limit,
					samples: population,
					random: random(seed + index),
					timeMs: TIME_MS,
				},
			);
			assert.equal(
				result.samples,
				forced ? 0 : population,
				`deal ${index}: incomplete work`,
			);
			assert.equal(calls, result.samples, `deal ${index}: DDS work mismatch`);
			return result;
		};
		const exact = search(exactLimit);
		if (forced) {
			assert.equal(exact.card, best.card);
			return { ...trial, exactCalls: exact.samples };
		}
		const exactReport = compare(exact, reference);
		if (status !== "aboveLimit") {
			assert.ok(
				Object.values(exactReport.maxError).every(
					(error) => error <= TOLERANCE,
				),
				`deal ${index}: exact value mismatch`,
			);
			assert.ok(
				exactReport.sameRanking,
				`deal ${index}: exact ranking mismatch`,
			);
		}
		if (status !== "qualifying")
			return { ...trial, exactCalls: exact.samples, exact: exactReport };
		const iid = search(0);
		return {
			...trial,
			exactCalls: exact.samples,
			iidCalls: iid.samples,
			exact: exactReport,
			iid: compare(iid, reference),
		};
	});
	assert.ok(coverage.qualifying > 0);
	const comparisons = trials.flatMap((trial) =>
		"exact" in trial && "iid" in trial && trial.exact && trial.iid
			? [{ oracleCard: trial.oracleCard, exact: trial.exact, iid: trial.iid }]
			: [],
	);
	const aggregate = (mode: "exact" | "iid") => {
		const results = comparisons.map((trial) => trial[mode]);
		return {
			maxError: Object.fromEntries(
				METRICS.map((metric) => [
					metric,
					Math.max(...results.map((result) => result.maxError[metric])),
				]),
			),
			meanBoardMaxError: Object.fromEntries(
				METRICS.map((metric) => [
					metric,
					results.reduce((sum, result) => sum + result.maxError[metric], 0) /
						results.length,
				]),
			),
			choicesMatchingOracle: comparisons.filter(
				(trial) => trial[mode].card === trial.oracleCard,
			).length,
			rankingsMatchingOracle: results.filter((result) => result.sameRanking)
				.length,
			positiveRegret: results.filter(
				(result) => result.utilityRegret > TOLERANCE,
			).length,
			meanUtilityRegret:
				results.reduce((sum, result) => sum + result.utilityRegret, 0) /
				results.length,
		};
	};
	return {
		...ACCURACY,
		tolerance: TOLERANCE,
		coverage,
		qualifyingWithDifferentUtilities: trials.filter(
			(trial) =>
				trial.status === "qualifying" && trial.utilitySpread > TOLERANCE,
		).length,
		exact: aggregate("exact"),
		iid: aggregate("iid"),
		trials,
	};
}

function paired(solver: DoubleDummySolver) {
	const { seed, deals, ply, samples } = PAIRED;
	const policy = (exactLimit: number) => {
		const work = { forced: 0, known: 0, enumerated: 0, iid: 0, calls: 0 };
		const play: PlayPolicy = (position, random) => {
			assert.equal(position.hints.length, 0);
			const forced = position.legal.length === 1;
			let population = 0;
			if (!forced)
				for (const _ of assignments(position.view))
					if (++population > samples) break;
			assert.ok(forced || population > 0);
			const status = forced
				? "forced"
				: population === 1
					? "known"
					: population <= exactLimit
						? "enumerated"
						: "iid";
			const expected =
				status === "forced"
					? 0
					: status === "known"
						? 1
						: status === "enumerated"
							? population
							: samples;
			let calls = 0;
			const result = analyzePlay(
				position,
				{
					solve(...args) {
						calls++;
						return solver.solve(...args);
					},
				},
				{ exactLimit, samples, random, timeMs: TIME_MS },
			);
			assert.equal(
				result.samples,
				expected,
				`ply ${position.view.plays.length}, exactLimit ${exactLimit}, ${status}: incomplete work`,
			);
			assert.equal(calls, expected, "paired DDS work mismatch");
			work[status]++;
			work.calls += calls;
			return result.card;
		};
		return { play, work };
	};
	const exact = policy(samples);
	const iid = policy(0);
	const trials = Array.from({ length: deals }, (_, index) => {
		const boardSeed = seed + index;
		return playPair(
			makeBoard(boardSeed, index + 1, ply),
			iid.play,
			exact.play,
			boardSeed,
		).imps;
	});
	for (const { work } of [exact, iid]) {
		assert.equal(
			work.forced + work.known + work.enumerated + work.iid,
			deals * (52 - ply),
		);
	}
	const negativeLower95 = summarize(trials.map((imp) => -imp)).lower95;
	return {
		...PAIRED,
		work: { exact: exact.work, iid: iid.work },
		...summarize(trials),
		upper95: negativeLower95 === null ? null : -negativeLower95,
		impsByBoardIndex: trials,
	};
}

const solver = await DdsSolver.create();
console.log(
	JSON.stringify({
		timeMs: TIME_MS,
		accuracy: accuracy(solver),
		paired: paired(solver),
	}),
);
