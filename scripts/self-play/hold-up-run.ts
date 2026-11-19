import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DdsSolver } from "../../src/bot/dds-solver";
import { obviousPlay } from "../../src/bot/obvious-play";
import { analyzeLocalPlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import type { Card } from "../../src/bridge/cards";
import { boardStatus } from "../../src/bridge/engine";
import type { Vulnerability } from "../../src/bridge/rules";
import { SEATS } from "../../src/protocol";
import { type PlayedTable, type PlayPolicy, playTable, random } from "./arena";
import { advanceHoldUpBoard, holdUpFork, makeHoldUpBoard } from "./hold-up";
import { searchHoldUp } from "./hold-up-tree";

const count = 256;
const dealStart = 1_680_000_000;
const searchStart = 1_681_000_000;
const incumbentTimeMs = 5_000;
const timedOrders = [
	["base", "plain", "biased"],
	["base", "biased", "plain"],
	["plain", "base", "biased"],
	["plain", "biased", "base"],
	["biased", "base", "plain"],
	["biased", "plain", "base"],
] as const;

type ArmName = (typeof timedOrders)[number][number] | "take";

interface Timing {
	readonly elapsedMs: number;
	readonly wallMs: number;
	readonly iterations: number;
	readonly nodes: number;
	readonly revisits: number;
	readonly root: readonly { card: Card; visits: number; mean: number }[];
}

interface TimedMove extends Timing {
	readonly card: Card | null;
}

export interface HoldUpArm extends TimedMove {
	readonly score: number;
	readonly made: boolean;
	readonly declarerTricks: number;
}

export interface HoldUpRow {
	readonly index: number;
	readonly seed: number;
	readonly distribution: string;
	readonly contract: "3NT";
	readonly vulnerability: Vulnerability;
	readonly fork: boolean;
	readonly forkData:
		| (NonNullable<ReturnType<typeof holdUpFork>> & { ply: number })
		| null;
	readonly base: HoldUpArm;
	readonly take: HoldUpArm;
	readonly plain: HoldUpArm;
	readonly biased: HoldUpArm;
}

interface RunOptions {
	readonly dealSeed: number;
	readonly searchSeed: number;
	readonly timeMs: number;
	readonly iterations?: number;
}

const untimed: Timing = {
	elapsedMs: 0,
	wallMs: 0,
	iterations: 0,
	nodes: 0,
	revisits: 0,
	root: [],
};

function report(move: TimedMove, table: PlayedTable): HoldUpArm {
	return {
		...move,
		score: table.scoreNS,
		made: table.declarerTricks >= 9,
		declarerTricks: table.declarerTricks,
	};
}

function fixedPolicy(solver: DdsSolver): PlayPolicy {
	return (position, rng) => {
		const obvious = obviousPlay(position);
		if (obvious !== undefined) return obvious;
		const result = analyzeLocalPlay(position, solver, {
			samples: 8,
			exactLimit: 0,
			timeMs: incumbentTimeMs,
			random: rng,
		});
		if (
			result.samples !== 8 &&
			!(result.samples === 1 && createHandSampler(position.view).uniqueLayout)
		)
			throw new Error(
				`Fixed policy returned ${result.samples} of 8 samples at ply ${position.view.plays.length}`,
			);
		return result.card;
	};
}

async function warmedSolvers() {
	const warmBoard = makeHoldUpBoard(0, 42);
	const { actor } = boardStatus(warmBoard);
	if (!actor) throw new Error("missing warm-up actor");
	const position = playPosition(warmBoard, actor);
	const hands = createHandSampler(position.view)(random(43));
	const base = await DdsSolver.create();
	const plain = await DdsSolver.create();
	const biased = await DdsSolver.create();
	for (const solver of [base, plain, biased])
		solver.solve(hands, "NT", position.current);
	return { base, plain, biased };
}

async function runBoard(
	index: number,
	options: RunOptions,
): Promise<HoldUpRow> {
	const { dealSeed, searchSeed, timeMs, iterations } = options;
	let board = makeHoldUpBoard(index, dealSeed);
	const row = {
		index,
		seed: dealSeed,
		distribution: createHash("sha256")
			.update(SEATS.map((seat) => board.deal[seat].join("")).join("|"))
			.digest("hex"),
		contract: "3NT" as const,
		vulnerability: board.vulnerability,
	};
	const policy = fixedPolicy(await DdsSolver.create());
	for (let ply = 0; ply < 12; ply++) {
		const { actor } = boardStatus(board);
		if (!actor) throw new Error("missing prefix actor");
		const position = playPosition(board, actor);
		const fork = holdUpFork(position);
		const move = ply * 4 + SEATS.indexOf(actor);
		const rng = () => random(searchSeed ^ Math.imul(move + 1, 0x9e3779b9));
		if (!fork) {
			board = advanceHoldUpBoard(board, actor, {
				type: "play",
				card: policy(position, rng()),
			});
			continue;
		}
		const order = timedOrders[index % timedOrders.length];
		if (!order) throw new Error("invalid timed arm order");
		const solvers = await warmedSolvers();
		const moves = new Map<ArmName, TimedMove>();
		for (const arm of order) {
			const source = rng();
			const start = performance.now();
			if (arm === "base") {
				const result = analyzeLocalPlay(position, solvers.base, {
					timeMs,
					random: source,
				});
				moves.set(arm, {
					...untimed,
					card: result.card,
					elapsedMs: result.elapsedMs,
					wallMs: performance.now() - start,
					iterations: result.samples,
				});
			} else {
				const result = searchHoldUp(
					position,
					solvers[arm],
					source,
					arm === "biased",
					timeMs,
					iterations,
				);
				moves.set(arm, { ...result, wallMs: performance.now() - start });
			}
		}
		moves.set("take", { ...untimed, card: fork.ace });
		const outcomes = new Map<Card, PlayedTable>();
		const complete = (name: ArmName) => {
			const choice = moves.get(name);
			if (!choice?.card) throw new Error(`missing ${name} root move`);
			let outcome = outcomes.get(choice.card);
			if (!outcome) {
				const next = advanceHoldUpBoard(board, actor, {
					type: "play",
					card: choice.card,
				});
				outcome = playTable(next, policy, policy, searchSeed);
				outcomes.set(choice.card, outcome);
			}
			return report(choice, outcome);
		};
		return {
			...row,
			fork: true,
			forkData: { ...fork, ply },
			base: complete("base"),
			take: complete("take"),
			plain: complete("plain"),
			biased: complete("biased"),
		};
	}
	const shared = report(
		{ ...untimed, card: null },
		playTable(board, policy, policy, searchSeed),
	);
	return {
		...row,
		fork: false,
		forkData: null,
		base: shared,
		take: shared,
		plain: shared,
		biased: shared,
	};
}

export function runHoldUp(
	index: number,
	options: RunOptions,
): Promise<HoldUpRow> {
	if (!Number.isInteger(index) || index < 0 || index >= count)
		throw new Error("invalid board index");
	for (const [seed, reserved] of [
		[options.dealSeed, dealStart],
		[options.searchSeed, searchStart],
	] as const) {
		if (
			!Number.isInteger(seed) ||
			seed < 0 ||
			seed >= 2 ** 32 ||
			(seed >= reserved && seed < reserved + count)
		)
			throw new Error("invalid or reserved development seed");
	}
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
			"usage: hold-up-run.ts START COUNT (0 <= START < 256, 1 <= COUNT <= 256 - START)",
		);
	for (let index = start; index < start + length; index++) {
		const row = await runBoard(index, {
			dealSeed: dealStart + index,
			searchSeed: searchStart + index,
			timeMs: incumbentTimeMs,
		});
		console.log(JSON.stringify(row));
	}
}
