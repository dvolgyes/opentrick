import { describe, expect, it } from "vitest";
import { callMeaning } from "../../src/bridge/conventions";
import { calls } from "./conventions-fixtures";

describe("guide meaning of a call", () => {
	it.each([
		[
			"hcp",
			"1NT",
			{ range: { min: 15, max: 17 }, shape: { kind: "balanced" } },
		],
		[
			"hcp-corrected",
			"P 1C",
			{
				range: { min: 12, max: 21 },
				shape: { kind: "cards", suit: "C", min: 3 },
			},
		],
		[
			"hcp",
			"1S",
			{
				range: { min: 12, max: 21 },
				shape: { kind: "cards", suit: "S", min: 5 },
			},
		],
		["hcp", "2C", { range: { min: 22 }, shape: { kind: "artificial" } }],
		[
			"hcp",
			"2H",
			{
				range: { min: 5, max: 11 },
				shape: { kind: "weak-two", suit: "H", length: 6 },
			},
		],
		[
			"hcp-corrected",
			"3D",
			{
				range: { min: 5, max: 10 },
				shape: { kind: "preempt", suit: "D", length: 7 },
			},
		],
		[
			"hcp-corrected",
			"P",
			{ range: { min: 0, max: 11 }, shape: { kind: "none" } },
		],
		["hcp", "1H P P", { range: { min: 0, max: 5 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1H P 2H",
			{
				range: { min: 6, max: 10 },
				shape: { kind: "support", suit: "H", min: 3 },
			},
		],
		[
			"hcp",
			"1D P 2D",
			{
				range: { min: 6, max: 10 },
				shape: { kind: "support", suit: "D", min: 4 },
			},
		],
		[
			"hcp-corrected",
			"1C P 3C",
			{
				range: { min: 10, max: 12 },
				shape: { kind: "support", suit: "C", min: 5 },
			},
		],
		[
			"hcp",
			"1C P 1NT",
			{ range: { min: 6, max: 10 }, shape: { kind: "no-major", min: 4 } },
		],
		[
			"hcp",
			"1S P 1NT",
			{
				range: { min: 6, max: 10 },
				shape: { kind: "at-most", suit: "S", max: 2 },
			},
		],
		[
			"hcp",
			"1H P 3H",
			{
				range: { min: 10, max: 12 },
				shape: { kind: "support", suit: "H", min: 3 },
			},
		],
		[
			"hcp",
			"1S P 2NT",
			{ range: { min: 13 }, shape: { kind: "support", suit: "S", min: 4 } },
		],
		[
			"hcp",
			"1H P 3NT",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "balanced-with", suit: "H", length: 2 },
			},
		],
		[
			"hcp",
			"1C P 2NT",
			{
				range: { min: 13, max: 15 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1D P 3NT",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1H P 2S",
			{ range: { min: 19 }, shape: { kind: "good-suit", suit: "S", min: 5 } },
		],
		[
			"hcp",
			"1D P 3C",
			{ range: { min: 19 }, shape: { kind: "good-suit", suit: "C", min: 5 } },
		],
		[
			"hcp",
			"1C 1H X",
			{ range: { min: 6 }, shape: { kind: "negative", suits: ["S"] } },
		],
		[
			"hcp",
			"1C 1D X",
			{ range: { min: 6 }, shape: { kind: "negative", suits: ["S", "H"] } },
		],
		[
			"hcp",
			"1D 1S X",
			{
				range: { min: 6 },
				shape: { kind: "negative", suits: ["H"], five: { min: 6, max: 10 } },
			},
		],
		[
			"hcp",
			"1H 2C X",
			{
				range: { min: 8 },
				shape: { kind: "negative", suits: ["S"], five: { min: 6, max: 10 } },
			},
		],
		[
			"hcp",
			"1H 1S 2C",
			{ range: { min: 10 }, shape: { kind: "cards", suit: "C", min: 5 } },
		],
		[
			"hcp",
			"1C 1H X P 1S",
			{
				range: { min: 12, max: 15 },
				shape: { kind: "cards", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1C 1H X P 2S",
			{
				range: { min: 16, max: 18 },
				shape: { kind: "cards", suit: "S", min: 4 },
			},
		],
		["hcp", "1C 1H X P 2H", { range: { min: 19 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1S P 4S",
			{
				range: { min: 6, max: 9 },
				shape: { kind: "short-support", suit: "S", min: 5 },
			},
		],
		[
			"hcp",
			"1H P 2NT P 3S",
			{ shape: { kind: "shortness", suit: "S", trumps: "H" } },
		],
		[
			"hcp",
			"1S P 2NT P 4S",
			{ range: { min: 12, max: 14 }, shape: { kind: "no-shortness" } },
		],
		[
			"hcp",
			"1S P 2NT P 3NT",
			{ range: { min: 15, max: 17 }, shape: { kind: "no-shortness" } },
		],
		[
			"hcp",
			"1H P 2NT P 3H",
			{ range: { min: 18, max: 21 }, shape: { kind: "no-shortness" } },
		],
		[
			"hcp-corrected",
			"1H P 1S",
			{ range: { min: 6 }, shape: { kind: "cards", suit: "S", min: 4 } },
		],
		[
			"hcp",
			"1H P 2C",
			{ range: { min: 11 }, shape: { kind: "cards", suit: "C", min: 4 } },
		],
		[
			"hcp",
			"1H P 1NT",
			{
				range: { min: 6, max: 10 },
				shape: {
					kind: "at-most-both",
					suit: "H",
					max: 2,
					other: "S",
					otherMax: 3,
				},
			},
		],
		[
			"hcp",
			"1NT P P",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "nt-pass", min: 5, long: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2C",
			{
				shape: {
					kind: "stayman",
					min: 4,
					strong: { min: 8 },
					weak: { min: 0, max: 7 },
					clubs: 1,
				},
			},
		],
		[
			"hcp-corrected",
			"1NT P 2D",
			{ shape: { kind: "transfer", suit: "H", min: 5 } },
		],
		["hcp", "1NT P 2H", { shape: { kind: "transfer", suit: "S", min: 5 } }],
		[
			"hcp",
			"1NT P 2S",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "weak-minor", min: 5, long: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2NT",
			{ range: { min: 8, max: 9 }, shape: { kind: "no-major", min: 4 } },
		],
		[
			"hcp",
			"1NT P 3D",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "invite", suit: "D", min: 6 },
			},
		],
		[
			"hcp",
			"1NT P 3S",
			{ range: { min: 16 }, shape: { kind: "slam-try", suit: "S", min: 6 } },
		],
		[
			"hcp",
			"1NT P 4C",
			{ range: { min: 16 }, shape: { kind: "gerber", min: 4 } },
		],
		[
			"hcp",
			"2NT P 4C",
			{ range: { min: 12 }, shape: { kind: "gerber", min: 4 } },
		],
		[
			"hcp-corrected",
			"1NT P 3NT",
			{ range: { min: 10, max: 15 }, shape: { kind: "no-major", min: 4 } },
		],
		[
			"hcp",
			"1NT P 4NT",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1NT P 6NT",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1NT P 7NT",
			{
				range: { min: 22 },
				shape: { kind: "no-major", min: 4, balanced: true },
			},
		],
		[
			"hcp",
			"1NT P 3D P P",
			{ range: { min: 15, max: 15 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 3C P 3NT",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 3S P 4S",
			{
				shape: {
					kind: "slam-decline",
					suit: "S",
					short: 2,
					points: { min: 15, max: 15 },
				},
			},
		],
		[
			"hcp",
			"1NT P 3H P 4NT",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "ace-ask", suit: "H", min: 3 },
			},
		],
		["hcp", "1NT P 3H P 4NT P 5H", { shape: { kind: "aces", counts: [2] } }],
		["hcp", "1NT P 4C P 4D", { shape: { kind: "aces", counts: [0, 4] } }],
		["hcp", "2NT P 4C P 4NT", { shape: { kind: "aces", counts: [3] } }],
		["hcp", "1NT P 4C P 4H P 5C", { shape: { kind: "king-ask" } }],
		[
			"hcp",
			"1NT P 4C P 4H P 5C P 5S",
			{ shape: { kind: "kings", counts: [2] } },
		],
		["hcp", "1NT X 2D", { shape: { kind: "transfer", suit: "H", min: 5 } }],
		[
			"hcp-corrected",
			"2C P 2D",
			{ range: { min: 0, max: 7 }, shape: { kind: "waiting" } },
		],
		[
			"hcp",
			"2C P 3C",
			{ range: { min: 8 }, shape: { kind: "good-suit", suit: "C", min: 5 } },
		],
		["hcp", "2C P 2NT", { range: { min: 8 }, shape: { kind: "balanced" } }],
	] as const)("reads %s %s", (system, auction, expected) => {
		const all = calls(auction);
		expect(callMeaning(system, all, all.length - 1)).toEqual(expected);
	});

	it.each([
		["other", "1NT"],
		["hcp", "1H X 2H"],
		["hcp", "1H P 1S P"],
		["hcp", "1H P 4S"], // a jump to game in a new suit
		["hcp", "1H P 4C"], // a double jump in a new suit
		["hcp", "1C P 4C"], // a minor raise past the jump raise
		["hcp", "2C P P"],
		["hcp", "4S"],
	] as const)(
		"has no guide meaning for the last call of %s %s",
		(system, auction) => {
			const all = calls(auction);
			expect(callMeaning(system, all, all.length - 1)).toBeUndefined();
		},
	);

	it.each([
		[
			"hcp",
			"1H P 1S P 1NT",
			{ range: { min: 12, max: 14 }, shape: { kind: "balanced" } },
		],
		[
			"hcp",
			"1H P 1S P 2S",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "support", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1H P 1S P 3S",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "support", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1H P 1S P 2H",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1H P 1S P 3H",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1H P 1S P 3D",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "cards", suit: "D", min: 4 },
			},
		],
		[
			"hcp",
			"1H P 1S P 2NT",
			{ range: { min: 18, max: 19 }, shape: { kind: "balanced" } },
		],
		[
			"hcp",
			"1S P 2C P 3C",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "support", suit: "C", min: 4 },
			},
		],
		[
			"hcp-corrected",
			"1H P 1NT P 2H",
			{
				range: { min: 12, max: 14 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		["hcp", "1NT P 2C P 2D", { shape: { kind: "no-major", min: 4 } }],
		["hcp", "1NT P 2C P 2S", { shape: { kind: "cards", suit: "S", min: 4 } }],
		["hcp", "1NT P 2D P 2H", { shape: { kind: "accept", suit: "H" } }],
		["hcp", "1NT P 2H P 2S", { shape: { kind: "accept", suit: "S" } }],
		[
			"hcp",
			"1NT P 2D P 3H",
			{
				range: { min: 17, max: 17 },
				shape: { kind: "support", suit: "H", min: 4 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 3H P P",
			{ range: { min: 0, max: 5 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2D P 3H P 4H",
			{ range: { min: 6 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2D P 2H P P",
			{ range: { min: 0, max: 7 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2NT",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "exact", suit: "H", length: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3S",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "cards", suit: "S", min: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 3NT",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "exact", suit: "H", length: 5, flat: true },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 4H",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "cards", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2S",
			{
				range: { min: 8, max: 9 },
				shape: {
					kind: "second-suit",
					major: "H",
					length: 5,
					suit: "S",
					min: 5,
				},
			},
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3H",
			{
				range: { min: 10, max: 15 },
				shape: {
					kind: "second-suit",
					major: "S",
					length: 5,
					suit: "H",
					min: 4,
				},
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2NT P P",
			{
				range: { min: 15, max: 15 },
				shape: { kind: "at-most", suit: "H", max: 2 },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2NT P 4H",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "support", suit: "H", min: 3 },
			},
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3S P 4S",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2H P 2S P 3NT P P",
			{ shape: { kind: "at-most", suit: "S", max: 2 } },
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2S P P",
			{
				range: { min: 15, max: 15 },
				shape: { kind: "longer-major", suit: "S", other: "H", ties: true },
			},
		],
		[
			"hcp",
			"1NT P 2D P 2H P 2S P 4H",
			{
				range: { min: 16, max: 17 },
				shape: { kind: "longer-major", suit: "H", other: "S", ties: false },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2D P 2H",
			{
				range: { min: 8, max: 9 },
				shape: {
					kind: "two-suits",
					suit: "H",
					length: 5,
					other: "S",
					otherLength: 4,
				},
			},
		],
		[
			"hcp",
			"1NT P 2C P 2D P 3NT",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "no-major", min: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2H P P",
			{ range: { min: 0, max: 7 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 2C P 2H P 2NT",
			{
				range: { min: 8, max: 9 },
				shape: { kind: "at-most", suit: "H", max: 3 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2S P 4S",
			{
				range: { min: 10, max: 15 },
				shape: { kind: "support", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2H P 2NT P 3S",
			{
				range: { min: 15, max: 15 },
				shape: { kind: "cards", suit: "S", min: 4 },
			},
		],
		[
			"hcp",
			"1NT P 2C P 2D P 3H P 3NT",
			{ shape: { kind: "at-most", suit: "H", max: 2 } },
		],
		["hcp", "1NT P 2S P 3C", { shape: { kind: "relay" } }],
		[
			"hcp",
			"1NT P 2S P 3C P P",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "cards", suit: "C", min: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2S P 3C P 3D",
			{
				range: { min: 0, max: 7 },
				shape: { kind: "cards", suit: "D", min: 5 },
			},
		],
		[
			"hcp",
			"1NT P 2NT P P",
			{ range: { min: 15, max: 15 }, shape: { kind: "none" } },
		],
		[
			"hcp-corrected",
			"1NT P 2NT P 3NT",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 4NT P P",
			{ range: { min: 15, max: 15 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1NT P 4NT P 6NT",
			{ range: { min: 16, max: 17 }, shape: { kind: "none" } },
		],
		[
			"hcp-corrected",
			"2C P 2D P 2NT",
			{ range: { min: 22, max: 24 }, shape: { kind: "balanced" } },
		],
		["hcp", "2H P 3H", { shape: { kind: "support", suit: "H", min: 3 } }],
		["hcp", "2S P 4S", { shape: { kind: "support", suit: "S", min: 3 } }],
		["hcp", "2H P 2NT", { range: { min: 15 }, shape: { kind: "ask" } }],
		[
			"hcp",
			"2H P 2NT P 3H",
			{ range: { min: 5, max: 8 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"2H P 2NT P 3D",
			{
				range: { min: 9, max: 11 },
				shape: { kind: "feature", suit: "D", trumps: "H" },
			},
		],
		[
			"hcp",
			"2D P 2NT P 3C",
			{
				range: { min: 9, max: 11 },
				shape: { kind: "feature", suit: "C", trumps: "D" },
			},
		],
		[
			"hcp",
			"2S P 2NT P 3NT",
			{
				range: { min: 9, max: 11 },
				shape: { kind: "no-feature", trumps: "S" },
			},
		],
		[
			"hcp",
			"1H 1S",
			{
				range: { min: 8, max: 16 },
				shape: { kind: "good-suit", suit: "S", min: 5 },
			},
		],
		[
			"hcp",
			"1H 2C",
			{
				range: { min: 10, max: 16 },
				shape: { kind: "good-suit", suit: "C", min: 5 },
			},
		],
		[
			"hcp-corrected",
			"1H P P 2D",
			{
				range: { min: 10, max: 16 },
				shape: { kind: "good-suit", suit: "D", min: 5 },
			},
		],
		[
			"hcp",
			"P 1H 1NT",
			{ range: { min: 15, max: 18 }, shape: { kind: "stopper", suit: "H" } },
		],
		[
			"hcp",
			"1H X",
			{
				range: { min: 12 },
				shape: { kind: "takeout", suit: "H", strong: { min: 17 } },
			},
		],
		[
			"hcp-corrected",
			"1D P P X",
			{
				range: { min: 12 },
				shape: { kind: "takeout", suit: "D", strong: { min: 17 } },
			},
		],
		["hcp", "1H X XX", { range: { min: 10 }, shape: { kind: "none" } }],
		[
			"hcp",
			"1H P 3H P 4NT",
			{ shape: { kind: "blackwood", small: { min: 33 }, grand: { min: 37 } } },
		],
		[
			"hcp-corrected",
			"1H 1S 3H P 4NT",
			{ shape: { kind: "blackwood", small: { min: 33 }, grand: { min: 37 } } },
		],
		["hcp", "1H P 3H P 4NT P 5C", { shape: { kind: "aces", counts: [0, 4] } }],
		["hcp", "1H P 3H P 4NT P 5D", { shape: { kind: "aces", counts: [1] } }],
		["hcp", "1H P 3H P 4NT P 5S", { shape: { kind: "aces", counts: [3] } }],
		[
			"hcp",
			"1H P 2H P P",
			{ range: { min: 12, max: 14 }, shape: { kind: "none" } },
		],
		[
			"hcp",
			"1H P 2H P 3H",
			{
				range: { min: 15, max: 17 },
				shape: { kind: "game-try", suit: "H", min: 5 },
			},
		],
		[
			"hcp-corrected",
			"1S P 2S P 4S",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "cards", suit: "S", min: 5 },
			},
		],
		[
			"hcp",
			"1H P 2H 2S 3H",
			{
				range: { min: 12, max: 17 },
				shape: { kind: "competitive", suit: "H", min: 6 },
			},
		],
		[
			"hcp",
			"1S P 2S X 3S",
			{
				range: { min: 12, max: 17 },
				shape: { kind: "competitive", suit: "S", min: 6 },
			},
		],
		[
			"hcp",
			"1H P 2H 3S 4H",
			{
				range: { min: 18, max: 21 },
				shape: { kind: "cards", suit: "H", min: 5 },
			},
		],
		["hcp", "1H P 2H 2S P", { shape: { kind: "rest" } }],
		[
			"hcp",
			"1H P 3H P P",
			{ range: { min: 12, max: 14 }, shape: { kind: "none" } },
		],
		[
			"hcp-corrected",
			"1S P 3S P 4S",
			{
				range: { min: 15, max: 21 },
				shape: { kind: "cards", suit: "S", min: 5 },
			},
		],
	] as const)("reads the later call %s %s", (system, auction, expected) => {
		const all = calls(auction);
		expect(callMeaning(system, all, all.length - 1)).toEqual(expected);
	});

	it.each([
		["hcp", "1H P 1S P P"],
		["hcp", "1H P 1S P 2C"], // a new suit without a jump
		["hcp", "1H P 1S P 4S"],
		["hcp", "1H P 2H P 2S"], // a new-suit game try
		["hcp", "1H P 2H P 3NT"],
		["hcp", "1H P 2H 2S X"],
		["hcp", "1D P 2D P 3D"], // opener's re-raise of a minor is not in the guide
		["hcp", "1H P 3H P 3NT"],
		["hcp", "1H P 3H 3S 4H"], // after a jump raise and an opponent's call
		["hcp", "1H P 1S 2C 2S"], // the rebid after an overcall
		["hcp", "1H 2H"], // a cue bid
		["hcp", "1H 2S"], // a jump overcall
		["hcp", "1H 1S 2H"],
		["hcp", "1H 1S X"], // no major that no one has bid
		["hcp", "1C 1H 2S"], // a jump in a new suit after an overcall
		["hcp", "1C 1H X 1S 2S"], // the fourth player did not pass
		["hcp", "1NT 2C"],
		["hcp", "1NT X"],
		["hcp", "2H 2S"],
		["hcp", "2H P 3C"],
		["hcp", "2H P 2NT P 4H"], // above the answers to the ask
		["hcp", "2H P 2NT X 3H"], // after an opponent's call
		["hcp", "2H P 2NT P 3S P 4H"], // responder's call after the answer
		["hcp", "1NT P 2C P 2D P 4NT"], // not an ace ask after partner's notrump
		["hcp", "1NT P 2NT P 4NT"],
		["hcp", "1NT P 4NT P 5C"], // no ace answer to a [4NT] that invites [6NT]
		["hcp", "1NT P 2D P 2H P 3S"], // a jump in the other major after the transfer
		["hcp", "1NT P 2C P 2H P 2S"], // five spades after Stayman: the guide leaves it out
		["hcp", "1NT P 2C P 2S P 3H"],
		["hcp", "1NT P 3NT P 4NT"],
		["hcp", "4NT"],
		["hcp", "1H P 3H P 4NT X 5D"],
		["hcp", "1H P 3H P 4NT P 6H"],
	] as const)(
		"has no guide meaning for the later call %s %s",
		(system, auction) => {
			const all = calls(auction);
			expect(callMeaning(system, all, all.length - 1)).toBeUndefined();
		},
	);

	it("reads an earlier call of the auction by its index", () => {
		expect(callMeaning("hcp", calls("1NT P 2C P"), 0)?.range).toEqual({
			min: 15,
			max: 17,
		});
	});
});
