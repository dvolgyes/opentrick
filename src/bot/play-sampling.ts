import { cardKnowledge, type VisiblePlay } from "../bridge/card-knowledge";
import { type Card, DECK, isCard, suitOf } from "../bridge/cards";
import { shuffle } from "../bridge/deal";
import { SEATS, type Seat } from "../protocol";

export type RemainingHands = Record<Seat, readonly Card[]>;

/** Uniform completions conditional on hand sizes and shown voids, without rejection loops. */
export function createHandSampler(
	view: VisiblePlay,
): (random: () => number) => RemainingHands {
	const visible = [
		...view.own,
		...(view.dummyCards ?? []),
		...view.plays.map((play) => play.card),
	];
	if (
		visible.some((card) => !isCard(card)) ||
		new Set(visible).size !== visible.length
	)
		throw new Error("visible cards must be valid and contain no duplicates");
	for (const seat of SEATS) {
		const played = view.plays.filter((play) => play.seat === seat).length;
		const known =
			seat === view.seat
				? view.own
				: seat === view.dummy
					? view.dummyCards
					: undefined;
		if (played > 13 || (known && known.length + played !== 13))
			throw new Error(`inconsistent visible hand size for ${seat}`);
	}
	const knowledge = cardKnowledge(view);
	const hidden = knowledge.hidden;
	const unseen = DECK.filter((card) => !visible.includes(card));
	if (hidden.reduce((sum, hand) => sum + hand.remaining, 0) !== unseen.length)
		throw new Error("unseen cards do not fill the hidden hands");
	// Three hands are hidden only at the opening lead, before any void can be observed.
	if (hidden.length !== 2 && !(hidden.length === 3 && view.plays.length === 0))
		throw new Error(
			"unsupported visibility: use the acting player's hand and exposed dummy",
		);
	const forced = new Map<Seat, Card[]>(hidden.map((hand) => [hand.seat, []]));
	const flexible: Card[] = [];
	for (const card of unseen) {
		const allowed = hidden.filter((hand) => hand.lengths[suitOf(card)].max > 0);
		if (allowed.length === 0)
			throw new Error("a card has no possible hidden owner");
		const owner = allowed[0];
		if (allowed.length === 1 && owner) forced.get(owner.seat)?.push(card);
		else flexible.push(card);
	}
	for (const hand of hidden)
		if ((forced.get(hand.seat)?.length ?? 0) > hand.remaining)
			throw new Error("forced cards exceed hidden hand capacity");
	return (random) => {
		const shuffled = shuffle(flexible, (bound) => {
			const value = random();
			if (!(value >= 0 && value < 1))
				throw new Error("random source must return a value in [0, 1)");
			return Math.floor(value * bound);
		});
		const hands: RemainingHands = { N: [], E: [], S: [], W: [] };
		hands[view.seat] = view.own;
		if (view.dummyCards) hands[view.dummy] = view.dummyCards;
		let offset = 0;
		for (const hand of hidden) {
			const fixed = forced.get(hand.seat) ?? [];
			const count = hand.remaining - fixed.length;
			hands[hand.seat] = [...fixed, ...shuffled.slice(offset, offset + count)];
			offset += count;
		}
		return hands;
	};
}

export function sampleHands(
	view: VisiblePlay,
	random: () => number,
): RemainingHands {
	return createHandSampler(view)(random);
}
