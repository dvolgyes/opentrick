import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserPlayEngine } from "../../src/bot/browser-play";
import { playPosition } from "../../src/bot/play-position";
import { createBoard } from "../../src/bridge/engine";
import { bidding, DEAL } from "./bridge-fixtures";

class WorkerStub {
	static made: WorkerStub[] = [];
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn();
	constructor() {
		WorkerStub.made.push(this);
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	WorkerStub.made = [];
});

describe("card worker boundary", () => {
	it("keeps searching until the default five-second response budget", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("Worker", WorkerStub);
		const position = playPosition(
			bidding(createBoard(1, DEAL), "1NT P P P"),
			"E",
		);
		const result = new BrowserPlayEngine().choose(
			position,
			new AbortController().signal,
		);
		const worker = WorkerStub.made[0];
		expect(worker?.postMessage).toHaveBeenCalledWith({
			position,
			timeMs: 5000,
		});
		worker?.onmessage?.({
			data: { ok: true, partial: true, analysis: { card: "S7", samples: 100 } },
		});
		let complete = false;
		void result.then(() => {
			complete = true;
		});
		await vi.advanceTimersByTimeAsync(4999);
		expect(complete).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect(result).resolves.toMatchObject({ card: "S7", samples: 100 });
		expect(worker?.terminate).toHaveBeenCalledOnce();
	});
	it("rejects invalid time budgets before constructing a worker", () => {
		vi.stubGlobal("Worker", WorkerStub);
		for (const timeMs of [0, -1, Number.NaN, Infinity, 60_001, 0.5])
			expect(() => new BrowserPlayEngine({ timeMs })).toThrow(/play time/);
		expect(WorkerStub.made).toHaveLength(0);
	});
	it("uses a completed evaluation when a later native search exceeds the response budget", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("Worker", WorkerStub);
		const engine = new BrowserPlayEngine({ timeMs: 1500 });
		const result = engine.choose(
			playPosition(bidding(createBoard(1, DEAL), "1NT P P P"), "E"),
			new AbortController().signal,
		);
		let settled = false;
		void result.then(() => {
			settled = true;
		});
		WorkerStub.made[0]?.onmessage?.({
			data: { ok: true, partial: true, analysis: { card: "S7", samples: 8 } },
		});
		await vi.advanceTimersByTimeAsync(1499);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect(result).resolves.toMatchObject({ card: "S7", samples: 8 });
		expect(WorkerStub.made[0]?.terminate).toHaveBeenCalledOnce();
	});
	it("rejects a worker card outside the authoritative legal list", async () => {
		vi.stubGlobal("Worker", WorkerStub);
		const position = playPosition(
			bidding(createBoard(1, DEAL), "1NT P P P"),
			"E",
		);
		const engine = new BrowserPlayEngine();
		const result = engine.choose(position, new AbortController().signal);
		const worker = WorkerStub.made[0];
		worker?.onmessage?.({ data: { ok: true, analysis: { card: "SA" } } });
		await expect(result).rejects.toThrow(/legal play/);
		expect(worker?.terminate).toHaveBeenCalledOnce();
	});
	it("terminates a stalled solver at the hard deadline", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("Worker", WorkerStub);
		const engine = new BrowserPlayEngine();
		const result = engine.choose(
			playPosition(bidding(createBoard(1, DEAL), "1NT P P P"), "E"),
			new AbortController().signal,
		);
		const failure = expect(result).rejects.toThrow(/deadline/);
		await vi.advanceTimersByTimeAsync(15_000);
		await failure;
		expect(WorkerStub.made[0]?.terminate).toHaveBeenCalledOnce();
	});
	it("refuses an already aborted request before creating a worker", async () => {
		vi.stubGlobal("Worker", WorkerStub);
		const controller = new AbortController();
		controller.abort();
		await expect(
			new BrowserPlayEngine().choose(
				playPosition(bidding(createBoard(1, DEAL), "1NT P P P"), "E"),
				controller.signal,
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(WorkerStub.made).toHaveLength(0);
	});
});
