import { afterEach, describe, expect, it, vi } from "vitest";
import { bidPosition } from "../../src/bot/bid-position";
import type { BrowserBotAssets } from "../../src/bot/browser-assets";
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
	it("does not start a worker after a pending request is cancelled", async () => {
		vi.stubGlobal("Worker", WorkerStub);
		vi.stubGlobal("document", { baseURI: "https://example.com/opentrick/" });
		let release: ((value: string) => void) | undefined;
		const worker = new Promise<string>((resolve) => {
			release = resolve;
		});
		const assets = {
			worker: () => worker,
			model: () => Promise.resolve(new ArrayBuffer(4)),
		} as unknown as BrowserBotAssets;
		const bidder = new BrowserBidder(assets);
		const abort = new AbortController();
		const result = bidder.choose(
			bidPosition(createBoard(1, DEAL), "N"),
			"sl",
			abort.signal,
		);
		abort.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		release?.("blob:worker");
		await worker;
		await Promise.resolve();
		expect(WorkerStub.made).toHaveLength(0);
	});
	it("recreates a stopped worker with the retained model", async () => {
		vi.stubGlobal("Worker", WorkerStub);
		vi.stubGlobal("document", { baseURI: "https://example.com/opentrick/" });
		const bytes = new ArrayBuffer(4);
		const assets = {
			worker: vi.fn().mockResolvedValue("blob:worker"),
			model: vi.fn().mockResolvedValue(bytes),
		} as unknown as BrowserBotAssets;
		const bidder = new BrowserBidder(assets);
		const position = bidPosition(createBoard(1, DEAL), "N");
		const first = bidder.choose(position, "sl", new AbortController().signal);
		await vi.waitFor(() => expect(WorkerStub.made).toHaveLength(1));
		WorkerStub.made[0]?.onmessage?.({
			data: { ok: true, analysis: { call: "P" } },
		});
		await first;
		bidder.stop();
		const second = bidder.choose(position, "sl", new AbortController().signal);
		await vi.waitFor(() => expect(WorkerStub.made).toHaveLength(2));
		expect(WorkerStub.made[1]?.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ bytes, policy: "sl" }),
		);
		WorkerStub.made[1]?.onmessage?.({
			data: { ok: true, analysis: { call: "P" } },
		});
		await expect(second).resolves.toMatchObject({ call: "P" });
		bidder.stop();
	});
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
