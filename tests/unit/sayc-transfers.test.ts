import { describe, expect, it } from "vitest";
import { type Card, SUITS } from "../../src/bridge/cards";
import { callMeaning, conventionCalls } from "../../src/bridge/conventions";
import type { Call } from "../../src/bridge/rules";

function hand(suits: string): Card[] {
	return suits
		.split(".")
		.flatMap((ranks, i) =>
			[...ranks].map((rank) => `${SUITS[i]}${rank}` as Card),
		);
}
const doubletonHearts = hand("AQJ4.K5.A73.K862");
const doubletonSpades = hand("K5.AQJ4.A73.K862");
function suggestions(cards: readonly Card[], text: string): Call[] | undefined {
	return conventionCalls("hcp", cards, text.split(" ") as Call[])?.map(
		(c) => c.call,
	);
}

describe("SAYC Jacoby transfers", () => {
	it("accepts an uncontested transfer with only two cards in the major", () => {
		expect(suggestions(doubletonHearts, "1NT P 2D P")).toEqual(["2H"]);
		expect(suggestions(doubletonSpades, "1NT P 2H P")).toEqual(["2S"]);
	});
	it("passes a doubled transfer with a doubleton and accepts with a real fit", () => {
		expect(suggestions(doubletonHearts, "1NT P 2D X")).toEqual(["P"]);
		expect(suggestions(doubletonSpades, "1NT P 2H X")).toEqual(["P"]);
		expect(suggestions(hand("AQ4.KJ5.A73.K862"), "1NT P 2D X")).toEqual(["2H"]);
	});
	it("keeps transfers on when the opponent doubles the 1NT opening", () => {
		expect(suggestions(doubletonHearts, "1NT X 2D P")).toEqual(["2H"]);
	});
	it("does not recommend a forced acceptance after a suit overcall", () => {
		expect(suggestions(doubletonHearts, "1NT P 2D 2S")).toBeUndefined();
	});
	it("distinguishes ordinary acceptance from support after the transfer is doubled", () => {
		expect(callMeaning("hcp", ["1NT", "P", "2D", "P", "2H"], 4)).toEqual({
			shape: { kind: "accept", suit: "H" },
		});
		expect(callMeaning("hcp", ["1NT", "P", "2D", "X", "2H"], 4)).toEqual({
			shape: { kind: "support", suit: "H", min: 3 },
		});
	});
});
