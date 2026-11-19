import { type Card, RANKS, rankOf, suitOf } from "../bridge/cards";
import type { PlayPosition } from "./play-position";
import { mapLegalRankClasses } from "./rank-classes";

/** Skips search only when every legal card has the same double-dummy value. */
export function obviousPlay(position: PlayPosition): Card | undefined {
	const { legal } = position;
	const first = legal[0];
	if (first === undefined || legal.length === 1) return first;

	const suit = suitOf(first);
	let highest = RANKS.length - 1;
	let lowest = 0;
	let lowestCard = first;
	let present = 0;
	for (const card of legal) {
		if (suitOf(card) !== suit) return undefined;
		const rank = RANKS.indexOf(rankOf(card));
		highest = Math.min(highest, rank);
		if (rank > lowest) {
			lowest = rank;
			lowestCard = card;
		}
		present |= 1 << rank;
	}

	const missing = ((1 << (lowest + 1)) - (1 << highest)) & ~present;
	if (missing === 0) return lowestCard;
	const keys = mapLegalRankClasses(position, (_, key) => key);
	return keys.every((key) => key === keys[0]) ? lowestCard : undefined;
}
