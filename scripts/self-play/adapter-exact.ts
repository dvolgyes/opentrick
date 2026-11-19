import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Dds, loadDds } from "bridge-dds";
import { DdsSolver } from "../../src/bot/dds-solver";
import type { Card } from "../../src/bridge/cards";
import {
	applyAction,
	boardStatus,
	legalActions,
} from "../../src/bridge/engine";
import { makeBoard } from "./arena";

type Solve = DdsSolver["solve"];
type NativeSolve = Dds["SolveBoardPBN"];
type NativeArgs = Parameters<NativeSolve>;
type NativeResult = ReturnType<NativeSolve>;
type SolverClass = typeof DdsSolver;
type Variant = "baseline" | "encoding" | "output" | "both";
const variants: readonly Variant[] = ["baseline", "encoding", "output", "both"];
const baselineSource = execFileSync(
	"git",
	["show", "b2858bff0d:src/bot/dds-solver.ts"],
	{ encoding: "utf8", cwd: new URL("../..", import.meta.url) },
);

function replace(source: string, before: string, after: string): string {
	assert.equal(source.split(before).length, 2, before);
	return source.replace(before, after);
}

function variantSource(variant: Variant): string {
	let source = baselineSource;
	if (variant === "encoding" || variant === "both") {
		source = replace(
			source,
			"const cardCodes",
			`function rankStrings(start: number, count: number): readonly string[] {
	return Array.from({ length: 1 << count }, (_, mask) => {
		let ranks = "";
		for (let bit = 0; bit < count; bit++) {
			if (mask & (1 << bit)) ranks += RANKS[start + bit];
		}
		return ranks;
	});
}

const highRanks = rankStrings(0, 7);
const lowRanks = rankStrings(7, 6);

const cardCodes`,
		);
		source = replace(
			source,
			`				let ranks = handRanks[suit] ?? 0;
				while (ranks !== 0) {
					remainCards += RANKS[31 - Math.clz32(ranks & -ranks)];
					ranks &= ranks - 1;
				}`,
			`				const ranks = handRanks[suit] ?? 0;
				remainCards += highRanks[ranks & 127] + lowRanks[ranks >>> 7];`,
		);
	}
	if (variant === "output" || variant === "both") {
		source = replace(
			source,
			`			for (let rank = 2; rank <= 14; rank++) {
				if (
					rank === result.rank[i] ||
					((result.equals[i] ?? 0) & (1 << rank)) !== 0
				) {
					const value = RANKS[14 - rank];
					if (value) scores.set(\x60\x24{suit}\x24{value}\x60, score);
				}
			}`,
			`			const rank = result.rank[i];
			let ranks = (result.equals[i] ?? 0) & 0x7ffc;
			if (
				rank !== undefined &&
				Number.isInteger(rank) &&
				rank >= 2 &&
				rank <= 14
			)
				ranks |= 1 << rank;
			const suitOffset = (suitIndex ?? 0) * RANKS.length;
			while (ranks !== 0) {
				const card = DECK[suitOffset + Math.clz32(ranks & -ranks) - 17];
				if (card) scores.set(card, score);
				ranks &= ranks - 1;
			}`,
		);
	}
	return source;
}

async function loadVariant(
	directory: string,
	variant: Variant,
): Promise<SolverClass> {
	const source = variantSource(variant)
		.replace('"bridge-dds"', JSON.stringify(import.meta.resolve("bridge-dds")))
		.replace(
			'"../bridge/cards"',
			JSON.stringify(new URL("../../src/bridge/cards.ts", import.meta.url)),
		)
		.replace(
			'"../protocol"',
			JSON.stringify(new URL("../../src/protocol.ts", import.meta.url)),
		);
	const path = join(directory, `${variant}.mts`);
	await writeFile(path, source);
	const module = await import(pathToFileURL(path).href);
	return module.DdsSolver;
}

function bind(Solver: SolverClass, SolveBoardPBN: NativeSolve): Solve {
	const solver: DdsSolver = Reflect.construct(Solver, [{ SolveBoardPBN }]);
	return solver.solve.bind(solver);
}

function position(board: ReturnType<typeof makeBoard>) {
	const status = boardStatus(board);
	assert.equal(status.phase, "play");
	if (status.phase !== "play") throw new Error("not a play position");
	return {
		status,
		args: [
			status.remaining,
			status.contract.strain,
			status.current,
		] satisfies Parameters<Solve>,
		legal: legalActions(board, status.actor).flatMap((action) =>
			action.type === "play" ? [action.card] : [],
		),
	};
}

function orderedCheck(map: ReturnType<Solve>, expected: ReturnType<Solve>) {
	assert.deepEqual([...map], [...expected]);
}

function choose(map: ReturnType<Solve>): Card {
	let best: Card | undefined;
	let score = -1;
	for (const [card, value] of map) {
		if (value <= score) continue;
		best = card;
		score = value;
	}
	assert.ok(best);
	return best;
}

async function loadVariants() {
	const directory = await mkdtemp(join(tmpdir(), "opentrick-adapter-"));
	try {
		return new Map(
			await Promise.all(
				variants.map(
					async (name) => [name, await loadVariant(directory, name)] as const,
				),
			),
		);
	} finally {
		await rm(directory, { recursive: true });
	}
}

const classes = await loadVariants();
const constructors = variants.map((name) => {
	const Solver = classes.get(name);
	assert.ok(Solver);
	return Solver;
});
const dds = new Dds(await loadDds());
const native = dds.SolveBoardPBN.bind(dds);
const [baseline] = constructors;
assert.ok(baseline);
const corpus: { args: Parameters<Solve>; result: NativeResult }[] = [];
const signatures = new Set<string>();
const work = [];
for (const startPly of [0, 12, 28, 44]) {
	const counts = {
		startPly,
		rotations: [0, 0, 0, 0],
		encodedRanks: 0,
		splitLookups: 0,
		baselineRankProbes: 0,
		sparseRankScans: 0,
		baselineTemplates: 0,
	};
	for (let i = 0; i < 60; i++) {
		const index = corpus.length;
		const board = makeBoard(10300000 + index, index + 1, startPly + (i % 4));
		const signature = JSON.stringify(board.deal);
		assert.ok(!signatures.has(signature));
		signatures.add(signature);
		const { args, legal } = position(board);
		const captures: { args: NativeArgs; result: NativeResult }[] = [];
		const expected = bind(baseline, (...nativeArgs) => {
			const result = native(...nativeArgs);
			captures.push({ args: nativeArgs, result });
			return result;
		})(...args);
		assert.equal(captures.length, 1);
		const capture = captures[0];
		assert.ok(capture);
		const bytes = JSON.stringify(capture.args);
		assert.deepEqual([...expected.keys()].sort(), [...legal].sort());
		for (const Solver of [...constructors, DdsSolver]) {
			const actual = bind(Solver, (...input) => {
				assert.equal(JSON.stringify(input), bytes);
				return capture.result;
			})(...args);
			orderedCheck(actual, expected);
		}
		const first = capture.args[0].first;
		counts.rotations[first] = (counts.rotations[first] ?? 0) + 1;
		counts.encodedRanks += capture.args[0].remainCards.replace(
			/[^AKQJT98765432]/g,
			"",
		).length;
		counts.splitLookups += 32;
		counts.baselineRankProbes += 13 * capture.result.cards;
		for (let j = 0; j < capture.result.cards; j++) {
			const rank = capture.result.rank[j];
			assert.ok(rank !== undefined && rank >= 2 && rank <= 14);
			let mask = ((capture.result.equals[j] ?? 0) | (1 << rank)) & 0x7ffc;
			while (mask) {
				counts.sparseRankScans++;
				counts.baselineTemplates++;
				mask &= mask - 1;
			}
		}
		corpus.push({ args, result: capture.result });
	}
	work.push(counts);
}
console.log(JSON.stringify({ work }));

const sample = corpus[0];
assert.ok(sample);
const invalidRanks = [
	undefined,
	-30,
	0,
	1,
	2,
	14,
	15,
	34,
	46,
	2.5,
	NaN,
	Infinity,
];
const equalMasks = [
	undefined,
	0,
	-1,
	2 ** 32 + 16,
	Infinity,
	0x80008003,
	0x6004,
];
for (const rank of invalidRanks) {
	for (const equals of equalMasks) {
		const replay = (): NativeResult => ({
			...sample.result,
			cards: 1,
			rank: [rank as number],
			equals: [equals as number],
		});
		for (const Solver of constructors) {
			orderedCheck(
				bind(Solver, replay)(...sample.args),
				bind(baseline, replay)(...sample.args),
			);
		}
	}
}

let cursor = 0;
let sink = 0;
const replay: NativeSolve = (arg, target, solutions, mode) => {
	const row = corpus[cursor];
	assert.ok(row);
	sink +=
		arg.remainCards.length + arg.first + arg.trump + target + solutions + mode;
	return row.result;
};
const run = (solve: Solve, repetitions: number) => {
	const start = performance.now();
	for (let i = 0; i < repetitions; i++) {
		for (const row of corpus) {
			const map = solve(...row.args);
			for (const [card, score] of map) sink += card.charCodeAt(1) + score;
			cursor++;
		}
		cursor = 0;
	}
	return performance.now() - start;
};

function measure(callback: NativeSolve, rounds: number, repetitions: number) {
	const solves = constructors.map((Solver) => bind(Solver, callback));
	for (const solve of solves) run(solve, callback === replay ? 12 : 1);
	const rows: number[][] = [];
	for (let round = 0; round < rounds; round++) {
		const order = [0, 1, 2, 3].map((index) => (index + (round >> 1)) % 4);
		if (round % 2) order.reverse();
		const row: number[] = [];
		for (const index of order) {
			const solve = solves[index];
			assert.ok(solve);
			row[index] = run(solve, repetitions);
		}
		rows.push(row);
	}
	return rows;
}

function play(solve: Solve, board: ReturnType<typeof makeBoard>) {
	const scores = [];
	while (board.cards.length < 52) {
		const { status, args, legal } = position(board);
		const map = solve(...args);
		assert.deepEqual([...map.keys()].sort(), [...legal].sort());
		const card = choose(map);
		const next = applyAction(board, status.actor, { type: "play", card });
		assert.ok(next.ok);
		scores.push([...map]);
		board = next.board;
	}
	return { cards: board.cards, scores };
}

const selected = process.argv[2];
if (selected) {
	const Solver =
		selected === "installed" ? DdsSolver : classes.get(selected as Variant);
	assert.ok(Solver);
	if (selected === "installed") {
		const variant = process.argv[3] as Variant;
		assert.ok(variants.includes(variant));
		assert.equal(
			await readFile(
				new URL("../../src/bot/dds-solver.ts", import.meta.url),
				"utf8",
			),
			variantSource(variant),
		);
	}
	const incumbent = bind(baseline, native);
	const candidate = bind(Solver, native);
	for (let i = 0; i < 24; i++) {
		const board = makeBoard(10400000 + i, i + 1, 0);
		assert.deepEqual(play(incumbent, board), play(candidate, board));
	}
	console.log(
		JSON.stringify({ pairedFullGames: 24, fullGamePlies: 24 * 52, selected }),
	);
} else {
	const isolated = measure(replay, 16, 80);
	console.log(JSON.stringify({ variants, isolated, sink }));
	const roundtrip = measure(native, 8, 1);
	console.log(JSON.stringify({ variants, roundtrip, sink }));
}
