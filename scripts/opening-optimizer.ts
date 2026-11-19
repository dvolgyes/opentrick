import { pathToFileURL } from "node:url";
import { DdsSolver, type DoubleDummySolver } from "../src/bot/dds-solver";
import { competitiveDeal } from "./self-play/competitive-deals";
import {
	compareLead,
	fitLead,
	type LeadRule,
	pickLead,
} from "./self-play/opening-fit";
import { openingPayoffs } from "./self-play/opening-payoffs";
import { partscoreDeal } from "./self-play/partscore-leads";
import { summarize } from "./self-play/statistics";

const TRAIN = 64;
const HOLDOUT = 96;
const SIZE = TRAIN + HOLDOUT;
const FIRST = 1_260_000_000;
const END = 1_350_000_000;
const conventional = { rank: "standard", margin: 1 } as const;

export function measureOpeningBoard(
	solver: DoubleDummySolver,
	first: number,
	i: number,
) {
	const seed = first + i;
	const number = 2 * Math.floor(i / 4) + (i % 2) + 1;
	const fixture =
		i % 4 < 2 ? competitiveDeal(seed, number) : partscoreDeal(seed, number);
	const result = openingPayoffs(
		solver,
		fixture.board,
		fixture.hints,
		i < TRAIN ? 4 : 8,
		seed ^ 0x28f5b13d,
	);
	return { seed, number, nt: i % 4 === 0, result };
}

function epoch(solver: DoubleDummySolver, index: number, detailed: boolean) {
	const first = FIRST + index * SIZE;
	if (!Number.isSafeInteger(first) || first < FIRST || first + SIZE > END)
		throw new RangeError(`Epoch ${index} is outside the reserved seed block`);
	function deal(i: number) {
		const { seed, number, nt, result } = measureOpeningBoard(solver, first, i);
		if (detailed)
			console.log(
				JSON.stringify({
					type: "board",
					epoch: index,
					seed,
					number,
					kind: i % 4,
					training: i < TRAIN,
					...result,
				}),
			);
		return { nt, result };
	}
	const train = Array.from({ length: TRAIN }, (_, i) => deal(i));
	const rules = {
		nt: fitLead(train.filter((x) => x.nt).map((x) => x.result)),
		suit: fitLead(train.filter((x) => !x.nt).map((x) => x.result)),
	};
	const holdout = Array.from({ length: HOLDOUT }, (_, i) => deal(i + TRAIN));
	const choice = (nt: boolean) => (nt ? rules.nt : rules.suit);
	const comparison = (control: LeadRule) =>
		summarize(
			holdout.map(({ nt, result }) => compareLead(result, choice(nt), control)),
		);
	const incumbent = comparison(null),
		standard = comparison(conventional);
	const alpha = 0.025 / ((index + 1) * (index + 2));
	const nominate = [incumbent, standard].every(
		(s) =>
			s.wins + s.losses >= 20 &&
			s.lower95 !== null &&
			s.lower95 > 0.05 &&
			s.signP < alpha,
	);
	const all = [...train, ...holdout];
	const summary = {
		type: "epoch",
		epoch: index,
		first,
		nextEpoch: index + 1,
		rules,
		trainImps: train.reduce(
			(sum, { nt, result }) => sum + compareLead(result, choice(nt), null),
			0,
		),
		changes: holdout.filter(
			({ nt, result }) =>
				pickLead(result, choice(nt)).card !== result.incumbent.card,
		).length,
		incumbent,
		standard,
		alpha,
		nominate,
		tables: all.reduce((s, r) => s + r.result.tables, 0),
		ddsCalls: all.reduce((s, r) => s + r.result.calls, 0),
	};
	console.log(JSON.stringify(summary));
	if (nominate) console.error(`NOMINATION ${JSON.stringify(summary)}`);
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const args = process.argv.slice(2);
	const detailed = args.at(-1) === "--rows";
	if (detailed) args.pop();
	if (
		args.length > 2 ||
		args.some((a) => !/^\d+$/.test(a) || !Number.isSafeInteger(Number(a))) ||
		(args[1] !== undefined && Number(args[1]) < 1) ||
		(detailed && args.length !== 2)
	)
		throw new Error(
			"Usage: node --import tsx scripts/opening-optimizer.ts [firstEpoch [count [--rows]]]",
		);
	const start = Number(args[0] ?? 0);
	const stop = args[1] === undefined ? Infinity : start + Number(args[1]);
	const capacity = Math.floor((END - FIRST) / SIZE);
	if (start >= capacity || (Number.isFinite(stop) && stop > capacity))
		throw new RangeError(`Epochs must be within 0 to ${capacity - 1}`);
	const solver = await DdsSolver.create();
	console.error(
		`READY opening optimizer: starting epoch ${start}, ${TRAIN} training and ${HOLDOUT} fresh holdout boards per epoch`,
	);
	for (let i = start; i < stop; i++) {
		try {
			epoch(solver, i, detailed);
		} catch (error) {
			console.error(`INVALID epoch ${i}: ${String(error)}`);
			throw error;
		}
	}
}
