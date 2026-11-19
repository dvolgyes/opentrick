import { createHash } from "node:crypto";
import { arch, cpus, platform } from "node:os";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS } from "../../src/protocol";
import { type PlayPolicy, playTable, random } from "./arena";
import { competitiveDeal } from "./competitive-deals";
import { boardSearch } from "./defensive-search";
import {
	chooseConsensus,
	loadWeightedOpening,
	replayLeads,
} from "./lead-consensus-policy";
import { partnerOpening } from "./partner-opening";
import { partscoreDeal } from "./partscore-leads";
import { summarize } from "./statistics";

const FIRST = 12_100_000;
const DEALS = 96;
const HALF_MS = 2500;
const CONTINUATION = 8;
const SNAPSHOT = "b2858bff0de6c3509e527f5aadfed7a34c2c3aa3";
const ARMS = ["incumbent", "standard", "consensus"] as const;
const ALPHA = 0.025;
const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emit = (row: unknown) => console.log(JSON.stringify(row));

function measure(
	solver: DoubleDummySolver,
	opening: Awaited<ReturnType<typeof loadWeightedOpening>>,
	i: number,
	seed: number,
	check: boolean,
) {
	const number = 2 * Math.floor(i / 4) + (i % 2) + 1;
	const fixture =
		i % 4 < 2 ? competitiveDeal(seed, number) : partscoreDeal(seed, number);
	const { board, hints, draws } = fixture;
	const status = boardStatus(board);
	if (status.phase !== "play" || board.cards.length !== 0)
		throw new Error("Not an opening position");
	const raw = playPosition(board, status.actor);
	const position = { ...raw, hints };
	const batchSeeds = [seed ^ 0x5a120efa, seed ^ 0x7e51a33d] as const;
	const run = (batch: 0 | 1) => {
		const options = {
			timeMs: HALF_MS,
			random: random(batchSeeds[batch]),
			...(check ? { samples: 8 } : {}),
		};
		const result = opening(position, solver, options);
		if (check) {
			const plain = analyzePlay(position, solver, {
				...options,
				random: random(batchSeeds[batch]),
			});
			const { elapsedMs: _instrumented, weightSum, ...observed } = result;
			const { elapsedMs: _plain, ...expected } = plain;
			if (
				hash(observed) !== hash(expected) ||
				!(weightSum > 0 && weightSum <= 8) ||
				plain.samples !== 8
			)
				throw new Error(
					"Instrumented and untouched fixed-sample evaluations differ",
				);
			const unweighted = opening(raw, solver, {
				...options,
				random: random(batchSeeds[batch]),
			});
			if (
				raw.hints.length !== 0 ||
				unweighted.weightSum !== unweighted.samples ||
				unweighted.samples !== 8
			)
				throw new Error("Unweighted layout count and measured weight differ");
		} else if (result.elapsedMs < HALF_MS || result.samples < 2) {
			throw new Error(
				`Opening clock or sample count is invalid: ${JSON.stringify(result)}`,
			);
		}
		return result;
	};
	const start = performance.now();
	const order = i % 2 === 0 ? ([0, 1] as const) : ([1, 0] as const);
	const first = run(order[0]);
	const second = run(order[1]);
	const roots =
		order[0] === 0 ? ([first, second] as const) : ([second, first] as const);
	const openingMs = performance.now() - start;
	const suggestion = partnerOpening("standard", position, roots[0].card);
	const choice = chooseConsensus(position.legal, ...roots, suggestion);
	const sign = status.actor === "N" || status.actor === "S" ? 1 : -1;
	const continuationSeed = seed ^ 0x28f5b13d;
	const search = boardSearch(solver, CONTINUATION, hints);
	const continuation = search.policy().play;
	const tables = replayLeads(
		ARMS.map((arm) => choice[arm]),
		(card) => {
			const policy: PlayPolicy = (p, rng) =>
				p.view.plays.length === 0 ? card : continuation(p, rng);
			const table = playTable(board, policy, policy, continuationSeed);
			return { ...table, defenderPoints: sign * table.scoreNS };
		},
	);
	const points = (arm: (typeof ARMS)[number]) => {
		const row = tables.find(({ card }) => choice[arm] === card);
		if (!row) throw new Error(`Missing table for ${arm}`);
		return row.result.defenderPoints;
	};
	const score = [
		points("incumbent"),
		points("standard"),
		points("consensus"),
	] as const;
	return {
		type: "board",
		seed,
		number,
		slot: i % 4,
		draws,
		dealHash: hash(SEATS.map((seat) => [...board.deal[seat]].sort())),
		status,
		batchSeeds,
		order,
		roots,
		openingMs,
		suggestion: suggestion ?? null,
		choice,
		continuationSeed,
		tables,
		score,
		...search.work,
	};
}

type Row = ReturnType<typeof measure>;

function comparison(rows: readonly Row[], control: 0 | 1) {
	const paired = rows.map(({ score, slot }) => {
		const raw = score[2] - score[control];
		return { raw, imp: scoreDifferenceToImps(raw), slot };
	});
	const raw = paired.map((row) => row.raw);
	const imps = paired.map((row) => row.imp);
	const strata = [0, 1, 2, 3].map((slot) =>
		paired.filter((row) => row.slot === slot).map((row) => row.imp),
	);
	const rng = random(0x51f15eed);
	const resamples = Array.from({ length: 10_000 }, () => {
		let total = 0;
		for (const stratum of strata)
			for (let j = 0; j < stratum.length; j++) {
				const imp = stratum[Math.floor(rng() * stratum.length)];
				if (imp === undefined) throw new Error("Missing resampled board");
				total += imp;
			}
		return total / rows.length;
	}).sort((a, b) => a - b);
	const lower975 = resamples[Math.ceil(ALPHA * resamples.length) - 1];
	if (lower975 === undefined) throw new Error("Missing bootstrap percentile");
	const stats = summarize(imps);
	return {
		...stats,
		lower975,
		rawTotal: raw.reduce((a, b) => a + b, 0),
		rawWins: raw.filter((x) => x > 0).length,
		rawLosses: raw.filter((x) => x < 0).length,
		rawTies: raw.filter((x) => x === 0).length,
		sameLead: rows.filter(
			({ choice }) => choice.consensus === choice[ARMS[control]],
		).length,
		passes:
			stats.wins + stats.losses >= 20 && stats.signP < ALPHA && lower975 > 0.05,
	};
}

function spread(values: readonly number[]) {
	const sorted = values.slice().sort((a, b) => a - b);
	return Object.fromEntries(
		[0, 0.25, 0.5, 0.75, 1].map((q) => [
			q,
			sorted[Math.floor(q * (sorted.length - 1))],
		]),
	);
}

const check = process.argv[2] === "--check";
if (process.argv.length !== (check ? 3 : 2))
	throw new Error("Only --check is supported");
const solver = await DdsSolver.create();
const opening = await loadWeightedOpening();
emit({
	type: "protocol",
	snapshot: SNAPSHOT,
	check,
	first: check ? 1736 : FIRST,
	deals: check ? 4 : DEALS,
	halfMs: HALF_MS,
	continuation: CONTINUATION,
	arms: ARMS,
	alpha: ALPHA,
	node: process.version,
	os: platform(),
	arch: arch(),
	cpu: cpus()[0]?.model,
});
const rows: Row[] = [];
const seen = new Set<string>();
for (let i = 0; i < (check ? 4 : DEALS); i++) {
	const seed = (check ? 1736 : FIRST) + i;
	try {
		const row = measure(solver, opening, i, seed, check);
		if (seen.has(row.dealHash))
			throw new Error(`Duplicate deal ${row.dealHash}`);
		seen.add(row.dealHash);
		rows.push(row);
		emit(row);
	} catch (error) {
		emit({ type: "invalid", seed, error: String(error) });
		throw error;
	}
}
if (!check) {
	const incumbent = comparison(rows, 0);
	const standard = comparison(rows, 1);
	emit({
		type: "summary",
		incumbent,
		standard,
		confirm: incumbent.passes && standard.passes,
		uniqueDeals: seen.size,
		uniqueLeads: rows.reduce((sum, row) => sum + row.tables.length, 0),
		timingMs: {
			opening: spread(rows.map((r) => r.openingMs)),
			half: spread(rows.flatMap((r) => r.roots.map((s) => s.elapsedMs))),
		},
		samples: {
			opening: spread(rows.map((r) => r.roots[0].samples + r.roots[1].samples)),
			half: spread(rows.flatMap((r) => r.roots.map((s) => s.samples))),
			halfCountDifference: spread(
				rows.map((r) => Math.abs(r.roots[0].samples - r.roots[1].samples)),
			),
		},
	});
}
