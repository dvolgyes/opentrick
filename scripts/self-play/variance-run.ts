import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import {
	analyzePlay,
	type PlayAnalysis,
	type PlayOptions,
} from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import {
	createHandSampler,
	type RemainingHands,
} from "../../src/bot/play-sampling";
import { boardStatus } from "../../src/bridge/engine";
import { makeBoard, type PlayPolicy, playPair, random } from "./arena";
import { assignments, layoutKey } from "./ending-oracle";
import { summarize } from "./statistics";
import { allocationSampler, type Candidate } from "./variance-sampling";

type Sampler = typeof createHandSampler;
type InjectedSearch = (
	position: PlayPosition,
	solver: DoubleDummySolver,
	options: PlayOptions,
	sampler: Sampler,
) => PlayAnalysis;
const SYSTEMS = { N: "hcp", E: "hcp", S: "hcp", W: "hcp" } as const;
const ORACLE_SEEDS = [294721, 531809, 821413, 993107] as const;
const TOLERANCE = 1e-9;
const emit = (row: unknown) => console.log(JSON.stringify(row));
const mean = (numbers: readonly number[]) =>
	numbers.reduce((sum, value) => sum + value, 0) / numbers.length;

async function instrumentedEngine(): Promise<InjectedSearch> {
	const sourceUrl = new URL("../../src/bot/play-engine.ts", import.meta.url);
	const source = await readFile(sourceUrl, "utf8");
	const parameter = "options: PlayOptions = {},";
	const call = "const sampler = createHandSampler(position.view);";
	assert.equal(source.split(parameter).length, 2);
	assert.equal(source.split(call).length, 2);
	const code = source
		.replace(parameter, `${parameter}\n\tmakeSampler = createHandSampler,`)
		.replace(call, "const sampler = makeSampler(position.view);")
		.replace(
			/from "(\.[^"]+)"/g,
			(_, specifier: string) =>
				`from "${new URL(`${specifier}.ts`, sourceUrl).href}"`,
		);
	const directory = await mkdtemp(join(tmpdir(), "opentrick-variance-"));
	try {
		const filename = join(directory, "play-engine.mts");
		await writeFile(filename, code);
		return (await import(pathToFileURL(filename).href)).analyzePlay;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function confidence(differences: readonly number[]) {
	const rng = random(574309);
	const resamples = Array.from({ length: 10_000 }, () => {
		let sum = 0;
		for (let j = 0; j < differences.length; j++) {
			const value = differences[Math.floor(rng() * differences.length)];
			assert.notEqual(value, undefined);
			sum += value as number;
		}
		return sum / differences.length;
	}).sort((a, b) => a - b);
	return { mean: mean(differences), lower975: resamples[249] };
}

function withCount(
	solver: DoubleDummySolver,
	expected: number,
	run: (counted: DoubleDummySolver) => PlayAnalysis,
): PlayAnalysis {
	let count = 0;
	const result = run({
		solve: (...args) => {
			count++;
			return solver.solve(...args);
		},
	});
	assert.equal(count, expected);
	assert.equal(result.samples, expected);
	assert.ok(positionFinite(result));
	return result;
}

function positionFinite(result: PlayAnalysis) {
	return (
		result.samples === 0 ||
		(Number.isFinite(result.effectiveSamples) &&
			result.effectiveSamples >= 1 - TOLERANCE &&
			result.effectiveSamples <= result.samples + TOLERANCE &&
			result.evaluations.every((item) =>
				[
					item.expectedTricks,
					item.expectedScore,
					item.successProbability,
					item.utility,
				].every(Number.isFinite),
			))
	);
}

function positionAt(seed: number, number: number, ply: number) {
	const board = makeBoard(seed, number, ply);
	const actor = boardStatus(board).actor;
	assert.ok(actor);
	return playPosition(board, actor, SYSTEMS);
}

function evaluate(
	result: PlayAnalysis,
	reference: ReadonlyMap<string, number>,
	best: number,
) {
	const chosen = reference.get(result.card);
	assert.notEqual(chosen, undefined);
	const bestEstimate = result.evaluations[0]?.utility;
	assert.notEqual(bestEstimate, undefined);
	return {
		card: result.card,
		mse: mean(
			result.evaluations.map(({ card, utility }) => {
				const value = reference.get(card);
				assert.notEqual(value, undefined);
				return (utility - (value as number)) ** 2;
			}),
		),
		regret: best - (chosen as number),
		tied:
			result.evaluations.filter(
				({ utility }) =>
					Math.abs(utility - (bestEstimate as number)) <= TOLERANCE,
			).length > 1,
	};
}

async function oracle(
	candidate: Candidate,
	solver: DoubleDummySolver,
	engine: InjectedSearch,
) {
	const firstSeed = candidate === "antithetic" ? 10000000 : 10200000;
	const oracleMse: number[] = [];
	const oracleRegret: number[] = [];
	const iidMse: number[] = [];
	const iidRegret: number[] = [];
	const excluded = { visibility: 0, forcedChoice: 0, exact: 0, tooLarge: 0 };
	const ties = {
		sameCard: 0,
		sameRegret: 0,
		reference: 0,
		iid: 0,
		candidate: 0,
		iidOptimal: 0,
		candidateOptimal: 0,
	};
	const populations: Record<number, number> = {};
	let examined = 0;
	let weightedPositions = 0;
	for (; oracleMse.length < 144 && examined < 10000; examined++) {
		const seed = firstSeed + examined;
		for (let ply = 24; ply <= 47; ply++) {
			const position = positionAt(seed, examined + 1, ply);
			if (!position.view.dummyCards) {
				excluded.visibility++;
				continue;
			}
			if (position.legal.length < 2) {
				excluded.forcedChoice++;
				continue;
			}
			const worlds: RemainingHands[] = [];
			for (const layout of assignments(position.view)) {
				worlds.push(layout);
				if (worlds.length > 128) break;
			}
			const population = worlds.length;
			if (population <= 8) {
				assert.ok(population > 0);
				excluded.exact++;
				continue;
			}
			if (population > 128) {
				excluded.tooLarge++;
				continue;
			}
			const sampler = createHandSampler(position.view);
			const exact = sampler.enumerate(128, random(0));
			assert.ok(exact);
			const exactKeys = new Set(Array.from(exact, layoutKey));
			assert.equal(exactKeys.size, population);
			assert.equal(new Set(worlds.map(layoutKey)).size, population);
			assert.ok(worlds.every((layout) => exactKeys.has(layoutKey(layout))));
			const referenceOptions = {
				samples: population,
				exactLimit: 128,
				timeMs: 60_000,
				random: random(0),
			};
			const referenceResult = withCount(solver, population, (dds) =>
				engine(position, dds, referenceOptions, () =>
					Object.assign(sampler, { enumerate: () => worlds }),
				),
			);
			const control = withCount(solver, population, (dds) =>
				analyzePlay(position, dds, referenceOptions),
			);
			const reference = new Map(
				referenceResult.evaluations.map(({ card, utility }) => [card, utility]),
			);
			for (const { card, utility } of control.evaluations) {
				const expected = reference.get(card);
				assert.ok(
					expected !== undefined && Math.abs(utility - expected) <= TOLERANCE,
				);
			}
			const best = referenceResult.evaluations[0]?.utility;
			assert.ok(best !== undefined);
			if (referenceResult.effectiveSamples < population - TOLERANCE)
				weightedPositions++;
			populations[population] = (populations[population] ?? 0) + 1;
			ties.reference += Number(
				[...reference.values()].filter((value) => best - value <= TOLERANCE)
					.length > 1,
			);
			const trials = ORACLE_SEEDS.map((searchSeed) => {
				const options = { samples: 8, exactLimit: 8, timeMs: 60_000 };
				const iid = evaluate(
					withCount(solver, 8, (dds) =>
						analyzePlay(position, dds, {
							...options,
							random: random(searchSeed),
						}),
					),
					reference,
					best,
				);
				const alternative = evaluate(
					withCount(solver, 8, (dds) =>
						engine(
							position,
							dds,
							{ ...options, random: random(searchSeed) },
							(view) => allocationSampler(view, candidate, 8),
						),
					),
					reference,
					best,
				);
				ties.sameCard += Number(iid.card === alternative.card);
				ties.sameRegret += Number(
					Math.abs(iid.regret - alternative.regret) <= TOLERANCE,
				);
				ties.iid += Number(iid.tied);
				ties.candidate += Number(alternative.tied);
				ties.iidOptimal += Number(iid.regret <= TOLERANCE);
				ties.candidateOptimal += Number(alternative.regret <= TOLERANCE);
				return { searchSeed, iid, candidate: alternative };
			});
			iidMse.push(mean(trials.map(({ iid }) => iid.mse)));
			iidRegret.push(mean(trials.map(({ iid }) => iid.regret)));
			oracleMse.push(mean(trials.map((trial) => trial.candidate.mse)));
			oracleRegret.push(mean(trials.map((trial) => trial.candidate.regret)));
			emit({ type: "oracle-position", seed, ply, population, trials });
			break;
		}
	}
	assert.equal(oracleMse.length, 144);
	emit({
		type: "oracle-summary",
		candidate,
		examined,
		deals: oracleMse.length,
		excludedDeals: examined - oracleMse.length,
		weightedPositions,
		excluded,
		populations,
		ties,
		iid: { mse: mean(iidMse), regret: mean(iidRegret) },
		alternative: { mse: mean(oracleMse), regret: mean(oracleRegret) },
		mseGain: confidence(
			iidMse.map((value, i) => value - (oracleMse[i] as number)),
		),
		regretGain: confidence(
			iidRegret.map((value, i) => value - (oracleRegret[i] as number)),
		),
	});
}

function paired(
	candidate: Candidate,
	solver: DoubleDummySolver,
	engine: InjectedSearch,
	confirm: boolean,
) {
	const firstSeed =
		candidate === "antithetic"
			? confirm
				? 10400000
				: 10100000
			: confirm
				? 10500000
				: 10300000;
	const budget = confirm ? 256 : 8;
	const deals = confirm ? 192 : 96;
	const imps: number[] = [];
	const counters = () => ({
		forced: 0,
		unique: 0,
		exact: 0,
		active: 0,
		opening: 0,
		dds: 0,
	});
	const iidCounters = counters();
	const alternativeCounters = counters();
	for (let i = 0; i < deals; i++) {
		const seed = firstSeed + i;
		const board = makeBoard(seed, i + 1, 0);
		const actor = boardStatus(board).actor;
		assert.ok(actor);
		const { hints } = playPosition(board, actor, SYSTEMS);
		const policy =
			(alternative: boolean, counts: ReturnType<typeof counters>): PlayPolicy =>
			(position, rng) => {
				const weighted = { ...position, hints };
				let expected = budget;
				if (weighted.legal.length === 1) {
					expected = 0;
					counts.forced++;
				} else {
					const sampler = createHandSampler(weighted.view);
					if (sampler.uniqueLayout) {
						expected = 1;
						counts.unique++;
					} else {
						const exact = sampler.enumerate(budget, random(0));
						if (exact) {
							expected = Array.from(exact).length;
							counts.exact++;
						} else if (weighted.view.dummyCards) counts.active++;
						else counts.opening++;
					}
				}
				const options = {
					samples: budget,
					exactLimit: budget,
					timeMs: 60_000,
					random: rng,
				};
				const result = withCount(solver, expected, (dds) =>
					alternative
						? engine(weighted, dds, options, (view) =>
								allocationSampler(view, candidate, budget),
							)
						: analyzePlay(weighted, dds, options),
				);
				counts.dds += result.samples;
				return result.card;
			};
		const searchSeed = seed ^ 0x65ea7c2d;
		const pair = playPair(
			board,
			policy(false, iidCounters),
			policy(true, alternativeCounters),
			searchSeed,
		);
		imps.push(pair.imps);
		emit({ type: "pair", seed, searchSeed, ...pair });
	}
	emit({
		type: "pair-summary",
		candidate,
		budget,
		...summarize(imps),
		strength: confidence(imps),
		iidCounters,
		alternativeCounters,
	});
}

const [candidate, mode] = process.argv.slice(2);
assert.ok(candidate === "antithetic" || candidate === "stratified");
assert.ok(mode === "oracle" || mode === "games" || mode === "confirm");
emit({
	type: "protocol",
	baseline: "b2858bff0d",
	runtime: process.version,
	candidate,
	mode,
});
const [engine, solver] = await Promise.all([
	instrumentedEngine(),
	DdsSolver.create(),
]);
if (mode === "oracle") await oracle(candidate, solver, engine);
else paired(candidate, solver, engine, mode === "confirm");
