import assert from "node:assert/strict";
import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { applyAction, boardStatus } from "../../src/bridge/engine";
import { random } from "./arena";
import { competitiveDeal } from "./competitive-deals";
import { emptyWork, proposalEngine } from "./proposal-engine";

const engine = await proposalEngine();
let known = 0;
let continuation = 0;
for (let index = 0; index < 64 && known === 0; index++) {
	const fixture = competitiveDeal(10_600_000 + index, index + 1);
	const rng = random(239811 + index);
	let board = fixture.board;
	while (board.cards.length < 52) {
		const actor = boardStatus(board).actor;
		assert.ok(actor);
		const position = { ...playPosition(board, actor), hints: fixture.hints };
		if (board.cards.length > 0 && position.legal.length > 1) {
			const unique = createHandSampler(position.view).uniqueLayout;
			const options = () => ({ samples: 8, random: random(423791) });
			const solver: DoubleDummySolver = {
				solve: (hands) =>
					new Map(
						position.legal.map((card, i) => [
							card,
							Number(hands.N.includes(card)) + (i % 2),
						]),
					),
			};
			const work = emptyWork();
			const { elapsedMs: _, ...control } = analyzePlay(
				position,
				solver,
				options(),
			);
			const { elapsedMs: _unused, ...candidate } = engine(
				position,
				solver,
				options(),
				true,
				work,
			);
			assert.deepEqual(candidate, control);
			assert.equal(candidate.samples, unique ? 1 : 8);
			assert.equal(work.proposals, candidate.samples);
			if (unique) {
				assert.equal(work.weightSum, 1);
				known++;
			} else continuation++;
		}
		const card = position.legal[Math.floor(rng() * position.legal.length)];
		assert.ok(card);
		const action = applyAction(board, actor, { type: "play", card });
		assert.ok(action.ok);
		board = action.board;
	}
}
assert.ok(known > 0 && continuation > 0);
console.log({ known, continuation });
