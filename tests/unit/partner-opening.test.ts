import { describe, expect, it } from "vitest";
import { competitiveDeal } from "../../scripts/self-play/competitive-deals";
import { partnerOpening } from "../../scripts/self-play/partner-opening";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import { type Card, isDeal, type Suit, suitOf } from "../../src/bridge/cards";
import { callMeaning, type Shape } from "../../src/bridge/conventions";
import { boardStatus } from "../../src/bridge/engine";
import { countHandPoints } from "../../src/bridge/hand-points";
import { boardSetup, isLegalCall } from "../../src/bridge/rules";
import { seatAfter } from "../../src/protocol";

const heartOpening = { kind: "cards", suit: "H", min: 5 } as const;

function hint(
	shape: Shape,
	seat: PlayPosition["turn"] = "N",
): PlayPosition["hints"][number] {
	return { seat, system: "hcp", meaning: { shape } };
}

function position(
	hearts: readonly Card[],
	strain: PlayPosition["contract"]["strain"] = "S",
	hints: PlayPosition["hints"] = [hint(heartOpening)],
): PlayPosition {
	const own = ["D2" as const, ...hearts];
	return {
		view: {
			seat: "S",
			declarer: "E",
			dummy: "W",
			trump: strain,
			own,
			dummyCards: undefined,
			plays: [],
		},
		turn: "S",
		current: { leader: "S", cards: [] },
		contract: {
			level: strain === "NT" ? 3 : 4,
			declarer: "E",
			strain,
			doubling: "",
		},
		vulnerability: "none",
		declarerTricks: 0,
		legal: own,
		hints,
	};
}

describe("partner opening lead", () => {
	it.each<{ cards: Card[]; high: Card; standard: Card }>([
		{ cards: ["H2"], high: "H2", standard: "H2" },
		{ cards: ["H3", "H6"], high: "H6", standard: "H6" },
		{ cards: ["H2", "HQ", "H7"], high: "HQ", standard: "H2" },
		{ cards: ["H8", "H4", "H2"], high: "H8", standard: "H2" },
		{ cards: ["H2", "HK", "H9", "H4", "H7"], high: "HK", standard: "H4" },
		{ cards: ["HK", "HJ", "HT", "H3"], high: "HK", standard: "HJ" },
		{ cards: ["HJ", "HQ", "H6", "H3"], high: "HQ", standard: "HQ" },
		{ cards: ["HK", "HA"], high: "HA", standard: "HK" },
		{ cards: ["H2", "HK", "HA"], high: "HA", standard: "HA" },
		{ cards: ["H2", "HA", "HJ", "H8"], high: "HA", standard: "HA" },
	])("chooses the rank from $cards", ({ cards, high, standard }) => {
		const play = position(cards);
		expect(partnerOpening("high", play, "D2")).toBe(high);
		expect(partnerOpening("standard", play, "D2")).toBe(standard);
	});

	it("still suggests the card when it agrees with the incumbent", () => {
		expect(partnerOpening("standard", position(["H5"]), "H5")).toBe("H5");
	});

	it("allows a fourth-best underlead against notrump only", () => {
		expect(
			partnerOpening(
				"standard",
				position(["HA", "HJ", "H8", "H2"], "NT"),
				"D2",
			),
		).toBe("H2");
	});

	it("accepts natural weak two and preempt meanings", () => {
		for (const shape of [
			{ kind: "weak-two", suit: "H", length: 6 },
			{ kind: "preempt", suit: "H", length: 7 },
		] as const) {
			expect(
				partnerOpening("standard", position(["H4"], "S", [hint(shape)]), "D2"),
			).toBe("H4");
		}
	});

	it("accepts a natural five-card overcall but does not read an opponent's stopper as their suit", () => {
		const hints: PlayPosition["hints"] = [
			hint({ kind: "good-suit", suit: "H", min: 5 }),
			hint({ kind: "stopper", suit: "H" }, "E"),
		];
		expect(partnerOpening("high", position(["H4"], "NT", hints), "D2")).toBe(
			"H4",
		);
	});

	it("abstains without unique natural evidence from partner", () => {
		const fakeHints: PlayPosition["hints"][] = [
			[],
			[hint(heartOpening, "S")],
			[hint(heartOpening, "W")],
			[hint({ ...heartOpening, min: 4 })],
			[hint({ ...heartOpening, suit: "D" })],
			[hint({ kind: "artificial" })],
			[hint({ kind: "transfer", suit: "H", min: 5 })],
			[hint({ kind: "support", suit: "H", min: 5 })],
			[hint({ kind: "ace-ask", suit: "H", min: 5 })],
			[hint({ kind: "weak-two", suit: "H", length: 5 })],
			[hint({ kind: "preempt", suit: "H", length: 6 })],
			[hint(heartOpening), hint({ ...heartOpening, suit: "S" })],
			[hint(heartOpening), hint({ ...heartOpening, min: 4 }, "E")],
		];
		for (const hints of fakeHints) {
			expect(
				partnerOpening("standard", position(["H4", "S4"], "NT", hints), "D2"),
			).toBeUndefined();
		}
	});

	it("abstains on trump, a void, and later defensive tricks", () => {
		expect(partnerOpening("high", position(["H4"], "H"), "D2")).toBeUndefined();
		expect(partnerOpening("high", position([]), "D2")).toBeUndefined();
		const opening = position(["H4"]);
		expect(
			partnerOpening(
				"high",
				{
					...opening,
					view: {
						...opening.view,
						plays: [{ seat: "S", card: "CJ", trick: 1 }],
					},
				},
				"D2",
			),
		).toBeUndefined();
	});
});

it("replays legal competitive auctions, rotating seats and exposing only dealer's natural meaning", () => {
	for (let number = 1; number <= 4; number++) {
		const result = competitiveDeal(100 + number, number);
		const { board, hints, draws } = result;
		expect(draws).toBeGreaterThan(0);
		expect(result).toEqual(competitiveDeal(100 + number, number));
		expect(board).toMatchObject(boardSetup(number));
		expect(isDeal(board.deal)).toBe(true);
		const opened = board.calls[0] === "1H" ? "H" : "S";
		const other = opened === "H" ? "S" : "H";
		const overcall = opened === "H" ? "1S" : "2H";
		expect(board.calls).toEqual(
			number % 2
				? [`1${opened}`, "1NT", "P", "3NT", "P", "P", "P"]
				: [
						`1${opened}`,
						overcall,
						"P",
						`3${other}`,
						"P",
						`4${other}`,
						"P",
						"P",
						"P",
					],
		);
		for (const [index, call] of board.calls.entries()) {
			expect(isLegalCall(board.calls.slice(0, index), call)).toBe(true);
		}
		const status = boardStatus(board);
		expect(status.contract).toMatchObject({
			declarer: seatAfter(board.dealer, 1),
			strain: number % 2 ? "NT" : other,
		});
		expect(status.actor).toBe(seatAfter(board.dealer, 2));
		expect(hints).toMatchObject([
			hint({ ...heartOpening, suit: opened }, board.dealer),
		]);
		expect(hints[0]?.meaning).toEqual(callMeaning("hcp", board.calls, 0));
		expect(callMeaning("hcp", board.calls, 1)?.shape).toEqual(
			number % 2
				? { kind: "stopper", suit: opened }
				: { kind: "good-suit", suit: other, min: 5 },
		);
		const lengths = (hand: readonly Card[], suit: Suit) =>
			hand.filter((card) => suitOf(card) === suit).length;
		const opener = board.deal[board.dealer];
		const declarer = board.deal[seatAfter(board.dealer, 1)];
		const dummy = board.deal[seatAfter(board.dealer, 3)];
		const hcp = (hand: readonly Card[]) => countHandPoints("hcp", hand).total;
		expect(hcp(opener)).toBeGreaterThanOrEqual(12);
		expect(hcp(opener)).toBeLessThanOrEqual(14);
		expect(lengths(opener, opened)).toBeGreaterThanOrEqual(5);
		expect(hcp(declarer) + hcp(dummy)).toBeGreaterThanOrEqual(25);
		expect(hcp(dummy)).toBeGreaterThanOrEqual(10);
		if (number % 2) {
			expect(hcp(declarer)).toBeGreaterThanOrEqual(15);
			expect(hcp(declarer)).toBeLessThanOrEqual(18);
			expect(hcp(dummy)).toBeLessThanOrEqual(12);
			const shape = (["H", "S", "D", "C"] as const)
				.map((suit) => lengths(declarer, suit))
				.sort((a, b) => b - a)
				.join("");
			expect(["4333", "4432", "5332"]).toContain(shape);
			expect(
				declarer.includes(`${opened}A`) ||
					(declarer.includes(`${opened}K`) && lengths(declarer, opened) >= 2) ||
					(declarer.includes(`${opened}Q`) && lengths(declarer, opened) >= 3) ||
					(declarer.includes(`${opened}J`) && lengths(declarer, opened) >= 4),
			).toBe(true);
		} else {
			expect(hcp(declarer)).toBeGreaterThanOrEqual(14);
			expect(hcp(declarer)).toBeLessThanOrEqual(16);
			expect(hcp(dummy)).toBeLessThanOrEqual(11);
			expect(lengths(declarer, other)).toBeGreaterThanOrEqual(5);
			expect(lengths(dummy, other)).toBeGreaterThanOrEqual(3);
		}
		const opening = {
			...playPosition(board, seatAfter(board.dealer, 2)),
			hints,
		};
		const offSuit = opening.legal.find((card) => suitOf(card) !== opened);
		if (offSuit) {
			expect(partnerOpening("high", opening, offSuit)).toBe(
				opening.legal.find((card) => suitOf(card) === opened),
			);
		}
	}
});
