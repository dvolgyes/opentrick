/**
 * The bidding guide of a point system as rules, in two directions: which calls the guide gives a hand
 * (`conventionCalls`), and what a call in the auction shows (`callMeaning`). Both read one meaning table, so a
 * suggested call always has the meaning that the auction shows for it. The numbers are in convention-rules.ts.
 *
 * The guides describe the opening and the first response to one of a suit, [1NT] or [2C] after the next hand
 * passed. Any other position, a hand with a suit longer than SHAPES.longestChecked, and the "other" system are not
 * described, and the functions return undefined. The module returns data; the callers write the text.
 */
import { type Card, SUITS, type Suit, suitOf } from "./cards";
import {
	type PointRange,
	RANGES,
	type Ranges,
	type RuleSystem,
	SHAPES,
} from "./convention-rules";
import { countHandPoints, type PointSystem } from "./hand-points";
import { type Bid, CALLS, type Call } from "./rules";

export type Shape =
	| { readonly kind: "none" }
	| { readonly kind: "balanced" }
	/** The [2C] opening: artificial and forcing, any shape. */
	| { readonly kind: "artificial" }
	/** `min` or more cards in `suit`. */
	| { readonly kind: "cards"; readonly suit: Suit; readonly min: number }
	/** `min` or more cards in partner's `suit`. */
	| { readonly kind: "support"; readonly suit: Suit; readonly min: number }
	| { readonly kind: "weak-two"; readonly suit: Suit; readonly length: number }
	| { readonly kind: "preempt"; readonly suit: Suit; readonly length: number }
	/** `min` or more cards in `suit`, the suit above the bid. */
	| { readonly kind: "transfer"; readonly suit: Suit; readonly min: number }
	/** A major with exactly `min` cards. */
	| { readonly kind: "stayman"; readonly min: number }
	/** `min` or more cards in a minor. */
	| { readonly kind: "weak-minor"; readonly min: number }
	| { readonly kind: "waiting" }
	/** `min` or more cards in `suit`, with the top cards of SHAPES.goodSuit. */
	| { readonly kind: "good-suit"; readonly suit: Suit; readonly min: number };

/** What a call shows by the guide. A meaning without `range` has no point limit. */
export interface CallMeaning {
	readonly range?: PointRange;
	readonly shape: Shape;
}

export interface GuideCall {
	readonly call: Call;
	readonly meaning: CallMeaning;
}

type Position =
	| { readonly kind: "opening" }
	| { readonly kind: "suit"; readonly suit: Suit }
	| { readonly kind: "1NT" }
	| { readonly kind: "2C" };

const MAJORS: readonly Suit[] = ["S", "H"];
const MINORS: readonly Suit[] = ["D", "C"];

function rules(system: PointSystem): Ranges | undefined {
	return system === "other" ? undefined : RANGES[system satisfies RuleSystem];
}

function isBid(call: Call): call is Bid {
	return call !== "P" && call !== "X" && call !== "XX";
}

function levelOf(bid: Bid): number {
	return Number(bid[0]);
}

function strainOf(bid: Bid): string {
	return bid.slice(1);
}

function isSuit(strain: string): strain is Suit {
	return (SUITS as readonly string[]).includes(strain);
}

/** Lower strains rank lower within a level: clubs, diamonds, hearts, spades. */
function suitRank(suit: Suit): number {
	return SUITS.length - SUITS.indexOf(suit);
}

/**
 * The position of the next call: an opening after passes only, or the first response after partner opened and the
 * next hand passed. Undefined for any other auction.
 */
function position(calls: readonly Call[]): Position | undefined {
	if (calls.every((call) => call === "P"))
		return calls.length < 4 ? { kind: "opening" } : undefined;
	const opening = calls.at(-2);
	if (
		calls.at(-1) !== "P" ||
		opening === undefined ||
		!isBid(opening) ||
		!calls.slice(0, -2).every((call) => call === "P")
	)
		return undefined;
	const strain = strainOf(opening);
	if (levelOf(opening) === 1 && isSuit(strain))
		return { kind: "suit", suit: strain };
	if (opening === "1NT") return { kind: "1NT" };
	if (opening === "2C") return { kind: "2C" };
	return undefined;
}

function openingMeaning(ranges: Ranges, call: Call): CallMeaning | undefined {
	if (call === "P")
		return { range: ranges["open-pass"], shape: { kind: "none" } };
	if (!isBid(call)) return undefined;
	const level = levelOf(call);
	const strain = strainOf(call);
	if (strain === "NT") {
		const key = (["open-1NT", "open-2NT", "open-3NT"] as const)[level - 1];
		return key === undefined
			? undefined
			: { range: ranges[key], shape: { kind: "balanced" } };
	}
	if (!isSuit(strain)) return undefined;
	if (level === 1)
		return {
			range: ranges["open-suit"],
			shape: {
				kind: "cards",
				suit: strain,
				min: MAJORS.includes(strain)
					? SHAPES.majorOpening
					: SHAPES.minorOpening,
			},
		};
	if (call === "2C")
		return { range: ranges["open-2C"], shape: { kind: "artificial" } };
	if (level === 2)
		return {
			range: ranges["open-weak-two"],
			shape: { kind: "weak-two", suit: strain, length: SHAPES.weakTwo },
		};
	if (level === 3)
		return {
			range: ranges["open-preempt"],
			shape: { kind: "preempt", suit: strain, length: SHAPES.preempt },
		};
	return undefined;
}

/** The lowest level at which `suit` can be bid over one of `opened`, without a jump. */
function cheapestLevel(suit: Suit, opened: Suit): number {
	return suitRank(suit) > suitRank(opened) ? 1 : 2;
}

function suitResponseMeaning(
	ranges: Ranges,
	opened: Suit,
	call: Call,
): CallMeaning | undefined {
	if (call === "P")
		return { range: ranges["suit-pass"], shape: { kind: "none" } };
	if (call === "1NT")
		return { range: ranges["suit-low"], shape: { kind: "none" } };
	if (!isBid(call)) return undefined;
	const level = levelOf(call);
	const strain = strainOf(call);
	if (!isSuit(strain)) return undefined;
	if (strain === opened) {
		if (!MAJORS.includes(opened)) return undefined;
		const key =
			level === 2 ? "suit-low" : level === 3 ? "suit-invite" : undefined;
		return key === undefined
			? undefined
			: {
					range: ranges[key],
					shape: { kind: "support", suit: opened, min: SHAPES.support },
				};
	}
	if (level !== cheapestLevel(strain, opened)) return undefined;
	// The guide: a new suit at the one level from 6–9 points up; "a new suit at the two level needs 10 or more points".
	return {
		range: {
			min: level === 1 ? ranges["suit-low"].min : ranges["suit-invite"].min,
		},
		shape: { kind: "cards", suit: strain, min: SHAPES.newSuit },
	};
}

function notrumpResponseMeaning(
	ranges: Ranges,
	call: Call,
): CallMeaning | undefined {
	switch (call) {
		case "P":
			return { range: ranges["nt-weak"], shape: { kind: "none" } };
		case "2C":
			return {
				range: ranges["nt-stayman"],
				shape: { kind: "stayman", min: SHAPES.stayman },
			};
		case "2D":
			return { shape: { kind: "transfer", suit: "H", min: SHAPES.transfer } };
		case "2H":
			return { shape: { kind: "transfer", suit: "S", min: SHAPES.transfer } };
		case "2S":
			return {
				range: ranges["nt-weak"],
				shape: { kind: "weak-minor", min: SHAPES.weakMinor },
			};
		case "2NT":
			return { range: ranges["nt-2NT"], shape: { kind: "none" } };
		case "3NT":
			return { range: ranges["nt-3NT"], shape: { kind: "none" } };
		default:
			return undefined;
	}
}

const POSITIVE_RESPONSES: Readonly<Partial<Record<Call, Suit>>> = {
	"2H": "H",
	"2S": "S",
	"3C": "C",
	"3D": "D",
};

function twoClubsResponseMeaning(
	ranges: Ranges,
	call: Call,
): CallMeaning | undefined {
	if (call === "2D")
		return { range: ranges["2c-waiting"], shape: { kind: "waiting" } };
	if (call === "2NT")
		return { range: ranges["2c-2NT"], shape: { kind: "balanced" } };
	const suit = POSITIVE_RESPONSES[call];
	return suit === undefined
		? undefined
		: {
				range: ranges["2c-positive"],
				shape: { kind: "good-suit", suit, min: SHAPES.positive },
			};
}

function meaningAt(
	ranges: Ranges,
	at: Position,
	call: Call,
): CallMeaning | undefined {
	switch (at.kind) {
		case "opening":
			return openingMeaning(ranges, call);
		case "suit":
			return suitResponseMeaning(ranges, at.suit, call);
		case "1NT":
			return notrumpResponseMeaning(ranges, call);
		case "2C":
			return twoClubsResponseMeaning(ranges, call);
	}
}

/** What `calls[index]` shows by the guide of `system`, read from the calls before it. */
export function callMeaning(
	system: PointSystem,
	calls: readonly Call[],
	index: number,
): CallMeaning | undefined {
	const ranges = rules(system);
	const call = calls[index];
	if (ranges === undefined || call === undefined) return undefined;
	const at = position(calls.slice(0, index));
	return at === undefined ? undefined : meaningAt(ranges, at, call);
}

interface Hand {
	readonly points: number;
	readonly lengths: Readonly<Record<Suit, number>>;
	readonly cards: readonly Card[];
}

function suitCards(hand: Hand, suit: Suit): readonly Card[] {
	return hand.cards.filter((card) => suitOf(card) === suit);
}

function isBalanced(hand: Hand): boolean {
	const shape = SUITS.map((suit) => hand.lengths[suit])
		.sort((a, b) => b - a)
		.join("");
	return (SHAPES.balanced as readonly string[]).includes(shape);
}

function isGoodSuit(hand: Hand, suit: Suit): boolean {
	const ranks = suitCards(hand, suit).map((card) => card[1] ?? "");
	return SHAPES.goodSuit.some(
		({ honours, count }) =>
			ranks.filter((rank) => honours.includes(rank)).length >= count,
	);
}

function inRange(points: number, range: PointRange | undefined): boolean {
	return (
		range === undefined ||
		(points >= range.min && points <= (range.max ?? Number.POSITIVE_INFINITY))
	);
}

function fitsShape(hand: Hand, shape: Shape): boolean {
	const { lengths } = hand;
	switch (shape.kind) {
		case "none":
		case "artificial":
		case "waiting":
			return true;
		case "balanced":
			return isBalanced(hand);
		case "cards":
		case "support":
		case "transfer":
			return lengths[shape.suit] >= shape.min;
		case "weak-two":
			return (
				lengths[shape.suit] === shape.length &&
				isGoodSuit(hand, shape.suit) &&
				MAJORS.every(
					(major) =>
						major === shape.suit || lengths[major] < SHAPES.weakTwoSideMajor,
				)
			);
		case "preempt":
			return (
				lengths[shape.suit] === shape.length && isGoodSuit(hand, shape.suit)
			);
		case "stayman":
			return MAJORS.some((major) => lengths[major] === shape.min);
		case "weak-minor":
			return MINORS.some((minor) => lengths[minor] >= shape.min);
		case "good-suit":
			return lengths[shape.suit] >= shape.min && isGoodSuit(hand, shape.suit);
	}
}

/** The suit of a one-level opening: the longest five-card or longer suit, the higher on a tie; else the longer minor. */
function openingSuit(hand: Hand): Suit {
	const { lengths } = hand;
	const longest = SUITS.reduce((best, suit) =>
		lengths[suit] > lengths[best] ? suit : best,
	);
	if (lengths[longest] >= SHAPES.majorOpening) return longest;
	if (lengths.D !== lengths.C) return lengths.D > lengths.C ? "D" : "C";
	// "[1D] with 4–4 in the minors, [1C] with 3–3".
	return lengths.D >= 4 ? "D" : "C";
}

/** The guide's order of the openings: the first group with a fitting call wins, so a balanced 16 opens [1NT], not [1H]. */
const OPENING_GROUPS: readonly ((call: Call) => boolean)[] = [
	(call) => call === "3NT",
	(call) => call === "2C",
	(call) => call === "2NT",
	(call) => call === "1NT",
	(call) => isBid(call) && levelOf(call) === 1 && isSuit(strainOf(call)),
	() => true,
];

function preferred(
	at: Position,
	hand: Hand,
	fitting: GuideCall[],
): GuideCall[] {
	if (at.kind === "opening") {
		const suit = openingSuit(hand);
		const ones = fitting.filter(
			({ call }) =>
				!(
					isBid(call) &&
					levelOf(call) === 1 &&
					isSuit(strainOf(call)) &&
					call !== `1${suit}`
				),
		);
		for (const group of OPENING_GROUPS) {
			const calls = ones.filter(({ call }) => group(call));
			if (calls.length > 0) return calls;
		}
		return [];
	}
	if (at.kind === "suit") {
		// "Raise partner's major one level with three or more cards. Otherwise bid a new suit ... or [1NT]."
		const raise = fitting.filter(({ call }) => call === `2${at.suit}`);
		if (raise.length > 0) return raise;
	}
	return fitting;
}

/**
 * The calls that the guide of `system` gives `cards`, the bidder's 13 cards, after `calls`, in bid-box order. Undefined
 * when the guide does not describe the position or the hand, or when no call fits.
 */
export function conventionCalls(
	system: PointSystem,
	cards: readonly Card[],
	calls: readonly Call[],
): readonly GuideCall[] | undefined {
	const ranges = rules(system);
	const at = position(calls);
	if (ranges === undefined || at === undefined) return undefined;
	const lengths = Object.fromEntries(
		SUITS.map((suit) => [
			suit,
			cards.filter((card) => suitOf(card) === suit).length,
		]),
	) as Record<Suit, number>;
	if (SUITS.some((suit) => lengths[suit] > SHAPES.longestChecked))
		return undefined;
	const hand: Hand = {
		points: countHandPoints(system, cards).total,
		lengths,
		cards,
	};
	const fitting = CALLS.flatMap((call) => {
		const meaning = meaningAt(ranges, at, call);
		return meaning !== undefined &&
			inRange(hand.points, meaning.range) &&
			fitsShape(hand, meaning.shape)
			? [{ call, meaning }]
			: [];
	});
	const result = preferred(at, hand, fitting);
	return result.length > 0 ? result : undefined;
}
