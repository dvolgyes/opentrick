import { describe, expect, it } from "vitest";
import { randomBelowFrom } from "../../src/bridge/deal";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
	legalActions,
} from "../../src/bridge/engine";
import {
	actionPayload,
	claimRequestPayload,
	claimVotePayload,
	createBridgeModule,
	dealPayload,
	parseBridgeState,
	resetRequestPayload,
	undoRequestPayload,
	undoVotePayload,
} from "../../src/game/bridge";
import { chatPayload } from "../../src/game/chat";
import type { ApplyContext, ApplyResult } from "../../src/game/module";
import {
	APPLICATION_FEATURES,
	type JsonObject,
	SEATS,
	type Seat,
} from "../../src/protocol";
import { bidding, call, DEAL, playing } from "./bridge-fixtures";
import { CONFIG, ROOM_ID } from "./fixtures";

// Plan §12 R4: each deal needs every seat at the table, a player or a robot, so the bidding never starts at a table
// with an empty seat. After the deal, a call or a card needs only its sender, the seat to act, so the others play on
// while a player who is not to act is away.
// A command that waits for a player is marked `waiting`, so the host keeps it for a resend (R3).

const module = createBridgeModule(randomBelowFrom(() => 7));

function stateWith(board: Board | null): JsonObject {
	return { ...module.initialState(ROOM_ID, CONFIG), board };
}

function send(
	state: JsonObject,
	seat: Seat,
	payload: JsonObject,
	present: readonly Seat[],
	control: Pick<ApplyContext, "bots" | "autoplaySeats"> = {},
): ApplyResult {
	return module.apply(
		state,
		{
			roomId: ROOM_ID,
			config: CONFIG,
			seat,
			holder: `holder-${seat}`,
			commandId: "00000000-0000-4000-8000-000000000001",
			seq: 1,
			present,
			...control,
			features: new Map(
				SEATS.map((seat) => [seat, Object.values(APPLICATION_FEATURES)]),
			),
		},
		payload,
	);
}

function without(...absent: Seat[]): Seat[] {
	return SEATS.filter((seat) => !absent.includes(seat));
}

/** Board 1 after a one-heart contract by North (North deals board 1), so South is dummy and East leads. */
function contract(): Board {
	const board = bidding(createBoard(1, DEAL), "1H P P P");
	const status = boardStatus(board);
	expect([status.phase, status.dummy, status.actor]).toEqual([
		"play",
		"S",
		"E",
	]);
	return board;
}

/** The table state after the actor played the first legal card until the board was over. */
function finished(board: Board): JsonObject {
	let state = stateWith(board);
	let current = board;
	for (let i = 0; i < 52; i++) {
		const seat = boardStatus(current).actor;
		if (seat === undefined) break;
		const [action] = legalActions(current, seat);
		if (!action) throw new Error("no legal action");
		const result = send(
			state,
			seat,
			actionPayload(ROOM_ID, current, action),
			SEATS,
		);
		if (!result.ok) throw new Error(result.reason);
		state = result.state;
		current = state.board as unknown as Board;
	}
	expect(boardStatus(current).phase).toBe("complete");
	return state;
}

describe("the presence rule for game actions", () => {
	it("allows repeated undo of a declarer's autoplay actions after control returns", () => {
		let board = playing(contract(), "S7 S2 C2");
		const action = legalActions(board, "N")[0];
		if (!action) throw new Error("no legal autoplay action");
		const played = applyAction(board, "N", action);
		if (!played.ok) throw new Error(played.reason);
		board = played.board;
		let state = stateWith(board);
		// The human has taken back North; the bots still control the other three seats.
		const control = { bots: ["E", "S", "W"] as Seat[] };
		for (const length of [3, 1, 0]) {
			const requested = send(
				state,
				"N",
				undoRequestPayload(ROOM_ID, board.number),
				SEATS,
				control,
			);
			if (!requested.ok) throw new Error(requested.reason);
			const pending = parseBridgeState(requested.state, ROOM_ID)?.undo;
			if (!pending) throw new Error("undo was not stored");
			state = requested.state;
			for (const voter of ["E", "W"] as const) {
				const vote = send(
					state,
					voter,
					undoVotePayload(ROOM_ID, pending.id, true),
					SEATS,
					control,
				);
				if (!vote.ok) throw new Error(vote.reason);
				state = vote.state;
			}
			expect(parseBridgeState(state, ROOM_ID)?.board?.cards).toHaveLength(
				length,
			);
		}
		const rewound = parseBridgeState(state, ROOM_ID)?.board;
		if (!rewound) throw new Error("no rewound board");
		expect(boardStatus(rewound).phase).toBe("auction");
		expect(
			send(
				state,
				"N",
				undoRequestPayload(ROOM_ID, board.number),
				SEATS,
				control,
			),
		).toMatchObject({
			ok: false,
			reason: "you have no bid or card to take back",
		});
	});

	it("takes back a defender's final pass after play starts, with both opposing players voting", () => {
		const board = playing(contract(), "S7");
		const requested = send(
			stateWith(board),
			"W",
			undoRequestPayload(ROOM_ID, board.number),
			SEATS,
		);
		expect(requested.ok).toBe(true);
		if (!requested.ok) return;
		const pending = parseBridgeState(requested.state, ROOM_ID)?.undo;
		expect(pending).toMatchObject({
			requester: "W",
			calls: 3,
			cards: 0,
			required: ["N", "S"],
		});
		if (!pending) throw new Error("undo was not stored");
		let state = requested.state;
		for (const voter of ["N", "S"] as const) {
			const vote = send(
				state,
				voter,
				undoVotePayload(ROOM_ID, pending.id, true),
				SEATS,
			);
			if (!vote.ok) throw new Error(vote.reason);
			state = vote.state;
		}
		const rewound = parseBridgeState(state, ROOM_ID)?.board;
		expect(rewound?.calls).toEqual(["1H", "P", "P"]);
		expect(rewound?.cards).toEqual([]);
		expect(parseBridgeState(state, ROOM_ID)?.bidHistory).toHaveLength(3);
		if (!rewound) throw new Error("no rewound board");
		expect(boardStatus(rewound).phase).toBe("auction");
	});

	it("asks a human dummy to approve an opponent's undo when declarer is a bot", () => {
		const afterThree = playing(contract(), "S7 S2 C2");
		const fourth = legalActions(afterThree, "N")[0];
		if (!fourth) throw new Error("North has no legal card");
		const result = applyAction(afterThree, "N", fourth);
		if (!result.ok) throw new Error(result.reason);
		const board = result.board;
		const requested = send(
			stateWith(board),
			"E",
			undoRequestPayload(ROOM_ID, board.number),
			SEATS,
			{ bots: ["N"] },
		);
		expect(requested.ok).toBe(true);
		if (!requested.ok) return;
		expect(parseBridgeState(requested.state, ROOM_ID)?.undo?.required).toEqual([
			"N",
			"S",
		]);
	});
	it.each(["undo", "claim-all", "claim-two", "claim-none"] as const)(
		"lets human dummy request %s when controlling the bot declarer",
		(operation) => {
			const board = playing(contract(), "S7 S2");
			const control = { bots: ["N", "E", "W"] as Seat[] };
			const payload =
				operation === "undo"
					? undoRequestPayload(ROOM_ID, board.number)
					: claimRequestPayload(
							ROOM_ID,
							board.number,
							operation === "claim-all"
								? 13
								: operation === "claim-two"
									? 2
									: 0,
						);
			const requested = send(stateWith(board), "S", payload, SEATS, control);
			expect(requested.ok).toBe(true);
			if (!requested.ok) return;
			const parsed = parseBridgeState(requested.state, ROOM_ID);
			const pending = operation === "undo" ? parsed?.undo : parsed?.claim;
			expect(pending).toMatchObject({ requester: "S", required: ["E", "W"] });
			if (!pending) throw new Error("request was not stored");
			let state = requested.state;
			for (const seat of ["E", "W"] as const) {
				const vote =
					operation === "undo"
						? undoVotePayload(ROOM_ID, pending.id, true)
						: claimVotePayload(ROOM_ID, pending.id, true);
				// An accepted request remains valid if the bot roster changes before the last vote.
				const result = send(
					state,
					seat,
					vote,
					SEATS,
					seat === "E" ? control : {},
				);
				expect(result.ok).toBe(true);
				if (!result.ok) return;
				state = result.state;
			}
			const final = parseBridgeState(state, ROOM_ID);
			if (operation === "undo") expect(final?.board?.cards).toHaveLength(1);
			else
				expect(final?.claimResult).toMatchObject({
					requester: "S",
					tricks:
						operation === "claim-all" ? 13 : operation === "claim-two" ? 2 : 0,
					result: {
						declarerTricks:
							operation === "claim-all"
								? 13
								: operation === "claim-two"
									? 2
									: 0,
					},
				});
			for (const denied of [
				{},
				{ bots: ["N", "S"] as Seat[] },
				{ bots: ["N"] as Seat[], autoplaySeats: ["N"] as Seat[] },
			]) {
				expect(
					send(
						stateWith(board),
						"S",
						{ ...payload, bots: ["N"] },
						SEATS,
						denied,
					).ok,
				).toBe(false);
			}
		},
	);
	it.each(["S", "N"] as const)(
		"lets human dummy select a card from %s when declarer is a robot",
		(hand) => {
			const board = playing(contract(), hand === "S" ? "S7" : "S7 S2 C2");
			expect(boardStatus(board).turn).toBe(hand);
			const action = legalActions(board, "N")[0];
			if (!action) throw new Error("no card to play");
			const payload = actionPayload(ROOM_ID, board, action);
			const state = stateWith(board);
			const control = { bots: ["N"] as Seat[] };
			expect(send(state, "S", payload, ["S"], control).ok).toBe(true);
			expect(
				send(
					state,
					"S",
					{ ...payload, card: hand === "S" ? "H6" : "HA" },
					SEATS,
					control,
				),
			).toMatchObject({
				ok: false,
				reason: expect.stringContaining("does not follow suit"),
			});
			expect(
				send(state, "S", { ...payload, card: "S7" }, SEATS, control).ok,
			).toBe(false);
			// A human declarer still controls a robot dummy.
			expect(send(state, "N", payload, SEATS, { bots: ["S"] }).ok).toBe(true);
			for (const other of ["N", "E", "W"] as const)
				expect(send(state, other, payload, SEATS, control).ok).toBe(false);
			// Sender-controlled fields cannot grant card control.
			expect(send(state, "S", { ...payload, bots: ["N"] }, SEATS).ok).toBe(
				false,
			);
			for (const autoplay of [
				{ bots: ["N", "S"] as Seat[] },
				{ bots: ["N"] as Seat[], autoplaySeats: ["N"] as Seat[] },
			]) {
				expect(send(state, "S", payload, SEATS, autoplay).ok).toBe(false);
				expect(send(state, "N", payload, SEATS, autoplay).ok).toBe(true);
			}
		},
	);

	it("deals only when all four players are present", () => {
		expect(
			send(stateWith(null), "N", dealPayload(ROOM_ID, 1), without("W")),
		).toEqual({
			ok: false,
			reason: "Waiting for West to come back",
			waiting: true,
		});
		expect(send(stateWith(null), "N", dealPayload(ROOM_ID, 1), SEATS).ok).toBe(
			true,
		);
	});

	it("waits with the next board until all four players are present", () => {
		const done = finished(contract());
		expect(send(done, "N", dealPayload(ROOM_ID, 2), without("S"))).toEqual({
			ok: false,
			reason: "Waiting for South to come back",
			waiting: true,
		});
		expect(send(done, "N", dealPayload(ROOM_ID, 2), SEATS).ok).toBe(true);
	});

	it("restarts without a board while a seat is away, so the first deal waits for all four", () => {
		const reset = (present: readonly Seat[]) => {
			const result = send(
				finished(contract()),
				"N",
				resetRequestPayload(ROOM_ID),
				present,
			);
			if (!result.ok) throw new Error(result.reason);
			return parseBridgeState(result.state, ROOM_ID);
		};
		const alone = reset(["N"]);
		expect([alone?.board, alone?.results]).toEqual([null, []]);
		expect(
			send(finished(contract()), "N", resetRequestPayload(ROOM_ID), SEATS).ok,
		).toBe(true);
	});

	it("accepts a call from the seat to bid while the other three are away", () => {
		const board = createBoard(1, DEAL);
		const payload = actionPayload(ROOM_ID, board, call("1H"));
		expect(send(stateWith(board), "N", payload, ["N"]).ok).toBe(true);
	});

	it("plays a card while the other players are away, also from dummy", () => {
		const board = contract();
		const [lead] = legalActions(board, "E");
		if (!lead) throw new Error("no lead");
		const led = send(
			stateWith(board),
			"E",
			actionPayload(ROOM_ID, board, lead),
			["E"],
		);
		if (!led.ok) throw new Error(led.reason);
		const next = led.state.board as unknown as Board;
		expect(boardStatus(next).actor).toBe("N");
		const [fromDummy] = legalActions(next, "N");
		if (!fromDummy) throw new Error("no card in dummy");
		expect(
			send(led.state, "N", actionPayload(ROOM_ID, next, fromDummy), ["N"]).ok,
		).toBe(true);
	});

	it("names every absent player for the first deal, in seat order", () => {
		expect(send(stateWith(null), "N", dealPayload(ROOM_ID, 1), ["N"])).toEqual({
			ok: false,
			reason: "Waiting for East, South and West to come back",
			waiting: true,
		});
	});

	it("checks the rules before presence, so a stale action keeps its own reason", () => {
		const board = contract();
		const stale = actionPayload(ROOM_ID, createBoard(1, DEAL), call("1H"));
		expect(send(stateWith(board), "N", stale, ["N"])).toEqual({
			ok: false,
			reason: "the table has moved on since this action was chosen",
		});
		expect(send(stateWith(board), "N", dealPayload(ROOM_ID, 2), ["N"])).toEqual(
			{
				ok: false,
				reason: "board 1 is not over",
			},
		);
	});

	it("needs nobody else for a chat message", () => {
		expect(
			send(stateWith(null), "N", chatPayload(ROOM_ID, "back soon"), []).ok,
		).toBe(true);
	});
});
