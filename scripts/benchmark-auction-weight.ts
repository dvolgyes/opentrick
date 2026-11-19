import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DdsSolver, type DoubleDummySolver } from "../src/bot/dds-solver";
import type { analyzePlay, PlayAnalysis } from "../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../src/bot/play-position";
import { SUITS, suitOf } from "../src/bridge/cards";
import { dealCards } from "../src/bridge/deal";
import {
	applyAction,
	boardStatus,
	createBoard,
	legalActions,
} from "../src/bridge/engine";
import { countHandPoints, POINT_SYSTEMS } from "../src/bridge/hand-points";
import type { Call } from "../src/bridge/rules";
import { SEATS } from "../src/protocol";

const baseline = process.argv[2];
assert(
	baseline,
	"pass the absolute path to a checkout or archive of eb18b5e565",
);
const countBaseline = process.argv.includes("--count-baseline");
const samples = 32;
const timeMs = 60_000;

function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

function fixture(index: number) {
	const seed = Math.imul(index + 1, 0x9e3779b9) >>> 0;
	const rng = random(seed);
	const deal = dealCards((bound) => Math.floor(rng() * bound));
	let board = createBoard(index + 1, deal);
	const auction: readonly Call[] =
		index % 2 === 0
			? ["1NT", "P", "2C", "P", "2H", "P", "3NT", "P", "P", "P"]
			: ["1H", "P", "2H", "P", "3H", "P", "4H", "P", "P", "P"];
	for (const call of auction) {
		const actor = boardStatus(board).actor;
		assert(actor);
		const next = applyAction(board, actor, { type: "call", call });
		assert(next.ok);
		board = next.board;
	}
	for (let ply = 0; ply < 48; ply++) {
		const status = boardStatus(board);
		assert(status.phase === "play");
		const legal = legalActions(board, status.actor);
		if (ply >= 12 + (index % 13) && legal.length > 1) {
			const origin = {
				controller: "seat",
				system: index % 4 < 2 ? "hcp" : "hcp-corrected",
			} as const;
			const production = playPosition(
				board,
				status.actor,
				{},
				auction.map(() => origin),
			);
			const hidden = SEATS.filter(
				(seat) =>
					seat !== production.view.seat && seat !== production.view.dummy,
			);
			assert(hidden.some((seat) => status.remaining[seat].length > 1));
			const generated: PlayPosition["hints"][number][] = [];
			for (let round = 0; round < 3; round++) {
				for (const [offset, seat] of hidden.entries()) {
					const system =
						POINT_SYSTEMS[
							(Math.floor(index / 2) + offset + (round === 2 ? 2 : 0)) %
								POINT_SYSTEMS.length
						];
					assert(system);
					const points = countHandPoints(system, deal[seat]).total;
					const suit = SUITS[(index + round + offset) % SUITS.length];
					assert(suit);
					const length = deal[seat].filter(
						(card) => suitOf(card) === suit,
					).length;
					generated.push({
						seat,
						system,
						meaning: {
							range:
								round === 0
									? { min: Math.max(0, points - 1), max: points + 1 }
									: round === 1 || index % 4 === 1
										? { min: Math.max(0, points - 2) }
										: undefined,
							shape:
								round === 0
									? { kind: "cards", suit, min: length }
									: round === 1
										? { kind: "exact", suit, length }
										: index % 4 === 1
											? { kind: "balanced" }
											: { kind: "stopper", suit },
						},
					});
				}
			}
			const hiddenHints = (
				index % 2 === 0 ? production.hints : generated
			).filter(({ seat }) => hidden.includes(seat));
			const visibleHints: PlayPosition["hints"][number][] = SEATS.filter(
				(seat) => !hidden.includes(seat),
			).map((seat) => ({
				seat,
				system: "hcp-corrected",
				meaning: {
					range: { min: 40 },
					shape: { kind: "cards", suit: "S", min: 13 },
				},
			}));
			return {
				seed: seed ^ ply ^ 0xa5a5,
				hinted: {
					...production,
					hints: [
						...visibleHints.slice(0, 1),
						...hiddenHints,
						...visibleHints.slice(1),
					],
				},
				hiddenOnly: { ...production, hints: hiddenHints },
				plain: { ...production, hints: [] },
			};
		}
		const action = legal[Math.floor(rng() * legal.length)];
		assert(action);
		const next = applyAction(board, status.actor, action);
		assert(next.ok);
		board = next.board;
	}
	throw new Error(`no decision for seed ${seed}`);
}

const fixtures = Array.from({ length: 48 }, (_, index) => fixture(index));
const systems = new Set(
	fixtures.flatMap(({ hiddenOnly }) =>
		hiddenOnly.hints.map(({ system }) => system),
	),
);
assert.deepEqual(systems, new Set(POINT_SYSTEMS));
const cheapSolver = (position: PlayPosition): DoubleDummySolver => {
	const scores = new Map(
		position.legal.map((card, index) => [card, index % 5]),
	);
	return { solve: () => scores };
};

const archivedSource = await readFile(
	join(baseline, "src/bot/play-engine.ts"),
	"utf8",
);
const original = archivedSource
	.slice(
		archivedSource.indexOf("function layoutWeight("),
		archivedSource.indexOf("/** Perfect-information Monte Carlo"),
	)
	.trim();
assert(original.startsWith("function layoutWeight("));
const currentSource = await readFile(resolve("src/bot/play-engine.ts"), "utf8");
const control = currentSource
	.replace(
		/function (?:layoutWeight|prepareLayoutWeight)\([\s\S]*?(?=\n\/\*\* Perfect-information Monte Carlo)/,
		`${original}\n\n`,
	)
	.replace("rankOf, type Suit", "rankOf, SUITS, type Suit")
	.replace(/\n\tconst weightLayout =[^;]+;/, "")
	.replace(
		/const weight = weightLayout\?\.\(hands\) \?\? 1;/,
		"const weight = sampler.uniqueLayout ? 1 : layoutWeight(position, hands);",
	);
const root = await mkdtemp(join(tmpdir(), "opentrick-auction-weight-"));

function instrument(source: string): string {
	const weightsAt = source.indexOf("/** Auction meanings");
	const engineAt = source.indexOf("/** Perfect-information Monte Carlo");
	assert(weightsAt >= 0 && engineAt > weightsAt);
	const weights = source.slice(weightsAt, engineAt);
	assert(
		weights.includes("position.view.plays") &&
			weights.includes("countHandPoints("),
	);
	const countedWeights = weights
		.replace(
			"position.view.plays",
			"(work.history += position.view.plays.length, position.view.plays)",
		)
		.replace("countHandPoints(", "(work.points++, countHandPoints)(");
	return `${source.slice(0, weightsAt)}
export const work = { history: 0, points: 0 };
${countedWeights}${source.slice(engineAt)}`;
}

async function load(
	name: string,
	source: string,
): Promise<{
	analyzePlay: typeof analyzePlay;
	work?: { history: number; points: number };
}> {
	const path = join(root, "bot", `${name}.ts`);
	await writeFile(path, source);
	return import(pathToFileURL(path).href);
}

function run(
	engine: typeof analyzePlay,
	regime: "hinted" | "plain",
	repeats: number,
) {
	let worlds = 0;
	const start = performance.now();
	for (let repeat = 0; repeat < repeats; repeat++) {
		for (const row of fixtures) {
			const position = row[regime];
			const analysis = engine(position, cheapSolver(position), {
				samples,
				timeMs,
				random: random(row.seed),
			});
			worlds += analysis.samples;
		}
	}
	return { ms: performance.now() - start, worlds };
}

function comparable({ elapsedMs: _elapsedMs, ...analysis }: PlayAnalysis) {
	return analysis;
}

try {
	await symlink(resolve("src/bot"), join(root, "original-bot"));
	await symlink(resolve("src/bridge"), join(root, "bridge"));
	await symlink(resolve("package.json"), join(root, "package.json"));
	await mkdir(join(root, "bot"));
	for (const module of ["play-budget", "play-sampling", "rank-classes"])
		await symlink(
			join(root, "original-bot", `${module}.ts`),
			join(root, "bot", `${module}.ts`),
		);
	const oldWork = await load("count-control", instrument(control));
	const counted = run(oldWork.analyzePlay, "hinted", 1);
	console.log(
		JSON.stringify({
			type: "pre-change work",
			worlds: counted.worlds,
			...oldWork.work,
		}),
	);
	if (!countBaseline) {
		const newWork = await load("count-change", instrument(currentSource));
		const after = run(newWork.analyzePlay, "hinted", 1);
		console.log(
			JSON.stringify({
				type: "changed work",
				worlds: after.worlds,
				...newWork.work,
			}),
		);
		assert.equal(after.worlds, counted.worlds);
		assert(oldWork.work && newWork.work);
		const historyReduction = 1 - newWork.work.history / oldWork.work.history;
		const pointsReduction = 1 - newWork.work.points / oldWork.work.points;
		const current = (await import("../src/bot/play-engine")).analyzePlay;
		const sameEngineControl = (await load("control", control)).analyzePlay;
		const historical = (
			await import(pathToFileURL(join(baseline, "src/bot/play-engine.ts")).href)
		).analyzePlay as typeof analyzePlay;
		const dds = await DdsSolver.create();
		for (const row of fixtures) {
			const replay = (engine: typeof analyzePlay, position: PlayPosition) => {
				const stream: string[] = [];
				const solver: DoubleDummySolver = {
					solve: (hands, strain, trick) => {
						stream.push(JSON.stringify(hands));
						return dds.solve(hands, strain, trick);
					},
				};
				const analysis = engine(position, solver, {
					samples,
					exactLimit: 0,
					timeMs,
					random: random(row.seed),
				});
				return { analysis: comparable(analysis), stream };
			};
			const reference = replay(historical, row.hinted);
			assert.equal(reference.stream.length, samples);
			assert.deepEqual(
				replay(current, row.hinted),
				reference,
				`historical seed ${row.seed}`,
			);
			assert.deepEqual(
				replay(current, row.hiddenOnly),
				reference,
				`visible hints seed ${row.seed}`,
			);
		}
		console.log(
			JSON.stringify({
				type: "replay",
				positions: fixtures.length,
				worlds: fixtures.length * samples,
			}),
		);
		const speed: Record<string, number> = {};
		for (const regime of ["hinted", "plain"] as const) {
			run(sameEngineControl, regime, 12);
			run(current, regime, 12);
			const ratios: number[] = [];
			for (let round = 0; round < 7; round++) {
				const [controlFirst, changeFirst] =
					round % 2 === 0
						? [sameEngineControl, current]
						: [current, sameEngineControl];
				const first = run(controlFirst, regime, 36);
				const second = run(changeFirst, regime, 36);
				const [before, after] =
					round % 2 === 0 ? [first, second] : [second, first];
				assert.equal(before.worlds, after.worlds);
				ratios.push(after.ms / before.ms);
				console.log(
					JSON.stringify({
						type: "timing",
						regime,
						round: round + 1,
						before: before.ms,
						after: after.ms,
						worlds: after.worlds,
					}),
				);
			}
			speed[regime] = ratios.sort((a, b) => a - b)[3] ?? NaN;
		}
		console.log(
			JSON.stringify({
				type: "acceptance",
				historyReduction,
				pointsReduction,
				speed,
			}),
		);
		assert(
			historyReduction >= 0.9 &&
				pointsReduction >= 0.3 &&
				(speed.hinted ?? Infinity) <= 0.85 &&
				(speed.plain ?? Infinity) <= 1.05,
		);
	}
} finally {
	await rm(root, { recursive: true });
}
