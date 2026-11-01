import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { playPosition } from "../../src/bot/play-position";
import { dealCards } from "../../src/bridge/deal";
import { applyAction, boardStatus, createBoard } from "../../src/bridge/engine";
import type { Call } from "../../src/bridge/rules";

test("the production card worker loads DDS and evaluates a deal", async ({
	page,
}) => {
	let board = createBoard(
		1,
		dealCards(() => 0),
	);
	for (const call of [
		"1NT",
		"P",
		"P",
		"P",
	] as const satisfies readonly Call[]) {
		const actor = boardStatus(board).actor;
		if (!actor) throw new Error("No player can bid");
		const result = applyAction(board, actor, { type: "call", call });
		if (!result.ok) throw new Error(result.reason);
		board = result.board;
	}
	const position = playPosition(board, "E");
	const workers = readdirSync("dist/assets").filter((name) =>
		/^play-worker-.*\.js$/.test(name),
	);
	expect(workers).toHaveLength(1);
	await page.goto("/");
	const result = await page.evaluate(
		({ workerPath, position }) =>
			new Promise<{
				ok: boolean;
				analysis?: { card: string; samples: number };
			}>((resolve, reject) => {
				const worker = new Worker(workerPath, { type: "module" });
				worker.onerror = (event) => reject(new Error(event.message));
				worker.onmessage = (event) => {
					if (event.data.partial) return;
					worker.terminate();
					resolve(event.data);
				};
				worker.postMessage({ position, timeMs: 150 });
			}),
		{ workerPath: `/assets/${workers[0]}`, position },
	);
	expect(result.ok).toBe(true);
	expect(result.analysis?.samples).toBeGreaterThan(0);
	expect(position.legal).toContain(result.analysis?.card);
});
