import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay, type PlayAnalysis } from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import type { Card } from "../../src/bridge/cards";
import { boardStatus } from "../../src/bridge/engine";
import { SEATS } from "../../src/protocol";
import { makeBoard, type PlayPolicy, playPair, random } from "./arena";

const INCUMBENT = "eb18b5e5657d5468faeb715f648be4f2678a87e2";
const INCUMBENT_HASHES = {
	"src/bot/dds-solver.ts":
		"629cadaa55f4da1ac506927e84e572bec78ac43095901549bd8c675e71263874",
	"src/bot/play-engine.ts":
		"fecabb2f2a11f1b2ed6b6708de8f31821f47c49e81c6296807e8ab24c805628a",
	"src/bot/play-position.ts":
		"78c16ff1b752c7f4e4707a22c052732fec98081690c421547ec2d690eaac3a77",
	"src/bot/play-sampling.ts":
		"dc836eb9ffdb12674037add6e5c671ceed5445e23d6a8584b9b20a345d877c16",
};
const POSITIONS = {
	seed: 7_310_000,
	count: 48,
	samples: 8,
	plies: [0, 12, 24, 38],
};
const BOARDS = { seed: 7_410_000, count: 32, samples: 4 };
const TIME_MS = 60_000;
const TIMED_PASSES = 4;
const ENGINES = ["historical", "optimized"] as const;
type Engine = (typeof ENGINES)[number];

type Work = {
	ddsCalls: number;
	accumulatorLookups: number;
	handSorts: number;
	lookupsByCard: Partial<Record<Card, number>>;
};

function measureWork(solver: DoubleDummySolver) {
	const counters: Work = {
		ddsCalls: 0,
		accumulatorLookups: 0,
		handSorts: 0,
		lookupsByCard: {},
	};
	const layouts = createHash("sha256");
	const instrumented: DoubleDummySolver = {
		solve(hands, trump, current) {
			counters.ddsCalls++;
			layouts.update(
				JSON.stringify(SEATS.map((seat) => [...hands[seat]].sort())),
			);
			const toSorted = Array.prototype.toSorted;
			Array.prototype.toSorted = function <T>(
				this: T[],
				compare?: (a: T, b: T) => number,
			): T[] {
				counters.handSorts++;
				return toSorted.call(this, compare);
			};
			try {
				const scores = solver.solve(hands, trump, current);
				const get = scores.get.bind(scores);
				Object.defineProperty(scores, "get", {
					value: (card: Card) => {
						counters.accumulatorLookups++;
						counters.lookupsByCard[card] =
							(counters.lookupsByCard[card] ?? 0) + 1;
						return get(card);
					},
				});
				return scores;
			} finally {
				Array.prototype.toSorted = toSorted;
			}
		},
	};
	return {
		instrumented,
		result: () => ({ ...counters, layoutHash: layouts.digest("hex") }),
	};
}

function expectedSamples(position: PlayPosition, budget: number): number {
	if (position.legal.length === 1) return 0;
	return createHandSampler(position.view).uniqueLayout ? 1 : budget;
}

function withoutTiming(
	analysis: PlayAnalysis,
): Omit<PlayAnalysis, "elapsedMs"> {
	const { elapsedMs: _, ...stable } = analysis;
	return stable;
}

function searchSeed(dealSeed: number): number {
	return dealSeed ^ 0x5a17c9e3;
}

async function fingerprint(root: string, extra: string[] = []) {
	return Object.fromEntries(
		await Promise.all(
			[...Object.keys(INCUMBENT_HASHES), ...extra].map(async (file) => {
				const content = await readFile(resolve(root, file));
				return [file, createHash("sha256").update(content).digest("hex")];
			}),
		),
	);
}

/** Local CLI only. Use a trusted snapshot: transitive imports are not pinned. */
async function run(incumbentPath: string) {
	const historicalHashes = await fingerprint(incumbentPath);
	for (const [file, hash] of Object.entries(INCUMBENT_HASHES))
		assert.equal(
			historicalHashes[file],
			hash,
			`${file} does not match incumbent ${INCUMBENT}`,
		);
	const candidatePath = resolve(import.meta.dirname, "../..");
	const incumbent = (file: string) =>
		pathToFileURL(resolve(incumbentPath, "src/bot", file)).href;
	const historical: typeof import("../../src/bot/play-engine") = await import(
		incumbent("play-engine.ts")
	);
	const historicalDds: typeof import("../../src/bot/dds-solver") = await import(
		incumbent("dds-solver.ts")
	);
	const analyze = {
		historical: historical.analyzePlay,
		optimized: analyzePlay,
	};
	const solvers = {
		historical: await historicalDds.DdsSolver.create(),
		optimized: await DdsSolver.create(),
	};
	const fixtures = Array.from({ length: POSITIONS.count }, (_, index) => {
		const dealSeed = POSITIONS.seed + index;
		const ply = POSITIONS.plies[index % POSITIONS.plies.length];
		assert.ok(ply !== undefined);
		const board = makeBoard(dealSeed, index + 1, ply);
		const { actor } = boardStatus(board);
		assert.ok(actor);
		const position = playPosition(board, actor);
		return {
			boardNumber: board.number,
			dealSeed,
			searchSeed: searchSeed(dealSeed),
			ply,
			position,
		};
	});

	function timeBatch(engine: Engine) {
		const elapsedByPlyMs: Record<number, number> = {};
		const runSearch = analyze[engine];
		const solver = solvers[engine];
		const start = performance.now();
		for (const fixture of fixtures) {
			const result = runSearch(fixture.position, solver, {
				samples: POSITIONS.samples,
				timeMs: TIME_MS,
				random: random(fixture.searchSeed),
			});
			elapsedByPlyMs[fixture.ply] =
				(elapsedByPlyMs[fixture.ply] ?? 0) + result.elapsedMs;
		}
		return { batchMs: performance.now() - start, elapsedByPlyMs };
	}

	const warmup = ENGINES.map((engine) => ({ engine, ...timeBatch(engine) }));
	const passes = Array.from({ length: TIMED_PASSES }, (_, index) => {
		const order =
			index % 2 === 0 ? ENGINES : ([ENGINES[1], ENGINES[0]] as const);
		return order.map((engine) => ({ engine, ...timeBatch(engine) }));
	});

	const positions = fixtures.map(({ position, ...fixture }) => {
		const samples = expectedSamples(position, POSITIONS.samples);
		const measure = (engine: Engine) => {
			const work = measureWork(solvers[engine]);
			const analysis = withoutTiming(
				analyze[engine](position, work.instrumented, {
					samples: POSITIONS.samples,
					timeMs: TIME_MS,
					random: random(fixture.searchSeed),
				}),
			);
			return { analysis, work: work.result() };
		};
		const historical = measure("historical");
		const optimized = measure("optimized");
		const equal =
			isDeepStrictEqual(historical.analysis, optimized.analysis) &&
			historical.work.layoutHash === optimized.work.layoutHash &&
			[historical, optimized].every(
				({ analysis, work }) =>
					analysis.samples === samples && work.ddsCalls === samples,
			);
		return {
			...fixture,
			strain: position.contract.strain,
			legal: position.legal,
			expectedSamples: samples,
			equal,
			historical,
			optimized,
		};
	});

	const boardPolicy =
		(engine: Engine): PlayPolicy =>
		(position, random) => {
			const result = analyze[engine](position, solvers[engine], {
				samples: BOARDS.samples,
				timeMs: TIME_MS,
				random,
			});
			assert.equal(
				result.samples,
				expectedSamples(position, BOARDS.samples),
				`${engine}: incorrect IID budget`,
			);
			return result.card;
		};
	const historicalPolicy = boardPolicy("historical");
	const optimizedPolicy = boardPolicy("optimized");
	const boards = Array.from({ length: BOARDS.count }, (_, index) => {
		const dealSeed = BOARDS.seed + index;
		const board = makeBoard(dealSeed, index + 1, 0);
		const seed = searchSeed(dealSeed);
		const result = playPair(board, historicalPolicy, optimizedPolicy, seed);
		const equal =
			result.imps === 0 &&
			isDeepStrictEqual(result.candidateNS, result.candidateEW);
		return {
			boardNumber: board.number,
			dealSeed,
			searchSeed: seed,
			equal,
			...result,
		};
	});

	const totals = Object.fromEntries(
		ENGINES.map((engine) => [
			engine,
			positions.reduce(
				(sum, position) => {
					const work = position[engine].work;
					sum.ddsCalls += work.ddsCalls;
					sum.accumulatorLookups += work.accumulatorLookups;
					sum.handSorts += work.handSorts;
					return sum;
				},
				{ ddsCalls: 0, accumulatorLookups: 0, handSorts: 0 },
			),
		]),
	);
	return {
		incumbentCommit: INCUMBENT,
		incumbentPath,
		environment: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			cpu: cpus()[0]?.model,
			dds: "separate Wasm instances",
		},
		sourceHashes: {
			historical: historicalHashes,
			optimized: await fingerprint(candidatePath, ["src/bot/rank-classes.ts"]),
		},
		protocol: {
			positions: POSITIONS,
			boards: BOARDS,
			timeMs: TIME_MS,
			timedPasses: TIMED_PASSES,
			searchSeedXor: 0x5a17c9e3,
			boardRandom:
				"arena.playPair: SplitMix32, reset for each ply and seat in both rooms",
		},
		warmup,
		passes,
		totals,
		positionMatches: positions.filter(({ equal }) => equal).length,
		boardMatches: boards.filter(({ equal }) => equal).length,
		netImps: boards.reduce((sum, board) => sum + board.imps, 0),
		positions,
		boards,
	};
}

const snapshot = process.argv[2];
assert.ok(
	process.argv.length === 3 && snapshot,
	"usage: node --import tsx scripts/self-play/search-control.ts TRUSTED_INCUMBENT_SNAPSHOT",
);
const evidence = await run(resolve(snapshot));
console.log(JSON.stringify(evidence, null, 2));
if (
	evidence.positionMatches !== POSITIONS.count ||
	evidence.boardMatches !== BOARDS.count
)
	process.exitCode = 1;
