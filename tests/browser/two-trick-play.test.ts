import { expect, it } from "vitest";
import { makeBoard } from "../../scripts/self-play/arena";
import { BrowserPlayEngine } from "../../src/bot/browser-play";
import { playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";

it("keeps the only chance to defeat 3NT and rejects duplicate visible cards", async () => {
	const board = makeBoard(15_920_010, 1, 46);
	const { actor } = boardStatus(board);
	if (!actor) throw new Error("Expected East to play to the penultimate trick");
	const position = playPosition(board, actor);
	const engine = new BrowserPlayEngine({ timeMs: 1000 });
	const signal = new AbortController().signal;
	try {
		const result = await engine.choose(position, signal);
		expect(result.card).toBe("C9");
		expect(
			result.evaluations.map(({ card, successProbability }) => [
				card,
				successProbability,
			]),
		).toEqual([
			["C9", 0.5],
			["ST", 0],
		]);
		await expect(
			engine.choose(
				{ ...position, view: { ...position.view, own: ["ST", "ST"] } },
				signal,
			),
		).rejects.toThrow("no valid legal play");
	} finally {
		engine.stop();
	}
});
