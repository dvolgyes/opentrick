import { type Card, rankOf, type Suit } from "../bridge/cards";
import type { Contract, Strain } from "../bridge/rules";
import type { Seat } from "../protocol";

/**
 * Pure layout rules of the bridge table (bridge-layout-spec §7, bridge-auction-screen). The DOM layer only places
 * what these functions return.
 */

/** Where a seat sits on the viewer's screen. */
export type Edge = "bottom" | "left" | "top" | "right";

/** The base order of every hand, from left to right; in play the trump suit moves in front of it or to its end. */
const SUIT_ORDER: readonly Suit[] = ["S", "H", "D", "C"];

/** Milton Work points: the only values the auction screen counts. */
const MILTON_POINTS: Readonly<Partial<Record<string, number>>> = {
	A: 4,
	K: 3,
	Q: 2,
	J: 1,
};

/** The partnership of a seat: North-South or East-West. */
export function sideOf(seat: Seat): "NS" | "EW" {
	return seat === "N" || seat === "S" ? "NS" : "EW";
}

/**
 * The suit order of one hand: spades, hearts, diamonds, clubs. With a trump suit, which the auction does not have
 * yet, the trump suit comes first and the other suits keep the base order. The trump suit goes last only in a hand on the right side of the viewer's
 * screen, so the trump suit is always on the left of the hand as its owner's side of the table reads it.
 * Dummy on a side of the screen is the exception: its trump suit is on dummy's own right, which is the bottom of the
 * stacked suits on the left and the top on the right.
 */
export function playSuitOrder(
	strain: Strain | undefined,
	edge?: Edge,
	dummy = false,
): readonly Suit[] {
	if (strain === undefined || strain === "NT") return SUIT_ORDER;
	const others = SUIT_ORDER.filter((suit) => suit !== strain);
	const last = dummy ? edge === "left" : edge === "right";
	return last ? [...others, strain] : [strain, ...others];
}

/** The Milton Work points of a set of cards: A 4, K 3, Q 2, J 1. */
export function miltonPoints(cards: readonly Card[]): number {
	return cards.reduce(
		(sum, card) => sum + (MILTON_POINTS[rankOf(card)] ?? 0),
		0,
	);
}

/** The state of the target: still open, secured by the declaring side, or defeated. */
export type TargetStatus = "open" | "secured" | "defeated";

/** What the viewer's partnership still needs (spec §11.2). */
export interface TrickNeed {
	/** Completed tricks won by the viewer's partnership. */
	readonly ours: number;
	/** The viewer's partnership target: the contract for the declaring side, otherwise the defeat count. */
	readonly target: number;
	readonly opponents: number;
	readonly needed: number;
	/** Tricks not yet completed, including the trick in play. */
	readonly remaining: number;
	readonly status: TargetStatus;
}

/**
 * The remaining requirement from the viewer's point of view. `T = 6 + level` is the declarer's target; the
 * defending side needs `14 - T` to defeat the contract. The target is never derived from an incomplete auction.
 */
export function trickNeed(
	viewer: Seat,
	contract: Contract,
	tricksNS: number,
	tricksEW: number,
): TrickNeed {
	const side = sideOf(viewer);
	const declaring = sideOf(contract.declarer) === side;
	const contractTarget = 6 + contract.level;
	const ours = side === "NS" ? tricksNS : tricksEW;
	const opponents = side === "NS" ? tricksEW : tricksNS;
	const declarerTricks = declaring ? ours : opponents;
	const defenderTricks = declaring ? opponents : ours;
	const target = declaring ? contractTarget : 14 - contractTarget;
	const needed = Math.max(0, target - ours);
	const impossible = needed > 13 - tricksNS - tricksEW;
	const status: TargetStatus =
		declarerTricks >= contractTarget || (!declaring && impossible)
			? "secured"
			: defenderTricks >= 14 - contractTarget || (declaring && impossible)
				? "defeated"
				: "open";
	return {
		ours,
		target,
		opponents,
		needed,
		remaining: 13 - tricksNS - tricksEW,
		status,
	};
}
