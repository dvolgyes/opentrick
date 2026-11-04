import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
	legalActions,
	scoreBoard,
} from "../../src/bridge/engine";
import type { BridgeState } from "../../src/game/bridge";
import type { OutboxItem } from "../../src/p2p/outbox";
import type { CommandFailure } from "../../src/p2p/table";
import {
	type JsonObject,
	type RoomConfig,
	SEAT_NAMES,
	type Seat,
	seatAfter,
} from "../../src/protocol";
import type { RosterRow } from "../../src/ui/model";
import {
	type HandDisplay,
	type TableView,
	type TableViewInput,
	tableView,
} from "../../src/ui/table-model";
import { bidding, DEAL, playing } from "./bridge-fixtures";

export const TABLE_ID = "Table_ID-0123456789abc";
export const CONFIG: RoomConfig = {
	names: { N: "player1", E: "player3", S: "player2", W: "player4" },
	scoring: "duplicate",
};
export const ALL = new Set<Seat>(["N", "E", "S", "W"]);
export const ROSTER: RosterRow[] = (["N", "E", "S", "W"] as const).map(
	(seat) => ({
		seat,
		label: SEAT_NAMES[seat],
		host: seat === "N",
		you: seat === "N",
		state: "online",
		releasable: false,
	}),
);

export function tableState(board: Board | null): BridgeState {
	const result = board && scoreBoard(board);
	const earlier = board ? board.number - 1 : 0;
	const results = Array.from({ length: earlier }, (_, i) => ({
		number: i + 1,
		contract: null,
		declarerTricks: 0,
		scoreNS: 0,
	}));
	return {
		v: 1,
		roomId: TABLE_ID,
		game: "bridge",
		messages: 0,
		board,
		results: result ? [...results, result] : results,
		undo: null,
		claim: null,
		claimResult: null,
		media: {},
		systems: {},
	};
}

export function view(
	seat: Seat,
	board: Board | null,
	overrides: Partial<TableViewInput> = {},
): TableView {
	// A constructed auction with declared systems represents calls made under those systems.
	// Tests for legacy or changed systems supply their own recorded history.
	const source = Object.hasOwn(overrides, "state")
		? overrides.state
		: tableState(board);
	const sourceBoard = source?.board;
	const historical =
		source && sourceBoard && source.bidHistory === undefined
			? {
					...source,
					bidHistory: sourceBoard.calls.map((_, index) => {
						const caller = seatAfter(sourceBoard.dealer, index);
						const system = source.systems[caller];
						return {
							controller: "seat" as const,
							...(system === undefined ? {} : { system }),
						};
					}),
				}
			: source;
	return tableView({
		config: CONFIG,
		seat,
		terminal: false,
		present: ALL,
		roster: ROSTER,
		hostSeat: "N",
		outbox: [],
		failures: [],
		undone: [],
		...overrides,
		state: historical,
	});
}

export function queued(
	id: string,
	payload: JsonObject,
	state: OutboxItem["state"] = "queued",
): OutboxItem {
	return { id, payload, order: 1, state };
}

export function refused(
	id: string,
	payload: JsonObject,
	reason: string,
): CommandFailure {
	return { id, payload, status: "rejected", reason };
}

export function seatView(table: TableView, seat: Seat) {
	const found = table.seats.find((item) => item.seat === seat);
	if (!found) throw new Error(`no seat ${seat}`);
	return found;
}

export function shownCards(hand: HandDisplay): string[] {
	return hand.visible
		? hand.suits.flatMap((row) => row.cards.map((c) => c.card))
		: [];
}

export function playableCards(hand: HandDisplay): string[] {
	return hand.visible
		? hand.suits.flatMap((row) =>
				row.cards.filter((c) => c.playable).map((c) => c.card),
			)
		: [];
}

export const BOARD = createBoard(1, DEAL);
/** 1♠ by North; East has led the ♠7, so declarer plays next from dummy (South). */
export const LED = playing(bidding(BOARD, "1S P P P"), "S7");
export const NORTH_DECLARER_BOARD = bidding(BOARD, "1C P P P");

export const NORTH_DUMMY_TURN = playing(NORTH_DECLARER_BOARD, "S7");
export const NORTH_OWN_TURN = playing(NORTH_DECLARER_BOARD, "S7 S4 H3");

/** Plays the first legal card until `count` tricks are complete. */
export function afterTricks(board: Board, count: number): Board {
	let current = board;
	while (boardStatus(current).tricks.length < count) {
		const seat = boardStatus(current).actor;
		const [action] = seat === undefined ? [] : legalActions(current, seat);
		if (seat === undefined || !action) throw new Error("nobody can play");
		const result = applyAction(current, seat, action);
		if (!result.ok) throw new Error(result.reason);
		current = result.board;
	}
	return current;
}
