import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayChooser } from "../../src/bot/browser-play";
import { HostBotRunner } from "../../src/bot/host-runner";
import type { PlayAnalysis } from "../../src/bot/play-engine";
import type { Card } from "../../src/bridge/cards";
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
	bidder: "sl",
} as const;

const MODULE = createBridgeModule(randomBelowFrom(() => 0));

/** The host's context for the `seq`th message, from `seat`; every page announces every feature. */
function contextFor(seat: Seat, seq: number) {
	return {
		roomId: ROOM_ID,
		config: CONFIG,
		seat,
		holder: `holder-${seat}`,
		commandId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
		seq,
		present: SEATS,
		features: new Map(
			SEATS.map((each) => [each, Object.values(APPLICATION_FEATURES)]),
		),
	};
}

/** Board 1, dealt by North, as the host's table state after `steps`; each step is a payload from a seat. */
function tableState(
	steps: readonly ((state: JsonObject) => [Seat, JsonObject])[],
): JsonObject {
	let state: JsonObject = {
		...MODULE.initialState(ROOM_ID, CONFIG),
		board: createBoard(1, DEAL),
	};
	for (const [index, step] of steps.entries()) {
		const [seat, payload] = step(state);
		const result = MODULE.apply(state, contextFor(seat, index + 1), payload);
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

/**
 * A host page at North whose bots sit East and West, on a table that applies each message with the bridge module
 * and refuses what the module refuses.
 */
function liveHost(state: JsonObject, playEngine: PlayChooser) {
	let current = state;
	let beforeBot: (() => void) | undefined;
	let seq = 1000;
	const listeners = new Set<() => void>();
	const deliver = (seat: Seat, payload: JsonObject) => {
		seq += 1;
		const result = MODULE.apply(current, contextFor(seat, seq), payload);
		if (!result.ok) return { ok: false as const, reason: result.reason };
		current = result.state;
		for (const listener of listeners) listener();
		return { ok: true as const };
	};
	const controller = {
		tableId: ROOM_ID,
		view: () => ({
			hosting: true,
			ready: true,
			seat: "N",
			table: { config: CONFIG, state: current },
			roster: { bots: ["E", "W"] },
		}),
		onChange: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		activateBots: async () => true,
		send: async (payload: JsonObject) => deliver("N", payload),
		sendBot: async (seat: Seat, payload: JsonObject) => {
			const first = beforeBot;
			beforeBot = undefined;
			first?.();
			return deliver(seat, payload);
		},
	} as unknown as TableController;
	const onError = vi.fn();
	return {
		runner: new HostBotRunner(controller, SETTINGS, onError, playEngine),
		onError,
		deliver,
		/** `message` reaches the host just before the next bot message. */
		beforeNextBot: (message: () => void) => {
			beforeBot = message;
		},
		state: () => parseBridgeState(current, ROOM_ID),
	};
}

/** A card engine reply that chooses `card`. */
function playReply(card: Card): PlayAnalysis {
	return {
		card,
		samples: 1,
		effectiveSamples: 1,
		elapsedMs: 1,
		evaluations: [],
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("host bot play", () => {
	it("decides a claim made while it chooses a card, then plays at the same position", async () => {
		// North declares 1C, and East, a bot, is to lead.
		const start = tableState(OPENING);
		const board = parseBridgeState(start, ROOM_ID)?.board;
		const lead = board && legalActions(board, "E")[0];
		if (lead?.type !== "play") throw new Error("East cannot lead");
		let answerFirst: (() => void) | undefined;
		const asked = vi.fn();
		const chooser: PlayChooser = {
			stop: () => {},
			choose: async () => {
				asked();
				// The first answer waits until the test lets it go; later answers come at once.
				if (asked.mock.calls.length === 1)
					await new Promise<void>((resolve) => {
						answerFirst = resolve;
					});
				return playReply(lead.card);
			},
		};
		const host = liveHost(start, chooser);
		expect(await host.runner.start()).toBe(true);
		await vi.waitFor(() => expect(answerFirst).toBeDefined());

		// While East's bot waits for its answer, declarer North claims every trick.
		expect(host.deliver("N", claimRequestPayload(ROOM_ID, 1, 13)).ok).toBe(
			true,
		);
		answerFirst?.();

		// A bot rejects the claim, and East then leads; the bots keep running.
		await vi.waitFor(() =>
			expect(host.state()?.board?.cards).toEqual([lead.card]),
		);
		host.runner.stop();
		expect(host.state()).toMatchObject({ claim: null, claimResult: null });
		expect(host.onError).not.toHaveBeenCalled();
		expect(asked).toHaveBeenCalledTimes(2);
	});
});

describe("host bot play, refused", () => {
	it("decides a claim that reaches the host just before its card, then plays at the same position", async () => {
		const start = tableState(OPENING);
		const board = parseBridgeState(start, ROOM_ID)?.board;
		const lead = board && legalActions(board, "E")[0];
		if (lead?.type !== "play") throw new Error("East cannot lead");
		const asked = vi.fn();
		const chooser: PlayChooser = {
			stop: () => {},
			choose: async () => {
				asked();
				return playReply(lead.card);
			},
		};
		const host = liveHost(start, chooser);
		// Declarer North's claim reaches the host after the bot chose East's card, so the host refuses the card.
		host.beforeNextBot(() => {
			expect(host.deliver("N", claimRequestPayload(ROOM_ID, 1, 13)).ok).toBe(
				true,
			);
		});
		expect(await host.runner.start()).toBe(true);
		await vi.waitFor(() =>
			expect(host.state()?.board?.cards).toEqual([lead.card]),
		);
		host.runner.stop();
		expect(host.state()).toMatchObject({ claim: null, claimResult: null });
		expect(host.onError).not.toHaveBeenCalled();
		expect(asked).toHaveBeenCalledTimes(2);
	});
});

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
