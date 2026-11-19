import assert from "node:assert/strict";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { DEFAULT_PLAY_TIME_MS } from "../../src/bot/play-budget";
import { analyzePlay } from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";
import { makeBoard, type PlayPolicy, playPair, random } from "./arena";
import { assignments, compare, layoutKey, oracle } from "./ending-oracle";
import { summarize } from "./statistics";

const BASELINE = 256;
const CANDIDATE = 1024;
const BOUNDS = [480, 750, CANDIDATE];
const COHORTS = [11_300_000, 11_400_000];
const SCANS = 600;
const PER_STRATUM = 2;
const MIN_ELIGIBLE = 32;
const PAIRED = { seed: 11_500_000, deals: 64, ply: 32, samples: CANDIDATE };
const PLAY_BUDGET_MS = 5_000;
const TIMING_CEILING_MS = 1_000;
const WORK_GUARD_MS = 60_000;
const TOLERANCE = 1e-10;

type Worlds = Parameters<DoubleDummySolver["solve"]>[0][];

function worldsUpTo(position: PlayPosition, limit: number): Worlds {
	const worlds: Worlds = [];
	for (const world of assignments(position.view)) {
		worlds.push(world);
		if (worlds.length === limit) break;
	}
	assert.ok(worlds.length > 0);
	return worlds;
}

function distinct(worlds: Worlds) {
	const keys = new Set(worlds.map(layoutKey));
	assert.equal(keys.size, worlds.length);
	return keys;
}

function structuralPreflight() {
	const cohort = COHORTS.flatMap((base) => {
		const used = new Map<string, number>();
		return Array.from({ length: SCANS }, (_, index) => {
			const seed = base + index;
			const number = index + 1;
			const ply = 20 + ((Math.floor(index / 5) + (index % 5)) % 15);
			const board = makeBoard(seed, number, ply);
			const { actor } = boardStatus(board);
			assert.ok(actor);
			const position = playPosition(board, actor);
			assert.equal(position.hints.length, 0);
			const trial = {
				base,
				seed,
				number,
				ply,
				strain: position.contract.strain,
				legal: position.legal.length,
			};
			if (trial.legal < 2) return { trial: { ...trial, status: "forced" } };
			const worlds = worldsUpTo(position, CANDIDATE + 1);
			const population = worlds.length;
			const upper = BOUNDS.find((bound) => population <= bound);
			const info = { ...trial, population };
			if (population <= BASELINE)
				return { trial: { ...info, status: "at-or-below-baseline" } };
			if (upper === undefined)
				return { trial: { ...info, status: "above-candidate" } };
			const stratum = `${trial.strain}:${upper}`;
			const count = used.get(stratum) ?? 0;
			if (count >= PER_STRATUM)
				return { trial: { ...info, status: "stratum-full" } };
			used.set(stratum, count + 1);
			return {
				trial: { ...info, status: "selected" },
				selected: {
					...info,
					upper,
					position,
					worlds,
					matched:
						count === 0 &&
						(upper === 750 ||
							upper === (base === COHORTS[0] ? 480 : CANDIDATE)),
				},
			};
		});
	});
	return {
		scanned: cohort.map(({ trial }) => trial),
		selected: cohort.flatMap(({ selected }) => (selected ? [selected] : [])),
	};
}
type Selected = ReturnType<typeof structuralPreflight>["selected"][number];

function timed(
	solver: DoubleDummySolver,
	selected: Selected,
	baseline: boolean,
) {
	const { seed, position } = selected;
	let calls = 0;
	const start = performance.now();
	const result = analyzePlay(
		position,
		{
			solve(...args) {
				calls++;
				return solver.solve(...args);
			},
		},
		{ random: random(seed), ...(baseline ? { exactLimit: BASELINE } : {}) },
	);
	return { ...result, elapsedMs: performance.now() - start, calls };
}

function accuracy(solver: DoubleDummySolver, selected: Selected) {
	const { seed, position, worlds, population } = selected;
	const keys = distinct(worlds);
	const reference = oracle(position, worlds, solver);
	const check = (baseline: boolean) => {
		let calls = 0;
		const seen = new Set<string>();
		const result = analyzePlay(
			position,
			{
				solve(...args) {
					calls++;
					const key = layoutKey(args[0]);
					assert.ok(keys.has(key), "illegal layout");
					assert.ok(baseline || !seen.has(key), "duplicate exact layout");
					seen.add(key);
					return solver.solve(...args);
				},
			},
			{
				exactLimit: baseline ? BASELINE : CANDIDATE,
				samples: population,
				timeMs: WORK_GUARD_MS,
				random: random(seed),
			},
		);
		assert.equal(calls, population);
		assert.equal(result.samples, population);
		return {
			calls,
			distinct: seen.size,
			result,
			comparison: compare(result, reference),
		};
	};
	return { reference, exact: check(false), iid: check(true) };
}

function paired(solver: DoubleDummySolver) {
	const totals = {
		candidate: 0,
		baseline: 0,
		candidateExpanded: 0,
		baselineExpanded: 0,
	};
	const imps = [];
	for (let index = 0; index < PAIRED.deals; index++) {
		const seed = PAIRED.seed + index;
		const work: Record<
			"baseline" | "candidate",
			{ ply: number; population: number; calls: number; card: string }[]
		> = { baseline: [], candidate: [] };
		const policy =
			(side: keyof typeof work, exactLimit: number): PlayPolicy =>
			(position, rng) => {
				const population =
					position.legal.length > 1
						? worldsUpTo(position, CANDIDATE + 1).length
						: 0;
				let calls = 0;
				const result = analyzePlay(
					position,
					{
						solve(...args) {
							calls++;
							return solver.solve(...args);
						},
					},
					{
						exactLimit,
						samples: PAIRED.samples,
						timeMs: WORK_GUARD_MS,
						random: rng,
					},
				);
				assert.equal(
					calls,
					population <= exactLimit ? population : PAIRED.samples,
				);
				assert.equal(result.samples, calls);
				assert.ok(position.legal.includes(result.card));
				work[side].push({
					ply: position.view.plays.length,
					population,
					calls,
					card: result.card,
				});
				totals[side] += calls;
				if (population > BASELINE && population <= CANDIDATE)
					totals[`${side}Expanded`]++;
				return result.card;
			};
		const result = playPair(
			makeBoard(seed, index + 1, PAIRED.ply),
			policy("baseline", BASELINE),
			policy("candidate", CANDIDATE),
			seed,
		);
		assert.equal(work.baseline.length, 52 - PAIRED.ply);
		assert.equal(work.candidate.length, 52 - PAIRED.ply);
		imps.push(result.imps);
		emit({ type: "ending", seed, result, work });
	}
	const lowerNegated = summarize(imps.map((imp) => -imp)).lower95;
	const upper95 = lowerNegated === null ? null : -lowerNegated;
	return {
		...summarize(imps),
		upper95,
		totals,
		passed:
			upper95 !== null &&
			upper95 >= 0 &&
			totals.candidateExpanded > 0 &&
			totals.candidate < totals.baseline,
	};
}

function emit(record: unknown) {
	console.log(JSON.stringify(record));
}

const preflight = structuralPreflight();
emit({
	type: "preflight",
	baseline: BASELINE,
	candidate: CANDIDATE,
	cohorts: COHORTS,
	scans: SCANS,
	bounds: BOUNDS,
	perStratum: PER_STRATUM,
	minEligible: MIN_ELIGIBLE,
	paired: PAIRED,
	playBudgetMs: PLAY_BUDGET_MS,
	timingCeilingMs: TIMING_CEILING_MS,
	workGuardMs: WORK_GUARD_MS,
	tolerance: TOLERANCE,
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	scanned: preflight.scanned,
	selected: preflight.selected.map(({ position, worlds, ...record }) => record),
});
if (!process.argv.includes("--preflight")) {
	assert.ok(preflight.selected.length >= MIN_ELIGIBLE);
	assert.equal(DEFAULT_PLAY_TIME_MS, PLAY_BUDGET_MS);
	const timingSolver = await DdsSolver.create();
	const workSolver = await DdsSolver.create();
	const metrics = preflight.selected.map((selected, index) => {
		const { seed, population, position } = selected;
		const baselineFirst =
			selected.matched && index % 2 === 0
				? timed(timingSolver, selected, true)
				: undefined;
		const candidate = timed(timingSolver, selected, false);
		const baseline = selected.matched
			? (baselineFirst ?? timed(timingSolver, selected, true))
			: undefined;
		const measured = accuracy(workSolver, selected);
		const timedComparison = compare(candidate, measured.reference);
		const equivalent = [timedComparison, measured.exact.comparison].every(
			({ sameRanking, maxError }) =>
				sameRanking &&
				Object.values(maxError).every((error) => error <= TOLERANCE),
		);
		const passed =
			equivalent &&
			candidate.calls === population &&
			candidate.samples === population &&
			candidate.elapsedMs < TIMING_CEILING_MS &&
			position.legal.includes(candidate.card) &&
			(!baseline ||
				(baseline.calls === baseline.samples &&
					baseline.calls > candidate.calls &&
					baseline.elapsedMs >= PLAY_BUDGET_MS * 0.9 &&
					baseline.elapsedMs < PLAY_BUDGET_MS * 1.6));
		emit({
			type: "position",
			seed,
			baselineFirst: baselineFirst !== undefined,
			passed,
			timed: { candidate, baseline, comparison: timedComparison },
			accuracy: measured,
		});
		return { passed, candidate, baseline };
	});
	const endings = paired(workSolver);
	emit({
		type: "summary",
		passed: metrics.every(({ passed }) => passed) && endings.passed,
		eligible: metrics.length,
		comparedTiming: metrics.filter(({ baseline }) => baseline).length,
		maxCandidateMs: Math.max(
			...metrics.map(({ candidate }) => candidate.elapsedMs),
		),
		endings,
	});
}
