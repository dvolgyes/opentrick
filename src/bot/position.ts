import type { Board } from "../bridge/engine";
import { SEATS } from "../protocol";

/** Stable key for the bidding or play position whose action the bot is considering. */
export function actionPositionKey(board: Board): string {
	// Reset can redeal board 1 with the same calls and cards but different hands.
	const deal = SEATS.map((seat) => board.deal[seat].join(",")).join("/");
	return `action:${board.number}:${deal}:${board.calls.join(",")}:${board.cards.join(",")}`;
}

/** Confirms the board has not changed while the bot selected an action. */
export function matchesActionPosition(board: Board, key: string): boolean {
	return actionPositionKey(board) === key;
}
