import { describe, expect, it } from "vitest";
import { BrowserPlayEngine } from "../../src/bot/browser-play";
import { playPosition } from "../../src/bot/play-position";
import { dealCards } from "../../src/bridge/deal";
import { applyAction, boardStatus, createBoard } from "../../src/bridge/engine";
import { bidding, DEAL } from "../unit/bridge-fixtures";

describe("browser card engine", () => {
	it("plays a whole board in a real worker while the page stays responsive", async () => {
		const engine = new BrowserPlayEngine();
		const abort = new AbortController();
		let ticks = 0;
		const timer = setInterval(() => ticks++, 10);
		const timings: number[] = [];
		try {
			let state = 739;
			const deal = dealCards((bound) => {
				state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
				return Math.floor((state / 2 ** 32) * bound);
			});
			let board = bidding(createBoard(1, deal), "3NT P P P");
			for (let i = 0; i < 52; i++) {
				const status = boardStatus(board);
				if (status.phase !== "play") throw new Error("board ended early");
				const position = playPosition(board, status.actor);
				const analysis = await engine.choose(position, abort.signal);
				expect(position.legal).toContain(analysis.card);
				timings.push(analysis.elapsedMs);
				const applied = applyAction(board, status.actor, {
					type: "play",
					card: analysis.card,
				});
				if (!applied.ok) throw new Error(applied.reason);
				board = applied.board;
			}
			expect(boardStatus(board).phase).toBe("complete");
			expect(ticks).toBeGreaterThan(10);
			console.info(
				"worker full board",
				JSON.stringify({
					cards: 52,
					totalMs: timings.reduce((a, b) => a + b, 0),
					maxMs: Math.max(...timings),
				}),
			);
		} finally {
			clearInterval(timer);
			engine.stop();
		}
	}, 90_000);
	it("aborts a running search and creates a working replacement", async () => {
		const engine = new BrowserPlayEngine();
		try {
			const position = playPosition(
				bidding(createBoard(1, DEAL), "1NT P P P"),
				"E",
			);
			const abort = new AbortController();
			const pending = engine.choose(position, abort.signal);
			abort.abort();
			await expect(pending).rejects.toMatchObject({ name: "AbortError" });
			const result = await engine.choose(
				position,
				new AbortController().signal,
			);
			expect(position.legal).toContain(result.card);
		} finally {
			engine.stop();
		}
	}, 20_000);
});
