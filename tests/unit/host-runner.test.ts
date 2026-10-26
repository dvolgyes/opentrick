import { describe, expect, it, vi } from "vitest";
import { HostBotRunner } from "../../src/bot/host-runner";
import { BOT_FALLBACK_MODEL, BOT_MODEL } from "../../src/bot/strategy";
import { randomBelowFrom } from "../../src/bridge/deal";
import {
	type Action,
	boardStatus,
	createBoard,
	legalActions,
} from "../../src/bridge/engine";
import {
	actionPayload,
	claimRequestPayload,
	createBridgeModule,
	parseBridgeState,
	undoRequestPayload,
} from "../../src/game/bridge";
import type { TableController } from "../../src/p2p/table";
import {
	APPLICATION_FEATURES,
	type JsonObject,
	SEATS,
	type Seat,
} from "../../src/protocol";
import { call, DEAL } from "./bridge-fixtures";
import { CONFIG, ROOM_ID } from "./fixtures";

const SETTINGS = {
	apiKey: "test-key",
	model: BOT_MODEL,
	fallbackModel: BOT_FALLBACK_MODEL,
	modelOrder: [],
	retries: 0,
	retryDelayMs: 0,
} as const;

/** Board 1, dealt by North, as the host's table state after `steps`; each step is a payload from a seat. */
function tableState(
	steps: readonly ((state: JsonObject) => [Seat, JsonObject])[],
): JsonObject {
	const module = createBridgeModule(randomBelowFrom(() => 0));
	let state: JsonObject = {
		...module.initialState(ROOM_ID, CONFIG),
		board: createBoard(1, DEAL),
	};
	for (const [index, step] of steps.entries()) {
		const [seat, payload] = step(state);
		const result = module.apply(
			state,
			{
				roomId: ROOM_ID,
				config: CONFIG,
				seat,
				holder: `holder-${seat}`,
				commandId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
				seq: index + 1,
				present: SEATS,
				features: new Map(
					SEATS.map((each) => [each, Object.values(APPLICATION_FEATURES)]),
				),
			},
			payload,
		);
		if (!result.ok) throw new Error(result.reason);
		state = result.state;
	}
	return state;
}

/** The seat that must act sends `action`, or its first legal card when there is none. */
function act(action?: Action) {
	return (state: JsonObject): [Seat, JsonObject] => {
		const board = parseBridgeState(state, ROOM_ID)?.board;
		const seat = board ? boardStatus(board).actor : undefined;
		const chosen =
			action ?? (board && seat ? legalActions(board, seat)[0] : undefined);
		if (!board || !seat || !chosen) throw new Error("nobody can act");
		return [seat, actionPayload(ROOM_ID, board, chosen)];
	};
}

const OPENING = [call("1C"), call("P"), call("P"), call("P")].map(act);

/** A host page at North whose bots sit East and West; sendBot records each bot's message. */
function hostAt(state: JsonObject) {
	const sendBot = vi.fn(async (_seat: Seat, _payload: JsonObject) => ({
		ok: true as const,
	}));
	const controller = {
		tableId: ROOM_ID,
		view: () => ({
			hosting: true,
			ready: true,
			seat: "N",
			table: { config: CONFIG, state },
			roster: { bots: ["E", "W"] },
		}),
		onChange: () => () => {},
		activateBots: async () => true,
		send: async () => ({ ok: true }),
		sendBot,
	} as unknown as TableController;
	return { runner: new HostBotRunner(controller, SETTINGS), sendBot };
}

describe("host bot votes", () => {
	it("rejects every claim", async () => {
		// North opens 1C and declares; after three cards North claims all thirteen tricks.
		const state = tableState([
			...OPENING,
			act(),
			act(),
			act(),
			() => ["N", claimRequestPayload(ROOM_ID, 1, 13)],
		]);
		const claim = parseBridgeState(state, ROOM_ID)?.claim;
		expect(claim?.required).toEqual(["E", "W"]);
		const { runner, sendBot } = hostAt(state);
		expect(await runner.start()).toBe(true);
		await vi.waitFor(() => expect(sendBot).toHaveBeenCalledTimes(2));
		runner.stop();
		expect(sendBot.mock.calls.map(([seat]) => seat)).toEqual(["E", "W"]);
		for (const [, payload] of sendBot.mock.calls)
			expect(payload).toMatchObject({
				type: "claim-vote",
				requestId: claim?.id,
				approve: false,
			});
	});

	it("accepts every undo", async () => {
		// North opens and asks to undo the opening call; East and West decide.
		const state = tableState([
			act(call("1C")),
			() => ["N", undoRequestPayload(ROOM_ID, 1)],
		]);
		const undo = parseBridgeState(state, ROOM_ID)?.undo;
		expect(undo?.required).toEqual(["E", "W"]);
		const { runner, sendBot } = hostAt(state);
		expect(await runner.start()).toBe(true);
		await vi.waitFor(() => expect(sendBot).toHaveBeenCalledTimes(2));
		runner.stop();
		for (const [, payload] of sendBot.mock.calls)
			expect(payload).toMatchObject({
				type: "undo-vote",
				requestId: undo?.id,
				approve: true,
			});
	});
});
