import { describe, expect, it } from "vitest";
import {
	cardKnowledge,
	type VisiblePlay,
	visiblePlay,
} from "../../src/bridge/card-knowledge";
import { type Card, type Deal, SUITS, suitOf } from "../../src/bridge/cards";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
	legalActions,
} from "../../src/bridge/engine";
import { SEATS, type Seat } from "../../src/protocol";
import { bidding, cards, DEAL, playing } from "./bridge-fixtures";

/** North declares 4♠ with South as dummy, so East leads (src/bridge/engine.ts). */
function fourSpades(): Board {
	return bidding(createBoard(1, DEAL), "1S P 4S P P P");
}

function visible(board: Board, seat: Seat): VisiblePlay {
	const view = visiblePlay(board, seat);
	if (view === undefined) throw new Error("the board is not in play");
	return view;
}

/** A small seeded generator, so that a failure can be repeated. */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state;
	};
}

describe("card knowledge", () => {
	it("shows only the own hand before the opening lead, and dummy after it", () => {
		const board = fourSpades();
		const before = visible(board, "E");
		expect(before.own).toEqual(DEAL.E);
		expect(before.dummyCards).toBeUndefined();
		expect(before.plays).toEqual([]);

		const knowledge = cardKnowledge(before);
		expect(knowledge.hidden.map((hand) => hand.seat)).toEqual(["N", "S", "W"]);
		expect(SUITS.flatMap((suit) => knowledge.unaccounted[suit]).length).toBe(
			39,
		);

		const after = visible(playing(board, "HJ"), "E");
		expect(after.dummyCards).toEqual(DEAL.S);
		expect(after.plays).toEqual([{ seat: "E", card: "HJ", trick: 1 }]);
		expect(cardKnowledge(after).hidden.map((hand) => hand.seat)).toEqual([
			"N",
			"W",
		]);
	});

	it("finds a void when a hand does not follow the led suit, also in the current trick", () => {
		// Trick 1: E ♥J, S ♥4, W ♥3, N ♥A. Trick 2: N ♠A, E ♠7, S ♠2, W discards ♦2.
		const board = playing(fourSpades(), "HJ H4 H3 HA SA S7 S2 D2");
		const knowledge = cardKnowledge(visible(board, "E"));
		const west = knowledge.hidden.find((hand) => hand.seat === "W");
		const north = knowledge.hidden.find((hand) => hand.seat === "N");
		expect(west?.voids).toEqual([{ suit: "S", trick: 2 }]);
		expect(west?.lengths.S).toEqual({ min: 0, max: 0 });
		expect(west?.remaining).toBe(11);
		// West has no spade, so North holds every spade that East cannot see.
		expect(knowledge.unaccounted.S).toEqual(cards("SK SQ SJ ST S9 S8"));
		expect(north?.lengths.S).toEqual({ min: 6, max: 6 });
		expect(north?.known).toEqual(cards("SK SQ SJ ST S9 S8"));

		// The opening lead ♠7, dummy ♠2, West discards ♦2: North has not played to the trick yet.
		const partial = playing(fourSpades(), "S7 S2 D2");
		const early = cardKnowledge(visible(partial, "E"));
		expect(early.hidden.find((hand) => hand.seat === "W")?.voids).toEqual([
			{ suit: "S", trick: 1 },
		]);
	});

	it("gives each hidden hand no cards of a suit with no unaccounted card", () => {
		// After three heart tricks, East holds ♥T9 and the other 11 hearts are played, so the hidden hands
		// hold no heart. This needs no void.
		const board = playing(fourSpades(), "HJ H4 H3 HA HK H7 H5 H2 HQ H8 H6 D2");
		const knowledge = cardKnowledge(visible(board, "E"));
		expect(knowledge.unaccounted.H).toEqual([]);
		for (const hand of knowledge.hidden)
			expect(hand.lengths.H).toEqual({ min: 0, max: 0 });
	});

	it("fills a hand whose remaining cards can only be one suit", () => {
		// West shows out of spades, hearts and diamonds in turn, so all its remaining cards are clubs.
		const deal: Deal = {
			N: cards("SA SK SQ SJ ST S9 S8 S7 HA HK HQ HJ HT"),
			E: cards("S6 S5 S4 S3 S2 H9 H8 H7 H6 H5 H4 H3 H2"),
			S: cards("DA DK DQ DJ DT D9 D8 D7 D6 D5 D4 D3 D2"),
			W: cards("CA CK CQ CJ CT C9 C8 C7 C6 C5 C4 C3 C2"),
		};
		// North declares 4S with South as dummy. East leads ♠6 and West discards; North leads ♥A and West
		// discards again. North sees all diamonds, so West's 11 cards must be the 11 unaccounted clubs.
		let board = bidding(createBoard(1, deal), "1S P 2D P 4S P P P");
		board = playing(board, "S6 D2 C2 SA HA H9 D3 C3");
		const knowledge = cardKnowledge(visible(board, "N"));
		const west = knowledge.hidden.find((hand) => hand.seat === "W");
		const east = knowledge.hidden.find((hand) => hand.seat === "E");
		expect(west?.voids).toEqual([
			{ suit: "S", trick: 1 },
			{ suit: "H", trick: 2 },
		]);
		expect(west?.lengths.C).toEqual({ min: 11, max: 11 });
		expect(west?.known).toEqual(cards("CA CK CQ CJ CT C9 C8 C7 C6 C5 C4"));
		expect(east?.known).toEqual(cards("S5 S4 S3 S2 H8 H7 H6 H5 H4 H3 H2"));
	});

	it("does not depend on the cards of the hidden hands", () => {
		const board = playing(fourSpades(), "HJ H4 H3 HA SA S7 S2 D2");
		// Swap two unplayed diamonds between the hidden North and West: East's view must not change.
		const swapped: Board = {
			...board,
			deal: {
				...board.deal,
				N: board.deal.N.map((card) => (card === "DA" ? "D5" : card)),
				W: board.deal.W.map((card) => (card === "D5" ? "DA" : card)),
			},
		};
		expect(visible(swapped, "E")).toEqual(visible(board, "E"));
		expect(cardKnowledge(visible(swapped, "E"))).toEqual(
			cardKnowledge(visible(board, "E")),
		);
	});

	it("holds every bound and known card for the real hidden hands in random games", () => {
		for (let game = 0; game < 40; game++) {
			const random = randomBelowFrom(seeded(game + 1));
			let board = bidding(
				createBoard(1 + (game % 16), dealCards(random)),
				"1NT P P P",
			);
			for (let step = 0; step < 52; step++) {
				const status = boardStatus(board);
				if (status.phase !== "play") break;
				for (const seat of SEATS) {
					if (seat === status.dummy) continue;
					const view = visible(board, seat);
					const shown = new Set<Card>([
						...view.own,
						...(view.dummyCards ?? []),
						...view.plays.map((play) => play.card),
					]);
					// No card of a hidden hand reaches the view.
					const allowed = new Set<Card>([
						...status.remaining[seat],
						...(board.cards.length > 0 ? status.remaining[status.dummy] : []),
						...board.cards,
					]);
					for (const card of shown) expect(allowed.has(card)).toBe(true);

					const knowledge = cardKnowledge(view);
					const held = knowledge.hidden.flatMap(
						(hand) => status.remaining[hand.seat],
					);
					expect(
						SUITS.flatMap((suit) => knowledge.unaccounted[suit]).toSorted(),
					).toEqual(held.toSorted());
					for (const hand of knowledge.hidden) {
						const real = status.remaining[hand.seat];
						expect(hand.remaining).toBe(real.length);
						for (const suit of SUITS) {
							const length = real.filter(
								(card) => suitOf(card) === suit,
							).length;
							expect(length).toBeGreaterThanOrEqual(hand.lengths[suit].min);
							expect(length).toBeLessThanOrEqual(hand.lengths[suit].max);
						}
						for (const card of hand.known) expect(real).toContain(card);
					}
				}
				const actions = legalActions(board, status.actor);
				const action = actions[random(actions.length)];
				if (action === undefined) throw new Error("no legal card");
				const result = applyAction(board, status.actor, action);
				if (!result.ok) throw new Error(result.reason);
				board = result.board;
			}
		}
		// About 3 s alone; the pre-commit hook runs it beside the browser tests.
	}, 30_000);
});
