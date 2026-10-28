import { describe, expect, it, vi } from "vitest";
import { BrowserPlayEngine } from "../../src/bot/browser-play";
import { playPosition } from "../../src/bot/play-position";
import { dealCards } from "../../src/bridge/deal";
import { applyAction, boardStatus, createBoard } from "../../src/bridge/engine";
import { bidding, DEAL } from "../unit/bridge-fixtures";

describe("browser card engine", () => {
	it("reuses a real worker for successive timed searches", async () => {
		const NativeWorker = Worker;
		let created = 0;
		class CountingWorker extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				created++;
			}
		}
		vi.stubGlobal("Worker", CountingWorker);
		const engine = new BrowserPlayEngine({ timeMs: 150 });
		try {
			let board = bidding(createBoard(1, DEAL), "3NT P P P");
			for (let ply = 0; ply < 40; ply++) {
				const status = boardStatus(board);
				if (status.phase !== "play") throw new Error("no test ending found");
				const position = playPosition(board, status.actor);
				const card = position.legal[0];
				if (!card) throw new Error("missing legal card");
				const applied = applyAction(board, status.actor, {
					type: "play",
					card,
				});
				if (!applied.ok) throw new Error(applied.reason);
				board = applied.board;
			}
			const status = boardStatus(board);
			if (status.phase !== "play") throw new Error("missing play position");
			const position = playPosition(board, status.actor);
			expect(position.legal.length).toBeGreaterThan(1);
			for (let search = 0; search < 2; search++) {
				const result = await engine.choose(
					position,
					new AbortController().signal,
				);
				expect(position.legal).toContain(result.card);
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			expect(created).toBe(1);
		} finally {
			engine.stop();
			vi.unstubAllGlobals();
		}
	}, 15_000);
	it("spends the default budget on more than 96 samples in an ending", async () => {
		let board = bidding(createBoard(1, DEAL), "3NT P P P");
		for (let ply = 0; ply < 52; ply++) {
			const status = boardStatus(board);
			if (status.phase !== "play") throw new Error("no test ending found");
			const position = playPosition(board, status.actor);
			if (ply >= 32 && position.legal.length > 1) {
				const engine = new BrowserPlayEngine();
				try {
					const start = performance.now();
					const result = await engine.choose(
						position,
						new AbortController().signal,
					);
					const elapsedMs = performance.now() - start;
					expect(result.samples).toBeGreaterThan(96);
					expect(elapsedMs).toBeGreaterThanOrEqual(4500);
					expect(elapsedMs).toBeLessThan(8000);
					expect(position.legal).toContain(result.card);
					console.info(
						"default play budget",
						JSON.stringify({
							elapsedMs,
							samples: result.samples,
							effectiveSamples: result.effectiveSamples,
						}),
					);
					return;
				} finally {
					engine.stop();
				}
			}
			const action = {
				type: "play" as const,
				card: position.legal[0] as NonNullable<(typeof position.legal)[0]>,
			};
			const applied = applyAction(board, status.actor, action);
			if (!applied.ok) throw new Error(applied.reason);
			board = applied.board;
		}
		throw new Error("no test ending with a choice");
	}, 15_000);
	it("plays a whole board in a real worker while the page stays responsive", async () => {
		const engine = new BrowserPlayEngine({ timeMs: 150 });
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
