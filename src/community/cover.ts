import { SEAT_GRACE_MS } from "../p2p/limits";
import type { SeatHolder } from "../p2p/wire";
import type { Seat } from "../protocol";

export interface CoverChange {
	readonly seat: Seat;
	readonly board: number | null;
}

/** The board boundary returns control; neither a reconnect nor a new host ends cover in mid-board. */
export class CommunityCover {
	readonly #missing = new Map<Seat, number>();
	changes(input: {
		readonly now: number;
		readonly board: number;
		readonly complete: boolean;
		readonly humans: readonly Seat[];
		readonly online: ReadonlySet<Seat>;
		readonly seats: readonly SeatHolder[];
	}): readonly CoverChange[] {
		const result: CoverChange[] = [];
		for (const seat of input.humans) {
			const row = input.seats.find((row) => row.seat === seat);
			const online = input.online.has(seat);
			if (online) this.#missing.delete(seat);
			else if (!this.#missing.has(seat)) this.#missing.set(seat, input.now);
			if (!row?.holder || input.board === 0) continue;
			if (row.coverBoard !== undefined) {
				if (online && input.complete) result.push({ seat, board: null });
				else if (row.coverBoard !== input.board)
					result.push({ seat, board: input.board });
			} else if (
				!online &&
				input.now - (this.#missing.get(seat) ?? input.now) >= SEAT_GRACE_MS
			)
				result.push({ seat, board: input.board });
		}
		return result;
	}
	reset(): void {
		this.#missing.clear();
	}
}
