import { describe, expect, it } from "vitest";
import {
	makeBoard,
	type PlayPolicy,
	playPair,
} from "../../scripts/self-play/arena";

const draw: PlayPolicy = ({ legal }, random) => {
	const card = legal[Math.floor(random() * legal.length)];
	if (!card) throw new Error("no legal card");
	return card;
};

describe("paired self-play", () => {
	it("preserves the seeded prefix and reproduces both complete traces", () => {
		const board = makeBoard(42, 3, 13);
		expect(makeBoard(42, 3, 25).cards.slice(0, 13)).toEqual(board.cards);
		const pair = playPair(board, draw, draw, 71);
		expect(pair.candidateNS.cards).toHaveLength(52);
		expect(pair.candidateNS.cards.slice(0, 13)).toEqual(board.cards);
		expect(pair.candidateNS).toEqual(pair.candidateEW);
		expect(pair.imps).toBe(0);
		expect(playPair(board, draw, draw, 71)).toEqual(pair);
	});

	it("scores NS minus EW from the candidate partnership's perspective", () => {
		const first: PlayPolicy = ({ legal }) => {
			if (!legal[0]) throw new Error("no legal card");
			return legal[0];
		};
		const last: PlayPolicy = ({ legal }) => {
			const card = legal.at(-1);
			if (!card) throw new Error("no legal card");
			return card;
		};
		const board = makeBoard(42, 3, 13);
		const pair = playPair(board, first, last, 71);
		expect(pair.candidateNS.scoreNS).toBe(-200);
		expect(pair.candidateEW.scoreNS).toBe(-150);
		expect(pair.imps).toBe(-2);
		expect(playPair(board, last, first, 71).imps).toBe(2);
	});

	it("rejects a non-play start, invalid prefix and illegal policy action", () => {
		const board = makeBoard(42, 1, 1);
		expect(() => makeBoard(42, 1, 52)).toThrow();
		expect(() =>
			playPair({ ...board, calls: [], cards: [] }, draw, draw, 0),
		).toThrow();
		const lead = board.cards[0];
		if (!lead) throw new Error("missing opening lead");
		expect(() =>
			playPair({ ...board, cards: [lead, lead] }, draw, draw, 0),
		).toThrow();
		expect(() =>
			playPair(
				board,
				() => lead,
				() => lead,
				0,
			),
		).toThrow();
	});
});
