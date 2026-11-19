import { expect, it } from "vitest";
import { applyPrior } from "../../scripts/self-play/defensive-search";
import type { Card } from "../../src/bridge/cards";

const scores = [
	{ card: "S5" as Card, utility: 2 },
	{ card: "SQ" as Card, utility: 1 },
	{ card: "SA" as Card, utility: 0.999 },
];

it("admits the boundary suggestion, preserves a clearly superior card, and rejects illegal advice", () => {
	expect(applyPrior(scores, "SQ")).toEqual({ card: "SQ", decision: "changed" });
	expect(applyPrior(scores, "SA")).toEqual({ card: "S5", decision: "veto" });
	expect(applyPrior(scores, undefined)).toEqual({
		card: "S5",
		decision: "abstained",
	});
	expect(applyPrior(scores, "S5")).toEqual({ card: "S5", decision: "agreed" });
	expect(() => applyPrior(scores, "H4")).toThrow(/not a scored legal card/);
});
