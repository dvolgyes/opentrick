import { SEATS, type Seat, seatAfter } from "../protocol";
import { type Card, DECK, SUITS, type Suit, suitOf } from "./cards";
import { type Board, boardStatus } from "./engine";
import type { Strain } from "./rules";

/** One played card; `trick` counts from 1, and the current partial trick is included. */
export interface VisiblePlayedCard {
	readonly seat: Seat;
	readonly card: Card;
	readonly trick: number;
}

/**
 * Everything that `seat` may see during the play: its own remaining cards, dummy's remaining cards after the
 * opening lead, and the played cards. It holds no card of a hidden hand.
 */
export interface VisiblePlay {
	readonly seat: Seat;
	readonly declarer: Seat;
	readonly dummy: Seat;
	readonly trump: Strain;
	readonly own: readonly Card[];
	/** Undefined before the opening lead, and for dummy itself. */
	readonly dummyCards: readonly Card[] | undefined;
	readonly plays: readonly VisiblePlayedCard[];
}

export interface SuitLength {
	readonly min: number;
	readonly max: number;
}

export interface HiddenHand {
	readonly seat: Seat;
	/** Cards not yet played. */
	readonly remaining: number;
	/** Suits in which the hand did not follow, with the first trick where it showed out. */
	readonly voids: readonly { readonly suit: Suit; readonly trick: number }[];
	readonly lengths: Readonly<Record<Suit, SuitLength>>;
	/** Unaccounted cards that can only be in this hand, in display order. */
	readonly known: readonly Card[];
}

export interface CardKnowledge {
	/** The cards that the hidden hands hold together, in display order. */
	readonly unaccounted: Readonly<Record<Suit, readonly Card[]>>;
	readonly hidden: readonly HiddenHand[];
}

/**
 * The view of `seat` on a board in play, or undefined during the auction and for a passed-out board. This is the
 * only function in the module that reads the deal, so that cardKnowledge cannot use a hidden card.
 */
export function visiblePlay(board: Board, seat: Seat): VisiblePlay | undefined {
	const status = boardStatus(board);
	if (status.contract === undefined || status.contract === null)
		return undefined;
	const dummy = seatAfter(status.contract.declarer, 2);
	const plays: VisiblePlayedCard[] = [];
	const tricks = [
		...status.tricks,
		...(status.current ? [status.current] : []),
	];
	for (const [index, trick] of tricks.entries()) {
		for (const [position, card] of trick.cards.entries())
			plays.push({
				seat: seatAfter(trick.leader, position),
				card,
				trick: index + 1,
			});
	}
	return {
		seat,
		declarer: status.contract.declarer,
		dummy,
		trump: status.contract.strain,
		own: status.remaining[seat],
		dummyCards:
			board.cards.length > 0 && seat !== dummy
				? status.remaining[dummy]
				: undefined,
		plays,
	};
}

interface Bounds {
	min: number;
	max: number;
}

/**
 * What the visible cards tell about the hidden hands: the unaccounted cards, the voids shown in play, and the
 * suit lengths that the card counts allow. The auction is not used. Throws when the view contradicts itself.
 */
export function cardKnowledge(view: VisiblePlay): CardKnowledge {
	const seen = new Set<Card>([
		...view.own,
		...(view.dummyCards ?? []),
		...view.plays.map((play) => play.card),
	]);
	const unaccounted = suitRecord((suit) =>
		DECK.filter((card) => suitOf(card) === suit && !seen.has(card)),
	);
	const hiddenSeats = SEATS.filter(
		(seat) =>
			seat !== view.seat &&
			!(view.dummyCards !== undefined && seat === view.dummy),
	);

	const led = new Map<number, Suit>();
	for (const play of view.plays)
		if (!led.has(play.trick)) led.set(play.trick, suitOf(play.card));
	const hands = hiddenSeats.map((seat) => {
		const played = view.plays.filter((play) => play.seat === seat);
		const voids: { suit: Suit; trick: number }[] = [];
		for (const play of played) {
			const suit = led.get(play.trick);
			if (
				suit !== undefined &&
				suitOf(play.card) !== suit &&
				!voids.some((known) => known.suit === suit)
			)
				voids.push({ suit, trick: play.trick });
		}
		const remaining = 13 - played.length;
		const lengths = suitRecord(
			(suit): Bounds => ({
				min: 0,
				max: voids.some((known) => known.suit === suit)
					? 0
					: Math.min(unaccounted[suit].length, remaining),
			}),
		);
		return { seat, remaining, voids, lengths };
	});

	propagate(hands, unaccounted);
	return {
		unaccounted,
		hidden: hands.map((hand) => ({
			...hand,
			known: SUITS.flatMap((suit) => {
				const count = unaccounted[suit].length;
				return count > 0 && hand.lengths[suit].min === count
					? unaccounted[suit]
					: [];
			}),
		})),
	};
}

/**
 * Tightens the bounds until nothing changes. Each suit's unaccounted cards are shared by the hidden hands, and
 * each hand's suit lengths add up to its remaining cards.
 */
function propagate(
	hands: readonly {
		readonly seat: Seat;
		readonly remaining: number;
		readonly lengths: Record<Suit, Bounds>;
	}[],
	unaccounted: Readonly<Record<Suit, readonly Card[]>>,
): void {
	let changed = true;
	while (changed) {
		changed = false;
		const tighten = (bounds: Bounds, min: number, max: number): void => {
			if (min > bounds.min) {
				bounds.min = min;
				changed = true;
			}
			if (max < bounds.max) {
				bounds.max = max;
				changed = true;
			}
		};
		for (const suit of SUITS) {
			const count = unaccounted[suit].length;
			for (const hand of hands) {
				const others = hands.filter((other) => other !== hand);
				tighten(
					hand.lengths[suit],
					count - sum(others, (other) => other.lengths[suit].max),
					count - sum(others, (other) => other.lengths[suit].min),
				);
			}
		}
		for (const hand of hands) {
			for (const suit of SUITS) {
				const others = SUITS.filter((other) => other !== suit);
				tighten(
					hand.lengths[suit],
					hand.remaining - sum(others, (other) => hand.lengths[other].max),
					hand.remaining - sum(others, (other) => hand.lengths[other].min),
				);
			}
		}
		for (const hand of hands)
			for (const suit of SUITS)
				if (hand.lengths[suit].min > hand.lengths[suit].max)
					throw new Error(
						`the visible cards contradict each other for ${hand.seat} in ${suit}`,
					);
	}
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
	return items.reduce((total, item) => total + value(item), 0);
}

function suitRecord<T>(value: (suit: Suit) => T): Record<Suit, T> {
	return { S: value("S"), H: value("H"), D: value("D"), C: value("C") };
}
