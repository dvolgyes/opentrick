import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DdsSolver } from "../../src/bot/dds-solver";
import { obviousPlay } from "../../src/bot/obvious-play";
import { isPlayTimeMs } from "../../src/bot/play-budget";
import { analyzeLocalPlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { type Board, boardStatus } from "../../src/bridge/engine";
import type { Contract, Vulnerability } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS } from "../../src/protocol";
import {
	makeBoard,
	type PlayedTable,
	type PlayPolicy,
	playTable,
	random,
} from "./arena";
import { mixedDeal } from "./mixed-deals";
import { searchMixed } from "./mixed-tree";

const count = 80;
const dealStart = 1_720_000_000;
const searchStart = 1_721_000_000;
const contrasts = [
	["plain", "base"],
	["biased", "base"],
	["biased", "plain"],
] as const;

type Policy = (typeof contrasts)[number][number];

type PolicyWork = ReturnType<typeof emptyWork>;

interface MixedPair {
	readonly candidate: "plain" | "biased";
	readonly control: "plain" | "base";
	readonly ns: PlayedTable;
	readonly ew: PlayedTable;
	readonly imps: number;
	readonly work: Readonly<Partial<Record<Policy, PolicyWork>>>;
}

export interface MixedRow {
	readonly index: number;
	readonly seed: number;
	readonly number: number;
	readonly contract: Contract;
	readonly vulnerability: Vulnerability;
	readonly distribution: string;
	readonly pairs: readonly MixedPair[];
}

interface RunOptions {
	readonly dealSeed: number;
	readonly searchSeed: number;
	readonly timeMs: number;
	readonly iterations?: number;
}

function emptyWork() {
	return {
		decisions: 0,
		obvious: 0,
		searches: 0,
		elapsedMs: 0,
		peakMs: 0,
		opening: 0,
		defense: 0,
		declarer: 0,
		ddsCalls: 0,
		simulations: 0,
		rootCoverage: 0,
		rootLegal: 0,
		incomplete: 0,
		bootstrapOnly: 0,
		revisits: 0,
	};
}

function warmInput() {
	const board = makeBoard(42, 1, 42);
	const { actor } = boardStatus(board);
	if (!actor) throw new Error("missing DDS warm-up actor");
	const position = playPosition(board, actor);
	return [
		createHandSampler(position.view)(random(43)),
		position.contract.strain,
		position.current,
	] as const;
}

async function makePolicy(
	name: Policy,
	work: PolicyWork,
	warm: ReturnType<typeof warmInput>,
	{ timeMs, iterations }: RunOptions,
): Promise<PlayPolicy> {
	const solver = await DdsSolver.create();
	solver.solve(...warm);
	if (name === "base") {
		const solve = solver.solve.bind(solver);
		solver.solve = (...args) => {
			work.ddsCalls++;
			return solve(...args);
		};
	}
	return (position, rng) => {
		work.decisions++;
		const obvious = obviousPlay(position);
		if (obvious !== undefined) {
			work.obvious++;
			return obvious;
		}
		work.searches++;
		if (position.view.plays.length === 0) work.opening++;
		else if (position.view.seat === position.contract.declarer) work.declarer++;
		else work.defense++;
		const start = performance.now();
		if (name === "base") {
			const result = analyzeLocalPlay(position, solver, {
				timeMs,
				random: rng,
			});
			const elapsedMs = performance.now() - start;
			work.elapsedMs += elapsedMs;
			work.peakMs = Math.max(work.peakMs, elapsedMs);
			work.simulations += result.samples;
			work.rootCoverage += result.evaluations.length;
			work.rootLegal += position.legal.length;
			if (result.evaluations.length < position.legal.length) work.incomplete++;
			return result.card;
		}
		const result = searchMixed(
			position,
			solver,
			rng,
			name === "biased",
			timeMs,
			iterations,
		);
		const elapsedMs = performance.now() - start;
		work.elapsedMs += elapsedMs;
		work.peakMs = Math.max(work.peakMs, elapsedMs);
		work.ddsCalls += result.ddsCalls;
		work.simulations += result.simulations;
		work.revisits += result.revisits;
		if (result.simulations === 0) work.bootstrapOnly++;
		work.rootCoverage += result.rootCoverage;
		work.rootLegal += result.rootLegal;
		if (result.rootCoverage < result.rootLegal) work.incomplete++;
		return result.card;
	};
}

async function runPair(
	board: Board,
	[candidate, control]: (typeof contrasts)[number],
	candidateNSFirst: boolean,
	warm: ReturnType<typeof warmInput>,
	options: RunOptions,
): Promise<MixedPair> {
	const candidateWork = emptyWork();
	const controlWork = emptyWork();
	const room = async (candidateNS: boolean) => {
		const ns = await makePolicy(
			candidateNS ? candidate : control,
			candidateNS ? candidateWork : controlWork,
			warm,
			options,
		);
		const ew = await makePolicy(
			candidateNS ? control : candidate,
			candidateNS ? controlWork : candidateWork,
			warm,
			options,
		);
		return playTable(board, ns, ew, options.searchSeed);
	};
	const first = await room(candidateNSFirst);
	const second = await room(!candidateNSFirst);
	const [ns, ew] = candidateNSFirst ? [first, second] : [second, first];
	return {
		candidate,
		control,
		ns,
		ew,
		imps: scoreDifferenceToImps(ns.scoreNS - ew.scoreNS),
		work: { [candidate]: candidateWork, [control]: controlWork },
	};
}

async function runBoard(index: number, options: RunOptions): Promise<MixedRow> {
	const board = mixedDeal(index, options.dealSeed);
	const status = boardStatus(board);
	if (status.phase !== "play" || board.cards.length !== 0)
		throw new Error("mixed fixture must start at opening lead");
	const warm = warmInput();
	const offset = index % contrasts.length;
	const pairs: MixedPair[] = [];
	for (const contrast of [
		...contrasts.slice(offset),
		...contrasts.slice(0, offset),
	])
		pairs.push(await runPair(board, contrast, index % 2 === 0, warm, options));
	return {
		index,
		seed: options.dealSeed,
		number: board.number,
		contract: status.contract,
		vulnerability: board.vulnerability,
		distribution: createHash("sha256")
			.update(
				SEATS.map((seat) => [...board.deal[seat]].sort().join("")).join("|"),
			)
			.digest("hex"),
		pairs,
	};
}

export function runMixed(
	index: number,
	options: RunOptions,
): Promise<MixedRow> {
	if (!Number.isInteger(index) || index < 0 || index >= count)
		throw new Error("invalid board index");
	for (const seed of [options.dealSeed, options.searchSeed]) {
		if (
			!Number.isInteger(seed) ||
			seed < 0 ||
			seed >= 2 ** 32 ||
			[dealStart, searchStart].some(
				(start) => seed >= start && seed < start + count,
			)
		)
			throw new Error("invalid or reserved development seed");
	}
	if (!isPlayTimeMs(options.timeMs))
		throw new Error(
			"play time must be an integer from 1 to 60000 milliseconds",
		);
	const { iterations } = options;
	if (
		iterations !== undefined &&
		(!Number.isInteger(iterations) || iterations < 1 || iterations > 4096)
	)
		throw new Error("iteration limit must be an integer from 1 to 4096");
	return runBoard(index, options);
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const args = process.argv.slice(2);
	const [start, length] = args.map(Number);
	if (
		args.length !== 2 ||
		!args.every((value) => /^\d+$/.test(value)) ||
		start === undefined ||
		length === undefined ||
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(length) ||
		start >= count ||
		length < 1 ||
		length > count - start
	)
		throw new Error(
			"usage: mixed-run.ts START COUNT (0 <= START < 80, 1 <= COUNT <= 80 - START)",
		);
	for (let index = start; index < start + length; index++) {
		const row = await runBoard(index, {
			dealSeed: dealStart + index,
			searchSeed: searchStart + index,
			timeMs: 100,
		});
		console.log(JSON.stringify(row));
	}
}
