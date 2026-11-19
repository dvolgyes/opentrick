import assert from "node:assert/strict";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay, type PlayOptions } from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import { applyAction, boardStatus, scoreBoard } from "../../src/bridge/engine";
import { scoreContract } from "../../src/bridge/rules";
import { scoreDifferenceToImps } from "../../src/bridge/scoring";
import { SEATS } from "../../src/protocol";
import { random } from "./arena";
import { competitiveDeal } from "./competitive-deals";
import { emptyWork, proposalEngine } from "./proposal-engine";

const [mode, rawShard, rawShards] = process.argv.slice(2);
const shard = Number(rawShard);
const shards = Number(rawShards);
assert.ok(mode === "accuracy" || mode === "games" || mode === "holdout");
assert.ok(
	Number.isInteger(shard) &&
		Number.isInteger(shards) &&
		shard >= 0 &&
		shard < shards,
);
const budget = 8;
const [engine, solver] = await Promise.all([
	proposalEngine(),
	DdsSolver.create(),
]);
const emit = (row: unknown) => console.log(JSON.stringify(row));
const firstSeed =
	mode === "accuracy" ? 10_700_000 : mode === "games" ? 10_800_000 : 10_900_000;
const boards = mode === "accuracy" ? 48 : 96;
const searchSeed = (fixtureSeed: number, stream: number) =>
	fixtureSeed ^ Math.imul(stream + 1, 0x9e3779b9);

function search(
	position: PlayPosition,
	alternative: boolean,
	seed: number,
	samples?: number,
) {
	const work = emptyWork();
	const options: PlayOptions = {
		random: random(seed),
		...(samples === undefined ? {} : { samples, timeMs: 60_000 }),
	};
	let queries = 0;
	const counted: DoubleDummySolver = {
		solve: (...args) => {
			queries++;
			return solver.solve(...args);
		},
	};
	const result = engine(position, counted, options, alternative, work);
	assert.equal(result.samples, queries);
	assert.equal(queries, work.dds);
	if (position.view.plays.length === 0) {
		if (samples !== undefined) assert.equal(queries, samples);
		assert.equal(work.proposals, (alternative ? 4 : 1) * queries);
	} else assert.equal(work.proposals, queries);
	return {
		card: result.card,
		ess: result.effectiveSamples,
		ms: result.elapsedMs,
		work,
		utility: Object.fromEntries(
			result.evaluations.map(({ card, utility }) => [card, utility]),
		),
	};
}

function supplied(position: PlayPosition, hints: PlayPosition["hints"]) {
	assert.equal(position.hints.length, 0);
	return { ...position, hints };
}

function ensureFixedControls(position: PlayPosition) {
	const stub: DoubleDummySolver = {
		solve: () => new Map(position.legal.map((card) => [card, 1])),
	};
	for (const hints of [
		[],
		position.hints.map((hint) => ({ ...hint, seat: position.view.seat })),
	]) {
		const view = { ...position, hints };
		const options = () => ({ samples: 8, random: random(220831) });
		const work = emptyWork();
		const { elapsedMs: _, ...control } = analyzePlay(view, stub, options());
		const { elapsedMs: _unused, ...candidate } = engine(
			view,
			stub,
			options(),
			true,
			work,
		);
		assert.deepEqual(candidate, control);
		assert.equal(work.proposals, 8);
		assert.equal(work.weightSum, 8);
	}
}

function accuracy(
	fixture: ReturnType<typeof competitiveDeal>,
	start: PlayPosition,
	seed: number,
	index: number,
) {
	const repeats = Array.from({ length: 4 }, (_, repeat) => {
		const stream = searchSeed(seed, 400 + repeat);
		const arms = index % 2 === 0 ? [false, true] : [true, false];
		return Object.fromEntries(
			arms.map((alternative) => [
				alternative ? "candidate" : "control",
				search(start, alternative, stream, budget),
			]),
		);
	});
	const reference = [500, 501].map((stream) =>
		search(start, false, searchSeed(seed, stream), 64),
	);
	const sign = start.turn === "N" || start.turn === "S" ? 1 : -1;
	const target = start.contract.level + 6;
	const base = scoreContract(start.contract, start.vulnerability, target);
	const scores = solver.solve(
		fixture.board.deal,
		start.contract.strain,
		start.current,
	);
	const oracle = Object.fromEntries(
		start.legal.map((card) => {
			const tricks = scores.get(card);
			assert.notEqual(tricks, undefined);
			return [
				card,
				scoreDifferenceToImps(
					sign *
						(scoreContract(
							start.contract,
							start.vulnerability,
							13 - (tricks as number),
						) -
							base),
				),
			];
		}),
	);
	return { repeats, reference, oracle };
}

function table(
	fixture: ReturnType<typeof competitiveDeal>,
	seed: number,
	alternative: boolean,
) {
	let board = fixture.board;
	const work = { dds: 0, proposals: 0, ms: 0 };
	let opening: ReturnType<typeof search> | undefined;
	while (board.cards.length < 52) {
		const actor = boardStatus(board).actor;
		assert.ok(actor);
		const position = supplied(playPosition(board, actor), fixture.hints);
		const ply = board.cards.length;
		const result = search(
			position,
			alternative && ply === 0,
			searchSeed(seed, ply * 4 + SEATS.indexOf(actor)),
			mode === "holdout" && ply === 0 ? undefined : budget,
		);
		if (ply === 0) opening = result;
		work.dds += result.work.dds;
		work.proposals += result.work.proposals;
		work.ms += result.ms;
		const step = applyAction(board, actor, { type: "play", card: result.card });
		assert.ok(step.ok);
		board = step.board;
	}
	const score = scoreBoard(board);
	assert.ok(score?.contract && opening);
	return {
		work,
		opening,
		scoreNS: score.scoreNS,
		declarerTricks: score.declarerTricks,
		cards: board.cards,
	};
}

emit({
	type: "protocol",
	mode,
	baseline: "b2858bff0de6c3509e527f5aadfed7a34c2c3aa3",
	node: process.version,
	shard,
	shards,
});
for (let index = shard; index < boards; index += shards) {
	const seed = firstSeed + index;
	const startMs = performance.now();
	const fixture = competitiveDeal(seed, index + 1);
	const actor = boardStatus(fixture.board).actor;
	assert.ok(actor);
	assert.equal(fixture.hints.length, 1);
	assert.equal(fixture.hints[0]?.seat, fixture.board.dealer);
	assert.notEqual(actor, fixture.board.dealer);
	const start = supplied(playPosition(fixture.board, actor), fixture.hints);
	if (index === shard) ensureFixedControls(start);
	const base = {
		type: mode,
		index,
		seed,
		draws: fixture.draws,
		strain: start.contract.strain,
	};
	if (mode === "accuracy") {
		emit({
			...base,
			...accuracy(fixture, start, seed, index),
			ms: performance.now() - startMs,
		});
	} else {
		const first = table(fixture, seed, index % 2 !== 0);
		const second = table(fixture, seed, index % 2 === 0);
		const [control, candidate] =
			index % 2 === 0 ? [first, second] : [second, first];
		if (control.opening.card === candidate.opening.card) {
			assert.deepEqual(control.cards, candidate.cards);
			assert.equal(control.scoreNS, candidate.scoreNS);
		}
		const sign = actor === "N" || actor === "S" ? 1 : -1;
		const imp = scoreDifferenceToImps(
			sign * (candidate.scoreNS - control.scoreNS),
		);
		emit({ ...base, control, candidate, imp, ms: performance.now() - startMs });
	}
}
