import { describe, expect, it } from "vitest";
import { trumpOpening } from "../../scripts/self-play/trump-opening";
import type { PlayPosition } from "../../src/bot/play-position";
import type { Card } from "../../src/bridge/cards";

function opening(
	hand: readonly Card[],
	strain: PlayPosition["contract"]["strain"] = "S",
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
		contract: { level: 4, strain, declarer: "N", doubling: "" },
		vulnerability: "none",
		declarerTricks: 0,
		legal: hand,
		hints: [],
	};
}

const shortHand = [
	"S9",
	"S3",
	"H4",
	"DK",
	"DJ",
	"D8",
	"D5",
	"D2",
	"CQ",
	"CJ",
	"C7",
	"C5",
	"C3",
] as const satisfies readonly Card[];

const fourthHand = [
	"C3",
	"D5",
	"HK",
	"D2",
	"C6",
	"H8",
	"SJ",
	"H2",
	"H9",
	"S8",
	"H4",
	"S5",
	"S2",
] as const satisfies readonly Card[];

describe("defensive suit opening challengers", () => {
	it("chooses fourth highest in the incumbent's side suit, not lowest or another suit", () => {
		const position = opening(fourthHand);
		expect(trumpOpening("fourth", position, "H2")).toBe("H4");
		expect(trumpOpening("fourth", position, "D2")).toBeUndefined();
		expect(trumpOpening("fourth", position, "S2")).toBeUndefined();
	});

	it.each([
		{ holding: ["HA", "H8", "H4", "H2"], lead: "HA" },
		{ holding: ["HK", "HQ", "H4", "H2"], lead: "HK" },
		{ holding: ["HK", "HJ", "HT", "H2"], lead: "HJ" },
	] as const)("gives $lead precedence from $holding", ({ holding, lead }) => {
		const rest = [
			"S9",
			"S3",
			"DK",
			"DJ",
			"D8",
			"D5",
			"CQ",
			"C7",
			"C5",
		] as const;
		expect(trumpOpening("fourth", opening([...holding, ...rest]), "H2")).toBe(
			lead,
		);
	});

	it.each([
		{ trumps: ["S9"], extraClub: "C2", clubToRemove: undefined },
		{ trumps: ["S9", "S3"], extraClub: undefined, clubToRemove: undefined },
		{ trumps: ["SK", "S9", "S3"], extraClub: undefined, clubToRemove: "C3" },
	] as const)(
		"offers the unique side singleton with $trumps",
		({ trumps, extraClub, clubToRemove }) => {
			const sides = shortHand.slice(2).filter((card) => card !== clubToRemove);
			const hand = [...trumps, ...sides, ...(extraClub ? [extraClub] : [])];
			expect(trumpOpening("short", opening(hand), "D5")).toBe("H4");
		},
	);

	it.each([
		{ hand: ["SA", "SK", ...shortHand.slice(2)], reason: "strong trumps" },
		{
			hand: [
				"S5",
				"S4",
				...shortHand.filter((card) => card !== "C5" && card !== "C3"),
			],
			reason: "four trumps",
		},
		{
			hand: shortHand.map(
				(card): Card => (card === "S9" ? "D4" : card === "S3" ? "C2" : card),
			),
			reason: "no trumps",
		},
		{
			hand: shortHand.map((card): Card => (card === "H4" ? "HA" : card)),
			reason: "singleton ace",
		},
		{
			hand: shortHand.map(
				(card): Card => (card === "H4" ? "H6" : card === "C3" ? "H4" : card),
			),
			reason: "no singleton",
		},
		{
			hand: [
				"CQ",
				"S9",
				"S3",
				"H4",
				"DK",
				"DJ",
				"D8",
				"D7",
				"D6",
				"D5",
				"D4",
				"D3",
				"D2",
			],
			reason: "two side singletons",
		},
	] satisfies { hand: readonly Card[]; reason: string }[])(
		"abstains with $reason",
		({ hand }) => {
			expect(trumpOpening("short", opening(hand), "D5")).toBeUndefined();
		},
	);

	it("avoids a singleton when an opponent showed length in the suit", () => {
		const position: PlayPosition = {
			...opening(shortHand),
			hints: [
				{
					seat: "S",
					system: "hcp",
					meaning: { shape: { kind: "transfer", suit: "H", min: 5 } },
				},
			],
		};
		expect(trumpOpening("short", position, "D5")).toBeUndefined();
	});

	it.each(["fourth", "short"] as const)(
		"does not use %s in notrump or outside the opening lead",
		(kind) => {
			const hand = kind === "fourth" ? fourthHand : shortHand;
			const incumbent = kind === "fourth" ? "H2" : "D5";
			const position = opening(hand);
			expect(
				trumpOpening(kind, opening(hand, "NT"), incumbent),
			).toBeUndefined();
			expect(
				trumpOpening(kind, { ...position, turn: "N" }, incumbent),
			).toBeUndefined();
			expect(
				trumpOpening(
					kind,
					{ ...position, current: { leader: "W", cards: ["DA"] } },
					incumbent,
				),
			).toBeUndefined();
			const later = {
				...position,
				view: {
					...position.view,
					plays: [{ seat: "W", card: "DA", trick: 1 }],
				},
			} satisfies PlayPosition;
			expect(trumpOpening(kind, later, incumbent)).toBeUndefined();
		},
	);
});
