import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BidChooser } from "../../src/bot/browser-bidder";
import type { PlayChooser } from "../../src/bot/browser-play";
import { BotRequestAbortedError } from "../../src/bot/errors";
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
	resetRequestPayload,
	resetVotePayload,
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
function liveHost(
	state: JsonObject,
	playEngine: PlayChooser,
	bidEngine?: BidChooser,
	initialBots: readonly Seat[] = ["E", "W"],
) {
	let current = state;
	let bots = initialBots;
	let autoplaySeats: readonly Seat[] = [];
	let hosting = true;
	let beforeBot: (() => void) | undefined;
	let seq = 1000;
	const listeners = new Set<() => void>();
	const deliver = (seat: Seat, payload: JsonObject) => {
		seq += 1;
		const result = MODULE.apply(
			current,
			{ ...contextFor(seat, seq), bots, autoplaySeats },
			payload,
		);
		if (!result.ok) return { ok: false as const, reason: result.reason };
		current = result.state;
		for (const listener of listeners) listener();
		return { ok: true as const };
	};
	const controller = {
		tableId: ROOM_ID,
		view: () => ({
			hosting,
			ready: true,
			seat: "N",
			table: { config: CONFIG, state: current },
			roster: { bots, autoplaySeats },
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
		runner: new HostBotRunner(
			controller,
			SETTINGS,
			onError,
			playEngine,
			bidEngine,
		),
		loseHost: () => {
			hosting = false;
		},
		onError,
		deliver,
		setControl: (nextBots: readonly Seat[], autoplay: readonly Seat[] = []) => {
			bots = nextBots;
			autoplaySeats = autoplay;
			for (const listener of listeners) listener();
		},
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

beforeEach(() =>
	vi.useFakeTimers({
		toFake: ["Date", "performance", "setTimeout", "clearTimeout"],
	}),
);
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("host bot play", () => {
	it("waits for human dummy, resumes on autoplay, and discards a late choice when autoplay stops", async () => {
		const start = tableState([
			...["P", "P", "1C", "P", "P", "P"].map((text) => act(call(text))),
			act(),
		]);
		const board = parseBridgeState(start, ROOM_ID)?.board;
		if (!board) throw new Error("no board");
		expect(boardStatus(board)).toMatchObject({
			dummy: "N",
			actor: "S",
			turn: "N",
		});
		const action = legalActions(board, "S")[0];
		if (action?.type !== "play") throw new Error("no dummy card");
		let answer: (() => void) | undefined;
		const choose = vi.fn(async () => {
			await new Promise<void>((resolve) => {
				answer = resolve;
			});
			return playReply(action.card);
		});
		const host = liveHost(start, { choose, stop: () => {} }, undefined, ["S"]);
		expect(await host.runner.start()).toBe(true);
		await vi.advanceTimersByTimeAsync(6000);
		expect(choose).not.toHaveBeenCalled();
		host.setControl(["N", "S"], ["N"]);
		expect(choose).toHaveBeenCalledTimes(1);
		host.setControl(["S"]);
		answer?.();
		await vi.advanceTimersByTimeAsync(6000);
		expect(host.state()?.board?.cards).toEqual(board.cards);
		expect(host.onError).not.toHaveBeenCalled();
		// Resuming at the same position must not be blocked by the discarded choice.
		host.setControl(["N", "S"], ["N"]);
		expect(choose).toHaveBeenCalledTimes(2);
		answer?.();
		await vi.advanceTimersByTimeAsync(6000);
		expect(host.state()?.board?.cards).toEqual([...board.cards, action.card]);
		host.runner.stop();
	});

	it("accepts a claim made while it chooses a card, and drops the card", async () => {
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
		expect(answerFirst).toBeDefined();

		// While East's bot waits for its answer, declarer North claims every trick.
		expect(host.deliver("N", claimRequestPayload(ROOM_ID, 1, 13)).ok).toBe(
			true,
		);
		answerFirst?.();

		// The bots accept the claim, so the board ends without East's card; the bots keep running.
		await vi.advanceTimersByTimeAsync(6000);
		expect(host.state()?.board?.cards).toEqual([]);
		host.runner.stop();
		expect(host.state()).toMatchObject({
			claim: null,
			claimResult: { requester: "N", tricks: 13 },
		});
		expect(host.onError).not.toHaveBeenCalled();
		expect(asked).toHaveBeenCalledTimes(1);
	});
});

describe("host bot play, refused", () => {
	it("accepts a claim that reaches the host just before its card, and drops the card", async () => {
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
		await vi.advanceTimersByTimeAsync(6000);
		expect(host.state()?.board?.cards).toEqual([]);
		host.runner.stop();
		expect(host.state()).toMatchObject({
			claim: null,
			claimResult: { requester: "N", tricks: 13 },
		});
		expect(host.onError).not.toHaveBeenCalled();
		expect(asked).toHaveBeenCalledTimes(1);
	});
});

describe("host bot votes", () => {
	it("accepts every claim", async () => {
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
				approve: true,
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

describe("bot pacing", () => {
	it("discards an old-hand decision when a reset redeals the same board number", async () => {
		let finishOld: (() => void) | undefined;
		let decisions = 0;
		const host = liveHost(
			tableState([]),
			{ choose: vi.fn(), stop: () => {} },
			{
				choose: async () => {
					decisions += 1;
					if (decisions === 1) {
						await new Promise<void>((resolve) => {
							finishOld = resolve;
						});
						return { call: "1C", policy: "sl", candidates: [] };
					}
					return { call: "P", policy: "sl", candidates: [] };
				},
				stop: () => {},
			},
		);
		host.runner.setSeatEnabled("E", false);
		host.runner.setSeatEnabled("W", false);
		await host.runner.start(["N"]);
		const oldDeal = host.state()?.board?.deal;
		expect(host.deliver("S", resetRequestPayload(ROOM_ID))).toEqual({
			ok: true,
		});
		const request = host.state()?.reset;
		if (!request) throw new Error("no reset request");
		// Players can approve a reset themselves while their autoplay decision is still running.
		for (const seat of ["E", "W", "N"] as const)
			expect(
				host.deliver(seat, resetVotePayload(ROOM_ID, request.id, true)),
			).toEqual({ ok: true });
		expect(host.state()?.board?.number).toBe(1);
		expect(host.state()?.board?.deal).not.toEqual(oldDeal);
		if (!finishOld) throw new Error("no pending decision");
		finishOld();
		await vi.advanceTimersByTimeAsync(3000);
		expect(host.state()?.board?.calls).toEqual(["P"]);
		expect(host.onError).not.toHaveBeenCalled();
		host.runner.stop();
	});

	it.each(["undo", "reset"] as const)(
		"bids again when %s returns to an earlier position",
		async (operation) => {
			const host = liveHost(
				tableState([act(call("1C"))]),
				{ choose: vi.fn(), stop: () => {} },
				{
					choose: async () => ({ call: "P", policy: "sl", candidates: [] }),
					stop: () => {},
				},
			);
			await host.runner.start();
			await vi.advanceTimersByTimeAsync(3000);
			expect(host.state()?.board?.calls).toEqual(["1C", "P"]);
			expect(
				host.deliver(
					"N",
					operation === "undo"
						? undoRequestPayload(ROOM_ID, 1)
						: resetRequestPayload(ROOM_ID),
				),
			).toEqual({ ok: true });
			await vi.advanceTimersByTimeAsync(0);
			if (operation === "reset") {
				const request = host.state()?.reset;
				if (!request) throw new Error("no reset request");
				expect(
					host.deliver("S", resetVotePayload(ROOM_ID, request.id, true)),
				).toEqual({ ok: true });
			}
			expect(host.state()?.board?.calls).toEqual([]);
			const board = host.state()?.board;
			if (!board) throw new Error("no board after request");
			expect(
				host.deliver("N", actionPayload(ROOM_ID, board, call("1C"))),
			).toEqual({ ok: true });
			await vi.advanceTimersByTimeAsync(2999);
			expect(host.state()?.board?.calls).toEqual(["1C"]);
			await vi.advanceTimersByTimeAsync(1);
			expect(host.state()?.board?.calls).toEqual(["1C", "P"]);
			expect(host.onError).not.toHaveBeenCalled();
			host.runner.stop();
		},
	);

	function cardHost(steps = 2, calculationMs = 0) {
		const state = tableState([
			...OPENING,
			...Array.from({ length: steps }, () => act()),
		]);
		const board = parseBridgeState(state, ROOM_ID)?.board;
		const actor = board && boardStatus(board).actor;
		const action = board && actor && legalActions(board, actor)[0];
		if (action?.type !== "play") throw new Error("no card to play");
		const choose = vi.fn<PlayChooser["choose"]>(async () => {
			if (calculationMs)
				await new Promise((resolve) => setTimeout(resolve, calculationMs));
			return playReply(action.card);
		});
		return { ...liveHost(state, { choose, stop: () => {} }), choose };
	}

	it("prepares the next bot play during presentation and sends it when presentation ends", async () => {
		const host = cardHost();
		host.runner.setPlayBlocked(true);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(host.choose).toHaveBeenCalledTimes(1);
		expect(host.state()?.board?.cards).toHaveLength(2);
		host.runner.setPlayBlocked(false);
		expect(host.state()?.board?.cards).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(0);
		expect(host.choose).toHaveBeenCalledTimes(1);
		expect(host.state()?.board?.cards).toHaveLength(3);
		host.runner.stop();
	});

	it("continues an in-progress bot choice when presentation becomes blocked", async () => {
		const host = cardHost(2, 2000);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(500);
		expect(host.choose).toHaveBeenCalledTimes(1);
		host.runner.setPlayBlocked(true);
		await vi.advanceTimersByTimeAsync(5000);
		expect(host.state()?.board?.cards).toHaveLength(2);
		host.runner.setPlayBlocked(false);
		await vi.advanceTimersByTimeAsync(2000);
		expect(host.choose).toHaveBeenCalledTimes(1);
		expect(host.state()?.board?.cards).toHaveLength(3);
		expect(host.onError).not.toHaveBeenCalled();
		host.runner.stop();
	});

	it("discards a prepared play when the bots are paused", async () => {
		const host = cardHost();
		host.runner.setPlayBlocked(true);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(host.choose).toHaveBeenCalledTimes(1);
		host.runner.pause();
		host.runner.setPlayBlocked(false);
		await vi.advanceTimersByTimeAsync(2000);
		expect(host.state()?.board?.cards).toHaveLength(2);
		host.runner.resume();
		await vi.advanceTimersByTimeAsync(1000);
		expect(host.choose).toHaveBeenCalledTimes(2);
		expect(host.state()?.board?.cards).toHaveLength(3);
		host.runner.stop();
	});

	it("answers a claim and discards a prepared card while presentation is blocked", async () => {
		const host = cardHost(0);
		host.runner.setPlayBlocked(true);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(host.choose).toHaveBeenCalledTimes(1);
		expect(host.deliver("N", claimRequestPayload(ROOM_ID, 1, 13)).ok).toBe(
			true,
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(host.state()?.claimResult).toMatchObject({
			requester: "N",
			tricks: 13,
		});
		host.runner.setPlayBlocked(false);
		await vi.advanceTimersByTimeAsync(6000);
		expect(host.state()?.board?.cards).toHaveLength(0);
		expect(host.onError).not.toHaveBeenCalled();
		host.runner.stop();
	});

	it("answers a claim promptly while preparing a card during presentation", async () => {
		const choose = vi.fn<PlayChooser["choose"]>(
			(_position, signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => reject(new BotRequestAbortedError()),
						{ once: true },
					);
				}),
		);
		const host = liveHost(tableState(OPENING), { choose, stop: () => {} });
		host.runner.setPlayBlocked(true);
		await host.runner.start();
		expect(choose).toHaveBeenCalledOnce();
		expect(host.deliver("N", claimRequestPayload(ROOM_ID, 1, 13)).ok).toBe(
			true,
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(host.state()?.claimResult).toMatchObject({
			requester: "N",
			tricks: 13,
		});
		expect(host.state()?.board?.cards).toHaveLength(0);
		expect(host.onError).not.toHaveBeenCalled();
		host.runner.stop();
	});

	it("prepares a new card after settings change during presentation", async () => {
		const host = cardHost();
		host.runner.setPlayBlocked(true);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(1000);
		host.runner.updateSettings({ ...SETTINGS, playTimeMs: 7000 });
		await vi.advanceTimersByTimeAsync(1000);
		expect(host.choose).toHaveBeenCalledTimes(2);
		expect(host.choose.mock.calls[1]?.[2]).toBe(7000);
		expect(host.state()?.board?.cards).toHaveLength(2);
		host.runner.setPlayBlocked(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(host.state()?.board?.cards).toHaveLength(3);
		host.runner.stop();
	});

	it("discards a prepared card when the bot loses control of its seat", async () => {
		const host = cardHost();
		host.runner.setPlayBlocked(true);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(1000);
		expect(host.choose).toHaveBeenCalledTimes(1);
		host.setControl([]);
		host.runner.setPlayBlocked(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(host.state()?.board?.cards).toHaveLength(2);
		host.setControl(["E", "W"]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(host.choose).toHaveBeenCalledTimes(2);
		expect(host.state()?.board?.cards).toHaveLength(3);
		host.runner.stop();
	});

	it("holds a fast card for one second, and does not add another second to a slow decision", async () => {
		for (const calculationMs of [0, 2000]) {
			const host = cardHost(2, calculationMs);
			await host.runner.start();
			await vi.advanceTimersByTimeAsync(Math.max(1000, calculationMs) - 1);
			expect(host.state()?.board?.cards).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(1);
			expect(host.state()?.board?.cards).toHaveLength(3);
			host.runner.stop();
		}
	});

	it("holds the opening lead for the auction pause", async () => {
		const host = cardHost(0);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(4999);
		expect(host.state()?.board?.cards).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(host.state()?.board?.cards).toHaveLength(1);
		host.runner.stop();
	});

	it("allows zero bid, card, and auction delays", async () => {
		const timing = {
			...SETTINGS,
			botCardDelayMs: 0,
			botBidDelayMs: 0,
			auctionPauseMs: 0,
		};
		const card = cardHost(0);
		card.runner.updateSettings(timing);
		await card.runner.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(card.state()?.board?.cards).toHaveLength(1);
		card.runner.stop();
		const bid = liveHost(
			tableState([act(call("1C"))]),
			{ choose: vi.fn(), stop: () => {} },
			{
				choose: async () => ({ call: "P", policy: "sl", candidates: [] }),
				stop: () => {},
			},
		);
		bid.runner.updateSettings(timing);
		await bid.runner.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(bid.state()?.board?.calls).toEqual(["1C", "P"]);
		bid.runner.stop();
	});

	it("holds a quick bid for three seconds", async () => {
		const host = liveHost(
			tableState([act(call("1C"))]),
			{ choose: vi.fn(), stop: () => {} },
			{
				choose: async () => ({ call: "P", policy: "sl", candidates: [] }),
				stop: () => {},
			},
		);
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(2999);
		expect(host.state()?.board?.calls).toEqual(["1C"]);
		await vi.advanceTimersByTimeAsync(1);
		expect(host.state()?.board?.calls).toEqual(["1C", "P"]);
		host.runner.stop();
	});

	it("cancels a queued card on pause or host loss, and resumes with the current settings", async () => {
		const host = cardHost();
		await host.runner.start();
		await vi.advanceTimersByTimeAsync(500);
		host.runner.pause();
		await vi.advanceTimersByTimeAsync(2000);
		expect(host.state()?.board?.cards).toHaveLength(2);
		host.runner.updateSettings({
			...SETTINGS,
			botCardDelayMs: 2000,
			playTimeMs: 7000,
		});
		host.runner.resume();
		await vi.advanceTimersByTimeAsync(1999);
		expect(host.state()?.board?.cards).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(host.state()?.board?.cards).toHaveLength(3);
		expect(host.choose.mock.calls.at(-1)?.[2]).toBe(7000);
		host.runner.stop();
		const former = cardHost();
		await former.runner.start();
		await vi.advanceTimersByTimeAsync(500);
		former.loseHost();
		await vi.advanceTimersByTimeAsync(1000);
		expect(former.state()?.board?.cards).toHaveLength(2);
		former.runner.stop();
	});
});
