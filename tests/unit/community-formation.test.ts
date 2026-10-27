import { describe, expect, it } from "vitest";
import {
	botsReady,
	type Group,
	placements,
	proposeMerge,
	rotate,
	validMerge,
} from "../../src/community/formation";
import { SEATS, type Seat } from "../../src/protocol";

function group(id: string, seats: readonly Seat[]): Group {
	const members = seats.map((seat, index) => ({
		id: `${id}_player_${index}`,
		name: `Player ${index}`,
		seat,
	}));
	const first = members[0];
	if (!first) throw new Error("a fixture needs a member");
	return { id, revision: 0, host: first.id, members };
}

describe("community seating", () => {
	it("preserves per-seat online and bot constraints through rotations and rejects conflicting vacancies", () => {
		const a: Group = {
			...group("group_aaa", ["N"]),
			open: { E: "online", S: "both", W: "bot" },
		};
		const b: Group = {
			...group("group_bbb", ["N"]),
			open: { E: "bot", S: "both", W: "both" },
		};
		const merge = proposeMerge("merge_new", a, b);
		expect(merge?.result.members.map((row) => row.seat)).toEqual(["N", "S"]);
		expect(merge?.result.open).toEqual({ E: "online", W: "bot" });
		if (!merge) throw new Error("compatible parties must merge");
		expect(
			validMerge({
				...merge,
				result: { ...merge.result, open: { E: "both", W: "both" } },
			}),
		).toBe(false);
		const humansOnly: Group = {
			...b,
			open: { E: "online", S: "online", W: "online" },
		};
		expect(placements(a, humansOnly)).toEqual([]);
	});
	it("uses an explicitly open neighbouring seat when a solo's opposite seat is bot-only", () => {
		const a: Group = {
			...group("group_aaa", ["N"]),
			open: { E: "both", S: "bot", W: "bot" },
		};
		const merge = proposeMerge("merge_new", a, group("group_bbb", ["N"]));
		expect(merge?.result.members.map((row) => row.seat)).toEqual(["N", "E"]);
	});
	it("checks all concrete layouts against an independent occupancy search", () => {
		for (let a = 1; a < 15; a++)
			for (let b = 1; b < 15; b++) {
				const left = group(
					"group_aaa",
					SEATS.filter((_, index) => a & (1 << index)),
				);
				const right = group(
					"group_bbb",
					SEATS.filter((_, index) => b & (1 << index)),
				);
				const canFit = [0, 1, 2, 3].some(
					(r) => (a & (((b << r) | (b >> (4 - r))) & 15)) === 0,
				);
				const choices = placements(left, right);
				expect(choices.length > 0, `${a} + ${b}`).toBe(canFit);
				for (const members of choices) {
					expect(new Set(members.map((member) => member.seat)).size).toBe(
						members.length,
					);
					expect(members.slice(0, left.members.length)).toEqual(left.members);
				}
			}
	});
	it("seats two solos opposite for every initial orientation", () => {
		for (const a of SEATS)
			for (const b of SEATS) {
				const choices = placements(
					group("group_aaa", [a]),
					group("group_bbb", [b]),
				);
				expect(choices).toHaveLength(1);
				expect(choices[0]?.[1]?.seat).toBe(rotate(a, 2));
			}
	});
	it("preserves partnerships and chooses the same survivor for crossed proposals", () => {
		const a = group("group_aaa", ["N", "S"]);
		const b = group("group_bbb", ["E", "W"]);
		expect(proposeMerge("merge_aaa", a, b)).toEqual(
			proposeMerge("merge_aaa", b, a),
		);
		const merged = proposeMerge("merge_aaa", a, b);
		if (!merged) throw new Error("opposite pairs must fit");
		expect(validMerge(merged)).toBe(true);
		expect(
			validMerge({ ...merged, result: { ...merged.result, host: b.host } }),
		).toBe(false);
		expect(
			validMerge({
				...merged,
				result: {
					...merged.result,
					members: merged.result.members.slice(0, 3),
				},
			}),
		).toBe(false);
	});
	it("rejects corner/opposite pairs, duplicate members and stale shape substitutions", () => {
		const a = group("group_aaa", ["N", "S"]);
		const b = group("group_bbb", ["N", "E"]);
		expect(proposeMerge("merge_aaa", a, b)).toBeUndefined();
		expect(placements(a, { ...a, id: "group_ccc" })).toEqual([]);
	});
});

describe("unanimous bot fallback", () => {
	it("requires each current member's consent and elapsed wait, including new arrivals", () => {
		const party = group("group_aaa", ["N", "S"]);
		const [a, b] = party.members;
		if (!a || !b) throw new Error("expected two players");
		const consent = new Map([
			[a.id, { allow: true, waitMs: 60_000, waitedMs: 90_000 }],
		]);
		expect(botsReady(party.members, consent)).toBe(false);
		consent.set(b.id, { allow: true, waitMs: 120_000, waitedMs: 90_000 });
		expect(botsReady(party.members, consent)).toBe(false);
		consent.set(b.id, { allow: true, waitMs: 120_000, waitedMs: 120_000 });
		expect(botsReady(party.members, consent)).toBe(true);
		consent.set(a.id, { allow: false, waitMs: 60_000, waitedMs: 150_000 });
		expect(botsReady(party.members, consent)).toBe(false);
	});
});
