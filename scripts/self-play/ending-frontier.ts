import assert from "node:assert/strict";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
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

const BASELINE = 64;
const CANDIDATE = 256;
const ACCURACY = {
	seed: 7_710_000,
	positions: 160,
	minEligible: 12,
	tolerance: 1e-10,
};
const TIMING = { budgetMs: 5_000, ceilingMs: 500 };
const PAIRED = { seed: 7_810_000, deals: 128, ply: 32, samples: CANDIDATE };
const WORK_GUARD_MS = 60_000;

type Worlds = Parameters<DoubleDummySolver["solve"]>[0][];

function layouts(position: PlayPosition, stop = Infinity): Worlds {
	assert.equal(
		position.hints.length,
		0,
		"the independent oracle requires no auction hints",
	);
	const worlds: Worlds = [];
	for (const hands of assignments(position.view)) {
		worlds.push(hands);
		if (worlds.length === stop) break;
	}
	assert.ok(worlds.length > 0);
	return worlds;
}

function distinctLayouts(worlds: Worlds) {
	const keys = new Set(worlds.map(layoutKey));
	assert.equal(
		keys.size,
		worlds.length,
		"the independent oracle repeated a layout",
	);
	return keys;
}

function accuracy(
	timedSolver: DoubleDummySolver,
	workSolver: DoubleDummySolver,
) {
	const coverage = {
		forced: 0,
		unique: 0,
		atMost64: 0,
		from65Through256: 0,
		above256: 0,
	};
	const eligible: {
		index: number;
		ply: number;
		position: PlayPosition;
		worlds: Worlds;
	}[] = [];
	for (let index = 0; index < ACCURACY.positions; index++) {
		const ply = 30 + (index % 10);
		const board = makeBoard(ACCURACY.seed + index, index + 1, ply);
		const { actor } = boardStatus(board);
		assert.ok(actor);
		const position = playPosition(board, actor);
		if (position.legal.length === 1) {
			coverage.forced++;
			continue;
		}
		const worlds = layouts(position, CANDIDATE + 1);
		if (worlds.length === 1) coverage.unique++;
		else if (worlds.length <= BASELINE) coverage.atMost64++;
		else if (worlds.length > CANDIDATE) coverage.above256++;
		else {
			coverage.from65Through256++;
			eligible.push({ index, ply, position, worlds });
		}
	}

	const timed = eligible.map(({ index, position, worlds }) => {
		const options = {
			exactLimit: CANDIDATE,
			timeMs: TIMING.budgetMs,
			random: random(ACCURACY.seed + index),
		};
		const start = performance.now();
		try {
			const result = analyzePlay(position, timedSolver, options);
			const elapsedMs = performance.now() - start;
			return {
				index,
				elapsedMs,
				samples: result.samples,
				truncated: result.samples < worlds.length,
				valid:
					result.samples === worlds.length &&
					position.legal.includes(result.card),
			};
		} catch (error) {
			return {
				index,
				elapsedMs: performance.now() - start,
				error: String(error),
				valid: false,
			};
		}
	});
	const times = timed.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
	const middle = Math.floor(times.length / 2);
	const medianMs = times.length
		? ((times[Math.floor((times.length - 1) / 2)] as number) +
				(times[middle] as number)) /
			2
		: null;
	const maxMs = times.at(-1) ?? null;
	const truncations = timed.filter(({ truncated }) => truncated).length;

	const trials = eligible.map(({ index, ply, position, worlds }) => {
		const trial = {
			index,
			ply,
			population: worlds.length,
			legal: position.legal.length,
		};
		try {
			const keys = distinctLayouts(worlds);
			const reference = oracle(position, worlds, workSolver);
			const oracleCard = reference[0]?.card;
			assert.ok(oracleCard);
			const instrument = (exactLimit: number) => {
				const seen = new Set<string>();
				let calls = 0;
				const result = analyzePlay(
					position,
					{
						solve(...args) {
							calls++;
							const key = layoutKey(args[0]);
							assert.ok(keys.has(key), "illegal layout");
							if (exactLimit)
								assert.ok(!seen.has(key), "repeated exact layout");
							seen.add(key);
							return workSolver.solve(...args);
						},
					},
					{
						exactLimit,
						samples: worlds.length,
						timeMs: WORK_GUARD_MS,
						random: random(ACCURACY.seed + index),
					},
				);
				assert.equal(result.samples, worlds.length, "incomplete analysis");
				assert.equal(calls, result.samples, "DDS call count mismatch");
				return { calls, distinct: seen.size, ...compare(result, reference) };
			};
			return {
				...trial,
				oracleCard,
				exact: instrument(CANDIDATE),
				iid: instrument(0),
			};
		} catch (error) {
			return { ...trial, error: String(error) };
		}
	});
	const compared = trials.flatMap((trial) =>
		"exact" in trial && trial.exact && trial.iid
			? [{ oracleCard: trial.oracleCard, exact: trial.exact, iid: trial.iid }]
			: [],
	);
	const aggregate = (mode: "exact" | "iid") => {
		const results = compared.map((trial) => trial[mode]);
		return {
			calls: results.reduce((sum, result) => sum + result.calls, 0),
			maxError: Object.fromEntries(
				METRICS.map((metric) => [
					metric,
					results.length
						? Math.max(...results.map((result) => result.maxError[metric]))
						: null,
				]),
			),
			choicesMatchingOracle: compared.filter(
				(trial) => trial[mode].card === trial.oracleCard,
			).length,
			rankingsMatchingOracle: results.filter((result) => result.sameRanking)
				.length,
			positiveRegret: results.filter(
				(result) => result.utilityRegret > ACCURACY.tolerance,
			).length,
			meanUtilityRegret: results.length
				? results.reduce((sum, result) => sum + result.utilityRegret, 0) /
					results.length
				: null,
		};
	};
	const exact = aggregate("exact");
	const passed =
		eligible.length >= ACCURACY.minEligible &&
		compared.length === eligible.length &&
		compared.every(
			({ exact }) =>
				exact.sameRanking &&
				Object.values(exact.maxError).every(
					(error) => error <= ACCURACY.tolerance,
				),
		) &&
		timed.every(
			({ valid, elapsedMs }) => valid && elapsedMs < TIMING.ceilingMs,
		);
	return {
		...ACCURACY,
		coverage,
		passed,
		exact,
		iid: aggregate("iid"),
		trials,
		timing: { ...TIMING, medianMs, maxMs, truncations, trials: timed },
	};
}

function paired(solver: DoubleDummySolver) {
	const policy = (exactLimit: number) => {
		const work = { forced: 0, unique: 0, exact: 0, iid: 0, calls: 0 };
		const play: PlayPolicy = (position, random) => {
			const forced = position.legal.length === 1;
			const keys = forced
				? new Set<string>()
				: distinctLayouts(layouts(position));
			const status = forced
				? "forced"
				: keys.size === 1
					? "unique"
					: keys.size <= exactLimit
						? "exact"
						: "iid";
			const expected = status === "iid" ? PAIRED.samples : keys.size;
			const seen = new Set<string>();
			let calls = 0;
			const result = analyzePlay(
				position,
				{
					solve(...args) {
						calls++;
						work.calls++;
						const key = layoutKey(args[0]);
						assert.ok(keys.has(key), "illegal paired layout");
						if (status !== "iid")
							assert.ok(!seen.has(key), "repeated paired exact layout");
						seen.add(key);
						return solver.solve(...args);
					},
				},
				{ exactLimit, samples: PAIRED.samples, random, timeMs: WORK_GUARD_MS },
			);
			assert.equal(result.samples, expected, "incomplete paired analysis");
			assert.equal(calls, expected, "paired DDS call count mismatch");
			assert.ok(position.legal.includes(result.card), "illegal paired card");
			work[status]++;
			return result.card;
		};
		return { play, work };
	};
	const baseline = policy(BASELINE);
	const candidate = policy(CANDIDATE);
	const trials = Array.from({ length: PAIRED.deals }, (_, index) => {
		const seed = PAIRED.seed + index;
		try {
			const { candidateNS, candidateEW, imps } = playPair(
				makeBoard(seed, index + 1, PAIRED.ply),
				baseline.play,
				candidate.play,
				seed,
			);
			return {
				index,
				imps,
				candidateNS: candidateNS.scoreNS,
				candidateEW: candidateEW.scoreNS,
			};
		} catch (error) {
			return { index, error: String(error) };
		}
	});
	const imps = trials.flatMap((trial) =>
		"imps" in trial && trial.imps !== undefined ? [trial.imps] : [],
	);
	const distribution: Record<number, number> = {};
	for (const imp of imps) distribution[imp] = (distribution[imp] ?? 0) + 1;
	const lowerNegated = summarize(imps.map((imp) => -imp)).lower95;
	const upper95 = lowerNegated === null ? null : -lowerNegated;
	const completeWork = [baseline.work, candidate.work].every(
		({ forced, unique, exact, iid }) =>
			forced + unique + exact + iid === PAIRED.deals * (52 - PAIRED.ply),
	);
	return {
		...PAIRED,
		...summarize(imps),
		scheduledDeals: PAIRED.deals,
		upper95,
		distribution,
		trials,
		work: { baseline: baseline.work, candidate: candidate.work },
		passed:
			imps.length === PAIRED.deals &&
			completeWork &&
			upper95 !== null &&
			upper95 >= 0,
	};
}

const timedSolver = await DdsSolver.create();
const workSolver = await DdsSolver.create();
const frontier = accuracy(timedSolver, workSolver);
const endings = paired(workSolver);
console.log(
	JSON.stringify({
		baseline: BASELINE,
		candidate: CANDIDATE,
		workGuardMs: WORK_GUARD_MS,
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		accuracy: frontier,
		paired: endings,
		recommendPromotion: frontier.passed && endings.passed,
	}),
);
