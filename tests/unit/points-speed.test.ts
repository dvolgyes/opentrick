import { describe, expect, it } from "vitest";
import type { Card } from "../../src/bridge/cards";
import {
	countHandPoints,
	explainHandPoints,
} from "../../src/bridge/hand-points";
import { englishTranslator, translator } from "../../src/i18n";

describe("corrected HCP on cards the UI can currently show", () => {
	it("reports only the raw scale for an empty hand", () => {
		expect(countHandPoints("hcp-corrected", [])).toEqual({
			total: 0,
			raw: 0,
			correction: 0,
		});
		expect(explainHandPoints("hcp-corrected", [], englishTranslator)).toEqual([
			"A=4, K=3, Q=2, J=1: 0",
		]);
	});

	it("applies honours to partial hands in suit and rank order, not input order", () => {
		const cards = [
			"CJ",
			"H9",
			"SQ",
			"ST",
			"CA",
			"H8",
			"SK",
			"S8",
			"S9",
			"DK",
		] as const satisfies readonly Card[];
		expect(countHandPoints("hcp-corrected", cards)).toEqual({
			total: 12,
			raw: 13,
			correction: -1,
		});
		expect(
			explainHandPoints("hcp-corrected", cards, englishTranslator),
		).toEqual([
			"A=4, K=3, Q=2, J=1: 13",
			"+1 good suit ♠KQ1098",
			"-1 singleton honour ♦K",
			"-1 unsupported honours ♣AJ",
		]);
	});

	it("recognizes aces in all four suits without requiring 13 cards", () => {
		const cards = ["CA", "DA", "HA", "SA"] as const;
		expect(countHandPoints("hcp-corrected", cards)).toEqual({
			total: 17,
			raw: 16,
			correction: 1,
		});
		expect(explainHandPoints("hcp-corrected", cards, translator("de"))).toEqual(
			["A=4, K=3, Q=2, J=1: 16", "+1 alle vier Asse"],
		);
	});
});
