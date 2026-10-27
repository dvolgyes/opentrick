import { describe, expect, it } from "vitest";
import { createBoard } from "../../src/bridge/engine";
import { AuctionPause } from "../../src/ui/auction-pause";
import { bidding, DEAL, playing } from "./bridge-fixtures";

describe("final auction pause", () => {
	it("starts after the closing passes, expires without restarting, and resets for another auction", () => {
		const pause = new AuctionPause();
		const board = createBoard(1, DEAL);
		expect(pause.remaining(bidding(board, "1C P P"), 3000, 0)).toBe(0);
		const ended = bidding(board, "1C P P P");
		expect(pause.remaining(ended, 3000, 1000)).toBe(3);
		expect(pause.remaining(ended, 3000, 2000)).toBe(2);
		expect(pause.remaining(ended, 3000, 3999)).toBe(1);
		expect(pause.remaining(ended, 3000, 4000)).toBe(0);
		expect(pause.remaining(ended, 3000, 8000)).toBe(0);
		expect(pause.remaining(playing(ended, "S7"), 3000, 8001)).toBe(0);
		expect(pause.remaining(ended, 3000, 9000)).toBe(3);
		expect(pause.remaining(ended, 5000, 10000)).toBe(4);
	});
});
