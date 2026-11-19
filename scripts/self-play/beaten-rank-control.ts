import assert from "node:assert/strict";
import { DdsSolver } from "../../src/bot/dds-solver";
import { obviousPlay } from "../../src/bot/obvious-play";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { mapLegalRankClasses } from "../../src/bot/rank-classes";
import { boardStatus } from "../../src/bridge/engine";
import { makeBoard, type PlayPolicy, playPair, random } from "./arena";

const solver = await DdsSolver.create();
for (let i = 0; i < 1200; i++) {
	const seed = 9_600_000 + i;
	const ply = (i % 2) + 2 + 4 * (Math.floor(i / 2) % 12);
	const board = makeBoard(seed, i + 1, ply);
	const { actor } = boardStatus(board);
	assert.ok(actor);
	const position = playPosition(board, actor);
	const groups = mapLegalRankClasses(position, (card, key) => ({ card, key }));
	const sampler = createHandSampler(position.view);
	const rng = random(seed ^ 0x396ad8b1);
	for (let sample = 0; sample < 2; sample++) {
		const scores = solver.solve(
			sampler(rng),
			position.contract.strain,
			position.current,
		);
		const byGroup = new Map<number, number>();
		for (const { card, key } of groups) {
			const tricks = scores.get(card);
			if (tricks === undefined) throw new Error(`no DDS score for ${card}`);
			const prior = byGroup.get(key);
			if (prior !== undefined)
				assert.equal(tricks, prior, `${seed}: unsound rank group for ${card}`);
			byGroup.set(key, tricks);
		}
	}
	console.log(
		JSON.stringify({
			seed,
			ply,
			legal: groups.length,
			groups: new Set(groups.map((x) => x.key)).size,
		}),
	);
}
for (let i = 0; i < 64; i++) {
	const seed = 9_500_000 + i;
	const board = makeBoard(seed, i + 1, 0);
	let skipped = 0;
	let calls = 0;
	const policy =
		(samples: number): PlayPolicy =>
		(position, rng) => {
			const fixed = obviousPlay(position);
			if (fixed) {
				if (position.legal.length > 1) skipped++;
				return fixed;
			}
			const result = analyzePlay(position, solver, {
				samples,
				timeMs: 60_000,
				random: rng,
			});
			calls += result.samples;
			return result.card;
		};
	const pair = playPair(board, policy(2), policy(4), seed ^ 0x396ad8b1);
	console.log(
		JSON.stringify({
			seed,
			skipped,
			calls,
			ns: pair.candidateNS.scoreNS,
			ew: pair.candidateEW.scoreNS,
			nsTrace: pair.candidateNS.cards.join(""),
			ewTrace: pair.candidateEW.cards.join(""),
		}),
	);
}
