import { SUITS, type Suit } from "./cards";
import { type Bid, type Call, isLegalCall, STRAINS } from "./rules";

/** Common treatments outside the app's explicit guide. These are explanations, not hand constraints. */
export type AuctionReference =
	| {
			readonly kind: "second-suit";
			readonly suit: Suit;
			readonly reverse: boolean;
	  }
	| { readonly kind: "game-raise"; readonly suit: Suit }
	| { readonly kind: "opener-notrump" }
	| { readonly kind: "opener-repeat"; readonly suit: Suit }
	| { readonly kind: "opener-support"; readonly suit: Suit }
	| { readonly kind: "preference"; readonly suit: Suit }
	| { readonly kind: "fourth-suit"; readonly suit: Suit }
	| {
			readonly kind: "major-preference";
			readonly suit: Suit;
			readonly other: Suit;
	  }
	| { readonly kind: "game-try"; readonly suit: Suit }
	| {
			readonly kind: "two-over-one-invite" | "forcing-raise";
			readonly suit: Suit;
	  }
	| {
			readonly kind: "fourth-answer";
			readonly action: "first" | "second" | "support" | "notrump" | "fourth";
			readonly suit: Suit;
	  }
	| {
			readonly kind: "notrump";
			readonly strength: "minimum" | "invite" | "game";
	  }
	| {
			readonly kind: "rebid" | "raise";
			readonly suit: Suit;
			readonly min: number;
			readonly strength: "minimum" | "invite" | "game";
	  };

function bid(call: Call | undefined): call is Bid {
	return call !== undefined && call !== "P" && call !== "X" && call !== "XX";
}

function suitOfBid(call: Bid): Suit | undefined {
	const suit = call.slice(1);
	return (SUITS as readonly string[]).includes(suit)
		? (suit as Suit)
		: undefined;
}

function level(call: Bid): number {
	return Number(call[0]);
}

function cheapest(suit: Suit, previous: Bid): number {
	return STRAINS.indexOf(suit) >
		STRAINS.indexOf(previous.slice(1) as (typeof STRAINS)[number])
		? level(previous)
		: level(previous) + 1;
}

function strength(call: Bid): "minimum" | "invite" | "game" | undefined {
	if (level(call) === 2) return "minimum";
	if (level(call) === 3) return "invite";
	if (level(call) === 4 && (suitOfBid(call) === "H" || suitOfBid(call) === "S"))
		return "game";
	return undefined;
}

/** Returns a cautious, explicitly labeled reference for supported uncontested natural-suit auctions. */
export function auctionReference(
	calls: readonly Call[],
	index: number,
): AuctionReference | undefined {
	if (!Number.isInteger(index) || index < 0 || index >= calls.length)
		return undefined;
	const auction = calls.slice(0, index + 1);
	const start = auction.findIndex((call) => call !== "P");
	// A previously passed responder can have different agreements (such as Drury).
	if (start < 0 || start >= 2) return undefined;
	const a = auction.slice(start);
	if (
		![5, 7, 9].includes(a.length) ||
		auction.some((call, i) => !isLegalCall(auction.slice(0, i), call))
	)
		return undefined;
	const [
		opening,
		firstOpponent,
		response,
		secondOpponent,
		openerRebid,
		thirdOpponent,
		responderRebid,
		fourthOpponent,
		openerThird,
	] = a;
	if (
		!bid(opening) ||
		level(opening) !== 1 ||
		!suitOfBid(opening) ||
		firstOpponent !== "P" ||
		!bid(response) ||
		secondOpponent !== "P" ||
		!bid(openerRebid)
	)
		return undefined;
	const opened = suitOfBid(opening);
	if (!opened) return undefined;
	const responseSuit = suitOfBid(response);
	const openerSuit = suitOfBid(openerRebid);
	if (a.length === 5) {
		if (
			level(response) === 2 &&
			responseSuit &&
			responseSuit !== opened &&
			level(response) === cheapest(responseSuit, opening)
		) {
			if (openerRebid === "2NT") return { kind: "opener-notrump" };
			if (openerSuit === opened && level(openerRebid) === 2)
				return { kind: "opener-repeat", suit: opened };
			if (openerSuit === responseSuit && level(openerRebid) === 3)
				return { kind: "opener-support", suit: responseSuit };
			if (
				openerSuit &&
				openerSuit !== opened &&
				openerSuit !== responseSuit &&
				level(openerRebid) === 2 &&
				level(openerRebid) === cheapest(openerSuit, response) &&
				STRAINS.indexOf(openerSuit) < STRAINS.indexOf(opened)
			)
				return { kind: "second-suit", suit: openerSuit, reverse: false };
		}
		if (level(response) !== 1 || !responseSuit || responseSuit === opened)
			return undefined;
		if (
			openerSuit === responseSuit &&
			level(openerRebid) === 4 &&
			(responseSuit === "H" || responseSuit === "S")
		)
			return { kind: "game-raise", suit: responseSuit };
		if (
			openerSuit &&
			openerSuit !== opened &&
			openerSuit !== responseSuit &&
			level(openerRebid) === cheapest(openerSuit, response)
		)
			return {
				kind: "second-suit",
				suit: openerSuit,
				reverse:
					level(openerRebid) === 2 &&
					STRAINS.indexOf(openerSuit) > STRAINS.indexOf(opened),
			};
		return undefined;
	}
	if (thirdOpponent !== "P" || !bid(responderRebid)) return undefined;
	if (
		a.length === 9 &&
		fourthOpponent === "P" &&
		bid(openerThird) &&
		responseSuit &&
		openerSuit
	) {
		const fourth = auctionReference(auction, index - 2);
		if (fourth?.kind === "fourth-suit") {
			const answer = suitOfBid(openerThird);
			if (openerThird === "2NT" || openerThird === "3NT")
				return { kind: "fourth-answer", action: "notrump", suit: fourth.suit };
			if (answer === opened)
				return { kind: "fourth-answer", action: "first", suit: opened };
			if (answer === openerSuit)
				return { kind: "fourth-answer", action: "second", suit: openerSuit };
			if (answer === responseSuit)
				return { kind: "fourth-answer", action: "support", suit: responseSuit };
			if (answer === fourth.suit)
				return { kind: "fourth-answer", action: "fourth", suit: fourth.suit };
			return undefined;
		}
	}
	if (
		a.length === 9 &&
		fourthOpponent === "P" &&
		bid(openerThird) &&
		responseSuit &&
		openerSuit &&
		openerSuit !== opened &&
		responderRebid === `2${openerSuit}` &&
		openerThird !== openerRebid
	) {
		const thirdSuit = suitOfBid(openerThird);
		if (
			thirdSuit &&
			thirdSuit !== opened &&
			thirdSuit !== responseSuit &&
			thirdSuit !== openerSuit &&
			level(openerThird) === 3
		)
			return { kind: "game-try", suit: thirdSuit };
		return undefined;
	}
	if (
		a.length === 7 &&
		level(response) === 2 &&
		responseSuit &&
		responseSuit !== opened &&
		level(response) === cheapest(responseSuit, opening) &&
		openerSuit &&
		openerSuit !== opened &&
		openerSuit !== responseSuit &&
		level(openerRebid) === 2 &&
		level(openerRebid) === cheapest(openerSuit, response) &&
		STRAINS.indexOf(openerSuit) < STRAINS.indexOf(opened)
	) {
		const next = suitOfBid(responderRebid);
		if (responderRebid === "2NT")
			return { kind: "notrump", strength: "invite" };
		if (
			next === opened &&
			level(responderRebid) === cheapest(opened, openerRebid)
		)
			return { kind: "preference", suit: opened };
		if (next === opened && level(responderRebid) === 3)
			return { kind: "forcing-raise", suit: opened };
		if (
			next &&
			(next === responseSuit || next === openerSuit) &&
			level(responderRebid) === 3
		)
			return { kind: "two-over-one-invite", suit: next };
		if (
			next &&
			next !== opened &&
			next !== responseSuit &&
			next !== openerSuit &&
			level(responderRebid) === 3
		)
			return { kind: "fourth-suit", suit: next };
		return undefined;
	}
	if (
		a.length !== 7 ||
		(response !== "1NT" &&
			(level(response) !== 1 || !responseSuit || responseSuit === opened))
	)
		return undefined;
	// Do not infer meanings after a jump shift, reverse, or other unhandled strong opener rebid.
	if (openerRebid !== "1NT") {
		if (
			!openerSuit ||
			openerSuit === responseSuit ||
			level(openerRebid) !== cheapest(openerSuit, response)
		)
			return undefined;
		if (
			openerSuit !== opened &&
			level(openerRebid) >= 2 &&
			STRAINS.indexOf(openerSuit) > STRAINS.indexOf(opened)
		)
			return undefined;
	}
	const nextSuit = suitOfBid(responderRebid);
	if (
		nextSuit === opened &&
		openerSuit !== opened &&
		level(responderRebid) === cheapest(opened, openerRebid)
	)
		return { kind: "preference", suit: opened };
	if (response === "1NT" || !responseSuit) return undefined;
	if (responderRebid === "1NT") return { kind: "notrump", strength: "minimum" };
	if (responderRebid === "2NT") return { kind: "notrump", strength: "invite" };
	if (responderRebid === "3NT") return { kind: "notrump", strength: "game" };
	if (
		opening[1] !== "H" &&
		opening[1] !== "S" &&
		response === "1S" &&
		openerRebid === "1NT" &&
		responderRebid === "2H"
	)
		return { kind: "major-preference", suit: "H", other: "S" };
	const rank = strength(responderRebid);
	if (nextSuit === responseSuit && rank)
		return {
			kind: "rebid",
			suit: nextSuit,
			min: openerRebid === "1NT" && level(responderRebid) === 2 ? 5 : 6,
			strength: rank,
		};
	if (
		nextSuit &&
		openerSuit &&
		nextSuit === openerSuit &&
		openerSuit !== opened &&
		rank
	) {
		const supportStrength = level(responderRebid) === 3 ? "invite" : rank;
		return { kind: "raise", suit: nextSuit, min: 4, strength: supportStrength };
	}
	if (
		nextSuit &&
		openerSuit &&
		openerSuit !== opened &&
		openerSuit !== responseSuit &&
		nextSuit !== opened &&
		nextSuit !== responseSuit &&
		nextSuit !== openerSuit &&
		level(responderRebid) >= 2 &&
		level(responderRebid) === cheapest(nextSuit, openerRebid)
	)
		return { kind: "fourth-suit", suit: nextSuit };
	return undefined;
}
