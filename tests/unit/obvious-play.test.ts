import { describe, expect, it } from "vitest";
import { obviousPlay } from "../../src/bot/obvious-play";
import { playPosition } from "../../src/bot/play-position";
import { mapLegalRankClasses } from "../../src/bot/rank-classes";
import { boardStatus, createBoard } from "../../src/bridge/engine";
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

	it("ignores an already beaten middle rank in the led suit", () => {
		const position = dummyPosition("S6 S7 H2 S8 S9 S3");
		expect(position.legal).toEqual(["S4", "S2"]);
		expect(obviousPlay(position)).toBe("S2");
	});

	it("keeps the current winner between ranks that beat and lose to it", () => {
		const deal = {
			...DEAL,
			E: cards("S7 S6 S5 HJ HT H9 H8 H6 DQ DJ DT CK CQ"),
			S: cards("S4 S3 S2 H7 H5 H4 D9 D8 D7 D6 CJ CT C9"),
			N: cards("SA SK SQ SJ ST S9 S8 DA DK CA C8 C7 C6"),
			W: cards("HA HK HQ H3 H2 D5 D4 D3 D2 C5 C4 C3 C2"),
		};
		const board = bidding(createBoard(1, deal), "1NT P P P");
		const position = playPosition(playing(board, "H6"), "N");
		expect(position.legal).toEqual(["H7", "H5", "H4"]);
		expect(obviousPlay(position)).toBeUndefined();
		expect(boardStatus(playing(board, "H6 H5 H2 C8")).turn).toBe("E");
		expect(boardStatus(playing(board, "H6 H7 H2 C8")).turn).toBe("S");
	});

	it.each([
		["1NT", "S7 H6 H8", true],
		["1H", "S7 H6 H8", true],
		["1H", "S7 H6 H4", false],
	] as const)(
		"keeps off-suit H6 as a gap only when it wins in %s after %s",
		(contract, plays, equivalent) => {
			const deal = {
				N: cards("HA HK HQ H7 H5 DA DK DQ DJ DT D9 D8 D7"),
				E: cards("SA SK SQ SJ ST S9 S8 S7 S6 S5 S4 S3 S2"),
				S: cards("HJ HT H9 H6 D6 D5 D4 D3 D2 CA CK CQ CJ"),
				W: cards("H8 H4 H3 H2 CT C9 C8 C7 C6 C5 C4 C3 C2"),
			};
			const board = bidding(createBoard(1, deal), `${contract} P P P`);
			const position = playPosition(playing(board, plays), "N");
			const keys = new Map(
				mapLegalRankClasses(position, (card, key) => [card, key] as const),
			);
			expect(keys.has("H5") && keys.has("H7")).toBe(true);
			expect(keys.get("H5") === keys.get("H7")).toBe(equivalent);
		},
	);

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
