import { describe, expect, it } from "vitest";
import { auctionReference } from "../../src/bridge/auction-reference";
import {
	callMeaning,
	conventionCalls,
	fitsCall,
} from "../../src/bridge/conventions";
import { createBoard } from "../../src/bridge/engine";
import { type Call, isLegalCall } from "../../src/bridge/rules";
import { bidding, DEAL } from "./bridge-fixtures";
import { calls, hand, RULE_SYSTEMS } from "./conventions-fixtures";
import { tableState, view } from "./table-model-fixtures";

// Tutorial examples omit opponents' passes; the fixtures include all four seats.
// BBO: https://news.bridgebase.com/2022/10/14/rebids/
// Walker: https://www.kwbridge.com/responses.htm and https://www.kwbridge.com/rebids2.htm
// Pavlicek: https://rpbridge.net/2z29.htm and https://rpbridge.net/2z31.htm
// SAYC booklet: https://www.fifthchar.ptbridge.net/pdfs/SAYC.pdf (pages 5–6)
// Stayman/transfer examples use the app's stated agreements, which differ between tutorials.
const EXAMPLES = [
	[
		"1H P 1S P 2H",
		{ guide: "cards", suit: "H", min: 6, range: { min: 12, max: 14 } },
	],
	[
		"1H P 1S P 2S",
		{ guide: "support", suit: "S", min: 4, range: { min: 12, max: 14 } },
	],
	["1H P 1S P 1NT", { guide: "balanced", range: { min: 12, max: 14 } }],
	[
		"1H P 1S P 3H",
		{ guide: "cards", suit: "H", min: 6, range: { min: 15, max: 17 } },
	],
	[
		"1H P 1S P 3S",
		{ guide: "support", suit: "S", min: 4, range: { min: 15, max: 17 } },
	],
	[
		"1H P 1S P 3C",
		{ guide: "cards", suit: "C", min: 4, range: { min: 18, max: 21 } },
	],
	["1H P 1S P 4S", { kind: "game-raise", suit: "S" }],
	["1H P 1S P 2NT", { guide: "balanced", range: { min: 18, max: 19 } }],
	["1D P 1H P 1S", { kind: "second-suit", suit: "S", reverse: false }],
	["1D P 1S P 2H", { kind: "second-suit", suit: "H", reverse: true }],
	["1C P 1S P 2D", { kind: "second-suit", suit: "D", reverse: true }],
	["1H P 1S P 2C", { kind: "second-suit", suit: "C", reverse: false }],
	["1H P 1S P 2D", { kind: "second-suit", suit: "D", reverse: false }],
	[
		"1C P 1H P 1S P 2H",
		{ kind: "rebid", suit: "H", min: 6, strength: "minimum" },
	],
	[
		"1C P 1H P 1S P 2S",
		{ kind: "raise", suit: "S", min: 4, strength: "minimum" },
	],
	["1C P 1H P 1S P 2C", { kind: "preference", suit: "C" }],
	["1C P 1H P 1S P 1NT", { kind: "notrump", strength: "minimum" }],
	["1C P 1H P 1S P 2NT", { kind: "notrump", strength: "invite" }],
	[
		"1C P 1H P 1S P 3H",
		{ kind: "rebid", suit: "H", min: 6, strength: "invite" },
	],
	[
		"1C P 1H P 1S P 3S",
		{ kind: "raise", suit: "S", min: 4, strength: "invite" },
	],
	["1C P 1H P 1S P 3NT", { kind: "notrump", strength: "game" }],
	["1C P 1H P 1S P 4H", { kind: "rebid", suit: "H", min: 6, strength: "game" }],
	["1C P 1H P 1S P 4S", { kind: "raise", suit: "S", min: 4, strength: "game" }],
	["1C P 1H P 1S P 2D", { kind: "fourth-suit", suit: "D" }],
	["1D P 1S P 1NT P 2H", { kind: "major-preference", suit: "H", other: "S" }],
	[
		"1D P 1S P 1NT P 2S",
		{ kind: "rebid", suit: "S", min: 5, strength: "minimum" },
	],
	["1D P 1S P 1NT P 2NT", { kind: "notrump", strength: "invite" }],
	["1D P 1S P 1NT P 3NT", { kind: "notrump", strength: "game" }],
	[
		"1C P 1H P 2C P 2H",
		{ kind: "rebid", suit: "H", min: 6, strength: "minimum" },
	],
	["1C P 1H P 2C P 2NT", { kind: "notrump", strength: "invite" }],
	["1C P 1H P 2C P 3NT", { kind: "notrump", strength: "game" }],
	["1H P 1S P 2C P 2H", { kind: "preference", suit: "H" }],
	[
		"1H P 1S P 2C P 3C",
		{ kind: "raise", suit: "C", min: 4, strength: "invite" },
	],
	["1H P 1S P 2C P 2D", { kind: "fourth-suit", suit: "D" }],
	["1S P 1NT P 2C P 2S", { kind: "preference", suit: "S" }],
	["1S P 2C P 2NT", { kind: "opener-notrump" }],
	["1H P 2D P 2NT", { kind: "opener-notrump" }],
	["1S P 2C P 2H", { kind: "second-suit", suit: "H", reverse: false }],
	["1S P 2C P 2H P 2NT", { kind: "notrump", strength: "invite" }],
	["1S P 2C P 2H P 2S", { kind: "preference", suit: "S" }],
	["1S P 2C P 2H P 3C", { kind: "two-over-one-invite", suit: "C" }],
	["1S P 2C P 2H P 3H", { kind: "two-over-one-invite", suit: "H" }],
	["1S P 2C P 2H P 3D", { kind: "fourth-suit", suit: "D" }],
	["1S P 2C P 2H P 3S", { kind: "forcing-raise", suit: "S" }],
	["1NT P 2C P 2D", { guide: "no-major" }],
	["1NT P 2C P 2H", { guide: "cards", suit: "H", min: 4 }],
	["1NT P 2C P 2S", { guide: "spades-no-hearts", suit: "S", min: 4 }],
	["1NT P 2D P 2H", { guide: "accept", suit: "H" }],
	["1NT P 2H P 2S", { guide: "accept", suit: "S" }],
	["1C P 1H P 1S P 2S P 3D", { kind: "game-try", suit: "D" }],
	[
		"1H P 1S P 2C P 2D P 2H",
		{ kind: "fourth-answer", action: "first", suit: "H" },
	],
	[
		"1H P 1S P 2C P 2D P 2S",
		{ kind: "fourth-answer", action: "support", suit: "S" },
	],
	[
		"1H P 1S P 2C P 2D P 2NT",
		{ kind: "fourth-answer", action: "notrump", suit: "D" },
	],
	[
		"1H P 1S P 2C P 2D P 3C",
		{ kind: "fourth-answer", action: "second", suit: "C" },
	],
	[
		"1H P 1S P 2C P 2D P 3D",
		{ kind: "fourth-answer", action: "fourth", suit: "D" },
	],
] as const;

describe("tutorial auction interpretations", () => {
	it.each(EXAMPLES)("interprets %s", (auction, expected) => {
		const all = calls(auction);
		for (let index = 0; index < all.length; index++)
			expect(
				isLegalCall(all.slice(0, index), all[index] as Call),
				auction,
			).toBe(true);
		for (const system of RULE_SYSTEMS) {
			if ("guide" in expected) {
				const meaning = callMeaning(system, all, all.length - 1);
				expect(meaning?.shape).toMatchObject({
					kind: expected.guide,
					...("suit" in expected ? { suit: expected.suit } : {}),
					...("min" in expected ? { min: expected.min } : {}),
				});
				if ("range" in expected) expect(meaning?.range).toEqual(expected.range);
			} else {
				expect(auctionReference(all, all.length - 1)).toMatchObject(expected);
			}
			const board = bidding(createBoard(1, DEAL), auction);
			const state = {
				...tableState(board),
				systems: { N: system, E: system, S: system, W: system },
			};
			const explanation = view("N", null, { state }).auction?.meanings.flat()[
				all.length - 1
			];
			expect(explanation, `${system} ${auction}`).toBeDefined();
			expect(explanation).not.toContain("not in the guide");
			if (!("guide" in expected))
				expect(explanation).toContain("Common treatment:");
		}
	});

	it("does not treat a four-four major hand as a 2S Stayman answer", () => {
		const both = hand("KQ84.AJ73.Q65.K4");
		for (const system of RULE_SYSTEMS) {
			expect(fitsCall(system, both, calls("1NT P 2C P"), "2H")).toBe(true);
			expect(fitsCall(system, both, calls("1NT P 2C P"), "2S")).toBe(false);
		}
	});

	it.each([
		"1C 1D 1H P 1S", // an opponent intervened
		"1C P 1S P 2D P 2S", // responder to a reverse
		"1H P 1S P 3C P 3S", // responder to a jump shift
		"P P 1C P 1H P 1S P 2D", // responder was a passed hand
		"1H P 1S P 2C P 4C", // four of a minor is not game
		"1D P 1S P 1NT P 2C", // agreements after a 1NT rebid differ
		"1C P 1H P 1S P 3D", // a jump in the fourth suit needs a different agreement
		"1C P 2D P 2NT", // the response was a jump shift, not a two-over-one
		"P P P P 1C P 1H P 1S", // the auction was already over
	])("does not apply an unsupported common treatment to %s", (auction) => {
		const all = calls(auction);
		expect(auctionReference(all, all.length - 1)).toBeUndefined();
	});

	it("uses only the auction before the requested call", () => {
		const all = calls("1C P 1H P 1S P 2D P 3C");
		expect(auctionReference(all, 6)).toEqual({
			kind: "fourth-suit",
			suit: "D",
		});
		expect(auctionReference(all.slice(0, 7), 6)).toEqual(
			auctionReference(all, 6),
		);
	});

	it("keeps positions and partnership relationships after an opening pass", () => {
		const ordinary = calls("1C P 1H P 1S P 2D");
		const shifted = calls("P 1C P 1H P 1S P 2D");
		expect(auctionReference(shifted, shifted.length - 1)).toEqual(
			auctionReference(ordinary, ordinary.length - 1),
		);
	});

	it("does not turn a common reference into a recommendation or hand constraint", () => {
		const before = calls("1C P 1H P 1S P");
		const cards = hand("KQ84.AJ73.Q65.K4");
		for (const system of RULE_SYSTEMS) {
			expect(auctionReference([...before, "2D"], before.length)).toMatchObject({
				kind: "fourth-suit",
			});
			expect(conventionCalls(system, cards, before)).toBeUndefined();
			expect(fitsCall(system, cards, before, "2D")).toBeUndefined();
		}
	});
});
