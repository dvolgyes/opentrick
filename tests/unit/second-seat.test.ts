import { describe, expect, it } from "vitest";
import { secondSeat } from "../../scripts/self-play/second-seat";
import type { PlayPosition } from "../../src/bot/play-position";
import type { Card } from "../../src/bridge/cards";
import { type Seat, seatAfter } from "../../src/protocol";

function position(
	lead: Card,
	legal: Card[],
	dummyCards: Card[] | undefined,
	leader: Seat = "N",
	strain: PlayPosition["contract"]["strain"] = "NT",
): PlayPosition {
	const turn = seatAfter(leader, 1);
	return {
		view: {
			seat: turn,
			declarer: "S",
			dummy: "N",
			trump: strain,
			own: legal,
			dummyCards,
			plays: [{ seat: leader, card: lead, trick: 2 }],
		},
		turn,
		current: { leader, cards: [lead] },
		contract: { level: 3, strain, declarer: "S", doubling: "" },
		vulnerability: "none",
		declarerTricks: 0,
		legal,
		hints: [],
	};
}

describe("offline second-seat defense", () => {
	it("selects the exact lowest follower from unsorted concrete spot ranks", () => {
		const play = position("H8", ["H4", "H2", "HA", "H3"], ["HK"]);
		expect(secondSeat("low", play, "H3")).toBe("H2");
		expect(secondSeat("context", play, "HA")).toBe("H2");
	});

	it.each<{ lead: Card; legal: Card[]; dummy: Card[]; expected: Card }>([
		{
			lead: "HT",
			legal: ["HK", "H7", "H2"],
			dummy: ["H5", "H4"],
			expected: "HK",
		},
		{
			lead: "HJ",
			legal: ["HQ", "H8", "H6", "H4"],
			dummy: ["H3"],
			expected: "HQ",
		},
		{
			lead: "HJ",
			legal: ["HQ", "H9", "H4"],
			dummy: ["HT", "H8"],
			expected: "H4",
		},
		{
			lead: "HQ",
			legal: ["HK", "H7", "H2"],
			dummy: ["HJ", "H8", "H6"],
			expected: "H2",
		},
		{
			lead: "HJ",
			legal: ["HQ", "H2", "HA"],
			dummy: ["HT", "H8", "H6"],
			expected: "HA",
		},
		{
			lead: "H9",
			legal: ["HT", "H3", "HQ"],
			dummy: ["H8", "H2"],
			expected: "HQ",
		},
	])(
		"treats dummy's $lead with $dummy according to visible support and higher honors",
		({ lead, legal, dummy, expected }) => {
			const play = position(lead, legal, dummy);
			expect(secondSeat("low", play, expected)).toBeUndefined();
			expect(secondSeat("context", play, expected)).toBe(expected);
		},
	);

	it("does not extrapolate support from declarer's concealed honor lead", () => {
		const play = position("HJ", ["HQ", "H9", "H4"], ["HT", "H8"], "S");
		expect(secondSeat("context", play, "H4")).toBeUndefined();
		const twoHigher = position("HJ", ["HQ", "H2", "HA"], ["HT"], "S");
		expect(secondSeat("context", twoHigher, "H2")).toBeUndefined();
	});

	it("splits a three-honor sequence or interior sequence, but not a two-honor pair", () => {
		const sequence = position("H4", ["HJ", "H7", "HT", "HQ"], ["H3"]);
		expect(secondSeat("context", sequence, "H7")).toBe("HQ");
		const interior = position(
			"H3",
			["H9", "HK", "H7", "HT"],
			["HA", "HJ", "H8"],
			"S",
		);
		expect(secondSeat("low", interior, "HK")).toBe("H7");
		expect(secondSeat("context", interior, "H9")).toBe("HT");
		const pair = position(
			"H4",
			["HQ", "HJ", "H8", "H3"],
			["HA", "H9", "H7", "H2"],
			"S",
		);
		expect(secondSeat("context", pair, "HJ")).toBe("H3");
		const gaps = position("H4", ["HA", "HQ", "HT", "H3"], [], "S");
		expect(secondSeat("context", gaps, "HT")).toBe("H3");
	});

	it("abstains on trump honor decisions and when a visible cover cannot be classified", () => {
		const trumpHonor = position("HJ", ["HQ", "H4"], [], "N", "H");
		const trumpSplit = position("H4", ["HQ", "HJ", "HT", "H7"], [], "N", "H");
		const trumpSpots = position("H4", ["HQ", "H7", "H2"], [], "N", "H");
		const unseen = position("HJ", ["HQ", "H4"], undefined);
		const noCover = position("HJ", ["H9", "H4"], ["HT"]);
		const noDuck = position("HJ", ["HQ"], ["HT"]);
		expect(secondSeat("context", trumpHonor, "H4")).toBeUndefined();
		expect(secondSeat("context", trumpSplit, "H7")).toBeUndefined();
		expect(secondSeat("context", trumpSpots, "HQ")).toBe("H2");
		expect(secondSeat("context", unseen, "H4")).toBeUndefined();
		expect(secondSeat("context", noCover, "H4")).toBeUndefined();
		expect(secondSeat("context", noDuck, "HQ")).toBeUndefined();
	});

	it.each(["low", "context"] as const)(
		"%s never ruffs, discards, plays for declarer, or acts outside second seat",
		(kind) => {
			const play = position("H4", ["HA", "H7"], ["H3"]);
			const voidHand = position("H4", ["S2", "C2"], ["H3"], "N", "S");
			const declarerSide = position("H4", ["HA", "H7"], undefined, "W");
			const partnerLead: PlayPosition = {
				...play,
				current: { leader: "W", cards: ["H4"] },
			};
			const leading: PlayPosition = {
				...play,
				current: { leader: "N", cards: [] },
			};
			const third: PlayPosition = {
				...play,
				current: { leader: "N", cards: ["H4", "H3"] },
			};
			expect(secondSeat(kind, voidHand, "S2")).toBeUndefined();
			expect(secondSeat(kind, declarerSide, "HA")).toBeUndefined();
			expect(secondSeat(kind, partnerLead, "HA")).toBeUndefined();
			expect(secondSeat(kind, leading, "HA")).toBeUndefined();
			expect(secondSeat(kind, third, "HA")).toBeUndefined();
		},
	);
});
