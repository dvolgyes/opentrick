import type { PointSystem } from "./hand-points";

/**
 * The numbers of the bidding conventions, as data. src/bridge/conventions.ts reads them to suggest calls for a hand
 * and to explain a call in the auction; the bot prompts, the Confirm hint and the auction table all use them.
 *
 * To change a rule:
 * 1. Change the number here.
 * 2. Change the same line in the guide of each language, src/guides/{guide}_{en,de,hu,no,es,pt,fr,it,nl}.txt.
 * 3. Run the unit tests. tests/unit/conventions.test.ts fails when a number here and its guide line disagree.
 *
 * Each comment names the guide section and line. A range without `max` has no upper limit ("22 or more points").
 */

export interface PointRange {
	readonly min: number;
	readonly max?: number;
}

export type RangeKey =
	| "open-pass"
	| "open-weak-two"
	| "open-preempt"
	| "open-suit"
	| "open-1NT"
	| "open-2NT"
	| "open-2C"
	| "open-3NT"
	| "suit-pass"
	| "suit-low"
	| "suit-invite"
	| "suit-force"
	| "nt-weak"
	| "nt-stayman"
	| "nt-2NT"
	| "nt-3NT"
	| "2c-waiting"
	| "2c-positive"
	| "2c-2NT";

export type Ranges = Readonly<Record<RangeKey, PointRange>>;

/** The systems that a guide describes; "other" has no rules. */
export type RuleSystem = Exclude<PointSystem, "other">;

/** milton_*.txt and milton_corrected_*.txt: the corrected points use the plain HCP ranges. */
const MILTON = {
	// ## Opening bids
	"open-pass": { min: 0, max: 11 }, // "0–11 points: [P]"
	"open-weak-two": { min: 5, max: 11 }, // "5–11 points: weak two"
	"open-preempt": { min: 5, max: 10 }, // "5–10 points: preempt"
	"open-suit": { min: 12, max: 21 }, // "12–21 points: [1C] [1D] [1H] [1S]"
	"open-1NT": { min: 15, max: 17 }, // "15–17 points: [1NT]"
	"open-2NT": { min: 20, max: 21 }, // "20–21 points: [2NT]"
	"open-2C": { min: 22 }, // "22 or more points: [2C]"
	"open-3NT": { min: 25, max: 27 }, // "25–27 points: [3NT]"
	// ## Responses to one of a suit
	"suit-pass": { min: 0, max: 5 }, // "0–5 points: [P]"
	"suit-low": { min: 6, max: 9 }, // "6–9 points: raise partner's major"
	"suit-invite": { min: 10, max: 12 }, // "10–12 points: invitational"
	"suit-force": { min: 13 }, // "13 or more points: game forcing"
	// ## Responses to [1NT]
	"nt-weak": { min: 0, max: 7 }, // "0–7 points: [P], or a transfer"
	"nt-stayman": { min: 8 }, // "[2C] (Stayman): 8 or more points"
	"nt-2NT": { min: 8, max: 9 }, // "[2NT]: 8–9 points, invitational"
	"nt-3NT": { min: 10, max: 15 }, // "[3NT]: 10–15 points, to play"
	// ## Responses to [2C]
	"2c-waiting": { min: 0, max: 7 }, // "[2D]: waiting, 0–7 points"
	"2c-positive": { min: 8 }, // "[2H] [2S] [3C] [3D]: 8 or more points"
	"2c-2NT": { min: 8 }, // "[2NT]: 8 or more points, balanced hand"
} as const satisfies Ranges;

/** vienna_*.txt and reith_*.txt: both scales hold 64 points and share their ranges. */
const SIXTY_FOUR = {
	// ## Opening bids
	"open-pass": { min: 0, max: 18 }, // "0–18 points: [P]"
	"open-weak-two": { min: 8, max: 18 }, // "8–18 points: weak two"
	"open-preempt": { min: 8, max: 17 }, // "8–17 points: preempt"
	"open-suit": { min: 19, max: 34 }, // "19–34 points: [1C] [1D] [1H] [1S]"
	"open-1NT": { min: 24, max: 28 }, // "24–28 points: [1NT]"
	"open-2NT": { min: 32, max: 34 }, // "32–34 points: [2NT]"
	"open-2C": { min: 35 }, // "35 or more points: [2C]"
	"open-3NT": { min: 40, max: 44 }, // "40–44 points: [3NT]"
	// ## Responses to one of a suit
	"suit-pass": { min: 0, max: 9 }, // "0–9 points: [P]"
	"suit-low": { min: 10, max: 15 }, // "10–15 points: raise partner's major"
	"suit-invite": { min: 16, max: 20 }, // "16–20 points: invitational"
	"suit-force": { min: 21 }, // "21 or more points: game forcing"
	// ## Responses to [1NT]
	"nt-weak": { min: 0, max: 12 }, // "0–12 points: [P], or a transfer"
	"nt-stayman": { min: 13 }, // "[2C] (Stayman): 13 or more points"
	"nt-2NT": { min: 13, max: 15 }, // "[2NT]: 13–15 points, invitational"
	"nt-3NT": { min: 16, max: 25 }, // "[3NT]: 16–25 points, to play"
	// ## Responses to [2C]
	"2c-waiting": { min: 0, max: 12 }, // "[2D]: waiting, 0–12 points"
	"2c-positive": { min: 13 }, // "[2H] [2S] [3C] [3D]: 13 or more points"
	"2c-2NT": { min: 13 }, // "[2NT]: 13 or more points, balanced hand"
} as const satisfies Ranges;

/** four_aces_*.txt: half points, 7.5 is "7½" in the guide. */
const FOUR_ACES = {
	// ## Opening bids
	"open-pass": { min: 0, max: 7.5 }, // "0–7½ points: [P]"
	"open-weak-two": { min: 3.5, max: 7.5 }, // "3½–7½ points: weak two"
	"open-preempt": { min: 3.5, max: 7 }, // "3½–7 points: preempt"
	"open-suit": { min: 8, max: 14 }, // "8–14 points: [1C] [1D] [1H] [1S]"
	"open-1NT": { min: 10, max: 11 }, // "10–11 points: [1NT]"
	"open-2NT": { min: 13, max: 14 }, // "13–14 points: [2NT]"
	"open-2C": { min: 14.5 }, // "14½ or more points: [2C]"
	"open-3NT": { min: 16.5, max: 18 }, // "16½–18 points: [3NT]"
	// ## Responses to one of a suit
	"suit-pass": { min: 0, max: 3.5 }, // "0–3½ points: [P]"
	"suit-low": { min: 4, max: 6 }, // "4–6 points: raise partner's major"
	"suit-invite": { min: 6.5, max: 8 }, // "6½–8 points: invitational"
	"suit-force": { min: 8.5 }, // "8½ or more points: game forcing"
	// ## Responses to [1NT]
	"nt-weak": { min: 0, max: 4.5 }, // "0–4½ points: [P], or a transfer"
	"nt-stayman": { min: 5 }, // "[2C] (Stayman): 5 or more points"
	"nt-2NT": { min: 5, max: 6 }, // "[2NT]: 5–6 points, invitational"
	"nt-3NT": { min: 6.5, max: 10 }, // "[3NT]: 6½–10 points, to play"
	// ## Responses to [2C]
	"2c-waiting": { min: 0, max: 4.5 }, // "[2D]: waiting, 0–4½ points"
	"2c-positive": { min: 5 }, // "[2H] [2S] [3C] [3D]: 5 or more points"
	"2c-2NT": { min: 5 }, // "[2NT]: 5 or more points, balanced hand"
} as const satisfies Ranges;

export const RANGES = {
	hcp: MILTON,
	"hcp-corrected": MILTON,
	vienna: SIXTY_FOUR,
	reith: SIXTY_FOUR,
	"four-aces": FOUR_ACES,
} as const satisfies Readonly<Record<RuleSystem, Ranges>>;

/** A suit is good with at least `count` of the `honours`, for example two of A K Q. */
export interface HonourTest {
	readonly honours: string;
	readonly count: number;
}

/** The shape rules, the same for every system. The guide line of each is in its comment. */
export const SHAPES = {
	/** "balanced: at least two cards in each suit and at most one doubleton (4333, 4432, 5332)" */
	balanced: ["4333", "4432", "5332"],
	/** "[1H] or [1S] needs five or more cards in the suit" */
	majorOpening: 5,
	/** A suit opening shows this many cards in a minor: "[1C] with 3–3". */
	minorOpening: 3,
	/** "weak two ... A six-card suit with two of A K Q or three of A K Q J 10, and no four-card side major" */
	weakTwo: 6,
	weakTwoSideMajor: 4,
	/** "preempt ... A seven-card suit with the same top cards as a weak two" */
	preempt: 7,
	/** The top cards of a weak two, a preempt, and a good suit after [2C]; "A K Q J 10" is "AKQJT". */
	goodSuit: [
		{ honours: "AKQ", count: 2 },
		{ honours: "AKQJT", count: 3 },
	] as readonly HonourTest[],
	/** "raise partner's major ... with three or more cards" */
	support: 3,
	/** "bid a new suit at the one level with four or more cards" */
	newSuit: 4,
	/** "[2D] shows five or more hearts, [2H] shows five or more spades (transfers)" */
	transfer: 5,
	/** "[2C] (Stayman): ... with a four-card major" */
	stayman: 4,
	/** "[2S]: a weak hand with six or more cards in a minor" */
	weakMinor: 6,
	/** "[2H] [2S] [3C] [3D]: ... with a good five-card suit" */
	positive: 5,
	/** The guides do not describe a hand with a longer suit, so it is not checked. */
	longestChecked: 7,
} as const;
