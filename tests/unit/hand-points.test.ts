import { describe, expect, it } from "vitest";
import type { Card } from "../../src/bridge/cards";
import {
	countHandPoints,
	formatHandPoints,
	POINT_SYSTEMS,
} from "../../src/bridge/hand-points";
import { englishTranslator, translator } from "../../src/i18n";

// ♠AKT2 ♥QJ3 ♦T98 ♣J42: each honour and two tens, so each scale gives a different count.
const HAND: readonly Card[] = [
	"SA",
	"SK",
	"ST",
	"S2",
	"HQ",
	"HJ",
	"H3",
	"DT",
	"D9",
	"D8",
	"CJ",
	"C4",
	"C2",
];

describe("hand evaluation points", () => {
	it.each([
		["hcp", 4 + 3 + 2 + 1 + 1],
		["vienna", 7 + 5 + 3 + 1 + 1],
		["reith", 6 + 4 + 3 + 2 + 2 + 1 + 1],
		["four-aces", 3 + 2 + 1 + 0.5 + 0.5],
	] as const)(
		"counts %s from the honour scale, without a correction",
		(system, points) => {
			expect(countHandPoints(system, HAND)).toEqual({
				total: points,
				raw: points,
				correction: 0,
			});
		},
	);

	it("counts corrected HCP from the 4-3-2-1 scale, and corrects it", () => {
		// 4333 deducts 1.
		expect(countHandPoints("hcp-corrected", HAND)).toEqual({
			total: 10,
			raw: 11,
			correction: -1,
		});
	});

	it("counts nothing when the player selects no points", () => {
		expect(countHandPoints("none", HAND)).toBeUndefined();
	});

	it("offers exactly the documented scales, with no points first", () => {
		expect(POINT_SYSTEMS).toEqual([
			"none",
			"hcp",
			"hcp-corrected",
			"vienna",
			"reith",
			"four-aces",
		]);
	});
});

/** A hand from its spade, heart, diamond and club ranks, for example hand("AK2", "QJ3", "T98", "J4"); "-" is a void. */
function hand(...suits: readonly string[]): Card[] {
	return suits.flatMap((ranks, index) =>
		ranks === "-"
			? []
			: [...ranks].map((rank) => `${"SHDC"[index]}${rank}` as Card),
	);
}

const correction = (cards: readonly Card[]): number | undefined =>
	countHandPoints("hcp-corrected", cards)?.correction;

describe("corrected HCP", () => {
	it.each([
		["K", -1],
		["Q", -1],
		["J", -1],
		["A", 0],
		["2", 0],
	])("corrects a singleton %s by %i", (singleton, points) => {
		// 6331 has no distribution points.
		expect(correction(hand("A87654", singleton, "932", "432"))).toBe(points);
	});

	it.each([
		["AJ", -1],
		["KQ", -1],
		["KJ", -1],
		["QJ", -1],
		["J4", -1],
		["JT", -1],
		["AK", 0],
		["AQ", 0],
		["K4", 0],
		["Q4", 0],
	])("corrects the doubleton %s by %i", (doubleton, points) => {
		// 5332 has no distribution points; the hand has no other correction.
		expect(correction(hand("98765", doubleton, "A32", "K32"))).toBe(points);
	});

	it("deducts 1 for 4333 and adds 1 for all four aces", () => {
		expect(correction(hand("A432", "A32", "A32", "A32"))).toBe(0);
		expect(correction(hand("A432", "A432", "A2", "A32"))).toBe(1);
		expect(correction(hand("K432", "K32", "K32", "K32"))).toBe(-1);
	});

	it("adds 1 for each suit of five or more cards with three of A K Q J T", () => {
		expect(correction(hand("KJT98", "A32", "K32", "43"))).toBe(1);
		expect(correction(hand("KJ987", "A32", "K32", "43"))).toBe(0);
		expect(correction(hand("AQJ987", "A32", "K32", "4"))).toBe(1);
	});

	it.each([
		["4441", ["A432", "K432", "Q432", "5"], 2],
		["5440", ["A8765", "K432", "Q432", "-"], 3],
		["5422", ["A8765", "K432", "32", "32"], 2],
		["5431", ["A8765", "K432", "432", "2"], 2],
		["5521", ["A8765", "K8765", "32", "2"], 3],
		["5530", ["A8765", "K8765", "432", "-"], 3],
	] as const)(
		"adds distribution points to the shape %s",
		(_shape, suits, points) => {
			expect(correction(hand(...suits))).toBe(points);
		},
	);

	it.each([
		["4432", ["A432", "K432", "32", "432"]],
		["5332", ["A8765", "K32", "32", "432"]],
		["6331", ["A87654", "K32", "432", "2"]],
		["6511", ["A87654", "K8765", "2", "2"]],
		["7600", ["A876543", "K87654", "-", "-"]],
	] as const)(
		"adds no distribution points to the shape %s",
		(_shape, suits) => {
			expect(correction(hand(...suits))).toBe(0);
		},
	);

	it("adds every correction of a hand", () => {
		// ♠AKQ32: a good five-card suit (+1); ♥K: a singleton king (-1); 5431: a singleton (+2).
		expect(
			countHandPoints("hcp-corrected", hand("AKQ32", "K", "J432", "432")),
		).toEqual({ total: 15, raw: 13, correction: 2 });
	});
});

describe("hand points text", () => {
	const t = englishTranslator;

	it("shows the raw count and the correction only when there is a correction", () => {
		expect(
			formatHandPoints(
				"hcp-corrected",
				{ total: 16, raw: 13, correction: 3 },
				t,
			),
		).toBe("corrected HCP: 16 (13 +3)");
		expect(
			formatHandPoints(
				"hcp-corrected",
				{ total: 11, raw: 13, correction: -2 },
				t,
			),
		).toBe("corrected HCP: 11 (13 -2)");
		expect(
			formatHandPoints("hcp", { total: 13, raw: 13, correction: 0 }, t),
		).toBe("HCP: 13");
	});

	it("names each scale and shows half points", () => {
		expect(
			formatHandPoints("vienna", { total: 17, raw: 17, correction: 0 }, t),
		).toBe("Vienna: 17");
		expect(
			formatHandPoints("reith", { total: 19, raw: 19, correction: 0 }, t),
		).toBe("Reith: 19");
		expect(
			formatHandPoints("four-aces", { total: 7, raw: 7, correction: 0 }, t),
		).toBe("Four Aces: 7");
		expect(
			formatHandPoints("four-aces", { total: 7.5, raw: 7.5, correction: 0 }, t),
		).toBe("Four Aces: 7.5");
	});

	it("translates the scale name", () => {
		expect(
			formatHandPoints(
				"hcp-corrected",
				{ total: 16, raw: 13, correction: 3 },
				translator("de"),
			),
		).toBe("korrigierte HCP: 16 (13 +3)");
	});
});
