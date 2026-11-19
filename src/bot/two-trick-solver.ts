import { type Card, SUITS } from "../bridge/cards";
import type { CurrentTrick } from "../bridge/engine";
import { playableCards, type Strain, trickWinner } from "../bridge/rules";
import { SEATS, seatAfter } from "../protocol";
import type { DoubleDummySolver } from "./dds-solver";
import type { PlayPosition } from "./play-position";
import type { RemainingHands } from "./play-sampling";

export function twoTrickLookup(
	position: PlayPosition,
	native: DoubleDummySolver,
): DoubleDummySolver {
	const { plays } = position.view;
	const offset = plays.length - 44;
	if (offset < 0 || offset > 3 || position.legal.length !== 2) return native;
	const { current, contract } = position;
	const first = SEATS.indexOf(current.leader);
	const strain = contract.strain;
	if (
		first < 0 ||
		current.cards.length !== offset ||
		(strain !== "NT" && !SUITS.includes(strain))
	)
		return native;
	for (let i = 0; i < offset; i++) {
		const play = plays[44 + i];
		if (
			play?.seat !== seatAfter(current.leader, i) ||
			play.card !== current.cards[i]
		)
			return native;
	}
	return {
		solve(hands, trump, trick) {
			for (let i = 0; i < 4; i++) {
				if (hands[seatAfter(current.leader, i)].length !== (i < offset ? 1 : 2))
					return native.solve(hands, trump, trick);
			}
			return solveTwoTrickScores(hands, trump, trick);
		},
	};
}

/**
 * Scores a validated two-trick world with eight distinct cards across the hands and legal current prefix.
 * Seats that have played to the current trick hold one card; the others hold two.
 * Map iteration does not follow DDS order.
 */
export function solveTwoTrickScores(
	hands: RemainingHands,
	strain: Strain,
	current: CurrentTrick,
): ReadonlyMap<Card, number> {
	const leader = current.leader;
	const first = SEATS.indexOf(leader);
	const root = current.cards.length;
	const side = (first + root) & 1;
	const penultimate = [...current.cards];
	const last: Card[] = [];
	const complete = (offset: number): number => {
		if (offset === 4) {
			const winner = trickWinner(penultimate, leader, strain);
			const lead = SEATS.indexOf(winner);
			for (let i = 0; i < 4; i++) {
				const seat = seatAfter(winner, i);
				const hand = hands[seat];
				last[i] = (
					hand[0] === penultimate[(lead + i - first + 4) & 3]
						? hand[1]
						: hand[0]
				) as Card;
			}
			return (
				Number((lead & 1) === side) +
				Number((SEATS.indexOf(trickWinner(last, winner, strain)) & 1) === side)
			);
		}
		const maximize = ((first + offset) & 1) === side;
		let value = maximize ? 0 : 2;
		for (const card of playableCards(
			penultimate,
			hands[seatAfter(leader, offset)],
		)) {
			penultimate.push(card);
			const result = complete(offset + 1);
			penultimate.pop();
			if (result === (maximize ? 2 : 0)) return result;
			value = maximize ? Math.max(value, result) : Math.min(value, result);
		}
		return value;
	};
	const scores = new Map<Card, number>();
	for (const card of playableCards(
		penultimate,
		hands[seatAfter(leader, root)],
	)) {
		penultimate.push(card);
		scores.set(card, complete(root + 1));
		penultimate.pop();
	}
	return scores;
}
