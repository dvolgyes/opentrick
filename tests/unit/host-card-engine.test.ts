import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayChooser } from "../../src/bot/browser-play";
import { BotRequestAbortedError } from "../../src/bot/errors";
import { HostBotRunner } from "../../src/bot/host-runner";
import type { PlayAnalysis } from "../../src/bot/play-engine";
import { randomBelowFrom } from "../../src/bridge/deal";
import { createBoard } from "../../src/bridge/engine";
import { createBridgeModule } from "../../src/game/bridge";
import type { TableController } from "../../src/p2p/table";
import { bidding, DEAL } from "./bridge-fixtures";
import { CONFIG, ROOM_ID } from "./fixtures";

const SETTINGS = {
	bidder: "sl",
} as const;
const ANALYSIS: PlayAnalysis = {
	card: "S7",
	samples: 8,
	effectiveSamples: 8,
	elapsedMs: 20,
	evaluations: [],
};

function host(chooser: PlayChooser) {
	const board = bidding(createBoard(1, DEAL), "1NT P P P");
	const state = {
		...createBridgeModule(randomBelowFrom(() => 0)).initialState(
			ROOM_ID,
			CONFIG,
		),
		board,
	};
	const sendBot = vi.fn(async () => ({ ok: true }));
	const controller = {
		tableId: ROOM_ID,
		view: () => ({
			hosting: true,
			ready: true,
			seat: "N",
			table: { config: CONFIG, state },
			roster: { bots: ["E"] },
		}),
		onChange: () => () => {},
		activateBots: async () => true,
		sendBot,
	} as unknown as TableController;
	const onError = vi.fn();
	return {
		runner: new HostBotRunner(controller, SETTINGS, onError, chooser),
		sendBot,
		onError,
	};
}

beforeEach(() =>
	vi.useFakeTimers({
		toFake: ["Date", "performance", "setTimeout", "clearTimeout"],
	}),
);
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("host card engine integration", () => {
	it("restarts a pending decision with a changed search budget", async () => {
		let rejectFirst: ((error: Error) => void) | undefined;
		const choose = vi.fn<PlayChooser["choose"]>();
		choose.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectFirst = reject;
				}),
		);
		choose.mockResolvedValue(ANALYSIS);
		const stop = vi.fn(() => rejectFirst?.(new BotRequestAbortedError()));
		const { runner, sendBot, onError } = host({ choose, stop });
		await runner.start();
		expect(choose).toHaveBeenCalledOnce();
		runner.updateSettings({ bidder: "sl", playTimeMs: 250 });
		await vi.advanceTimersByTimeAsync(3000);
		expect(sendBot).toHaveBeenCalledOnce();
		expect(choose.mock.calls.map((call) => call[2])).toEqual([5000, 250]);
		expect(stop).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
		runner.stop();
	});
	it("can re-enable a seat at the same position after discarding its disabled search", async () => {
		let answer: ((analysis: PlayAnalysis) => void) | undefined;
		let requests = 0;
		const choose: PlayChooser["choose"] = () => {
			requests++;
			return requests === 1
				? new Promise((resolve) => {
						answer = resolve;
					})
				: Promise.resolve(ANALYSIS);
		};
		const { runner, sendBot, onError } = host({ choose, stop: () => {} });
		await runner.start();
		expect(answer).toBeDefined();
		runner.setSeatEnabled("E", false);
		answer?.(ANALYSIS);
		await vi.advanceTimersByTimeAsync(0);
		expect(sendBot).not.toHaveBeenCalled();
		runner.setSeatEnabled("E", true);
		await vi.advanceTimersByTimeAsync(3000);
		expect(sendBot).toHaveBeenCalledOnce();
		expect(requests).toBe(2);
		expect(onError).not.toHaveBeenCalled();
		runner.stop();
	});
	it("plays locally without loading prompts or calling OpenRouter", async () => {
		const network = vi.fn(() => {
			throw new Error("card play attempted a model request");
		});
		vi.stubGlobal("fetch", network);
		const chooser = { choose: vi.fn(async () => ANALYSIS), stop: vi.fn() };
		const { runner, sendBot, onError } = host(chooser);
		await runner.start();
		await vi.advanceTimersByTimeAsync(3000);
		expect(sendBot).toHaveBeenCalledOnce();
		expect(network).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		expect(chooser.choose.mock.calls).toHaveLength(1);
		expect(chooser.choose).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(AbortSignal),
			5000,
		);
		runner.stop();
		expect(chooser.stop).toHaveBeenCalledOnce();
	});
	it("resumes the same position when pause and resume occur before abort rejection settles", async () => {
		let requests = 0;
		const choose: PlayChooser["choose"] = (_position, signal) => {
			requests++;
			if (requests > 1) return Promise.resolve(ANALYSIS);
			return new Promise((_resolve, reject) =>
				signal.addEventListener(
					"abort",
					() => reject(new BotRequestAbortedError()),
					{ once: true },
				),
			);
		};
		const { runner, sendBot, onError } = host({ choose, stop: () => {} });
		await runner.start();
		expect(requests).toBe(1);
		runner.pause();
		runner.resume();
		await vi.advanceTimersByTimeAsync(3000);
		expect(sendBot).toHaveBeenCalledOnce();
		expect(requests).toBe(2);
		expect(onError).not.toHaveBeenCalled();
		runner.stop();
	});
});
