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
		{ seat: "E", board: 4, recruitment: "online" },
	]);
	const covered = {
		...input,
		now: SEAT_GRACE_MS,
		seats: input.seats.map((row) => ({
			...row,
			coverBoard: 4,
			recruiting: "online" as const,
		})),
		online: new Set<Seat>(["E"]),
	};
	expect(policy.changes(covered)).toEqual([]);
	expect(policy.changes({ ...covered, complete: true })).toEqual([
		{ seat: "E", board: null, recruitment: null },
	]);
	expect(new CommunityCover().changes(covered)).toEqual([]);
});

it("does not cover an initial player before a board and ends temporary cover at the board boundary", () => {
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
			now: SEAT_GRACE_MS * 10,
			board: 3,
			seats: input.seats.map((row) => ({ ...row, coverBoard: 2 })),
		}),
	).toEqual([{ seat: "N", board: null, recruitment: "online" }]);
});

it("offers one replacement seat at a time while covering each missing seat for this board", () => {
	const policy = new CommunityCover();
	const seats = [
		{ seat: "N" as const, holder: "abcdefghijklmnop", gen: 1 },
		{ seat: "E" as const, holder: "qrstuvwxyzABCDEF", gen: 1 },
	];
	const input = {
		now: 0,
		board: 5,
		complete: false,
		humans: ["N", "E"] as Seat[],
		online: new Set<Seat>(),
		seats,
	};
	policy.changes(input);
	expect(policy.changes({ ...input, now: SEAT_GRACE_MS })).toEqual([
		{ seat: "N", board: 5, recruitment: "online" },
		{ seat: "E", board: 5 },
	]);
});

it("keeps an invited seat private and preserves its admission kind", () => {
	const policy = new CommunityCover();
	const input = {
		now: 0,
		board: 2,
		complete: false,
		humans: ["S"] as Seat[],
		online: new Set<Seat>(),
		seats: [{ seat: "S" as const, holder: "abcdefghijklmnop", gen: 1 }],
		recruitment: { S: "invited" as const },
	};
	policy.changes(input);
	expect(policy.changes({ ...input, now: SEAT_GRACE_MS })).toEqual([
		{ seat: "S", board: 2, recruitment: "invited" },
	]);
});
