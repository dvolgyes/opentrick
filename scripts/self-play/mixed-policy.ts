import {
	type Card,
	RANKS,
	rankOf,
	SUITS,
	suitOf,
} from "../../src/bridge/cards";
import type { CurrentTrick } from "../../src/bridge/engine";
import type { Strain } from "../../src/bridge/rules";

export function publicOrder(a: Card, b: Card): number {
	return (
		RANKS.indexOf(rankOf(b)) - RANKS.indexOf(rankOf(a)) ||
		SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b))
	);
}

function leadCard(hand: readonly Card[]): Card {
	const lengths = { S: 0, H: 0, D: 0, C: 0 };
	for (const card of hand) lengths[suitOf(card)]++;
	let longest: (typeof SUITS)[number] = SUITS[0];
	for (const suit of SUITS)
		if (lengths[suit] > lengths[longest]) longest = suit;
	const cards = hand
		.filter((card) => suitOf(card) === longest)
		.sort((a, b) => publicOrder(b, a));
	const [top, next] = cards;
	if (top && next) {
		const rank = RANKS.indexOf(rankOf(top));
		if (rank <= RANKS.indexOf("T") && RANKS[rank + 1] === rankOf(next))
			return top;
	}
	const lead = cards[Math.min(3, cards.length - 1)];
	if (!lead) throw new Error("cannot model a play from an empty hand");
	return lead;
}

function beats(card: Card, winner: Card, strain: Strain): boolean {
	return suitOf(card) === suitOf(winner)
		? publicOrder(card, winner) > 0
		: suitOf(card) === strain;
}

/** Model the next seat using only its current hand and the public trick. */
export function modelCard(
	hand: readonly Card[],
	current: CurrentTrick,
	strain: Strain,
): Card {
	const lead = current.cards[0];
	if (!lead) return leadCard(hand);
	let winner = lead;
	let winningOffset = 0;
	for (const [offset, card] of current.cards.entries()) {
		if (beats(card, winner, strain)) {
			winner = card;
			winningOffset = offset;
		}
	}
	const partnerWinning = current.cards.length - winningOffset === 2;
	const led = suitOf(lead);
	const follows = hand.some((card) => suitOf(card) === led);
	let low: Card | undefined;
	let cheapestWinner: Card | undefined;
	for (const card of hand) {
		if (follows && suitOf(card) !== led) continue;
		if (!low || publicOrder(card, low) < 0) low = card;
		if (
			!partnerWinning &&
			beats(card, winner, strain) &&
			(!cheapestWinner || publicOrder(card, cheapestWinner) < 0)
		) {
			cheapestWinner = card;
		}
	}
	if (!low) throw new Error("cannot model a play from an empty hand");
	return cheapestWinner ?? low;
}
