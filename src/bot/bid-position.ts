import { type Card, RANKS, rankOf, SUITS, suitOf } from "../bridge/cards";
import { type Board, boardStatus, legalActions } from "../bridge/engine";
import { CALLS, type Call, type Vulnerability } from "../bridge/rules";
import { SEATS, type Seat, seatAfter } from "../protocol";

export interface BidPosition {
	readonly hand: readonly Card[];
	readonly seat: Seat;
	readonly dealer: Seat;
	readonly vulnerability: Vulnerability;
	readonly calls: readonly Call[];
	readonly legal: readonly Call[];
}

/** The bidder receives its own hand and public auction information only. */
export function bidPosition(board: Board, seat: Seat): BidPosition {
	const status = boardStatus(board);
	if (status.phase !== "auction" || status.actor !== seat)
		throw new Error("bidding engine requires the current bidder");
	return {
		hand: board.deal[seat],
		seat,
		dealer: board.dealer,
		vulnerability: board.vulnerability,
		calls: board.calls,
		legal: legalActions(board, seat).flatMap((action) =>
			action.type === "call" ? [action.call] : [],
		),
	};
}

/** PGX 1.4 / OpenSpiel's 480-bit information state, adapted from Apache-2.0 PGX. */
export function encodeBidPosition(position: BidPosition): Float32Array {
	const observation = new Float32Array(480);
	const ownNS = position.seat === "N" || position.seat === "S";
	const nsVulnerable =
		position.vulnerability === "NS" || position.vulnerability === "both";
	const ewVulnerable =
		position.vulnerability === "EW" || position.vulnerability === "both";
	observation[Number(ownNS ? nsVulnerable : ewVulnerable)] = 1;
	observation[2 + Number(ownNS ? ewVulnerable : nsVulnerable)] = 1;
	let lastBid = 0;
	for (const [index, call] of position.calls.entries()) {
		const actor = seatAfter(position.dealer, index);
		const relative =
			(SEATS.indexOf(actor) - SEATS.indexOf(position.seat) + 4) % 4;
		const action = CALLS.indexOf(call);
		if (action < 0) throw new Error("unknown call in bidder observation");
		if (action === 0) {
			if (lastBid === 0) observation[4 + relative] = 1;
		} else if (action <= 2) {
			if (lastBid < 3)
				throw new Error("double or redouble without a contract bid");
			observation[8 + (lastBid - 3) * 12 + action * 4 + relative] = 1;
		} else {
			lastBid = action;
			observation[8 + (action - 3) * 12 + relative] = 1;
		}
	}
	if (position.hand.length !== 13 || new Set(position.hand).size !== 13)
		throw new Error("bidding engine requires 13 distinct cards");
	for (const card of position.hand) {
		const suit = SUITS.indexOf(suitOf(card));
		const rank = RANKS.indexOf(rankOf(card));
		if (suit < 0 || rank < 0) throw new Error("invalid bidder card");
		observation[428 + (12 - rank) * 4 + (3 - suit)] = 1;
	}
	return observation;
}
