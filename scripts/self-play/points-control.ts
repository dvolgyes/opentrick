import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import type { PlayAnalysis } from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import type { Card } from "../../src/bridge/cards";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import { boardStatus } from "../../src/bridge/engine";
import { POINT_SYSTEMS } from "../../src/bridge/hand-points";
import { englishTranslator, translator } from "../../src/i18n";
import { SEATS } from "../../src/protocol";
import { makeBoard, type PlayPolicy, playTable, random } from "./arena";

const INCUMBENT = "b2858bff0de6c3509e527f5aadfed7a34c2c3aa3";
const POINTS = "src/bridge/hand-points.ts";
const ENGINE = "src/bot/play-engine.ts";
const DEADLINE = 60_000;
const HAND_SEED = 11_100_000;
const POSITION_SEED = 11_200_000;
const BOARD_SEED = 11_200_100;
const HANDS = 4096;
const POSITIONS = 48;
const BOARDS = 16;
const SAMPLES = 4;
const ROUNDS = 9;

const [baselinePath, candidatePath = "."] = process.argv.slice(2);
assert(
	baselinePath,
	"usage: points-control.ts TRUSTED_BASELINE [TRUSTED_CANDIDATE]",
);
const roots = [baselinePath, candidatePath] as const;
const digest = async (root: string, file: string) =>
	createHash("sha256")
		.update(await readFile(resolve(root, file)))
		.digest("hex");
const moduleUrl = (root: string, file: string) =>
	pathToFileURL(resolve(root, file)).href;
assert.equal(
	await digest(baselinePath, POINTS),
	"f60fe308b73e50b50056bd8eff331adfbd5696c304ea2de998f8bdced0305aa2",
);
for (const root of roots)
	assert.equal(
		await digest(root, ENGINE),
		"53c7ec2e4bca0ce82e30e280f53331b5eab070e1f682fcfd0bcea657a326a927",
	);
const incumbent: typeof import("../../src/bridge/hand-points") = await import(
	moduleUrl(baselinePath, POINTS)
);
const candidate: typeof incumbent = await import(
	moduleUrl(candidatePath, POINTS)
);
const historicalEngine: typeof import("../../src/bot/play-engine") =
	await import(moduleUrl(baselinePath, ENGINE));
const candidateEngine: typeof historicalEngine = await import(
	moduleUrl(candidatePath, ENGINE)
);
const scorers = [incumbent, candidate] as const;
const engines = [historicalEngine, candidateEngine] as const;
const variants = [0, 1] as const;
type Variant = (typeof variants)[number];

const assertFixture = (label: string, cards: readonly Card[]) => {
	for (const system of POINT_SYSTEMS) {
		assert.deepEqual(
			candidate.countHandPoints(system, cards),
			incumbent.countHandPoints(system, cards),
			`${label} ${system} totals`,
		);
		for (const t of [englishTranslator, german])
			assert.deepEqual(
				candidate.explainHandPoints(system, cards, t),
				incumbent.explainHandPoints(system, cards, t),
				`${label} ${system} explanation`,
			);
	}
};
const german = translator("de");
function hand(...ranks: string[]): Card[] {
	return ranks.flatMap((suit, i) =>
		[...suit].map((rank) => `${"SHDC"[i]}${rank}` as Card),
	);
}
const named = {
	singleton: hand("987654", "K", "Q32", "J32"),
	"weak doubletons": hand("98765", "JA", "QK", "JT87"),
	"all aces and flat": hand("A432", "A32", "A32", "A32"),
	"flat alone": hand("K432", "K32", "K32", "K32"),
	"distribution 4441": hand("A432", "K432", "Q432", "J"),
	"distribution 5440": hand("A8765", "KQJT", "Q432", ""),
	"distribution 5422": hand("89TJK", "K432", "J2", "QJ"),
	"distribution 5431": hand("23QKA", "K", "J432", "432"),
	"distribution 5521": hand("A8765", "K8765", "32", "2"),
	"distribution 5530": hand("A8765", "KT432", "432", ""),
	"good six-card suit": hand("789JQA", "A32", "K32", "4"),
	"extreme length": hand("AKQJT98765432", "", "", ""),
	"partial aces": hand("A", "A", "A", "A").reverse(),
	"partial honours": hand("QT89K", "98", "K", "JA").reverse(),
	empty: [],
};
for (const [name, cards] of Object.entries(named)) assertFixture(name, cards);
const hands = Array.from({ length: HANDS }, (_, index) => {
	const seed = HAND_SEED + index;
	const rng = random(seed);
	const seat = SEATS[index % SEATS.length];
	assert(seat);
	const cards = dealCards(randomBelowFrom(() => rng() * 2 ** 32))[seat];
	assert.equal(cards.length, 13);
	assertFixture(`${seed}/${seat}`, cards);
	assertFixture(
		`${seed}/${seat} partial`,
		cards.slice(0, index % 13).reverse(),
	);
	return cards;
});

function hinted(position: PlayPosition, index: number): PlayPosition {
	return {
		...position,
		hints: SEATS.flatMap((seat, offset): PlayPosition["hints"] => {
			if (
				seat === position.view.seat ||
				(seat === position.view.dummy && position.view.dummyCards)
			)
				return [];
			const min = 5 + ((index + offset * 3) % 10);
			return [
				{
					seat,
					system: "hcp-corrected",
					meaning: { range: { min, max: min + 3 }, shape: { kind: "none" } },
				},
				{
					seat,
					system: "hcp",
					meaning: { range: { min: 3, max: 15 }, shape: { kind: "none" } },
				},
			];
		}),
	};
}

const solvers = [await DdsSolver.create(), await DdsSolver.create()] as const;
type Solve = DoubleDummySolver["solve"];
type Sample = { input: Parameters<Solve>; result: ReturnType<Solve> };
function stable({ elapsedMs: _, ...analysis }: PlayAnalysis) {
	return analysis;
}
const realAnalysisMs = [0, 0];
const realDdsMs = [0, 0];
let weighted = 0;
const fixtures = Array.from({ length: POSITIONS }, (_, index) => {
	const seed = POSITION_SEED + index;
	let ply = 8 + (index % 7) * 4 + (index % 4);
	let board = makeBoard(seed, index + 1, ply);
	let position: PlayPosition;
	for (;;) {
		const { actor } = boardStatus(board);
		assert(actor);
		position = hinted(playPosition(board, actor), index);
		if (position.legal.length > 1) break;
		board = makeBoard(seed, index + 1, ++ply);
	}
	const searchSeed = seed ^ 0x5a17c9e3;
	const run = (variant: Variant) => {
		const captured: Sample[] = [];
		const result = engines[variant].analyzePlay(
			position,
			{
				solve(...input) {
					const begin = performance.now();
					const result = solvers[variant].solve(...input);
					realDdsMs[variant] =
						(realDdsMs[variant] ?? 0) + performance.now() - begin;
					captured.push({ input, result });
					return result;
				},
			},
			{ samples: SAMPLES, timeMs: DEADLINE, random: random(searchSeed) },
		);
		realAnalysisMs[variant] = (realAnalysisMs[variant] ?? 0) + result.elapsedMs;
		assert.equal(result.samples, SAMPLES, `sample count at ${seed}/${ply}`);
		return { analysis: stable(result), captured };
	};
	const first = index % 2 === 0 ? 0 : 1;
	const reference = run(first);
	assert.deepEqual(
		run(first === 0 ? 1 : 0),
		reference,
		`real-DDS result at ${seed}/${ply}`,
	);
	if (reference.analysis.effectiveSamples < SAMPLES - 1e-9) weighted++;
	return { seed, position, searchSeed, captured: reference.captured };
});
assert(
	weighted >= 40,
	"at least 40 positions must exercise nonuniform weights",
);

let checksum = 0;
function measure(variant: Variant) {
	function score(system: "hcp" | "hcp-corrected") {
		const start = performance.now();
		const { countHandPoints } = scorers[variant];
		for (let rep = 0; rep < 32; rep++)
			for (const cards of hands)
				checksum += countHandPoints(system, cards).total;
		return performance.now() - start;
	}
	const corrected = score("hcp-corrected");
	const hcp = score("hcp");
	const start = performance.now();
	for (let rep = 0; rep < 16; rep++) {
		for (const { position, searchSeed, captured } of fixtures) {
			let index = 0;
			const result = engines[variant].analyzePlay(
				position,
				{
					solve() {
						const sample = captured[index++];
						assert(sample);
						return sample.result;
					},
				},
				{ samples: SAMPLES, timeMs: DEADLINE, random: random(searchSeed) },
			);
			checksum += result.effectiveSamples;
		}
	}
	return { corrected, hcp, hintedReplay: performance.now() - start };
}
for (let warm = 0; warm < 2; warm++)
	for (const variant of variants) measure(variant);
const rounds = Array.from({ length: ROUNDS }, (_, index) => {
	if (index % 2 === 0) return [measure(0), measure(1)] as const;
	const next = measure(1);
	return [measure(0), next] as const;
});
function medianRatio(key: keyof ReturnType<typeof measure>) {
	return (
		rounds.map(([old, next]) => next[key] / old[key]).sort((a, b) => a - b)[
			Math.floor(ROUNDS / 2)
		] ?? Infinity
	);
}
const ratios = {
	corrected: medianRatio("corrected"),
	hcp: medianRatio("hcp"),
	hintedReplay: medianRatio("hintedReplay"),
};

const boardMs = [0, 0];
const policy =
	(variant: Variant, index: number): PlayPolicy =>
	(position, rng) =>
		engines[variant].analyzePlay(hinted(position, index), solvers[variant], {
			samples: 2,
			timeMs: DEADLINE,
			random: rng,
		}).card;
for (let index = 0; index < BOARDS; index++) {
	const seed = BOARD_SEED + index;
	const board = makeBoard(seed, index + 1, 0);
	const run = (variant: Variant) => {
		const p = policy(variant, index);
		const start = performance.now();
		const result = playTable(board, p, p, seed ^ 0x5a17c9e3);
		boardMs[variant] = (boardMs[variant] ?? 0) + performance.now() - start;
		return result;
	};
	const first = index % 2 === 0 ? 0 : 1;
	const result = run(first);
	assert.deepEqual(run(first === 0 ? 1 : 0), result, `paired board ${seed}`);
}

console.log(
	JSON.stringify(
		{
			incumbent: INCUMBENT,
			candidateHash: await digest(candidatePath, POINTS),
			node: process.version,
			cpu: cpus()[0]?.model,
			hands: HANDS,
			partials: HANDS,
			named: Object.keys(named).length,
			positions: fixtures.length,
			weighted,
			ddsLayouts: fixtures.reduce(
				(sum, fixture) => sum + fixture.captured.length,
				0,
			),
			boards: BOARDS,
			netImps: 0,
			rounds,
			ratios,
			realAnalysisMs,
			realDdsMs,
			boardMs,
			checksum,
		},
		null,
		2,
	),
);
assert(ratios.corrected < 0.85, "corrected HCP speed gate");
assert(ratios.hcp <= 1.03, "ordinary HCP speed gate");
