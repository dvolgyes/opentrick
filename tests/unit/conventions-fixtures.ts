import type { Card } from "../../src/bridge/cards";
import { SUITS } from "../../src/bridge/cards";
import type { RuleSystem } from "../../src/bridge/convention-rules";
import { conventionCalls } from "../../src/bridge/conventions";
import type { PointSystem } from "../../src/bridge/hand-points";
import type { Call } from "../../src/bridge/rules";

/** A hand as "spades.hearts.diamonds.clubs", for example "AQ4.KJ5.Q862.K73"; "-" is a void. */
export function hand(text: string): Card[] {
	const suits = text.split(".");
	if (suits.length !== 4) throw new Error(`a hand needs four suits: ${text}`);
	const result = SUITS.flatMap((suit, index) =>
		[...(suits[index] === "-" ? "" : (suits[index] ?? ""))].map(
			(rank) => `${suit}${rank}` as Card,
		),
	);
	if (result.length !== 13) throw new Error(`a hand needs 13 cards: ${text}`);
	return result;
}

export function calls(text: string): Call[] {
	return text === "" ? [] : (text.split(" ") as Call[]);
}

export function suggested(
	system: Parameters<typeof conventionCalls>[0],
	cardsText: string,
	auction: string,
): Call[] | undefined {
	return conventionCalls(system, hand(cardsText), calls(auction))?.map(
		({ call }) => call,
	);
}

/** A small seeded generator, so that a failure can be repeated. */
export function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state;
	};
}

export const RULE_SYSTEMS: readonly RuleSystem[] = ["hcp", "hcp-corrected"];

/** The scales that have a guide but no rules: only their guide text. */
export const GUIDE_ONLY: readonly PointSystem[] = [
	"vienna",
	"reith",
	"four-aces",
];

/** The inverse of hand(): "AQ4.KJ5.Q862.K73". */
export function cardsText(cards: readonly Card[]): string {
	return SUITS.map(
		(suit) =>
			cards
				.filter((card) => card[0] === suit)
				.map((card) => card[1])
				.join("") || "-",
	).join(".");
}
