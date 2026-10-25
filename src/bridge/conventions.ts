/**
 * The bidding guide of a point system as rules, in two directions: which calls the guide gives a hand
 * (`conventionCalls`), and what a call in the auction shows (`callMeaning`). Both read one meaning table, so a
 * suggested call always has the meaning that the auction shows for it. The numbers are in convention-rules.ts.
 *
 * The guides describe the opening, the first response to one of a suit, [1NT], [2C] or a weak two, opener's
 * rebid, opener's answer to Stayman, a transfer and [2S], the overcalls and the takeout double of one of a suit, the
 * redouble after partner's opening is doubled, and Blackwood. Each of them only when the other side passed, except
 * the overcalls, the double, the redouble and the [4NT] ask. Any other position, a hand with a suit longer than
 * SHAPES.longestChecked, and the "other" system are not described, and the functions return undefined. Where the
 * guide describes only some hands, such as an overcall, conventionCalls returns undefined for a hand that fits no
 * call. The module returns data; the callers write the text.
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
	| { readonly kind: "good-suit"; readonly suit: Suit; readonly min: number }
	/** Opener's answer to Stayman: no major with `min` cards. */
	| { readonly kind: "no-major"; readonly min: number }
	/** Opener completes the transfer to `suit`. */
	| { readonly kind: "accept"; readonly suit: Suit }
	/** Opener must bid [3C] after [2S], whatever the hand. */
	| { readonly kind: "relay" }
	/** Asks opener to describe the hand. */
	| { readonly kind: "ask" }
	/** Balanced, with a stopper of SHAPES.stoppers in the opponents' `suit`. */
	| { readonly kind: "stopper"; readonly suit: Suit }
	/** Short in the opponents' `suit` with support for the others, or any hand in `strong`. */
	| {
			readonly kind: "takeout";
			readonly suit: Suit;
			readonly strong: PointRange;
	  }
	/** [4NT] asks partner for aces, for a small slam with `small` points together or a grand slam with `grand`. */
	| {
			readonly kind: "blackwood";
			readonly small: PointRange;
			readonly grand: PointRange;
	  }
	/** The answer to [4NT]: the number of aces is one of `counts`. */
	| { readonly kind: "aces"; readonly counts: readonly number[] };

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
	| { readonly kind: "2C" }
	| { readonly kind: "weak-two"; readonly suit: Suit }
	/** Opener's second call after one of `opened`, a pass, and partner's `response`. */
	| { readonly kind: "rebid"; readonly opened: Suit; readonly response: Bid }
	| { readonly kind: "stayman-answer" }
	| { readonly kind: "transfer-answer"; readonly suit: Suit }
	| { readonly kind: "relay" }
	/** Responder's call after [1NT] [P] [2S] [P] [3C] [P]. */
	| { readonly kind: "relay-answer" }
	| { readonly kind: "2C-rebid"; readonly response: Bid }
	/** A call after the opponents' one of `opened`, directly or after two passes. */
	| { readonly kind: "overcall"; readonly opened: Suit }
	/** Responder's call after partner's one of a suit was doubled. */
	| { readonly kind: "redouble" }
	| { readonly kind: "aces" };

/** The positions in which the guide gives every hand a call; in the others a hand can fit no call. */
const EVERY_HAND: ReadonlySet<Position["kind"]> = new Set([
	"opening",
	"suit",
	"1NT",
	"2C",
	"stayman-answer",
	"transfer-answer",
	"relay",
	"relay-answer",
	"aces",
]);

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

/** Lower strains rank lower within a level: clubs, diamonds, hearts, spades, notrump. */
function strainRank(strain: string): number {
	return isSuit(strain)
		? SUITS.length - SUITS.indexOf(strain)
		: SUITS.length + 1;
}

/** The lowest level at which `strain` can be bid over `last`, without a jump. */
function cheapestLevel(strain: string, last: Bid): number {
	return strainRank(strain) > strainRank(strainOf(last))
		? levelOf(last)
		: levelOf(last) + 1;
}

/** The suit of a one-level suit opening, else undefined. */
function oneOfASuit(call: Call | undefined): Suit | undefined {
	if (call === undefined || !isBid(call) || levelOf(call) !== 1)
		return undefined;
	const strain = strainOf(call);
	return isSuit(strain) ? strain : undefined;
}

/** True when `calls[index]` is [4NT] and the partnership has bid a suit and no notrump before it. */
function isBlackwood(calls: readonly Call[], index: number): boolean {
	if (calls[index] !== "4NT") return false;
	const ours = calls
		.slice(0, index)
		.filter((call, at) => at % 2 === index % 2 && isBid(call)) as Bid[];
	return (
		ours.some((bid) => isSuit(strainOf(bid))) &&
		ours.every((bid) => strainOf(bid) !== "NT")
	);
}

/** The position after partner's one of `opened`, a pass, and `response`, a new suit without a jump or [1NT]. */
function rebidPosition(opened: Suit, response: Call): Position | undefined {
	if (response === "1NT") return { kind: "rebid", opened, response };
	if (!isBid(response)) return undefined;
	const strain = strainOf(response);
	return isSuit(strain) &&
		strain !== opened &&
		levelOf(response) === cheapestLevel(strain, `1${opened}`)
		? { kind: "rebid", opened, response }
		: undefined;
}

/** The position of opener's second call, after `opening`, a pass, partner's `response` and a pass. */
function openerPosition(opening: Bid, response: Call): Position | undefined {
	const opened = oneOfASuit(opening);
	if (opened !== undefined) return rebidPosition(opened, response);
	if (opening === "2C")
		return isBid(response) ? { kind: "2C-rebid", response } : undefined;
	if (opening !== "1NT") return undefined;
	switch (response) {
		case "2C":
			return { kind: "stayman-answer" };
		case "2D":
			return { kind: "transfer-answer", suit: "H" };
		case "2H":
			return { kind: "transfer-answer", suit: "S" };
		case "2S":
			return { kind: "relay" };
		default:
			return undefined;
	}
}

/** The position of the first response after partner's `opening` and a pass. */
function responsePosition(opening: Bid): Position | undefined {
	const opened = oneOfASuit(opening);
	if (opened !== undefined) return { kind: "suit", suit: opened };
	if (opening === "1NT") return { kind: "1NT" };
	if (opening === "2C") return { kind: "2C" };
	const strain = strainOf(opening);
	if (levelOf(opening) === 2 && isSuit(strain))
		return { kind: "weak-two", suit: strain };
	return undefined;
}

/**
 * The position of the next call, from the calls after the opening. Undefined for an auction that the guide does not
 * describe.
 */
function position(calls: readonly Call[]): Position | undefined {
	if (calls.every((call) => call === "P"))
		return calls.length < 4 ? { kind: "opening" } : undefined;
	if (calls.at(-1) === "P" && isBlackwood(calls, calls.length - 2))
		return { kind: "aces" };
	const start = calls.findIndex((call) => call !== "P");
	const opening = calls[start];
	if (opening === undefined || !isBid(opening)) return undefined;
	const after = calls.slice(start + 1).join(" ");
	const opened = oneOfASuit(opening);
	if (after === "" || after === "P P")
		return opened === undefined ? undefined : { kind: "overcall", opened };
	if (after === "X")
		return opened === undefined ? undefined : { kind: "redouble" };
	if (after === "P") return responsePosition(opening);
	if (opening === "1NT" && after === "P 2S P 3C P")
		return { kind: "relay-answer" };
	const [pass, response, again, ...rest] = calls.slice(start + 1);
	return pass === "P" &&
		again === "P" &&
		rest.length === 0 &&
		response !== undefined
		? openerPosition(opening, response)
		: undefined;
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
	if (level !== cheapestLevel(strain, `1${opened}`)) return undefined;
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

function weakTwoResponseMeaning(
	ranges: Ranges,
	opened: Suit,
	call: Call,
): CallMeaning | undefined {
	if (call === "2NT")
		return { range: ranges["weak-2NT"], shape: { kind: "ask" } };
	// "Raise partner's suit to make the auction harder for the opponents."
	return call === `3${opened}` || call === `4${opened}`
		? { shape: { kind: "support", suit: opened, min: SHAPES.support } }
		: undefined;
}

function rebidMeaning(
	ranges: Ranges,
	opened: Suit,
	response: Bid,
	call: Call,
): CallMeaning | undefined {
	if (!isBid(call)) return undefined;
	const strain = strainOf(call);
	const oneLevel = levelOf(response) === 1;
	if (call === "1NT" && oneLevel)
		return { range: ranges["rebid-low"], shape: { kind: "balanced" } };
	if (call === "2NT" && oneLevel)
		return { range: ranges["rebid-2NT"], shape: { kind: "balanced" } };
	if (!isSuit(strain)) return undefined;
	const jump = levelOf(call) - cheapestLevel(strain, response);
	const key = jump === 0 ? "rebid-low" : jump === 1 ? "rebid-mid" : undefined;
	// "12–14 points: ... a single raise, or a rebid of your own suit. 15–17 points: a jump raise, or a jump rebid".
	if (strain === strainOf(response))
		return key === undefined
			? undefined
			: {
					range: ranges[key],
					shape: { kind: "support", suit: strain, min: SHAPES.rebidSupport },
				};
	if (strain === opened)
		return key === undefined
			? undefined
			: {
					range: ranges[key],
					shape: { kind: "cards", suit: strain, min: SHAPES.rebidSuit },
				};
	// "18–21 points: a jump in a new suit".
	return jump === 1
		? {
				range: ranges["rebid-high"],
				shape: { kind: "cards", suit: strain, min: SHAPES.newSuit },
			}
		: undefined;
}

function staymanAnswerMeaning(call: Call): CallMeaning | undefined {
	// "Opener answers [2D] without a four-card major, otherwise [2H] or [2S]."
	if (call === "2D")
		return { shape: { kind: "no-major", min: SHAPES.stayman } };
	if (call === "2H" || call === "2S")
		return {
			shape: { kind: "cards", suit: call[1] as Suit, min: SHAPES.stayman },
		};
	return undefined;
}

function relayAnswerMeaning(
	ranges: Ranges,
	call: Call,
): CallMeaning | undefined {
	// "Opener must bid [3C]; pass with clubs, or bid [3D] with diamonds."
	const suit = call === "P" ? "C" : call === "3D" ? "D" : undefined;
	return suit === undefined
		? undefined
		: {
				range: ranges["nt-weak"],
				shape: { kind: "cards", suit, min: SHAPES.weakMinor },
			};
}

function overcallMeaning(
	ranges: Ranges,
	opened: Suit,
	call: Call,
): CallMeaning | undefined {
	if (call === "X")
		return {
			range: ranges.takeout,
			shape: {
				kind: "takeout",
				suit: opened,
				strong: ranges["takeout-strong"],
			},
		};
	if (call === "1NT")
		return {
			range: ranges["overcall-1NT"],
			shape: { kind: "stopper", suit: opened },
		};
	if (!isBid(call)) return undefined;
	const strain = strainOf(call);
	const level = levelOf(call);
	if (
		!isSuit(strain) ||
		strain === opened ||
		level !== cheapestLevel(strain, `1${opened}`)
	)
		return undefined;
	return {
		range: ranges[level === 1 ? "overcall-one" : "overcall-two"],
		shape: { kind: "good-suit", suit: strain, min: SHAPES.overcall },
	};
}

/** "[4NT] (Blackwood) asks for aces: [5C] 0 or 4, [5D] 1, [5H] 2, [5S] 3." */
const ACE_ANSWERS: Readonly<Partial<Record<Call, readonly number[]>>> = {
	"5C": [0, 4],
	"5D": [1],
	"5H": [2],
	"5S": [3],
};

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
		case "weak-two":
			return weakTwoResponseMeaning(ranges, at.suit, call);
		case "rebid":
			return rebidMeaning(ranges, at.opened, at.response, call);
		case "stayman-answer":
			return staymanAnswerMeaning(call);
		case "transfer-answer":
			return call === `2${at.suit}`
				? { shape: { kind: "accept", suit: at.suit } }
				: undefined;
		case "relay":
			return call === "3C" ? { shape: { kind: "relay" } } : undefined;
		case "relay-answer":
			return relayAnswerMeaning(ranges, call);
		case "2C-rebid":
			// "With a balanced 22–24 points, rebid [2NT] after partner's answer."
			return call === "2NT" && cheapestLevel("NT", at.response) === 2
				? { range: ranges["2c-rebid-2NT"], shape: { kind: "balanced" } }
				: undefined;
		case "overcall":
			return overcallMeaning(ranges, at.opened, call);
		case "redouble":
			return call === "XX"
				? { range: ranges.redouble, shape: { kind: "none" } }
				: undefined;
		case "aces": {
			const counts = ACE_ANSWERS[call];
			return counts === undefined
				? undefined
				: { shape: { kind: "aces", counts } };
		}
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
	const meaning = at === undefined ? undefined : meaningAt(ranges, at, call);
	// The [4NT] ask is a meaning only: no hand needs it, so conventionCalls never suggests it.
	return (
		meaning ??
		(isBlackwood(calls, index)
			? {
					shape: {
						kind: "blackwood",
						small: ranges["slam-small"],
						grand: ranges["slam-grand"],
					},
				}
			: undefined)
	);
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

function hasStopper(hand: Hand, suit: Suit): boolean {
	const cards = suitCards(hand, suit);
	return SHAPES.stoppers.some(
		({ honour, length }) =>
			cards.length >= length && cards.some((card) => card[1] === honour),
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
		case "accept":
		case "relay":
		case "ask":
		case "blackwood":
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
		case "no-major":
			return MAJORS.every((major) => lengths[major] < shape.min);
		case "stopper":
			return isBalanced(hand) && hasStopper(hand, shape.suit);
		case "takeout":
			return (
				inRange(hand.points, shape.strong) ||
				(lengths[shape.suit] <= SHAPES.takeoutShort &&
					SUITS.every(
						(suit) =>
							suit === shape.suit || lengths[suit] >= SHAPES.takeoutSupport,
					))
			);
		case "aces":
			return shape.counts.includes(
				hand.cards.filter((card) => card[1] === "A").length,
			);
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
 * The calls that the guide of `system` gives `cards`, the bidder's 13 cards, after `calls`, in bid-box order. Empty when
 * the guide describes the position and the hand but no call fits; undefined when it does not describe them.
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
	if (fitting.length === 0 && !EVERY_HAND.has(at.kind)) return undefined;
	return preferred(at, hand, fitting);
}
