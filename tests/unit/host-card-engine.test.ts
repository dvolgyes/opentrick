import { afterEach, describe, expect, it, vi } from "vitest";
import { BotRequestAbortedError } from "../../src/bot/browser-openrouter";
import type { PlayChooser } from "../../src/bot/browser-play";
import { HostBotRunner } from "../../src/bot/host-runner";
import type { PlayAnalysis } from "../../src/bot/play-engine";
import { BOT_FALLBACK_MODEL, BOT_MODEL } from "../../src/bot/strategy";
import { randomBelowFrom } from "../../src/bridge/deal";
import { createBoard } from "../../src/bridge/engine";
import { createBridgeModule } from "../../src/game/bridge";
import type { TableController } from "../../src/p2p/table";
import { bidding, DEAL } from "./bridge-fixtures";
import { CONFIG, ROOM_ID } from "./fixtures";

const SETTINGS = {
	apiKey: "test-key",
	model: BOT_MODEL,
	fallbackModel: BOT_FALLBACK_MODEL,
	modelOrder: [BOT_MODEL],
	retries: 0,
	retryDelayMs: 0,
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
		runner: new HostBotRunner(
			controller,
			SETTINGS,
			onError,
			undefined,
			undefined,
			chooser,
		),
		sendBot,
		onError,
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("host card engine integration", () => {
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
		await vi.waitFor(() => expect(answer).toBeDefined());
		runner.setSeatEnabled("E", false);
		answer?.(ANALYSIS);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sendBot).not.toHaveBeenCalled();
		runner.setSeatEnabled("E", true);
		await vi.waitFor(() => expect(sendBot).toHaveBeenCalledOnce());
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
		await vi.waitFor(() => expect(sendBot).toHaveBeenCalledOnce());
		expect(network).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		expect(chooser.choose.mock.calls).toHaveLength(1);
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
		await vi.waitFor(() => expect(requests).toBe(1));
		runner.pause();
		runner.resume();
		await vi.waitFor(() => expect(sendBot).toHaveBeenCalledOnce());
		expect(requests).toBe(2);
		expect(onError).not.toHaveBeenCalled();
		runner.stop();
	});
});
