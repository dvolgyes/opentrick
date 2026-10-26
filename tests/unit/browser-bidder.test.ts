import { afterEach, describe, expect, it, vi } from "vitest";
import { bidPosition } from "../../src/bot/bid-position";
import { BrowserBidder } from "../../src/bot/browser-bidder";
import { createBoard } from "../../src/bridge/engine";
import { DEAL } from "./bridge-fixtures";

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

describe("bidding worker boundary", () => {
	it("rejects an unavailable call even when the worker reports success", async () => {
		vi.stubGlobal("Worker", WorkerStub);
		vi.stubGlobal("document", { baseURI: "https://example.com/opentrick/" });
		const position = bidPosition(createBoard(1, DEAL), "N");
		const result = new BrowserBidder().choose(
			position,
			"sl",
			new AbortController().signal,
		);
		const worker = WorkerStub.made[0];
		worker?.onmessage?.({ data: { ok: true, analysis: { call: "X" } } });
		await expect(result).rejects.toThrow(/legal call/);
		expect(worker?.terminate).toHaveBeenCalledOnce();
	});
	it("aborts model loading and can create a new worker for the next bid", async () => {
		vi.stubGlobal("Worker", WorkerStub);
		vi.stubGlobal("document", { baseURI: "https://example.com/opentrick/" });
		const bidder = new BrowserBidder();
		const position = bidPosition(createBoard(1, DEAL), "N");
		const controller = new AbortController();
		const result = bidder.choose(position, "sl", controller.signal);
		controller.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(WorkerStub.made[0]?.terminate).toHaveBeenCalledOnce();
		const next = bidder.choose(
			position,
			"rl-fsp",
			new AbortController().signal,
		);
		const worker = WorkerStub.made[1];
		expect(worker?.postMessage).toHaveBeenCalledWith({
			position,
			policy: "rl-fsp",
			url: "https://example.com/opentrick/bot-models/brl-rl-fsp.f32",
		});
		worker?.onmessage?.({ data: { ok: true, analysis: { call: "P" } } });
		await expect(next).resolves.toMatchObject({ call: "P" });
		bidder.stop();
	});
	it("terminates a stalled worker at the hard deadline", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("Worker", WorkerStub);
		vi.stubGlobal("document", { baseURI: "https://example.com/" });
		const result = new BrowserBidder().choose(
			bidPosition(createBoard(1, DEAL), "N"),
			"sl",
			new AbortController().signal,
		);
		const failure = expect(result).rejects.toThrow(/deadline/);
		await vi.advanceTimersByTimeAsync(60_000);
		await failure;
		expect(WorkerStub.made[0]?.terminate).toHaveBeenCalledOnce();
	});
});
