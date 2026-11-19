import { type Card, RANKS, rankOf, SUITS, suitOf } from "../bridge/cards";
import type { Strain } from "../bridge/rules";
import type { PlayPosition } from "./play-position";

function currentWinner(
	lead: Card,
	cards: readonly Card[],
	trump: Strain,
): Card {
	let winner = lead;
	let winningSuit = suitOf(lead);
	let winningRank = RANKS.indexOf(rankOf(lead));
	for (let i = 1; i < cards.length; i++) {
		const card = cards[i];
		if (card === undefined) continue;
		const suit = suitOf(card);
		if (suit !== winningSuit && suit !== trump) continue;
		const rank = RANKS.indexOf(rankOf(card));
		if (suit !== winningSuit || rank < winningRank) {
			winner = card;
			winningSuit = suit;
			winningRank = rank;
		}
	}
	return winner;
}

/** Map legal cards in order, with a shared key for publicly equivalent ranks. */
export function mapLegalRankClasses<T>(
	position: PlayPosition,
	map: (card: Card, key: number) => T,
): T[] {
	const gaps = { S: 0, H: 0, D: 0, C: 0 };
	for (const card of position.legal) {
		gaps[suitOf(card)] |= 1 << RANKS.indexOf(rankOf(card));
	}
	for (const suit of SUITS) {
		const legal = gaps[suit];
		if (legal === 0) continue;
		const span = (1 << (32 - Math.clz32(legal))) - (legal & -legal);
		gaps[suit] = span & ~legal;
	}
	if (gaps.S | gaps.H | gaps.D | gaps.C) {
		const { view, turn } = position;
		const hand = turn === view.seat ? view.own : view.dummyCards;
		for (const card of hand ?? []) {
			gaps[suitOf(card)] &= ~(1 << RANKS.indexOf(rankOf(card)));
		}
		for (
			let i = view.plays.length - position.current.cards.length - 1;
			i >= 0;
			i--
		) {
			if (!(gaps.S | gaps.H | gaps.D | gaps.C)) break;
			const play = view.plays[i];
			if (play)
				gaps[suitOf(play.card)] &= ~(1 << RANKS.indexOf(rankOf(play.card)));
		}
		const cards = position.current.cards;
		const lead = cards[0];
		if (lead !== undefined && cards.length > 1) {
			let winner: Card | undefined;
			for (let i = 0; i < cards.length; i++) {
				if (!(gaps.S | gaps.H | gaps.D | gaps.C)) break;
				const card = cards[i];
				if (card === undefined) continue;
				const suit = suitOf(card);
				const bit = 1 << RANKS.indexOf(rankOf(card));
				if (!(gaps[suit] & bit)) continue;
				winner ??= currentWinner(lead, cards, position.contract.strain);
				if (card !== winner) gaps[suit] &= ~bit;
			}
		}
	}
	return position.legal.map((card) => {
		const suit = suitOf(card);
		const higher = (1 << RANKS.indexOf(rankOf(card))) - 1;
		const key =
			SUITS.indexOf(suit) * RANKS.length +
			(32 - Math.clz32(gaps[suit] & higher));
		return map(card, key);
	});
}
