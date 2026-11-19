import { describe, expect, it } from "vitest";
import { makeBoard, random } from "../../scripts/self-play/arena";
import {
	type LeadTreatment,
	leadPolicy,
	TREATMENTS,
} from "../../scripts/self-play/lead-lab";
import { policy } from "../../scripts/self-play/policy";
import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import type { Card } from "../../src/bridge/cards";
import { boardStatus } from "../../src/bridge/engine";

const own = [
	"C4",
	"D7",
	"H5",
	"S2",
	"CQ",
	"DA",
	"H8",
	"S9",
	"CT",
	"DK",
	"H3",
	"DQ",
	"D2",
] as const satisfies readonly Card[];
const budget = { samples: 1 };

function opening(
	hand: readonly Card[],
	strain: PlayPosition["contract"]["strain"] = "NT",
): PlayPosition {
	return {
		view: {
			seat: "E",
			declarer: "N",
			dummy: "S",
			trump: strain,
			own: hand,
			dummyCards: undefined,
			plays: [],
		},
		turn: "E",
		current: { leader: "E", cards: [] },
		contract: { level: 3, strain, declarer: "N", doubling: "" },
		vulnerability: "none",
		declarerTricks: 0,
		legal: hand,
		hints: [],
	};
}

function scores(
	position: PlayPosition,
	byCard: Partial<Record<Card, number>> = {},
	fallback = 5,
): DoubleDummySolver {
	return {
		solve: () =>
			new Map(position.legal.map((card) => [card, byCard[card] ?? fallback])),
	};
}

function lead(
	treatment: LeadTreatment,
	position = opening(own),
	dd = scores(position),
): Card {
	return leadPolicy(treatment, dd, budget)(position, random(18));
}
describe("opening lead challengers", () => {
	it("distinguishes fourth highest, low from length and the top sequence", () => {
		expect(lead("nt-fourth")).toBe("D7");
		expect(lead("long-low")).toBe("D2");
		expect(lead("sequence")).toBe("DA");
		expect(lead("sequence-or-shape")).toBe("DA");
	});

	it("uses the fourth held rank even when not all higher cards are tied", () => {
		const position = opening(own);
		expect(lead("nt-fourth", position, scores(position, { DK: 4 }))).toBe("D7");
		expect(lead("nt-fourth", position, scores(position, { D7: 4 }))).toBe("S2");
	});

	it("considers every equally long suit rather than the first in suit order", () => {
		const position = opening([
			"SA",
			"SQ",
			"S9",
			"S8",
			"HA",
			"HQ",
			"H9",
			"H6",
			"DQ",
			"D8",
			"D2",
			"CJ",
			"C7",
		]);
		expect(lead("nt-fourth", position)).toBe("H6");
		expect(lead("long-low", position)).toBe("H6");
		expect(lead("sequence-or-shape", position)).toBe("H6");
	});

	it("leaves equal-IMP but lower-scoring lead choices alone", () => {
		const position = opening(own);
		const dd = scores(position, { D7: 11 }, 12);
		const result = analyzePlay(position, dd, { ...budget, random: random(18) });
		const best = result.evaluations[0];
		const fourth = result.evaluations.find(({ card }) => card === "D7");
		expect(fourth?.utility).toBe(best?.utility);
		expect(fourth?.expectedScore).not.toBe(best?.expectedScore);
		expect(lead("nt-fourth", position, dd)).toBe("S2");
	});

	it("uses suit length only where the treatment calls for it", () => {
		const hand: readonly Card[] = [
			"S4",
			"H5",
			"HA",
			"HK",
			"H2",
			"DA",
			"DK",
			"DJ",
			"D7",
			"DT",
			"DQ",
			"CT",
			"C3",
		];
		expect(lead("nt-fourth", opening(hand, "H"))).toBe("H2");
		expect(lead("suit-singleton", opening(hand))).toBe("H2");
		expect(lead("suit-singleton", opening(hand, "H"))).toBe("S4");
		expect(lead("suit-singleton", opening(hand, "S"))).toBe("H2");
	});

	it("requires three top touching honors or near-honors in notrump, two in suits", () => {
		const hand: readonly Card[] = [
			"SA",
			"SK",
			"S7",
			"HA",
			"HJ",
			"HT",
			"D9",
			"D8",
			"D7",
			"D2",
			"CA",
			"C3",
			"C2",
		];
		expect(lead("sequence", opening(hand))).toBe("D2");
		expect(lead("sequence", opening(hand, "H"))).toBe("SA");
	});

	it("delegates follow-ups and later trick leads to the incumbent", () => {
		for (const ply of [1, 2, 4, 8]) {
			const board = makeBoard(42, 3, ply);
			const { actor } = boardStatus(board);
			if (!actor) throw new Error("missing actor");
			const position = playPosition(board, actor);
			const dd = scores(position);
			const incumbent = policy("incumbent", dd, budget)(position, random(18));
			for (const treatment of TREATMENTS)
				expect(lead(treatment, position, dd)).toBe(incumbent);
		}
	});
});
