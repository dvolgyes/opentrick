import { afterEach, describe, expect, it, vi } from "vitest";
import type { BidChooser } from "../../src/bot/browser-bidder";
import { HostBotRunner } from "../../src/bot/host-runner";
import { randomBelowFrom } from "../../src/bridge/deal";
import { createBoard } from "../../src/bridge/engine";
import { createBridgeModule, seatSystems } from "../../src/game/bridge";
import type { TableController } from "../../src/p2p/table";
import { DEFAULT_BOT_SETUP, parseBotSetup } from "../../src/protocol";
import { bookmarkQuery, parseBookmark } from "../../src/ui/bookmark";
import { DEAL } from "./bridge-fixtures";
import { CONFIG, ROOM_ID } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("local bidder integration", () => {
	it("bids for the host without a key, prompt fetch, or model API", async () => {
		const network = vi.fn(() => {
			throw new Error("unexpected network request");
		});
		vi.stubGlobal("fetch", network);
		const state = {
			...createBridgeModule(randomBelowFrom(() => 0)).initialState(
				ROOM_ID,
				CONFIG,
			),
			board: createBoard(1, DEAL),
		};
		const send = vi.fn(async () => ({ ok: true }));
		const controller = {
			tableId: ROOM_ID,
			view: () => ({
				hosting: true,
				ready: true,
				seat: "N",
				table: { config: CONFIG, state },
				roster: { bots: ["N"] },
			}),
			onChange: () => () => {},
			activateBots: async () => true,
			send,
		} as unknown as TableController;
		const bidder: BidChooser = {
			choose: vi.fn(async () => ({
				call: "1NT" as const,
				policy: "sl" as const,
				candidates: [],
			})),
			stop: vi.fn(),
		};
		const errors = vi.fn();
		const runner = new HostBotRunner(
			controller,
			{ bidder: "sl" },
			errors,
			undefined,
			bidder,
		);
		await runner.start(["N"]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		expect(network).not.toHaveBeenCalled();
		expect(errors).not.toHaveBeenCalled();
		runner.stop();
		expect(bidder.stop).toHaveBeenCalledOnce();
	});
	it("uses the WBridge5 imitation when a room setup or link omits the bidding policy", () => {
		const setup = { seats: ["N"], bidder: "sl" };
		expect(parseBotSetup({ seats: ["N"] })).toEqual(setup);
		expect(parseBookmark("?bot_seats=N").botSetup).toEqual(setup);
	});
	it("preserves the selected policy in reusable room links", () => {
		for (const bidder of ["sl", "rl-fsp"] as const) {
			const setup = { ...DEFAULT_BOT_SETUP, bidder };
			const parsed = parseBookmark(
				`?${bookmarkQuery(CONFIG.names, "W", setup)}`,
			);
			expect(parsed.botSetup).toEqual(setup);
		}
		expect(
			parseBookmark("?bot_bidder=sl&bot_bidder=rl-fsp").botSetup,
		).toBeUndefined();
		expect(
			parseBotSetup({ ...DEFAULT_BOT_SETUP, bidder: "../../private" }),
		).toBeUndefined();
	});
	it("gives a bot's own play no guide meanings, and the table assumes corrected HCP for a bot", () => {
		expect(seatSystems({ E: "hcp" }, ["N"], "other")).toEqual({
			N: "other",
			E: "hcp",
		});
		expect(seatSystems({}, ["N"])).toEqual({ N: "hcp-corrected" });
	});
});
