import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { makeBoard } from "../../scripts/self-play/arena";
import { DdsSolver } from "../../src/bot/dds-solver";
import { analyzePlay, type PlayAnalysis } from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";

function ending(): PlayPosition {
	for (let i = 1; i <= 32; i++) {
		const board = makeBoard(12501700 + i, i, 45);
		const status = boardStatus(board);
		assert.equal(status.phase, "play");
		assert.ok(status.actor);
		const position = playPosition(board, status.actor);
		if (position.legal.length === 2) return position;
	}
	throw new Error("no eligible partial ending");
}

test("the local worker skips native solves only for coherent two-trick inputs", async () => {
	const position = ending();
	const solver = await DdsSolver.create();
	const native = vi.spyOn(DdsSolver.prototype, "solve");
	type Reply =
		| { ok: true; analysis: PlayAnalysis; partial?: boolean }
		| { ok: false };
	let receive: (result: Reply) => void;
	const scope: {
		onmessage:
			| ((event: { data: { position: PlayPosition; timeMs: number } }) => void)
			| null;
		postMessage: (result: Reply) => void;
	} = {
		onmessage: null,
		postMessage(result) {
			if (!result.ok || !result.partial) receive(result);
		},
	};
	try {
		const expected = analyzePlay(position, solver);
		assert.ok(expected.samples > 0);
		assert.equal(native.mock.calls.length, expected.samples);
		native.mockClear();
		vi.stubGlobal("self", scope);
		await import("../../src/bot/play-worker");
		const request = (input: PlayPosition) =>
			new Promise<Reply>((resolve) => {
				receive = resolve;
				assert.ok(scope.onmessage);
				scope.onmessage({
					data: { position: structuredClone(input), timeMs: 5_000 },
				});
			});
		const actual = await request(position);
		assert.ok(actual.ok);
		assert.deepEqual(
			{ ...actual.analysis, elapsedMs: 0 },
			{ ...expected, elapsedMs: 0 },
		);
		assert.equal(native.mock.calls.length, 0);
		const malformed = {
			...position,
			current: { ...position.current, cards: [] },
		};
		assert.deepEqual(await request(malformed), { ok: false });
		assert.equal(native.mock.calls.length, 1);
		const held = position.view.own[0];
		assert.ok(held);
		const duplicate = {
			...position,
			current: { ...position.current, cards: [held] },
		};
		assert.deepEqual(await request(duplicate), { ok: false });
		assert.equal(native.mock.calls.length, 2);
	} finally {
		native.mockRestore();
		vi.unstubAllGlobals();
	}
}, 30_000);
