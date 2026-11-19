import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { random } from "./arena";
import { summarize } from "./statistics";

interface Search {
	card: string;
	ess: number;
	ms: number;
	work: { dds: number; proposals: number; mixed: number; weightSum: number };
	utility: Record<string, number>;
}
interface RecordBase {
	index: number;
	seed: number;
	draws: number;
	strain: string;
	ms: number;
}
interface Accuracy extends RecordBase {
	repeats: { control: Search; candidate: Search }[];
	reference: [Search, Search];
	oracle: Record<string, number>;
}
interface Table {
	work: { dds: number; proposals: number; ms: number };
	opening: Search;
	scoreNS: number;
	declarerTricks: number;
}
interface Pair extends RecordBase {
	control: Table;
	candidate: Table;
	imp: number;
}
const arms = ["control", "candidate"] as const;
const [dir, mode] = process.argv.slice(2);
assert.ok(
	dir && (mode === "accuracy" || mode === "games" || mode === "holdout"),
);
const names = readdirSync(dir).filter((name) =>
	new RegExp(`^${mode}-\\d+\\.jsonl$`).test(name),
);
const rows: (Accuracy | Pair)[] = names
	.flatMap((name) =>
		readFileSync(join(dir, name), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line))
			.filter((row) => row.type === mode),
	)
	.sort((a, b) => a.index - b.index);
const n = mode === "accuracy" ? 48 : 96;
assert.deepEqual(
	rows.map(({ index }) => index),
	Array.from({ length: n }, (_, i) => i),
);
const wallSeconds = Number(
	readFileSync(join(dir, `${mode}.wall-seconds`), "utf8"),
);
const sum = (numbers: readonly number[]) =>
	numbers.reduce((total, value) => total + value, 0);
const mean = (numbers: readonly number[]) => sum(numbers) / numbers.length;
function required<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Missing ${label}`);
	return value;
}
const median = (numbers: readonly number[]) => {
	const sorted = [...numbers].sort((a, b) => a - b);
	return (
		(required(sorted[Math.floor((sorted.length - 1) / 2)], "lower median") +
			required(sorted[Math.ceil((sorted.length - 1) / 2)], "upper median")) /
		2
	);
};
function byArm<T>(measure: (arm: (typeof arms)[number]) => T) {
	return { control: measure("control"), candidate: measure("candidate") };
}
function lower95<T>(data: readonly T[], metric: (resample: T[]) => number) {
	const rng = random(6_592_676);
	const scores = Array.from({ length: 10_000 }, () =>
		metric(
			Array.from({ length: data.length }, () =>
				required(data[Math.floor(rng() * data.length)], "bootstrap row"),
			),
		),
	).sort((a, b) => a - b);
	return scores[499];
}
function mse(x: Record<string, number>, y: Record<string, number>) {
	assert.deepEqual(Object.keys(x).sort(), Object.keys(y).sort());
	return mean(
		Object.entries(x).map(
			([card, value]) => (value - required(y[card], card)) ** 2,
		),
	);
}
function regret(card: string, utility: Record<string, number>) {
	return Math.max(...Object.values(utility)) - required(utility[card], card);
}
function searchWork(results: readonly Search[]) {
	return {
		dds: sum(results.map(({ work }) => work.dds)),
		proposals: sum(results.map(({ work }) => work.proposals)),
		mixed: sum(results.map(({ work }) => work.mixed)),
		seconds: sum(results.map(({ ms }) => ms)) / 1000,
		medianMs: median(results.map(({ ms }) => ms)),
	};
}
function measureAccuracy(input: Accuracy[]) {
	const measurements = input.map(
		({ repeats, reference, oracle, seed, strain }) => {
			const [left, right] = reference;
			assert.equal(repeats.length, 4);
			const pooled = Object.fromEntries(
				Object.entries(left.utility).map(([card, value]) => [
					card,
					(value * left.work.weightSum +
						required(right.utility[card], card) * right.work.weightSum) /
						(left.work.weightSum + right.work.weightSum),
				]),
			);
			return {
				seed,
				strain,
				referenceHalfMse: mse(left.utility, right.utility),
				changes: sum(
					repeats.map(({ control, candidate }) =>
						Number(control.card !== candidate.card),
					),
				),
				arms: byArm((arm) => ({
					mse: mean(repeats.map((repeat) => mse(repeat[arm].utility, pooled))),
					halfMse: reference.map((half) =>
						mean(
							repeats.map((repeat) => mse(repeat[arm].utility, half.utility)),
						),
					),
					ess: mean(repeats.map((repeat) => repeat[arm].ess)),
					refRegret: mean(
						repeats.map((repeat) => regret(repeat[arm].card, pooled)),
					),
					oracleRegret: mean(
						repeats.map((repeat) => regret(repeat[arm].card, oracle)),
					),
				})),
			};
		},
	);
	const reduction = (sample: typeof measurements) =>
		1 -
		sum(sample.map((row) => row.arms.candidate.mse)) /
			sum(sample.map((row) => row.arms.control.mse));
	const essGain = (sample: typeof measurements) =>
		mean(sample.map((row) => row.arms.candidate.ess - row.arms.control.ess));
	return {
		boards: input.length,
		arms: byArm((arm) => ({
			mse: mean(measurements.map((row) => row.arms[arm].mse)),
			halfMse: [0, 1].map((half) =>
				mean(
					measurements.map((row) =>
						required(row.arms[arm].halfMse[half], "reference half MSE"),
					),
				),
			),
			ess: mean(measurements.map((row) => row.arms[arm].ess)),
			refRegret: mean(measurements.map((row) => row.arms[arm].refRegret)),
			oracleRegret: mean(measurements.map((row) => row.arms[arm].oracleRegret)),
			work: searchWork(
				input.flatMap(({ repeats }) => repeats.map((repeat) => repeat[arm])),
			),
		})),
		referenceHalfMse: mean(measurements.map((row) => row.referenceHalfMse)),
		referenceWork: searchWork(input.flatMap(({ reference }) => reference)),
		oracleDds: input.length,
		changed: sum(measurements.map(({ changes }) => changes)),
		mseRegressions: measurements.filter(
			(row) => row.arms.candidate.mse > row.arms.control.mse,
		).length,
		mseTies: measurements.filter(
			(row) => row.arms.candidate.mse === row.arms.control.mse,
		).length,
		reduction: {
			point: reduction(measurements),
			lower95: lower95(measurements, reduction),
		},
		essGain: {
			point: essGain(measurements),
			lower95: lower95(measurements, essGain),
		},
	};
}
function measureGames(input: Pair[]) {
	return {
		boards: input.length,
		imp: summarize(input.map(({ imp }) => imp)),
		changed: input.filter(
			({ control, candidate }) =>
				control.opening.card !== candidate.opening.card,
		).length,
		changedButTied: input.filter(
			({ control, candidate, imp }) =>
				imp === 0 && control.opening.card !== candidate.opening.card,
		).length,
		arms: byArm((arm) => {
			const results = input.map((row) => row[arm]);
			return {
				opening: searchWork(results.map(({ opening }) => opening)),
				dds: sum(results.map(({ work }) => work.dds)),
				proposals: sum(results.map(({ work }) => work.proposals)),
				seconds: sum(results.map(({ work }) => work.ms)) / 1000,
			};
		}),
	};
}
const evaluate = (data: typeof rows) =>
	mode === "accuracy"
		? measureAccuracy(data as Accuracy[])
		: measureGames(data as Pair[]);
console.log(
	JSON.stringify(
		{
			mode,
			wallSeconds,
			elapsedBoardSeconds: sum(rows.map(({ ms }) => ms)) / 1000,
			fixtureDraws: sum(rows.map(({ draws }) => draws)),
			combined: evaluate(rows),
			notrump: evaluate(rows.filter(({ strain }) => strain === "NT")),
			suit: evaluate(rows.filter(({ strain }) => strain !== "NT")),
		},
		null,
		2,
	),
);
