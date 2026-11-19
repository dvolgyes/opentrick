import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isCard } from "../../src/bridge/cards";
import { scoreContract } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { random } from "./arena";
import { signP } from "./statistics";

const BOARDS = 256;
const RESAMPLES = 20_000;
const LOWER_INDEX = 166;
const ALPHA = 0.05 / 6;
const ARMS = ["base", "take", "plain", "biased"] as const;
const CONTRASTS = [
	["take", "base"],
	["plain", "base"],
	["plain", "take"],
	["biased", "base"],
	["biased", "take"],
	["biased", "plain"],
] as const;
const WORK = [
	"elapsedMs",
	"wallMs",
	"iterations",
	"nodes",
	"revisits",
] as const;

type Arm = (typeof ARMS)[number];
type Work = Record<(typeof WORK)[number], number>;

function record(value: unknown, path: string): Record<string, unknown> {
	assert(
		value && typeof value === "object" && !Array.isArray(value),
		`${path} must be an object`,
	);
	return value as Record<string, unknown>;
}

function number(
	value: unknown,
	path: string,
	valid: (value: number) => boolean,
): number {
	assert(
		typeof value === "number" && Number.isFinite(value) && valid(value),
		`${path} is invalid`,
	);
	return value;
}

function parseRows(jsonl: string) {
	const lines = jsonl.replace(/\r?\n$/, "").split(/\r?\n/);
	assert.equal(lines.length, BOARDS, `expected exactly ${BOARDS} boards`);
	const distributions = new Set<string>();
	return lines.map((line, index) => {
		const path = `board ${index}`;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch (cause) {
			throw new Error(`${path}: invalid JSON`, { cause });
		}
		const row = record(value, path);
		assert.equal(row.index, index, `${path}: unexpected index`);
		assert.equal(row.seed, 1_680_000_000 + index, `${path}: off-schedule seed`);
		const { distribution, fork, vulnerability } = row;
		assert(
			typeof distribution === "string" &&
				/^[0-9a-f]{64}$/.test(distribution) &&
				!distributions.has(distribution),
			`${path}: missing or duplicate distribution`,
		);
		distributions.add(distribution);
		assert.equal(row.contract, "3NT", `${path}: unexpected contract`);
		assert(
			vulnerability === "none" ||
				vulnerability === "NS" ||
				vulnerability === "EW" ||
				vulnerability === "both",
			`${path}: invalid vulnerability`,
		);
		assert(typeof fork === "boolean", `${path}: invalid fork flag`);
		const forkData = fork ? record(row.forkData, `${path}.forkData`) : null;
		if (forkData) {
			assert(
				isCard(forkData.ace) &&
					isCard(forkData.duck) &&
					forkData.ace !== forkData.duck &&
					typeof forkData.bias === "boolean" &&
					(forkData.ply === 3 || forkData.ply === 7 || forkData.ply === 11),
				`${path}: invalid fork data`,
			);
		} else {
			assert.equal(row.forkData, null, `${path}: non-fork has fork data`);
		}
		const arms = {} as Record<
			Arm,
			Work & {
				card: string | null;
				score: number;
				made: boolean;
				tricks: number;
			}
		>;
		for (const arm of ARMS) {
			const armPath = `${path}.${arm}`;
			const data = record(row[arm], armPath);
			const { card, made } = data;
			assert(card === null || isCard(card), `${armPath}: invalid card`);
			assert.equal(
				card !== null,
				fork,
				`${armPath}: card must be present only at a fork`,
			);
			const tricks = number(
				data.declarerTricks,
				`${armPath}.declarerTricks`,
				(n) => Number.isInteger(n) && n >= 0 && n <= 13,
			);
			const score = number(
				data.score,
				`${armPath}.score`,
				Number.isSafeInteger,
			);
			assert(
				typeof made === "boolean" && made === tricks >= 9,
				`${armPath}: inconsistent make result`,
			);
			assert.equal(
				score,
				scoreContract(
					{ level: 3, strain: "NT", declarer: "N", doubling: "" },
					vulnerability,
					tricks,
				),
				`${armPath}: inconsistent score`,
			);
			const work = {} as Work;
			for (const key of WORK) {
				const time = key === "elapsedMs" || key === "wallMs";
				work[key] = number(data[key], `${armPath}.${key}`, (n) =>
					fork ? n >= 0 && (time || Number.isSafeInteger(n)) : n === 0,
				);
			}
			arms[arm] = { card, score, made, tricks, ...work };
		}
		if (forkData)
			assert.equal(
				arms.take.card,
				forkData.ace,
				`${path}: take must play the ace`,
			);
		for (const [candidate, control] of CONTRASTS) {
			const a = arms[candidate];
			const b = arms[control];
			if (a.card === b.card) {
				const reason = fork ? "identical root choices" : "non-fork outcomes";
				assert(
					a.score === b.score && a.made === b.made && a.tricks === b.tricks,
					`${path}: ${reason} disagree (${candidate}-${control})`,
				);
			}
		}
		return { fork, arms };
	});
}

function bootstrapLowers(imps: readonly Int8Array[]): number[] {
	const next = random(0x484f4c44);
	const sums = imps.map(() => new Int16Array(RESAMPLES));
	const counts = new Uint16Array(BOARDS);
	for (let trial = 0; trial < RESAMPLES; trial++) {
		counts.fill(0);
		for (let draw = 0; draw < BOARDS; draw++) {
			const index = Math.floor(next() * BOARDS);
			counts[index] = (counts[index] as number) + 1;
		}
		for (const [contrast, values] of imps.entries()) {
			let total = 0;
			for (let board = 0; board < BOARDS; board++)
				total += (counts[board] as number) * (values[board] as number);
			(sums[contrast] as Int16Array)[trial] = total;
		}
	}
	return sums.map((values) => (values.sort()[LOWER_INDEX] as number) / BOARDS);
}

export function scoreHoldUp(jsonl: string) {
	const rows = parseRows(jsonl);
	const arms = {} as Record<
		Arm,
		Work & { makes: number; changedChoices: number }
	>;
	for (const arm of ARMS) {
		const totals = {
			makes: 0,
			changedChoices: 0,
			elapsedMs: 0,
			wallMs: 0,
			iterations: 0,
			nodes: 0,
			revisits: 0,
		};
		for (const row of rows) {
			const result = row.arms[arm];
			totals.makes += Number(result.made);
			totals.changedChoices += Number(result.card !== row.arms.base.card);
			for (const key of WORK) totals[key] += result[key];
		}
		arms[arm] = totals;
	}
	const pairedImps = CONTRASTS.map(([candidate, control]) =>
		Int8Array.from(rows, ({ arms }) =>
			scoreDifferenceToImps(arms[candidate].score - arms[control].score),
		),
	);
	const lowers = bootstrapLowers(pairedImps);
	const contrasts = CONTRASTS.map(([candidate, control], index) => {
		let wins = 0;
		let losses = 0;
		let total = 0;
		for (const imp of pairedImps[index] as Int8Array) {
			wins += Number(imp > 0);
			losses += Number(imp < 0);
			total += imp;
		}
		const lower = lowers[index] as number;
		const p = signP(wins, losses);
		const changedChoices = rows.filter(
			({ arms }) => arms[candidate].card !== arms[control].card,
		).length;
		return {
			candidate,
			control,
			wins,
			losses,
			ties: BOARDS - wins - losses,
			total,
			mean: total / BOARDS,
			makeDifference: arms[candidate].makes - arms[control].makes,
			changedChoices,
			lower,
			signP: p,
			passed: lower > 0.05 && wins + losses >= 12 && p < ALPHA,
		};
	});
	const [takeBase, plainBase, plainTake, biasedBase, biasedTake, biasedPlain] =
		contrasts.map(({ passed }) => passed);
	const policy =
		biasedBase && biasedTake && biasedPlain
			? "biased"
			: plainBase && plainTake
				? "plain"
				: takeBase
					? "take"
					: "incumbent";
	return {
		boards: BOARDS,
		forks: rows.filter(({ fork }) => fork).length,
		arms,
		contrasts,
		policy,
	};
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const path = process.argv[2];
	assert(path, "usage: hold-up-score.ts <canonical-jsonl>");
	console.log(
		JSON.stringify(scoreHoldUp(await readFile(path, "utf8")), null, 2),
	);
}
