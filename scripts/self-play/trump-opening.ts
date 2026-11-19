import type { PlayPosition } from "../../src/bot/play-position";
import {
	type Card,
	RANKS,
	rankOf,
	SUITS,
	type Suit,
	sortCards,
	suitOf,
} from "../../src/bridge/cards";
import type { Shape } from "../../src/bridge/conventions";
import { seatAfter } from "../../src/protocol";

function fourthLead(holding: readonly Card[]): Card | undefined {
	const [top, next, third, fourth] = holding;
	if (!top || !next || !third || !fourth) return undefined;
	const firstRank = RANKS.indexOf(rankOf(top));
	const secondRank = RANKS.indexOf(rankOf(next));
	const thirdRank = RANKS.indexOf(rankOf(third));
	if (firstRank === 0) return top;
	const ten = RANKS.indexOf("T");
	if (secondRank <= ten && secondRank === firstRank + 1) return top;
	if (thirdRank <= ten && thirdRank === secondRank + 1) return next;
	return fourth;
}

function showsLength(shape: Shape, suit: Suit): boolean {
	switch (shape.kind) {
		case "two-suits":
			if (shape.other === suit && shape.otherLength >= 4) return true;
			return shape.suit === suit && shape.length >= 4;
		case "second-suit":
			return (
				(shape.major === suit && shape.length >= 4) ||
				(shape.suit === suit && shape.min >= 4)
			);
		case "balanced-with":
		case "exact":
		case "preempt":
		case "weak-two":
			return shape.suit === suit && shape.length >= 4;
		default:
			return (
				"suit" in shape &&
				shape.suit === suit &&
				"min" in shape &&
				shape.min >= 4
			);
	}
}

/** Offline opening-lead suggestions based on Larry Cohen's Opening Leads and David Lindop's Leading Against Suit Contracts. */
export function trumpOpening(
	kind: "fourth" | "short",
	position: PlayPosition,
	incumbentCard: Card,
): Card | undefined {
	const { declarer, strain: trump } = position.contract;
	if (
		trump === "NT" ||
		position.turn !== seatAfter(declarer, 1) ||
		position.current.cards.length !== 0 ||
		position.view.plays.length !== 0
	)
		return undefined;

	const { own } = position.view;
	if (kind === "fourth") {
		const suit = suitOf(incumbentCard);
		if (suit === trump) return undefined;
		return fourthLead(sortCards(own.filter((card) => suitOf(card) === suit)));
	}

	const trumps = own.filter((card) => suitOf(card) === trump);
	if (
		trumps.length < 1 ||
		trumps.length > 3 ||
		trumps.filter((card) => RANKS.indexOf(rankOf(card)) < 4).length >= 2
	)
		return undefined;

	let singleton: Card | undefined;
	for (const suit of SUITS) {
		if (suit === trump) continue;
		const [only, second] = own.filter((card) => suitOf(card) === suit);
		if (!only || second) continue;
		if (singleton !== undefined) return undefined;
		singleton = only;
	}
	if (singleton === undefined || rankOf(singleton) === "A") return undefined;
	const suit = suitOf(singleton);
	if (
		position.hints.some(
			({ seat, meaning }) =>
				(seat === declarer || seat === position.view.dummy) &&
				showsLength(meaning.shape, suit),
		)
	)
		return undefined;
	return singleton;
}
