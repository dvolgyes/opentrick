import type { PlayPosition } from "../../src/bot/play-position";
import { type Card, RANKS, rankOf, suitOf } from "../../src/bridge/cards";

const nine = RANKS.indexOf("9");

/**
 * Second hand low on 2–8. Context also uses Pavlicek's visible-dummy cover
 * and split rules (https://www.rpbridge.net/4l00.htm). Support is the next
 * lower rank still in dummy. With two or more higher cards, cover highest;
 * with one, duck a supported honor only if a lower follower is available.
 * Abstain on concealed honor leads, unavailable dummy, and honor leads with
 * no possible cover. On spot leads, split at the top of the highest touching
 * pair when holding at least three of A–9. Leave all trump covers and splits
 * to search; ordinary low follows are still eligible in trumps.
 */
export function secondSeat(
	kind: "low" | "context",
	position: PlayPosition,
	_incumbentCard: Card,
): Card | undefined {
	const { current, legal, turn, view } = position;
	const lead = current.cards[0];
	if (
		current.cards.length !== 1 ||
		!lead ||
		turn === view.declarer ||
		turn === view.dummy ||
		(current.leader !== view.declarer && current.leader !== view.dummy)
	)
		return undefined;

	const suit = suitOf(lead);
	const leadRank = RANKS.indexOf(rankOf(lead));
	const trump = suit === position.contract.strain;
	const dummy = view.dummyCards;
	if (
		leadRank <= nine &&
		(kind === "low" || trump || current.leader !== view.dummy || !dummy)
	)
		return undefined;

	let low: Card | undefined;
	let high: Card | undefined;
	let lowRank = -1;
	let highRank: number = RANKS.length;
	let higherCount = 0;
	let honorCount = 0;
	let honors = 0;
	for (const card of legal) {
		if (suitOf(card) !== suit) continue;
		const rank = RANKS.indexOf(rankOf(card));
		if (rank > lowRank) {
			low = card;
			lowRank = rank;
		}
		if (rank < leadRank) {
			higherCount++;
			if (rank < highRank) {
				high = card;
				highRank = rank;
			}
		}
		if (rank <= nine) {
			honorCount++;
			honors |= 1 << rank;
		}
	}

	if (leadRank <= nine) {
		if (!high || !dummy) return undefined;
		const support = `${suit}${RANKS[leadRank + 1]}` as Card;
		if (higherCount === 1 && dummy.includes(support))
			return lowRank > leadRank ? low : undefined;
		return high;
	}

	if (kind === "context" && honorCount >= 3) {
		const touching = honors & (honors >> 1);
		for (let rank = 0; rank < nine; rank++) {
			if (touching & (1 << rank))
				return trump ? undefined : (`${suit}${RANKS[rank]}` as Card);
		}
	}
	return low;
}
