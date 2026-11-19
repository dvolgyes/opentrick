import { describe, expect, it } from "vitest";
import { modelCard, publicOrder } from "../../scripts/self-play/mixed-policy";
import type { Card } from "../../src/bridge/cards";

const lead = { leader: "N", cards: [] } as const;

describe("mixed study modeled play", () => {
	it("orders from low rank upward, breaking ties in display suit order", () => {
		const cards: Card[] = ["CA", "D2", "H3", "C2", "SA", "S2", "H2"];
		expect(cards.sort(publicOrder)).toEqual([
			"S2",
			"H2",
			"D2",
			"C2",
			"H3",
			"SA",
			"CA",
		]);
	});

	it("leads the top of a touching honor sequence in the longest suit", () => {
		expect(
			modelCard(["S4", "HK", "S2", "HQ", "SQ", "SJ", "H2", "H3"], lead, "NT"),
		).toBe("SQ");
		expect(modelCard(["H9", "H2", "HT"], lead, "S")).toBe("HT");
	});

	it("uses fourth-highest from length otherwise, or low from a short suit", () => {
		expect(modelCard(["S2", "S9", "SJ", "H3", "S5", "SA"], lead, "NT")).toBe(
			"S5",
		);
		expect(modelCard(["D8", "D7", "D9"], lead, "NT")).toBe("D7");
		expect(modelCard(["SA", "SQ", "SJ", "S4"], lead, "NT")).toBe("S4");
	});

	it("follows suit and takes the trick as cheaply as possible from an opponent", () => {
		expect(
			modelCard(["ST", "C2", "SK", "S2"], { leader: "W", cards: ["S9"] }, "C"),
		).toBe("ST");
		expect(
			modelCard(["ST", "C2", "SK", "S2"], { leader: "W", cards: ["SA"] }, "C"),
		).toBe("S2");
		expect(
			modelCard(["SA", "S2", "C3"], { leader: "E", cards: ["S9", "C2"] }, "C"),
		).toBe("S2");
	});

	it("plays low when partner is winning, regardless of absolute seats", () => {
		for (const leader of ["N", "E", "S", "W"] as const) {
			expect(
				modelCard(["SA", "S2", "C2"], { leader, cards: ["S9", "S8"] }, "C"),
			).toBe("S2");
			expect(
				modelCard(["H2", "D3", "C3"], { leader, cards: ["S9", "S8"] }, "C"),
			).toBe("H2");
			expect(
				modelCard(["C3", "D3"], { leader, cards: ["S8", "S9"] }, "NT"),
			).toBe("D3");
		}
	});

	it("ruffs and overruffs cheaply when void, or discards if it cannot win", () => {
		const hand = ["CT", "C2", "CK", "H2"] as const;
		expect(modelCard(hand, { leader: "W", cards: ["SA"] }, "C")).toBe("C2");
		expect(modelCard(hand, { leader: "N", cards: ["SA", "C9"] }, "C")).toBe(
			"CT",
		);
		expect(modelCard(hand, { leader: "N", cards: ["SA", "CA"] }, "C")).toBe(
			"H2",
		);
		expect(modelCard(hand, { leader: "N", cards: ["CA", "S2"] }, "C")).toBe(
			"C2",
		);
		expect(
			modelCard(
				["C4", "CT", "H5"],
				{ leader: "N", cards: ["SA", "C9", "S2"] },
				"C",
			),
		).toBe("C4");
	});
});
