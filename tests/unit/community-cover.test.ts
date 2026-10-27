import { expect, it } from "vitest";
import { CommunityCover } from "../../src/community/cover";
import { SEAT_GRACE_MS } from "../../src/p2p/limits";
import type { Seat } from "../../src/protocol";

it("waits through reload grace, covers the board, and restores the same human only at its end", () => {
	const policy = new CommunityCover();
	const input = {
		now: 0,
		board: 4,
		complete: false,
		humans: ["E"] as Seat[],
		online: new Set<Seat>(),
		seats: [{ seat: "E" as const, holder: "abcdefghijklmnop", gen: 7 }],
	};
	expect(policy.changes(input)).toEqual([]);
	expect(policy.changes({ ...input, now: SEAT_GRACE_MS - 1 })).toEqual([]);
	expect(policy.changes({ ...input, now: SEAT_GRACE_MS })).toEqual([
		{ seat: "E", board: 4 },
	]);
	const covered = {
		...input,
		now: SEAT_GRACE_MS,
		seats: input.seats.map((row) => ({ ...row, coverBoard: 4 })),
		online: new Set<Seat>(["E"]),
	};
	expect(policy.changes(covered)).toEqual([]);
	expect(policy.changes({ ...covered, complete: true })).toEqual([
		{ seat: "E", board: null },
	]);
	expect(new CommunityCover().changes(covered)).toEqual([]);
});

it("does not fill a missing initial player without consent and carries cover into the next board", () => {
	const policy = new CommunityCover();
	const input = {
		now: 0,
		board: 0,
		complete: false,
		humans: ["N"] as Seat[],
		online: new Set<Seat>(),
		seats: [{ seat: "N" as const, holder: "abcdefghijklmnop", gen: 1 }],
	};
	policy.changes(input);
	expect(policy.changes({ ...input, now: SEAT_GRACE_MS * 10 })).toEqual([]);
	expect(
		policy.changes({
			...input,
			board: 3,
			seats: input.seats.map((row) => ({ ...row, coverBoard: 2 })),
		}),
	).toEqual([{ seat: "N", board: 3 }]);
});
