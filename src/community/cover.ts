import { SEAT_GRACE_MS } from "../p2p/limits";
import type { SeatHolder } from "../p2p/wire";
import type { Seat } from "../protocol";

export interface CoverChange {
	readonly seat: Seat;
	readonly board: number | null;
	readonly recruitment?: "invited" | "online" | null;
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
		readonly permanentBots?: ReadonlySet<Seat>;
		readonly recruitment?: Readonly<
			Partial<Record<Seat, "invited" | "online">>
		>;
	}): readonly CoverChange[] {
		const result: CoverChange[] = [];
		const alreadyRecruiting = input.humans.find(
			(seat) =>
				input.seats.find((row) => row.seat === seat)?.recruiting !== undefined,
		);
		const nextRecruitment =
			alreadyRecruiting ??
			input.humans.find((seat) => {
				const row = input.seats.find((item) => item.seat === seat);
				return (
					row?.holder !== null &&
					row?.holder !== undefined &&
					!input.online.has(seat) &&
					input.now - (this.#missing.get(seat) ?? input.now) >= SEAT_GRACE_MS
				);
			});
		for (const seat of input.humans) {
			const row = input.seats.find((row) => row.seat === seat);
			const online = input.online.has(seat);
			if (online) this.#missing.delete(seat);
			else if (!this.#missing.has(seat)) this.#missing.set(seat, input.now);
			if (!row?.holder || input.board === 0) continue;
			if (input.permanentBots?.has(seat) || row.communityBot) {
				if (row.recruiting !== undefined)
					result.push({
						seat,
						board: row.coverBoard ?? null,
						recruitment: null,
					});
				continue;
			}
			if (row.coverBoard !== undefined) {
				if (input.complete)
					result.push({
						seat,
						board: null,
						...(seat === nextRecruitment && !online
							? { recruitment: input.recruitment?.[seat] ?? "online" }
							: online
								? { recruitment: null }
								: {}),
					});
				else if (row.coverBoard !== input.board)
					result.push({
						seat,
						board: null,
						...(seat === nextRecruitment
							? { recruitment: input.recruitment?.[seat] ?? "online" }
							: {}),
					});
				else if (seat === nextRecruitment && row.recruiting === undefined)
					result.push({
						seat,
						board: row.coverBoard,
						recruitment: input.recruitment?.[seat] ?? "online",
					});
			} else if (
				!online &&
				input.now - (this.#missing.get(seat) ?? input.now) >= SEAT_GRACE_MS
			) {
				result.push({
					seat,
					board: input.complete ? null : input.board,
					...(seat === nextRecruitment
						? { recruitment: input.recruitment?.[seat] ?? "online" }
						: {}),
				});
			} else if (
				!online &&
				seat === nextRecruitment &&
				row.recruiting === undefined
			) {
				result.push({
					seat,
					board: row.coverBoard ?? null,
					recruitment: input.recruitment?.[seat] ?? "online",
				});
			} else if (online && row.recruiting !== undefined && input.complete) {
				result.push({ seat, board: null, recruitment: null });
			}
		}
		return result;
	}
	reset(): void {
		this.#missing.clear();
	}
}
