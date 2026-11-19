import { describe, expect, it } from "vitest";
import { obviousPlay } from "../../src/bot/obvious-play";
import { playPosition } from "../../src/bot/play-position";
import { createBoard } from "../../src/bridge/engine";
import { bidding, cards, DEAL, playing } from "./bridge-fixtures";

const gapDeal = {
	...DEAL,
	E: cards("S6 S5 S3 HJ HT H9 H8 H7 DQ DJ DT CK CQ"),
	S: cards("S7 S4 S2 H6 H5 H4 D9 D8 D7 D6 CJ CT C9"),
};

function dummyPosition(plays: string) {
	return playPosition(
		playing(bidding(createBoard(1, gapDeal), "1NT P P P"), plays),
		"N",
	);
}

describe("obviousPlay", () => {
	it("chooses the lowest equivalent rank from dummy's legal cards", () => {
		const board = bidding(createBoard(1, DEAL), "1NT P P P");
		const position = playPosition(playing(board, "S7"), "N");
		expect(position.turn).toBe("S");
		expect(position.legal).toEqual(["S4", "S3", "S2"]);
		expect(obviousPlay(position)).toBe("S2");
	});

	it("keeps a rank in the current trick live", () => {
		const position = dummyPosition("S6 S7 H2 S8 S9 S3");
		expect(position.legal).toEqual(["S4", "S2"]);
		expect(obviousPlay(position)).toBeUndefined();
	});

	it("rejects a gap held outside the acting hand", () => {
		const position = dummyPosition("S6 S7 H2 S8 S9 S5");
		expect(position.legal).toEqual(["S4", "S2"]);
		expect(obviousPlay(position)).toBeUndefined();
	});

	it("ignores a middle rank from a completed trick", () => {
		const position = dummyPosition("S3 S7 H2 S8 S9 S6");
		expect(position.legal).toEqual(["S4", "S2"]);
		expect(obviousPlay(position)).toBe("S2");
	});

	it("rejects legal alternatives in different suits", () => {
		const board = bidding(createBoard(1, DEAL), "1NT P P P");
		expect(obviousPlay(playPosition(board, "E"))).toBeUndefined();
	});

	it("chooses the only legal card when the hand has other suits", () => {
		const deal = {
			...DEAL,
			E: cards("S6 S5 HJ HT H9 H8 H7 H2 DQ DJ DT CK CQ"),
			W: cards("S7 H3 D5 D4 D3 D2 C8 C7 C6 C5 C4 C3 C2"),
		};
		const board = bidding(createBoard(1, deal), "1NT P P P");
		const position = playPosition(playing(board, "S6 S2"), "W");
		expect(position.legal).toEqual(["S7"]);
		expect(obviousPlay(position)).toBe("S7");
	});
});
