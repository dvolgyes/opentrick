import { describe, expect, it, vi } from "vitest";
import {
	chooseConsensus,
	replayLeads,
} from "../../scripts/self-play/lead-consensus-policy";

const legal = ["SA", "H2"] as const;
function root(sa: number, h2: number, weightSum = 1) {
	const evaluations = [
		{ card: "SA" as const, utility: sa },
		{ card: "H2" as const, utility: h2 },
	].map((e) => ({
		...e,
		expectedScore: 0,
		expectedTricks: 0,
		successProbability: 0,
	}));
	evaluations.sort((a, b) => b.utility - a.utility);
	const card = h2 > sa ? "H2" : "SA";
	return {
		card,
		evaluations,
		samples: 5,
		effectiveSamples: 5,
		elapsedMs: 0,
		weightSum,
	} as const;
}

describe("two-batch opening lead", () => {
	it("vetoes a weighted-pool switch if either batch rejects the suggestion", () => {
		for (const [a, b] of [
			[root(1, 0.5, 9), root(2, 0, 1)],
			[root(2, 0, 1), root(1, 0.5, 9)],
		] as const) {
			const result = chooseConsensus(legal, a, b, "H2");
			expect(result).toMatchObject({
				incumbent: "SA",
				standard: "H2",
				consensus: "SA",
				decision: "vetoed",
			});
			expect(result.gaps[2]).toBeCloseTo(0.65);
		}
	});

	it("includes the 1 IMP boundary and allows different winners", () => {
		const result = chooseConsensus(legal, root(1, 0, 2), root(0, 1), "H2");
		expect(result).toMatchObject({
			incumbent: "SA",
			standard: "H2",
			consensus: "H2",
		});
		expect(result.gaps.slice(0, 2)).toEqual([1, 0]);
	});

	it("abstains without advice and follows weighted rather than sample-count pooling", () => {
		expect(
			chooseConsensus(legal, root(10, 0), root(0, 2, 9), undefined),
		).toMatchObject({
			incumbent: "H2",
			standard: "H2",
			consensus: "H2",
			decision: "abstained",
			gaps: [null, null, null],
		});
	});

	it("rejects missing cards and invalid normalizers", () => {
		expect(() =>
			chooseConsensus(legal, root(1, 0, 0), root(1, 0), "H2"),
		).toThrow(/weight sum/);
		expect(() => chooseConsensus(legal, root(1, 0), root(1, 0), "D3")).toThrow(
			/not a scored legal card/,
		);
	});

	it("replays a shared card once even when the proposal matches the incumbent", () => {
		const choice = chooseConsensus(legal, root(1, 0), root(2, 0), "SA");
		const play = vi.fn((card) => card);
		expect(
			replayLeads([choice.incumbent, choice.standard, choice.consensus], play),
		).toEqual([{ card: "SA", result: "SA" }]);
		expect(play).toHaveBeenCalledTimes(1);
	});
});
