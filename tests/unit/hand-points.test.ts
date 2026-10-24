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

	it("counts corrected HCP from the 4-3-2-1 scale; the correction rules are not defined yet", () => {
		expect(countHandPoints("hcp-corrected", HAND)).toEqual({
			total: 11,
			raw: 11,
			correction: 0,
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
