/**
 * The bidding guide of a point system as rules, in two directions: which calls the guide gives a hand
 * (`conventionCalls`), and what a call in the auction shows (`callMeaning`). Both read one meaning table, so a
 * suggested call always has the meaning that the auction shows for it. The numbers are in convention-rules.ts.
 *
 * The guides describe the opening, the first response to one of a suit, [1NT], [2C] or a weak two, opener's
 * rebid, opener's re-raise after a single or a jump raise of the major, opener's answer to Stayman, a transfer, [2S] and a notrump invitation, the overcalls and the takeout double of one of a suit, the
 * redouble after partner's opening is doubled, and Blackwood. Each of them only when the other side passed, except
 * the overcalls, the double, the redouble, the re-raise, SAYC notrump transfers after doubles and the [4NT] ask. Any other position, a hand with a suit longer than
 * SHAPES.longestChecked, and the "other" system are not described, and the functions return undefined. Where the
 * guide describes only some hands, such as an overcall, conventionCalls returns undefined for a hand that fits no
 * call. The module returns data; the callers write the text.
 */
import { type Card, SUITS, type Suit, suitOf } from "./cards";
import {
	type PointRange,
	RANGES,
	type RangeKey,
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
	/** A pass over a doubled transfer denies three-card support in the requested major. */
	| { readonly kind: "short-suit"; readonly suit: Suit; readonly max: number }
	| { readonly kind: "weak-two"; readonly suit: Suit; readonly length: number }
	| { readonly kind: "preempt"; readonly suit: Suit; readonly length: number }
	/** Opener's re-raise of the major after a pass: invites game, with `min` or more cards in `suit`. */
	| { readonly kind: "game-try"; readonly suit: Suit; readonly min: number }
	/** Opener's re-raise of the major after an opponent's call: `min` or more cards in `suit`, no game invitation. */
	| { readonly kind: "competitive"; readonly suit: Suit; readonly min: number }
	/** `min` or more cards in `suit`, the suit above the bid. */
	| { readonly kind: "transfer"; readonly suit: Suit; readonly min: number }
	/** Exactly `length` cards in `suit`; `flat` also needs no singleton or void. */
	| {
			readonly kind: "exact";
			readonly suit: Suit;
			readonly length: number;
			readonly flat?: true;
	  }
	/** Exactly `length` cards in the `major`, `min` or more in the new `suit`, and a singleton or void. */
	| {
			readonly kind: "second-suit";
			readonly major: Suit;
			readonly length: number;
			readonly suit: Suit;
			readonly min: number;
	  }
	/** Exactly `length` cards in `suit` and exactly `otherLength` cards in `other`. */
	| {
			readonly kind: "two-suits";
			readonly suit: Suit;
			readonly length: number;
			readonly other: Suit;
			readonly otherLength: number;
	  }
	/** At most `max` cards in partner's `suit`. */
	| { readonly kind: "at-most"; readonly suit: Suit; readonly max: number }
	/** At most `max` cards in partner's `suit` and at most `otherMax` cards in `other`. */
	| {
			readonly kind: "at-most-both";
			readonly suit: Suit;
			readonly max: number;
			readonly other: Suit;
			readonly otherMax: number;
	  }
	/** The ace or king of `suit` (a feature), and neither in a lower suit other than `trumps`. */
	| { readonly kind: "feature"; readonly suit: Suit; readonly trumps: Suit }
	/** No ace or king in a suit other than `trumps`. */
	| { readonly kind: "no-feature"; readonly trumps: Suit }
	/** More cards in `suit` than in `other`, or with `ties` at least as many. */
	| {
			readonly kind: "longer-major";
			readonly suit: Suit;
			readonly other: Suit;
			readonly ties: boolean;
	  }
	/**
	 * A major with exactly `min` cards and `strong` points, or exactly `min` cards in both majors, at most `clubs`
	 * clubs and `weak` points (weak Stayman).
	 */
	| {
			readonly kind: "stayman";
			readonly min: number;
			readonly strong: PointRange;
			readonly weak: PointRange;
			readonly clubs: number;
	  }
	/** `long` or more cards in a minor, or `min` cards in a minor in a hand that is not 5-3-3-2. */
	| { readonly kind: "weak-minor"; readonly min: number; readonly long: number }
	/**
	 * The pass of [1NT] by a weak hand: no major with `min` or more cards, no minor with `long` or more, a minor with
	 * `min` cards only in a 5-3-3-2 hand, and not the weak Stayman shape.
	 */
	| { readonly kind: "nt-pass"; readonly min: number; readonly long: number }
	/** Invites [3NT] with `min` or more cards in the minor `suit`. */
	| { readonly kind: "invite"; readonly suit: Suit; readonly min: number }
	/** Slam interest with `min` or more cards in the major `suit`. */
	| { readonly kind: "slam-try"; readonly suit: Suit; readonly min: number }
	/** Opener declines the slam try in `suit`: `points`, or at most `short` cards in `suit`. */
	| {
			readonly kind: "slam-decline";
			readonly suit: Suit;
			readonly short: number;
			readonly points: PointRange;
	  }
	/** Opener accepts the slam try with `min` or more cards in `suit`, and asks for aces with [4NT]. */
	| { readonly kind: "ace-ask"; readonly suit: Suit; readonly min: number }
	/** [4C] asks partner for aces: an unbalanced hand without a major of `min` cards. */
	| { readonly kind: "gerber"; readonly min: number }
	/** [5C] after the answer to Gerber asks partner for kings. */
	| { readonly kind: "king-ask" }
	| { readonly kind: "waiting" }
	/** A pass when no other guide call fits the hand. */
	| { readonly kind: "rest" }
	/** `min` or more cards in `suit`, with the top cards of SHAPES.goodSuit. */
	| { readonly kind: "good-suit"; readonly suit: Suit; readonly min: number }
	/** No major with `min` cards, as opener's answer to Stayman; `balanced` also needs a balanced hand. */
	| {
			readonly kind: "no-major";
			readonly min: number;
			readonly balanced?: true;
	  }
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
	/** The answer to [4NT] or Gerber: the number of aces is one of `counts`. */
	| { readonly kind: "aces"; readonly counts: readonly number[] }
	/** The answer to the king ask after Gerber: the number of kings is one of `counts`. */
	| { readonly kind: "kings"; readonly counts: readonly number[] };

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
	/** Opener's answer after a weak two in `suit`, a pass, partner's [2NT] ask and a pass. */
	| { readonly kind: "weak-answer"; readonly suit: Suit }
	/** Opener's second call after one of `opened`, a pass, and partner's `response`. */
	| { readonly kind: "rebid"; readonly opened: Suit; readonly response: Bid }
	/**
	 * Opener's second call after one of the major `suit`, a pass, and partner's single raise. `contested` when an
	 * opponent called after the raise; `last` is the last bid before opener.
	 */
	| {
			readonly kind: "reraise";
			readonly suit: Suit;
			readonly contested: boolean;
			readonly last: Bid;
	  }
	/** Opener's second call after one of the major `suit`, a pass, partner's jump raise and a pass. */
	| { readonly kind: "jump-raise"; readonly suit: Suit }
	| { readonly kind: "stayman-answer" }
	| {
			readonly kind: "transfer-answer";
			readonly suit: Suit;
			readonly doubled?: boolean;
	  }
	| { readonly kind: "relay" }
	/** Responder's call after [1NT] [P] [2S] [P] [3C] [P]. */
	| { readonly kind: "relay-answer" }
	/** Responder's second call after the transfer to the major `suit` was accepted at the two level. */
	| { readonly kind: "transfer-rebid"; readonly suit: Suit }
	/** Responder's second call after opener jumped to three of the major `suit` (super-accept). */
	| { readonly kind: "super-accepted"; readonly suit: Suit }
	/** Opener's third call after the transfer to `suit`, the acceptance, and responder's `rebid`. */
	| {
			readonly kind: "transfer-reply";
			readonly suit: Suit;
			readonly rebid: Bid;
	  }
	/** Responder's second call after Stayman and opener's `answer` [2D], [2H] or [2S]. */
	| { readonly kind: "stayman-rebid"; readonly answer: Bid }
	/** Opener's third call after Stayman, opener's `answer`, and responder's `rebid` below game in a major. */
	| {
			readonly kind: "stayman-reply";
			readonly answer: Bid;
			readonly rebid: Bid;
	  }
	/**
	 * Opener's call after [1NT], a pass, partner's invitation [2NT], [3C], [3D] or [4NT] and a pass; `game` accepts
	 * it.
	 */
	| { readonly kind: "nt-invite"; readonly game: Bid }
	/** Opener's call after [1NT], a pass, partner's slam try in the major `suit` and a pass. */
	| { readonly kind: "slam-try"; readonly suit: Suit }
	/** The first response to [2NT]: the guide describes only Gerber. */
	| { readonly kind: "2NT" }
	| { readonly kind: "2C-rebid"; readonly response: Bid }
	/** A call after the opponents' one of `opened`, directly or after two passes. */
	| { readonly kind: "overcall"; readonly opened: Suit }
	/** Responder's call after partner's one of a suit was doubled. */
	| { readonly kind: "redouble" }
	/** The answer to an ask for aces or kings by steps: `first` shows 0 or 4, each step above it one more. */
	| { readonly kind: "aces"; readonly honour: "A" | "K"; readonly first: Bid };

/** The positions in which the guide gives every hand a call; in the others a hand can fit no call. */
const EVERY_HAND: ReadonlySet<Position["kind"]> = new Set([
	"opening",
	"suit",
	"1NT",
	"2C",
	"weak-answer",
	"stayman-answer",
	"transfer-answer",
	"relay",
	"relay-answer",
	"transfer-rebid",
	"super-accepted",
	"transfer-reply",
	"stayman-rebid",
	"stayman-reply",
	"nt-invite",
	"slam-try",
	"aces",
]);

/** The positions in which the guide describes only some calls; fitsCall does not judge the others. */
const SOME_CALLS: ReadonlySet<Position["kind"]> = new Set(["2NT"]);

const MAJORS: readonly Suit[] = ["S", "H"];
const MINORS: readonly Suit[] = ["D", "C"];

/** Whether `system` has rules for its calls; the other systems have only their guide text, or no guide. */
export function hasRules(system: PointSystem): system is RuleSystem {
	return Object.hasOwn(RANGES, system);
}

function rules(system: PointSystem): Ranges | undefined {
	return hasRules(system) ? RANGES[system] : undefined;
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

/** True when `calls` end with [1NT] or [2NT], a pass, Gerber, a pass, opener's answer and a pass. */
function afterGerberAnswer(calls: readonly Call[]): boolean {
	const start = calls.findIndex((call) => call !== "P");
	return (
		(calls[start] === "1NT" || calls[start] === "2NT") &&
		/^P 4C P (4D|4H|4S|4NT) P$/.test(calls.slice(start + 1).join(" "))
	);
}

/** The position after [1NT] and `after`: a pass, a transfer, a pass and more, all without the opponents' calls. */
function transferPosition(after: readonly Call[]): Position | undefined {
	const [pass, transfer, again, accept, still, rebid, last, ...rest] = after;
	const suit = transfer === "2D" ? "H" : transfer === "2H" ? "S" : undefined;
	if (suit === undefined || pass !== "P" || again !== "P" || still !== "P")
		return undefined;
	if (rebid === undefined)
		return accept === `2${suit}`
			? { kind: "transfer-rebid", suit }
			: accept === `3${suit}`
				? { kind: "super-accepted", suit }
				: undefined;
	// The invitations: [2NT], three of the major, [3NT], and the five-five [2S] after [2D] [2H].
	const invitations: readonly Call[] = [
		"2NT",
		`3${suit}`,
		"3NT",
		...(suit === "H" ? (["2S"] as const) : []),
	];
	return accept === `2${suit}` &&
		last === "P" &&
		rest.length === 0 &&
		isBid(rebid) &&
		invitations.includes(rebid)
		? { kind: "transfer-reply", suit, rebid }
		: undefined;
}

/**
 * Responder's second calls after each answer to Stayman that opener answers in turn: the calls below game in a major.
 */
const STAYMAN_REBIDS: Readonly<Record<string, readonly Call[]>> = {
	"2D": ["2H", "2S", "2NT", "3H", "3S", "3NT"],
	"2H": ["2NT", "3H", "3NT"],
	"2S": ["2NT", "3S", "3NT"],
};

/**
 * The position after [1NT] and `after`: a pass, Stayman, a pass, opener's answer, a pass and more, all without the
 * opponents' calls.
 */
function staymanPosition(after: readonly Call[]): Position | undefined {
	const [pass, stayman, again, answer, still, rebid, last, ...rest] = after;
	if (
		pass !== "P" ||
		stayman !== "2C" ||
		again !== "P" ||
		still !== "P" ||
		answer === undefined ||
		!isBid(answer) ||
		STAYMAN_REBIDS[answer] === undefined
	)
		return undefined;
	if (rebid === undefined) return { kind: "stayman-rebid", answer };
	return last === "P" &&
		rest.length === 0 &&
		isBid(rebid) &&
		STAYMAN_REBIDS[answer].includes(rebid)
		? { kind: "stayman-reply", answer, rebid }
		: undefined;
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
	// "[4C] (Gerber) ... Opener answers [4D] 0 or 4, [4H] 1, [4S] 2, [4NT] 3."
	if ((opening === "1NT" || opening === "2NT") && response === "4C")
		return { kind: "aces", honour: "A", first: "4D" };
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
		case "2NT":
		case "3C":
		case "3D":
			return { kind: "nt-invite", game: "3NT" };
		case "3H":
			return { kind: "slam-try", suit: "H" };
		case "3S":
			return { kind: "slam-try", suit: "S" };
		case "4NT":
			return { kind: "nt-invite", game: "6NT" };
		default:
			return undefined;
	}
}

/** The position of the first response after partner's `opening` and a pass. */
function responsePosition(opening: Bid): Position | undefined {
	const opened = oneOfASuit(opening);
	if (opened !== undefined) return { kind: "suit", suit: opened };
	if (opening === "1NT") return { kind: "1NT" };
	if (opening === "2NT") return { kind: "2NT" };
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
	if (
		calls.at(-1) === "P" &&
		(isBlackwood(calls, calls.length - 2) ||
			(calls.at(-2) === "4NT" &&
				position(calls.slice(0, -2))?.kind === "slam-try"))
	)
		return { kind: "aces", honour: "A", first: "5C" };
	// "Then [5C] asks for kings in the same steps, from [5D]".
	if (
		calls.at(-2) === "5C" &&
		calls.at(-1) === "P" &&
		afterGerberAnswer(calls.slice(0, -2))
	)
		return { kind: "aces", honour: "K", first: "5D" };
	const start = calls.findIndex((call) => call !== "P");
	const opening = calls[start];
	if (opening === undefined || !isBid(opening)) return undefined;
	const after = calls.slice(start + 1).join(" ");
	const opened = oneOfASuit(opening);
	if (after === "" || after === "P P")
		return opened === undefined ? undefined : { kind: "overcall", opened };
	if (after === "X")
		return opening === "1NT"
			? { kind: "1NT" }
			: opened === undefined
				? undefined
				: { kind: "redouble" };
	if (after === "P") return responsePosition(opening);
	if (opening === "1NT" && after === "P 2S P 3C P")
		return { kind: "relay-answer" };
	const strain = strainOf(opening);
	if (
		after === "P 2NT P" &&
		levelOf(opening) === 2 &&
		isSuit(strain) &&
		strain !== "C"
	)
		return { kind: "weak-answer", suit: strain };
	const later =
		opening === "1NT"
			? (transferPosition(calls.slice(start + 1)) ??
				staymanPosition(calls.slice(start + 1)))
			: undefined;
	if (later !== undefined) return later;
	const [pass, response, again, ...rest] = calls.slice(start + 1);
	if (
		(pass !== "P" && !(opening === "1NT" && pass === "X")) ||
		response === undefined ||
		again === undefined ||
		rest.length !== 0
	)
		return undefined;
	if (
		opened !== undefined &&
		MAJORS.includes(opened) &&
		isBid(response) &&
		response === `2${opened}`
	) {
		if (again === "P")
			return {
				kind: "reraise",
				suit: opened,
				contested: false,
				last: response,
			};
		if (again === "X")
			return { kind: "reraise", suit: opened, contested: true, last: response };
		return isBid(again)
			? { kind: "reraise", suit: opened, contested: true, last: again }
			: undefined;
	}
	if (
		opening === "1NT" &&
		again === "X" &&
		(response === "2D" || response === "2H")
	)
		return {
			kind: "transfer-answer",
			suit: response === "2D" ? "H" : "S",
			doubled: true,
		};
	if (again !== "P") return undefined;
	return opened !== undefined &&
		MAJORS.includes(opened) &&
		response === `3${opened}`
		? { kind: "jump-raise", suit: opened }
		: openerPosition(opening, response);
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
		return { range: ranges["suit-low"], shape: oneNotrumpShape(opened) };
	if (!isBid(call)) return undefined;
	const level = levelOf(call);
	const strain = strainOf(call);
	if (!isSuit(strain)) return undefined;
	if (strain === opened) {
		const key =
			level === 2 ? "suit-low" : level === 3 ? "suit-invite" : undefined;
		return key === undefined
			? undefined
			: {
					range: ranges[key],
					shape: { kind: "support", suit: opened, min: raiseLength(opened) },
				};
	}
	if (level !== cheapestLevel(strain, `1${opened}`)) return undefined;
	// The guide: a new suit at the one level from 6–10 points up; "a new suit at the two level needs 11 or more points".
	return {
		range: {
			min: level === 1 ? ranges["suit-low"].min : ranges["suit-two-level"].min,
		},
		shape: { kind: "cards", suit: strain, min: SHAPES.newSuit },
	};
}

/** "with four or more diamonds over [1D] and five or more clubs over [1C]"; three cards raise a major. */
function raiseLength(opened: Suit): number {
	if (opened === "D") return SHAPES.raiseDiamonds;
	if (opened === "C") return SHAPES.raiseClubs;
	return SHAPES.support;
}

/**
 * "[1NT] denies a four-card major over [1C] or [1D], four spades and three hearts over [1H], and three spades over
 * [1S]."
 */
function oneNotrumpShape(opened: Suit): Shape {
	if (opened === "S")
		return { kind: "at-most", suit: "S", max: SHAPES.support - 1 };
	if (opened === "H")
		return {
			kind: "at-most-both",
			suit: "H",
			max: SHAPES.support - 1,
			other: "S",
			otherMax: SHAPES.newSuit - 1,
		};
	return { kind: "no-major", min: SHAPES.newSuit };
}

function notrumpResponseMeaning(
	ranges: Ranges,
	call: Call,
): CallMeaning | undefined {
	// "[2NT]" and "[3NT]": "without a four-card major"; "[4NT]", "[6NT]" and "[7NT]": also "balanced".
	const notrump = (key: RangeKey, balanced?: true): CallMeaning => ({
		range: ranges[key],
		shape: {
			kind: "no-major",
			min: SHAPES.stayman,
			...(balanced ? { balanced } : {}),
		},
	});
	switch (call) {
		case "P":
			return {
				range: ranges["nt-weak"],
				shape: {
					kind: "nt-pass",
					min: SHAPES.notrumpPass,
					long: SHAPES.longMinor,
				},
			};
		case "2C":
			return {
				shape: {
					kind: "stayman",
					min: SHAPES.stayman,
					strong: ranges["nt-stayman"],
					weak: ranges["nt-weak-stayman"],
					clubs: SHAPES.weakStaymanClubs,
				},
			};
		case "2D":
			return { shape: { kind: "transfer", suit: "H", min: SHAPES.transfer } };
		case "2H":
			return { shape: { kind: "transfer", suit: "S", min: SHAPES.transfer } };
		case "2S":
			return {
				range: ranges["nt-weak"],
				shape: {
					kind: "weak-minor",
					min: SHAPES.weakMinor,
					long: SHAPES.longMinor,
				},
			};
		case "2NT":
			return notrump("nt-2NT");
		case "3C":
		case "3D":
			return {
				range: ranges["nt-3m"],
				shape: { kind: "invite", suit: call[1] as Suit, min: SHAPES.longMinor },
			};
		case "3H":
		case "3S":
			return {
				range: ranges["nt-3M"],
				shape: { kind: "slam-try", suit: call[1] as Suit, min: SHAPES.slamTry },
			};
		case "4C":
			return gerber(ranges["nt-gerber"]);
		case "3NT":
			return notrump("nt-3NT");
		case "4NT":
			return notrump("nt-4NT", true);
		case "6NT":
			return notrump("nt-6NT", true);
		case "7NT":
			return notrump("nt-7NT", true);
		default:
			return undefined;
	}
}

/** "[4C] (Gerber): ... an unbalanced hand without a four-card major; asks for aces." */
function gerber(range: PointRange): CallMeaning {
	return { range, shape: { kind: "gerber", min: SHAPES.stayman } };
}

function slamTryMeaning(
	ranges: Ranges,
	suit: Suit,
	call: Call,
): CallMeaning | undefined {
	// "Opener bids four of the major with 15 points or with two cards in it; with 16–17 points and three or more
	// cards, [4NT] (Blackwood)."
	if (call === `4${suit}`)
		return {
			shape: {
				kind: "slam-decline",
				suit,
				short: SHAPES.support - 1,
				points: ranges["nt-slam-decline"],
			},
		};
	return call === "4NT"
		? {
				range: ranges["nt-slam-accept"],
				shape: { kind: "ace-ask", suit, min: SHAPES.support },
			}
		: undefined;
}

/** Responder's second call after opener accepted the transfer to the major `suit` at the two level. */
function transferRebidMeaning(
	ranges: Ranges,
	suit: Suit,
	call: Call,
): CallMeaning | undefined {
	const five = SHAPES.transfer;
	const invite = ranges["transfer-invite"];
	const game = ranges["transfer-game"];
	const long: Shape = { kind: "cards", suit, min: SHAPES.transferLong };
	// "[P] with 0–7 points; [2NT] with exactly five cards and 8–9 points; three of the major with six or more cards and
	// 8–9 points; [3NT] with exactly five cards, no singleton or void, and 10–15 points; four of the major with six or
	// more cards and 10–15 points."
	const meanings: Partial<Record<Call, CallMeaning>> = {
		P: { range: ranges["transfer-pass"], shape: { kind: "none" } },
		"2NT": { range: invite, shape: { kind: "exact", suit, length: five } },
		[`3${suit}`]: { range: invite, shape: long },
		"3NT": {
			range: game,
			shape: { kind: "exact", suit, length: five, flat: true },
		},
		[`4${suit}`]: { range: game, shape: long },
	};
	const meaning = meanings[call];
	if (meaning !== undefined) return meaning;
	// "After [2D] [2H], [2S] instead of [2NT] shows five cards in each major and 8–9 points."
	if (suit === "H" && call === "2S")
		return {
			range: invite,
			shape: {
				kind: "second-suit",
				major: suit,
				length: five,
				suit: "S",
				min: five,
			},
		};
	// "A new suit after the transfer is game forcing: exactly five cards in the major, four or more cards in the new
	// suit, a singleton or void, and 10–15 points."
	const newSuits: readonly Suit[] = suit === "S" ? ["C", "D", "H"] : ["C", "D"];
	const side = newSuits.find((other) => call === `3${other}`);
	return side === undefined
		? undefined
		: {
				range: game,
				shape: {
					kind: "second-suit",
					major: suit,
					length: five,
					suit: side,
					min: SHAPES.newSuit,
				},
			};
}

/** Opener's third call after the transfer to `suit`, the acceptance, and responder's invitation `rebid`. */
function transferReplyMeaning(
	ranges: Ranges,
	suit: Suit,
	rebid: Bid,
): Partial<Record<Call, CallMeaning>> {
	const low = ranges["nt-invite-pass"];
	const high = ranges["nt-invite-accept"];
	const short: Shape = {
		kind: "at-most",
		suit,
		max: SHAPES.transferSupport - 1,
	};
	const support: Shape = { kind: "support", suit, min: SHAPES.transferSupport };
	switch (rebid) {
		case "2NT":
			// "Opener answers [2NT] with 15 points by [P] with two cards in the major, or by three of the major with three
			// or more cards; with 16–17 points, by [3NT] or four of the major in the same way."
			return {
				P: { range: low, shape: short },
				[`3${suit}`]: { range: low, shape: support },
				"3NT": { range: high, shape: short },
				[`4${suit}`]: { range: high, shape: support },
			};
		case "3NT":
			// "After [3NT], opener passes with two cards in the major and bids four of it with three or more cards."
			return { P: { shape: short }, [`4${suit}`]: { shape: support } };
		case "2S": {
			// "After [2S], opener passes with 15 points and at least as many spades as hearts, otherwise bids [3H]; with
			// 16–17 points, [4S] or [4H] in the same way."
			const spades: Shape = {
				kind: "longer-major",
				suit: "S",
				other: "H",
				ties: true,
			};
			const hearts: Shape = {
				kind: "longer-major",
				suit: "H",
				other: "S",
				ties: false,
			};
			return {
				P: { range: low, shape: spades },
				"3H": { range: low, shape: hearts },
				"4S": { range: high, shape: spades },
				"4H": { range: high, shape: hearts },
			};
		}
		default:
			// "After three of the major, opener passes with 15 points and bids four of it with 16–17 points."
			return {
				P: { range: low, shape: { kind: "none" } },
				[`4${suit}`]: { range: high, shape: { kind: "none" } },
			};
	}
}

/** Responder's second call after Stayman and opener's `answer`. */
function staymanRebidMeaning(
	ranges: Ranges,
	answer: Bid,
): Partial<Record<Call, CallMeaning>> {
	const invite = ranges["stayman-invite"];
	const game = ranges["stayman-game"];
	// "Weak Stayman: ... Pass any answer of opener."
	const pass: CallMeaning = {
		range: ranges["nt-weak-stayman"],
		shape: { kind: "none" },
	};
	if (answer === "2D") {
		// "After [2C] [2D], responder bids [2H] or [2S] with five cards in that major, four cards in the other major and
		// 8–9 points; [3H] or [3S] in the same way with 10–15 points, game forcing. Without a five-card major, [2NT]
		// with 8–9 points or [3NT] with 10–15 points."
		const fiveFour = (suit: Suit, other: Suit): Shape => ({
			kind: "two-suits",
			suit,
			length: SHAPES.transfer,
			other,
			otherLength: SHAPES.stayman,
		});
		const noFive: Shape = { kind: "no-major", min: SHAPES.transfer };
		return {
			P: pass,
			"2H": { range: invite, shape: fiveFour("H", "S") },
			"2S": { range: invite, shape: fiveFour("S", "H") },
			"2NT": { range: invite, shape: noFive },
			"3H": { range: game, shape: fiveFour("H", "S") },
			"3S": { range: game, shape: fiveFour("S", "H") },
			"3NT": { range: game, shape: noFive },
		};
	}
	// "After [2C] [2H], responder bids [3H] with four hearts and 8–9 points or [4H] with 10–15 points; without four
	// hearts, [2NT] or [3NT] in the same way. After [2C] [2S], the same with spades."
	const suit: Suit = answer === "2H" ? "H" : "S";
	const fit: Shape = { kind: "support", suit, min: SHAPES.stayman };
	const short: Shape = { kind: "at-most", suit, max: SHAPES.stayman - 1 };
	return {
		P: pass,
		"2NT": { range: invite, shape: short },
		[`3${suit}`]: { range: invite, shape: fit },
		"3NT": { range: game, shape: short },
		[`4${suit}`]: { range: game, shape: fit },
	};
}

/** Opener's third call after Stayman, opener's `answer`, and responder's `rebid`. */
function staymanReplyMeaning(
	ranges: Ranges,
	answer: Bid,
	rebid: Bid,
): Partial<Record<Call, CallMeaning>> {
	const low = ranges["nt-invite-pass"];
	const high = ranges["nt-invite-accept"];
	const any: Shape = { kind: "none" };
	const strain = strainOf(rebid);
	if (answer === "2D" && isSuit(strain)) {
		// "After [2C] [2D] and five cards in a major from responder, opener with two cards in that major bids [2NT] over
		// a two-level bid with 15 points, otherwise [3NT]; with three or more cards, [P] over a two-level bid with 15
		// points, otherwise four of the major."
		const short: Shape = {
			kind: "at-most",
			suit: strain,
			max: SHAPES.transferSupport - 1,
		};
		const support: Shape = {
			kind: "support",
			suit: strain,
			min: SHAPES.transferSupport,
		};
		return levelOf(rebid) === 2
			? {
					P: { range: low, shape: support },
					"2NT": { range: low, shape: short },
					"3NT": { range: high, shape: short },
					[`4${strain}`]: { range: high, shape: support },
				}
			: { "3NT": { shape: short }, [`4${strain}`]: { shape: support } };
	}
	// "After Stayman, opener answers [2NT] with 15 points by [P] and with 16–17 points by [3NT]; after [2C] [2H] [2NT],
	// with four spades, by [3S] or [4S] in the same way instead. After three of opener's major, [P] with 15 points or
	// four of it with 16–17 points. After [3NT], [P], but [4S] with four spades after [2C] [2H]."
	const spades: Shape = { kind: "cards", suit: "S", min: SHAPES.stayman };
	const hidden = answer === "2H";
	const rest: Shape = hidden
		? { kind: "at-most", suit: "S", max: SHAPES.stayman - 1 }
		: any;
	switch (rebid) {
		case "2NT":
			return {
				P: { range: low, shape: rest },
				"3NT": { range: high, shape: rest },
				...(hidden
					? {
							"3S": { range: low, shape: spades },
							"4S": { range: high, shape: spades },
						}
					: {}),
			};
		case "3NT":
			return {
				P: { shape: rest },
				...(hidden ? { "4S": { shape: spades } } : {}),
			};
		default:
			return {
				P: { range: low, shape: any },
				[`4${strain}`]: { range: high, shape: any },
			};
	}
}

/** The answers by steps from `first`: 0 or 4, then 1, 2 and 3. */
function stepAnswers(
	first: Bid,
): Readonly<Partial<Record<Call, readonly number[]>>> {
	const start = CALLS.indexOf(first);
	return Object.fromEntries(
		[[0, 4], [1], [2], [3]].map((counts, step) => [
			CALLS[start + step],
			counts,
		]),
	);
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

/** Opener's answer to the [2NT] ask after a weak two in `trumps`. */
function weakAnswerMeaning(
	ranges: Ranges,
	trumps: Suit,
): Partial<Record<Call, CallMeaning>> {
	// "After [2NT], opener bids three of the suit with 5–8 points. With 9–11 points, opener bids three of the lowest
	// side suit with its ace or king (a feature), or [3NT] without a feature."
	const maximum = ranges["weak-2NT-maximum"];
	const meanings: Partial<Record<Call, CallMeaning>> = {
		[`3${trumps}`]: {
			range: ranges["weak-2NT-minimum"],
			shape: { kind: "none" },
		},
		"3NT": { range: maximum, shape: { kind: "no-feature", trumps } },
	};
	for (const suit of SUITS)
		if (suit !== trumps)
			meanings[`3${suit}`] = {
				range: maximum,
				shape: { kind: "feature", suit, trumps },
			};
	return meanings;
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

function reraiseMeaning(
	ranges: Ranges,
	at: Extract<Position, { kind: "reraise" }>,
	call: Call,
): CallMeaning | undefined {
	// "After a single raise of your major ([1H] – [2H]) and a pass: [P] with 12–14 points; [3H] with 15–17 points is a
	// game try and invites game; [4H] with 18–21 points." After an opponent's call, [3H] is competitive.
	if (call === "P")
		return at.contested
			? undefined
			: { range: ranges["reraise-pass"], shape: { kind: "none" } };
	const level = cheapestLevel(at.suit, at.last);
	if (call === `3${at.suit}` && level === 3)
		return at.contested
			? {
					range: ranges["reraise-compete"],
					shape: {
						kind: "competitive",
						suit: at.suit,
						min: SHAPES.competitiveReraise,
					},
				}
			: {
					range: ranges["reraise-try"],
					shape: { kind: "game-try", suit: at.suit, min: SHAPES.majorOpening },
				};
	return call === `4${at.suit}` && level <= 4
		? {
				range: ranges["reraise-game"],
				shape: { kind: "cards", suit: at.suit, min: SHAPES.majorOpening },
			}
		: undefined;
}

function jumpRaiseMeaning(
	ranges: Ranges,
	suit: Suit,
	call: Call,
): CallMeaning | undefined {
	// "After a jump raise of your major ([1H] – [3H]) and a pass, partner has at least 10 points: [4H] with 15–21
	// points (25 or more together), otherwise [P] with 12–14 points."
	if (call === "P")
		return { range: ranges["jump-raise-pass"], shape: { kind: "none" } };
	return call === `4${suit}`
		? {
				range: ranges["jump-raise-game"],
				shape: { kind: "cards", suit, min: SHAPES.majorOpening },
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
export const ACE_ANSWERS = stepAnswers("5C");

/**
 * Whether the guide gives a pass to the hands that fit no other call in `at`: after the opponents' opening, after
 * partner's opening is doubled, after partner's weak two, opener's rebid after [1NT], and opener's re-raise after an
 * opponent's call. The other positions
 * force a call, or give a pass its own meaning.
 */
function passesTheRest(at: Position): boolean {
	switch (at.kind) {
		case "overcall":
		case "redouble":
		case "weak-two":
			return true;
		case "rebid":
			return at.response === "1NT";
		case "reraise":
			return at.contested;
		default:
			return false;
	}
}

function meaningAt(
	ranges: Ranges,
	at: Position,
	call: Call,
): CallMeaning | undefined {
	if (call === "P" && passesTheRest(at)) return { shape: { kind: "rest" } };
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
		case "weak-answer":
			return weakAnswerMeaning(ranges, at.suit)[call];
		case "rebid":
			return rebidMeaning(ranges, at.opened, at.response, call);
		case "reraise":
			return reraiseMeaning(ranges, at, call);
		case "jump-raise":
			return jumpRaiseMeaning(ranges, at.suit, call);
		case "stayman-answer":
			return staymanAnswerMeaning(call);
		case "transfer-answer":
			if (at.doubled) {
				if (call === "P")
					return { shape: { kind: "short-suit", suit: at.suit, max: 2 } };
				return call === `2${at.suit}`
					? { shape: { kind: "support", suit: at.suit, min: 3 } }
					: undefined;
			}
			// "Opener bids the next suit, or jumps to three of it with 17 points and four or more cards (super-accept)."
			if (call === `3${at.suit}`)
				return {
					range: ranges["nt-super-accept"],
					shape: { kind: "support", suit: at.suit, min: SHAPES.superAccept },
				};
			return call === `2${at.suit}`
				? { shape: { kind: "accept", suit: at.suit } }
				: undefined;
		case "transfer-rebid":
			return transferRebidMeaning(ranges, at.suit, call);
		case "super-accepted":
			// "After the super-accept, responder passes with 0–5 points and bids four of the major with 6 or more points."
			return call === "P"
				? { range: ranges["nt-super-pass"], shape: { kind: "none" } }
				: call === `4${at.suit}`
					? { range: ranges["nt-super-game"], shape: { kind: "none" } }
					: undefined;
		case "transfer-reply":
			return transferReplyMeaning(ranges, at.suit, at.rebid)[call];
		case "stayman-rebid":
			return staymanRebidMeaning(ranges, at.answer)[call];
		case "stayman-reply":
			return staymanReplyMeaning(ranges, at.answer, at.rebid)[call];
		case "relay":
			return call === "3C" ? { shape: { kind: "relay" } } : undefined;
		case "relay-answer":
			return relayAnswerMeaning(ranges, call);
		case "nt-invite":
			// "Opener passes with 15 points and bids [3NT] with 16–17 points", or [6NT] after [4NT].
			return call === "P"
				? { range: ranges["nt-invite-pass"], shape: { kind: "none" } }
				: call === at.game
					? { range: ranges["nt-invite-accept"], shape: { kind: "none" } }
					: undefined;
		case "slam-try":
			return slamTryMeaning(ranges, at.suit, call);
		case "2NT":
			return call === "4C" ? gerber(ranges["2nt-gerber"]) : undefined;
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
			const counts = stepAnswers(at.first)[call];
			return counts === undefined
				? undefined
				: { shape: { kind: at.honour === "A" ? "aces" : "kings", counts } };
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
	// The [4NT] ask and the king ask after Gerber are meanings only: no hand needs them, so conventionCalls never
	// suggests them.
	if (meaning !== undefined) return meaning;
	if (isBlackwood(calls, index))
		return {
			shape: {
				kind: "blackwood",
				small: ranges["slam-small"],
				grand: ranges["slam-grand"],
			},
		};
	return call === "5C" && afterGerberAnswer(calls.slice(0, index))
		? { shape: { kind: "king-ask" } }
		: undefined;
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

/** Whether `hand` holds the ace or king of `suit`. */
function hasFeature(hand: Hand, suit: Suit): boolean {
	return suitCards(hand, suit).some(
		(card) => card[1] === "A" || card[1] === "K",
	);
}

function inRange(points: number, range: PointRange | undefined): boolean {
	// A range from 0 also covers a negative total: corrected HCP gives a 4333 hand without honours -1.
	return (
		range === undefined ||
		((points >= range.min || range.min === 0) &&
			points <= (range.max ?? Number.POSITIVE_INFINITY))
	);
}

function fitsShape(hand: Hand, shape: Shape): boolean {
	const { lengths } = hand;
	switch (shape.kind) {
		case "none":
		case "artificial":
		case "waiting":
		case "rest":
		case "accept":
		case "relay":
		case "ask":
		case "blackwood":
			return true;
		case "balanced":
			return isBalanced(hand);
		case "feature":
			return (
				hasFeature(hand, shape.suit) &&
				SUITS.slice(SUITS.indexOf(shape.suit) + 1).every(
					(suit) => suit === shape.trumps || !hasFeature(hand, suit),
				)
			);
		case "no-feature":
			return SUITS.every(
				(suit) => suit === shape.trumps || !hasFeature(hand, suit),
			);
		case "two-suits":
			return (
				lengths[shape.suit] === shape.length &&
				lengths[shape.other] === shape.otherLength
			);
		case "exact":
			return (
				lengths[shape.suit] === shape.length &&
				(shape.flat !== true ||
					SUITS.every((suit) => lengths[suit] > SHAPES.shortSide))
			);
		case "second-suit":
			return (
				lengths[shape.major] === shape.length &&
				lengths[shape.suit] >= shape.min &&
				SUITS.some((suit) => lengths[suit] <= SHAPES.shortSide)
			);
		case "at-most":
			return lengths[shape.suit] <= shape.max;
		case "at-most-both":
			return (
				lengths[shape.suit] <= shape.max &&
				lengths[shape.other] <= shape.otherMax
			);
		case "longer-major":
			return shape.ties
				? lengths[shape.suit] >= lengths[shape.other]
				: lengths[shape.suit] > lengths[shape.other];
		case "short-suit":
			return lengths[shape.suit] <= shape.max;
		case "cards":
		case "support":
		case "transfer":
		case "game-try":
		case "competitive":
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
			return (
				(inRange(hand.points, shape.strong) &&
					MAJORS.some((major) => lengths[major] === shape.min)) ||
				(inRange(hand.points, shape.weak) &&
					MAJORS.every((major) => lengths[major] === shape.min) &&
					lengths.C <= shape.clubs)
			);
		case "weak-minor":
			return fitsWeakMinor(hand, shape.min, shape.long);
		case "nt-pass":
			return (
				MAJORS.every((major) => lengths[major] < shape.min) &&
				!fitsWeakMinor(hand, shape.min, shape.long) &&
				!(
					MAJORS.every((major) => lengths[major] === SHAPES.stayman) &&
					lengths.C <= SHAPES.weakStaymanClubs
				)
			);
		case "invite":
		case "slam-try":
		case "ace-ask":
			return lengths[shape.suit] >= shape.min;
		case "slam-decline":
			return (
				inRange(hand.points, shape.points) || lengths[shape.suit] <= shape.short
			);
		case "gerber":
			return (
				MAJORS.every((major) => lengths[major] < shape.min) && !isBalanced(hand)
			);
		case "king-ask":
			return true;
		case "good-suit":
			return lengths[shape.suit] >= shape.min && isGoodSuit(hand, shape.suit);
		case "no-major":
			return (
				MAJORS.every((major) => lengths[major] < shape.min) &&
				(shape.balanced !== true || isBalanced(hand))
			);
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
		case "kings":
			return shape.counts.includes(
				hand.cards.filter((card) => card[1] === "K").length,
			);
	}
}

/** "[2S]": `long` or more cards in a minor, or `min` cards in a minor in a hand that is not 5-3-3-2. */
function fitsWeakMinor(hand: Hand, min: number, long: number): boolean {
	return MINORS.some(
		(minor) =>
			hand.lengths[minor] >= long ||
			(hand.lengths[minor] >= min && !isBalanced(hand)),
	);
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

/**
 * "The order: [3H] or [3S] first; with five cards in one major and four in the other, [2C] with 8 or more points, else
 * the transfer; then the other transfers; then [2C]; [3C] or [3D] before [2NT]." Of two long majors the longer one,
 * spades on equal length, as for the transfers, but hearts with five cards in each and 8–9 points; of two long minors
 * the longer one, diamonds on equal length.
 */
function notrumpPreferred(
	ranges: Ranges,
	hand: Hand,
	fitting: GuideCall[],
): GuideCall[] {
	const { H, S, D, C } = hand.lengths;
	const fiveFiveInvite =
		H === SHAPES.transfer &&
		S === SHAPES.transfer &&
		inRange(hand.points, ranges["transfer-invite"]);
	const major = H > S || fiveFiveInvite ? "H" : "S";
	const order: readonly Call[][] = [
		[`3${major}`],
		Math.max(H, S) === SHAPES.transfer && Math.min(H, S) === SHAPES.stayman
			? ["2C"]
			: [],
		[major === "H" ? "2D" : "2H"],
		["2C"],
		[D >= C ? "3D" : "3C"],
	];
	for (const calls of order) {
		const first = fitting.filter(({ call }) => calls.includes(call));
		if (first.length > 0) return first;
	}
	return fitting;
}

function preferred(
	ranges: Ranges,
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
		// With 10 points the single and the jump raise both fit; the guide orders no calls over a minor.
		const raise = fitting.filter(
			({ call }) =>
				MAJORS.includes(at.suit) && isBid(call) && strainOf(call) === at.suit,
		);
		if (raise.length > 0) return raise;
	}
	if (at.kind === "1NT") return notrumpPreferred(ranges, hand, fitting);
	if (at.kind === "transfer-answer") {
		// "or jumps to three of it with 17 points and four or more cards (super-accept)".
		const jump = fitting.filter(({ call }) => call === `3${at.suit}`);
		if (jump.length > 0) return jump;
	}
	if (at.kind === "transfer-rebid") {
		// "[2S] instead of [2NT]"; "with two such suits, the longer, or the lower one with equal length".
		const length = ({ meaning: { shape } }: GuideCall) =>
			shape.kind === "second-suit" ? hand.lengths[shape.suit] : 0;
		const longest = Math.max(...fitting.map(length));
		const second = fitting.find((guide) => length(guide) === longest);
		if (longest > 0 && second !== undefined) return [second];
	}
	if (at.kind === "stayman-answer") {
		// "[2H] with four hearts, [2S] with four spades and not four hearts".
		const hearts = fitting.filter(({ call }) => call === "2H");
		if (hearts.length > 0) return hearts;
	}
	return fitting;
}

/** Undefined for a hand with a suit longer than the guide checks. */
function handOf(system: PointSystem, cards: readonly Card[]): Hand | undefined {
	const lengths = Object.fromEntries(
		SUITS.map((suit) => [
			suit,
			cards.filter((card) => suitOf(card) === suit).length,
		]),
	) as Record<Suit, number>;
	if (SUITS.some((suit) => lengths[suit] > SHAPES.longestChecked))
		return undefined;
	return { points: countHandPoints(system, cards).total, lengths, cards };
}

/**
 * Whether `cards` fit what `call` shows by the guide of `system` after `calls`. In a position that the guide describes, a
 * call without a meaning does not fit. Undefined when the guide does not describe the position. Unlike
 * conventionCalls, this also judges a call in a position where the guide gives some hands no call.
 */
export function fitsCall(
	system: PointSystem,
	cards: readonly Card[],
	calls: readonly Call[],
	call: Call,
): boolean | undefined {
	const meaning = callMeaning(system, [...calls, call], calls.length);
	const hand = handOf(system, cards);
	if (hand === undefined) return undefined;
	if (meaning === undefined) {
		const at = position(calls);
		return rules(system) === undefined ||
			at === undefined ||
			SOME_CALLS.has(at.kind)
			? undefined
			: false;
	}
	return inRange(hand.points, meaning.range) && fitsShape(hand, meaning.shape);
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
	const hand = handOf(system, cards);
	if (ranges === undefined || at === undefined || hand === undefined)
		return undefined;
	const fitting = CALLS.flatMap((call) => {
		const meaning = meaningAt(ranges, at, call);
		return meaning !== undefined &&
			inRange(hand.points, meaning.range) &&
			fitsShape(hand, meaning.shape)
			? [{ call, meaning }]
			: [];
	});
	const others = fitting.filter(({ meaning }) => meaning.shape.kind !== "rest");
	if (fitting.length === 0 && !EVERY_HAND.has(at.kind)) return undefined;
	return preferred(ranges, at, hand, others.length > 0 ? others : fitting);
}
