import { type Card, RANKS, rankOf, SUITS, suitOf } from "../bridge/cards";
import type { PlayPosition } from "./play-position";

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
