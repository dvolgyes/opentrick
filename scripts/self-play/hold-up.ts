import type { PlayPosition } from "../../src/bot/play-position";
import {
	type Card,
	RANKS,
	rankOf,
	SUITS,
	suitOf,
} from "../../src/bridge/cards";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import {
	type Action,
	applyAction,
	type Board,
	boardStatus,
	createBoard,
} from "../../src/bridge/engine";
import { countHandPoints } from "../../src/bridge/hand-points";
import { type Call, trickWinner } from "../../src/bridge/rules";
import { type Seat, seatAfter } from "../../src/protocol";
import { random } from "./arena";

export function holdUpFork(
	p: PlayPosition,
): { ace: Card; duck: Card; bias: boolean } | undefined {
	const { contract, current, legal, turn, view } = p;
	const lead = current.cards[0];
	const dummy = seatAfter(contract.declarer, 2);
	if (
		contract.level !== 3 ||
		contract.strain !== "NT" ||
		(turn !== contract.declarer && turn !== dummy) ||
		view.dummyCards === undefined ||
		view.plays.length >= 12 ||
		current.cards.length !== 3 ||
		lead === undefined
	)
		return undefined;
	const suit = suitOf(lead);
	const ace: Card = `${suit}A`;
	if (!legal.includes(ace)) return undefined;
	let duck: Card | undefined;
	for (const card of legal) {
		if (suitOf(card) !== suit) continue;
		const winner = trickWinner([...current.cards, card], current.leader, "NT");
		const wins = winner === contract.declarer || winner === dummy;
		if (card === ace) {
			if (!wins) return undefined;
		} else {
			if (wins) return undefined;
			if (
				duck === undefined ||
				RANKS.indexOf(rankOf(card)) > RANKS.indexOf(rankOf(duck))
			)
				duck = card;
		}
	}
	if (duck === undefined) return undefined;
	const holding = [...view.own, ...view.dummyCards].filter(
		(card) => suitOf(card) === suit,
	);
	const bias =
		holding.length >= 3 &&
		holding.length <= 6 &&
		!holding.some((card) => rankOf(card) === "K" || rankOf(card) === "Q") &&
		current.cards.every((card, offset) => {
			const seat = seatAfter(current.leader, offset);
			return (
				seat === contract.declarer || seat === dummy || suitOf(card) === suit
			);
		});
	return { ace, duck, bias };
}

export function advanceHoldUpBoard(
	board: Board,
	actor: Seat,
	action: Action,
): Board {
	const result = applyAction(board, actor, action);
	if (!result.ok)
		throw new Error(
			`board ${board.number}, ply ${board.cards.length}, ${actor}: ${result.reason}`,
		);
	return result.board;
}

export function makeHoldUpBoard(index: number, seed: number): Board {
	const next = random(seed);
	const randomBelow = randomBelowFrom(() => next() * 2 ** 32);
	for (;;) {
		const deal = dealCards(randomBelow);
		const north = countHandPoints("hcp", deal.N).total;
		if (north < 15 || north > 17) continue;
		const south = countHandPoints("hcp", deal.S).total;
		if (north + south < 25 || north + south > 27) continue;
		const shape = SUITS.map(
			(suit) => deal.N.filter((card) => suitOf(card) === suit).length,
		)
			.sort((a, b) => b - a)
			.join("");
		if (shape !== "4333" && shape !== "4432" && shape !== "5332") continue;
		let board = createBoard(1 + 4 * (index % 4), deal);
		const auction: readonly Call[] =
			south >= 10
				? ["1NT", "P", "3NT", "P", "P", "P"]
				: ["1NT", "P", "2NT", "P", "3NT", "P", "P", "P"];
		for (const call of auction) {
			const { actor } = boardStatus(board);
			if (!actor) throw new Error("missing bidder");
			board = advanceHoldUpBoard(board, actor, { type: "call", call });
		}
		return board;
	}
}
