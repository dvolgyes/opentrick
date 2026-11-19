import { createHash } from "node:crypto";
import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { obviousPlay } from "../../src/bot/obvious-play";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS } from "../../src/protocol";
import { type PlayPolicy, playTable, random } from "./arena";
import { competitiveDeal } from "./competitive-deals";
import { applyPrior, boardSearch } from "./defensive-search";
import { partnerOpening } from "./partner-opening";
import { partscoreDeal } from "./partscore-leads";
import { summarize } from "./statistics";

export const stages = { screen: 1_510_000_000, live: 1_520_000_000 } as const;
export type Stage = keyof typeof stages;
export const boards = 128;
export const rootMs = 5000;
export const layouts = 8;
export const alpha = 0.025;
const fixtures = [
	"competitive-nt",
	"competitive-major",
	"partscore-weak-leader",
	"partscore-stronger-leader",
] as const;
export const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function measure(solver: DoubleDummySolver, stage: Stage, i: number) {
	const start = performance.now();
	const seed = stages[stage] + i;
	const slot = i % 4;
	const number = 2 * Math.floor(i / 4) + (i % 2) + 1;
	const { board, hints, draws } = (slot < 2 ? competitiveDeal : partscoreDeal)(
		seed,
		number,
	);
	const status = boardStatus(board);
	if (status.phase !== "play" || board.cards.length !== 0)
		throw new Error("Not an opening position");
	const raw = playPosition(board, status.actor);
	const position = { ...raw, hints };
	const stream = seed ^ 0x28f5b13d;
	const root = analyzePlay(position, solver, {
		timeMs: rootMs,
		random: random(
			stream ^ Math.imul(1 + SEATS.indexOf(status.actor), 0x9e3779b9),
		),
	});
	if (
		root.samples < 2 ||
		root.elapsedMs < rootMs ||
		root.evaluations[0]?.card !== root.card ||
		root.evaluations.some((entry) => !Number.isFinite(entry.utility))
	) {
		throw new Error("Incomplete 5000ms opening analysis");
	}
	const suggestion = partnerOpening("standard", position, root.card);
	const choice = applyPrior(root.evaluations, suggestion);
	const sign = status.actor === "N" || status.actor === "S" ? 1 : -1;
	const fixed =
		stage === "screen" ? boardSearch(solver, layouts, hints) : undefined;
	const policy = fixed?.policy();
	const order =
		choice.card === root.card
			? []
			: i % 2 === 0
				? [root.card, choice.card]
				: [choice.card, root.card];
	const tables = order.map((lead) => {
		const decisions: {
			ply: number;
			timeMs: number;
			elapsedMs: number;
			samples: number;
		}[] = [];
		const continuation: PlayPolicy = (raw, rng) => {
			const ply = raw.view.plays.length;
			if (ply === 0) return lead;
			if (policy) return policy.play(raw, rng);
			const position = { ...raw, hints };
			const obvious = obviousPlay(position);
			if (obvious !== undefined) return obvious;
			const timeMs = ply >= 40 ? 2000 : rootMs;
			const result = analyzePlay(position, solver, { timeMs, random: rng });
			if (result.samples < 1)
				throw new Error(`No continuation samples at ply ${ply}`);
			decisions.push({
				ply,
				timeMs,
				elapsedMs: result.elapsedMs,
				samples: result.samples,
			});
			return result.card;
		};
		const start = performance.now();
		const table = playTable(board, continuation, continuation, stream);
		return {
			lead,
			...table,
			defenderPoints: sign * table.scoreNS,
			elapsedMs: performance.now() - start,
			decisions,
		};
	});
	const incumbent = tables.find((table) => table.lead === root.card);
	const candidate = tables.find((table) => table.lead === choice.card);
	if (order.length !== 0 && (!incumbent || !candidate))
		throw new Error("Missing paired table");
	const rawDifference =
		incumbent && candidate
			? candidate.defenderPoints - incumbent.defenderPoints
			: 0;
	return {
		stage,
		seed,
		slot,
		number,
		fixture: fixtures[slot],
		draws,
		stream,
		status,
		sign,
		dealHash: digest(SEATS.map((seat) => [...board.deal[seat]].sort())),
		root,
		suggestion: suggestion ?? null,
		choice,
		tables,
		fixed: fixed?.work ?? null,
		rawDifference,
		imps: scoreDifferenceToImps(rawDifference),
		elapsedMs: performance.now() - start,
	};
}

export type Row = ReturnType<typeof measure>;

function spread(values: readonly number[]) {
	return {
		count: values.length,
		sum: values.reduce((a, b) => a + b, 0),
		min: values.length ? Math.min(...values) : null,
		max: values.length ? Math.max(...values) : null,
	};
}

export function report(rows: readonly Row[]) {
	const strata = fixtures.map((fixture) => ({
		fixture,
		rows: rows.filter((row) => row.fixture === fixture),
	}));
	const imps = rows.map((row) => row.imps);
	const { lower95: _unstratified, ...stats } = summarize(imps);
	const rng = random(0x51f15eed);
	const complete = strata.every(
		(stratum) => stratum.rows.length === boards / fixtures.length,
	);
	let lower975: number | null = null;
	if (complete) {
		const resamples = Array.from({ length: 10_000 }, () => {
			let sum = 0;
			for (const { rows } of strata) {
				for (let i = 0; i < rows.length; i++) {
					const row = rows[Math.floor(rng() * rows.length)];
					if (!row) throw new Error("Missing resampled board");
					sum += row.imps;
				}
			}
			return sum / boards;
		}).sort((a, b) => a - b);
		const percentile = resamples[249];
		if (percentile === undefined)
			throw new Error("Missing bootstrap percentile");
		lower975 = percentile;
	}
	const counts = (sample: readonly Row[]) => ({
		changed: sample.filter((row) => row.tables.length === 2).length,
		identity: sample.filter((row) => row.tables.length === 0).length,
		positive: sample.filter((row) => row.imps > 0).length,
		negative: sample.filter((row) => row.imps < 0).length,
		zero: sample.filter((row) => row.imps === 0).length,
		totalImps: sample.reduce((sum, row) => sum + row.imps, 0),
		totalRaw: sample.reduce((sum, row) => sum + row.rawDifference, 0),
	});
	const tables = rows.flatMap((row) => row.tables);
	const decisions = tables.flatMap((table) => table.decisions);
	return {
		...stats,
		...counts(rows),
		lower975,
		complete,
		passes:
			lower975 === null
				? null
				: stats.wins + stats.losses >= 24 &&
					stats.signP < alpha &&
					lower975 > 0.05,
		fixtures: Object.fromEntries(
			strata.map((stratum) => [stratum.fixture, counts(stratum.rows)]),
		),
		elapsedMs: {
			boards: spread(rows.map((row) => row.elapsedMs)),
			roots: spread(rows.map((row) => row.root.elapsedMs)),
			tables: spread(tables.map((table) => table.elapsedMs)),
			liveSearches: spread(decisions.map((decision) => decision.elapsedMs)),
		},
		samples: {
			roots: spread(rows.map((row) => row.root.samples)),
			liveSearches: spread(decisions.map((decision) => decision.samples)),
			fixedDdsCalls: spread(
				rows.flatMap((row) => (row.fixed ? [row.fixed.ddsCalls] : [])),
			),
		},
	};
}
