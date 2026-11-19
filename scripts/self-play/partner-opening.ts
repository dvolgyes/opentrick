import type { PlayPosition } from "../../src/bot/play-position";
import {
	type Card,
	RANKS,
	rankOf,
	type Suit,
	sortCards,
	suitOf,
} from "../../src/bridge/cards";
import type { Shape } from "../../src/bridge/conventions";
import { seatAfter } from "../../src/protocol";

function naturalMajor(shape: Shape): Suit | undefined {
	if (!("suit" in shape) || (shape.suit !== "H" && shape.suit !== "S"))
		return undefined;
	switch (shape.kind) {
		case "cards":
		case "good-suit":
			return shape.min >= 5 && shape.min <= 13 ? shape.suit : undefined;
		case "weak-two":
			return shape.length === 6 ? shape.suit : undefined;
		case "preempt":
			return shape.length === 7 ? shape.suit : undefined;
		default:
			return undefined;
	}
}

function showsOpposingSuit(shape: Shape, suit: Suit): boolean {
	if (shape.kind === "two-suits")
		return shape.suit === suit || shape.other === suit;
	if (shape.kind === "second-suit")
		return shape.suit === suit || shape.major === suit;
	if (shape.kind === "negative") return shape.suits.includes(suit);
	if (!("suit" in shape) || shape.suit !== suit) return false;
	switch (shape.kind) {
		case "cards":
		case "spades-no-hearts":
		case "support":
		case "weak-two":
		case "preempt":
		case "game-try":
		case "competitive":
		case "transfer":
		case "exact":
		case "balanced-with":
		case "short-support":
		case "longer-major":
		case "invite":
		case "slam-try":
		case "ace-ask":
		case "good-suit":
			return true;
		default:
			return false;
	}
}

/** Cohen/Lindop standard: low from three small, ace from AKx, king only from AK doubleton. */
function standardRank(
	cards: readonly Card[],
	againstSuit: boolean,
): Card | undefined {
	const [top, second, third] = cards;
	if (!top || !second) return top;
	const rank = rankOf(top);
	if (rank === "A" && rankOf(second) === "K") return third ? top : second;
	if (!third || (againstSuit && rank === "A")) return top;
	const topIndex = RANKS.indexOf(rank);
	const secondIndex = RANKS.indexOf(rankOf(second));
	const thirdIndex = RANKS.indexOf(rankOf(third));
	if (topIndex >= 1 && secondIndex <= 4 && secondIndex === topIndex + 1)
		return top;
	if (topIndex >= 1 && secondIndex <= 3 && thirdIndex === secondIndex + 1)
		return second;
	return cards[3] ?? third;
}

export function partnerOpening(
	kind: "high" | "standard",
	position: PlayPosition,
	_incumbentCard: Card,
): Card | undefined {
	const { turn, contract, current, view, hints, legal } = position;
	if (
		turn !== seatAfter(contract.declarer, 1) ||
		current.leader !== turn ||
		current.cards.length !== 0 ||
		view.plays.length !== 0
	)
		return undefined;
	const partner = seatAfter(turn, 2);
	let suit: Suit | undefined;
	for (const { seat, meaning, system } of hints) {
		if (seat !== partner || system === "other") continue;
		const shown = naturalMajor(meaning.shape);
		if (shown === undefined) continue;
		if (suit !== undefined && suit !== shown) return undefined;
		suit = shown;
	}
	if (suit === undefined || suit === contract.strain) return undefined;
	for (const { seat, meaning } of hints) {
		if (
			(seat === contract.declarer || seat === view.dummy) &&
			showsOpposingSuit(meaning.shape, suit)
		)
			return undefined;
	}
	const cards = sortCards(legal.filter((card) => suitOf(card) === suit));
	return kind === "high"
		? cards[0]
		: standardRank(cards, contract.strain !== "NT");
}
