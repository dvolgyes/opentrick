import { type Board, boardStatus } from "../bridge/engine";

/** Holds the final auction locally before the opening lead; later renders do not restart the countdown. */
export class AuctionPause {
	#key: string | null = null;
	#startedAt = 0;

	remaining(
		board: Board | null | undefined,
		durationMs: number,
		now: number,
	): number {
		if (
			!board ||
			board.cards.length > 0 ||
			boardStatus(board).phase !== "play"
		) {
			this.#key = null;
			return 0;
		}
		const key = `${board.number}:${board.calls.join(",")}`;
		if (key !== this.#key) {
			this.#key = key;
			this.#startedAt = now;
		}
		return Math.max(
			0,
			Math.ceil((durationMs - (now - this.#startedAt)) / 1000),
		);
	}
}
