import { describe, expect, it, vi } from "vitest";
import type { BidAnalysis, LocalBidder } from "../../src/bot/bid-network";
import { type BidPosition, bidPosition } from "../../src/bot/bid-position";
import type { BidChooser } from "../../src/bot/browser-bidder";
import { createBoard } from "../../src/bridge/engine";
import type { Call } from "../../src/bridge/rules";
import { botBidHint, viewerBidPosition } from "../../src/ui/bot-bid-hint";
import { DEAL } from "./bridge-fixtures";

/** A bidder whose requests the test answers one by one, also after an abort, as a late answer can come. */
function fakeBidder() {
	const requests: {
		position: BidPosition;
		policy: LocalBidder;
		signal: AbortSignal;
		answer(call: Call): void;
	}[] = [];
	const bidder: BidChooser = {
		choose: (position, policy, signal) =>
			new Promise<BidAnalysis>((resolve) => {
				requests.push({
					position,
					policy,
					signal,
					answer: (call) => resolve({ call } as BidAnalysis),
				});
			}),
		stop: vi.fn(),
	};
	return { bidder, requests };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("bot bid hint", () => {
	const board = createBoard(1, DEAL);
	const north = bidPosition(board, board.dealer);

	it("gives the position only to the viewer whose turn it is to call", () => {
		expect(viewerBidPosition(board, board.dealer)).toEqual(north);
		expect(viewerBidPosition(board, "E")).toBeUndefined();
		expect(viewerBidPosition(null, board.dealer)).toBeUndefined();
	});

	it("shows the bidder's call for the current position", async () => {
		const shown = vi.fn();
		const { bidder, requests } = fakeBidder();
		const hint = botBidHint(shown, bidder);
		hint.update(north, "sl");
		expect(shown).toHaveBeenLastCalledWith(undefined);
		expect(requests.map((request) => request.policy)).toEqual(["sl"]);
		requests[0]?.answer("1C");
		await flush();
		expect(shown).toHaveBeenLastCalledWith("1C");
		// The same position asks no new question.
		hint.update(north, "sl");
		expect(requests).toHaveLength(1);
		expect(shown).toHaveBeenLastCalledWith("1C");
	});

	it("stops the request of an old position and never shows its call", async () => {
		const shown = vi.fn();
		const { bidder, requests } = fakeBidder();
		const hint = botBidHint(shown, bidder);
		hint.update(north, "sl");
		hint.update(north, "rl-fsp");
		expect(requests[0]?.signal.aborted).toBe(true);
		requests[0]?.answer("1C");
		requests[1]?.answer("P");
		await flush();
		expect(shown).toHaveBeenLastCalledWith("P");
		expect(shown).not.toHaveBeenCalledWith("1C");
		hint.update(undefined, "rl-fsp");
		expect(shown).toHaveBeenLastCalledWith(undefined);
		expect(requests).toHaveLength(2);
	});

	it("shows nothing when the bidder fails, and stop ends the request", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const shown = vi.fn();
		const failing: BidChooser = {
			choose: () => Promise.reject(new Error("no model")),
			stop: vi.fn(),
		};
		botBidHint(shown, failing).update(north, "sl");
		await flush();
		expect(shown.mock.calls).toEqual([[undefined]]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		const { bidder, requests } = fakeBidder();
		const hint = botBidHint(shown, bidder);
		hint.update(north, "sl");
		hint.stop();
		expect(requests[0]?.signal.aborted).toBe(true);
		expect(bidder.stop).toHaveBeenCalled();
	});
});
