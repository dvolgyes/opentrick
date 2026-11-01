import type { LocalBidder } from "../bot/bid-network";
import { type BidPosition, bidPosition } from "../bot/bid-position";
import { type BidChooser, BrowserBidder } from "../bot/browser-bidder";
import { BotRequestAbortedError } from "../bot/errors";
import { type Board, boardStatus } from "../bridge/engine";
import type { Call } from "../bridge/rules";
import type { Seat } from "../protocol";

/**
 * Asks the local bidder in this browser for the call that the bot would make for the viewer. The bidder sees only the
 * viewer's own hand and the public auction, as a bot at the table does.
 */
export interface BotBidHint {
	/**
	 * A new position, or a new policy, clears the shown call and starts a new request; the previous request stops.
	 * The same position keeps the running request or its result. Undefined: no call to show.
	 */
	update(position: BidPosition | undefined, policy: LocalBidder): void;
	stop(): void;
}

/** The viewer's position while it is the viewer's turn to call, else undefined. */
export function viewerBidPosition(
	board: Board | null | undefined,
	seat: Seat,
): BidPosition | undefined {
	if (!board) return undefined;
	const status = boardStatus(board);
	return status.phase === "auction" && status.actor === seat
		? bidPosition(board, seat)
		: undefined;
}

export function botBidHint(
	show: (call: Call | undefined) => void,
	bidder: BidChooser = new BrowserBidder(),
): BotBidHint {
	let asked: string | undefined;
	let abort: AbortController | undefined;
	return {
		update(position, policy) {
			const key =
				position === undefined ? undefined : JSON.stringify([policy, position]);
			if (key === asked) return;
			asked = key;
			abort?.abort();
			abort = undefined;
			show(undefined);
			if (position === undefined) return;
			const request = new AbortController();
			abort = request;
			bidder.choose(position, policy, request.signal).then(
				(analysis) => {
					if (abort === request) show(analysis.call);
				},
				(error: unknown) => {
					// A failed hint leaves the bid box as it is; the player bids without it.
					if (!(error instanceof BotRequestAbortedError))
						console.warn("The bot's call could not be computed.", error);
				},
			);
		},
		stop() {
			asked = undefined;
			abort?.abort();
			abort = undefined;
			bidder.stop();
		},
	};
}
