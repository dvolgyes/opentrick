import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	BID_MODEL_BYTES,
	BidNetwork,
	LOCAL_BIDDERS,
} from "../../src/bot/bid-network";
import {
	type BidPosition,
	bidPosition,
	encodeBidPosition,
} from "../../src/bot/bid-position";
import { createBoard } from "../../src/bridge/engine";
import { CALLS } from "../../src/bridge/rules";
import { DEAL } from "./bridge-fixtures";
import reference from "./fixtures/bid-model.json";

describe("local bidding network", () => {
	it("matches an independent NumPy reference across both published policies", () => {
		for (const policy of LOCAL_BIDDERS) {
			const bytes = readFileSync(`public/bot-models/brl-${policy}.f32`);
			const network = new BidNetwork(
				bytes.buffer.slice(
					bytes.byteOffset,
					bytes.byteOffset + bytes.byteLength,
				),
				policy,
			);
			for (const fixture of reference.fixtures) {
				const position = fixture.position as BidPosition;
				const encoded = encodeBidPosition(position);
				expect(
					[...encoded.keys()].filter((index) => encoded[index] === 1),
				).toEqual(fixture.features);
				const actual = network.logits(encoded);
				for (const [index, expected] of fixture.logits[policy].entries())
					expect(Math.abs((actual[index] ?? 0) - expected)).toBeLessThan(
						0.0001,
					);
				const chosen = network.choose(position);
				const best = position.legal.toSorted(
					(a, b) =>
						(fixture.logits[policy][CALLS.indexOf(b)] ?? 0) -
						(fixture.logits[policy][CALLS.indexOf(a)] ?? 0),
				)[0];
				expect(chosen.call).toBe(best);
				expect(position.legal).toContain(chosen.call);
				expect(
					chosen.candidates.reduce((sum, item) => sum + item.probability, 0),
				).toBeCloseTo(1, 10);
			}
		}
	});
	it("never exposes another bidder's hand", () => {
		const board = createBoard(1, DEAL);
		const changed = {
			...board,
			deal: { ...board.deal, E: board.deal.W, W: board.deal.E },
		};
		expect(bidPosition(board, "N")).toEqual(bidPosition(changed, "N"));
		expect(bidPosition(board, "N")).not.toHaveProperty("deal");
		expect(() => bidPosition(board, "E")).toThrow(/current bidder/);
	});
	it("encodes leading passes, doubles, and redoubles from the bidder's perspective", () => {
		const base = bidPosition(createBoard(1, DEAL), "N");
		const position: BidPosition = {
			...base,
			calls: ["P", "1C", "X", "XX"],
			vulnerability: "NS",
		};
		const encoded = encodeBidPosition(position);
		expect([...encoded.slice(0, 20)]).toEqual([
			0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
		]);
	});
	it("rejects corrupt model bytes and invalid hands before inference", () => {
		expect(() => new BidNetwork(new ArrayBuffer(4), "sl")).toThrow(/format/);
		const bytes = new ArrayBuffer(BID_MODEL_BYTES);
		new DataView(bytes).setFloat32(0, Number.NaN, true);
		expect(() => new BidNetwork(bytes, "sl")).toThrow(/non-finite/);
		const position = bidPosition(createBoard(1, DEAL), "N");
		expect(() =>
			encodeBidPosition({ ...position, hand: position.hand.slice(1) }),
		).toThrow(/13 distinct/);
	});
});
