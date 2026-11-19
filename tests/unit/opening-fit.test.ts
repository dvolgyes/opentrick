import { describe, expect, it } from "vitest";
import {
	compareLead,
	fitLead,
	pickLead,
} from "../../scripts/self-play/opening-fit";
import type { OpeningPayoffs } from "../../scripts/self-play/opening-payoffs";

function row(high: number, standard: number, gap: number): OpeningPayoffs {
	return {
		incumbent: { card: "S2", points: 50, gap: 0 },
		ranked: { card: "H2", points: 50, gap: 0 },
		standard: { card: "H4", points: standard, gap },
		high: { card: "HQ", points: high, gap },
		calls: 10,
		tables: 4,
	};
}

describe("fit a defensive lead on training scores", () => {
	it("learns the narrowest useful margin and rejects costly high leads outside it", () => {
		const deals = [row(150, -100, 0.24), row(170, 0, 0.22), row(-250, 0, 0.49)];
		const rule = fitLead(deals);
		expect(rule).toEqual({ rank: "high", margin: 0.25 });
		expect(pickLead(row(0, 0, 0.26), rule).card).toBe("S2");
		expect(pickLead(row(0, 0, 0.25), rule).card).toBe("HQ");
	});
	it("keeps the incumbent when interventions earn no IMPs", () => {
		expect(fitLead([row(40, 50, 0), row(-110, 50, 0.2)])).toBe(null);
	});
	it("compares policies in duplicate points before converting the difference to IMPs", () => {
		const deal = row(170, 140, 0.25);
		expect(
			compareLead(
				deal,
				{ rank: "high", margin: 1 },
				{ rank: "standard", margin: 1 },
			),
		).toBe(1);
		expect(
			compareLead(
				deal,
				{ rank: "standard", margin: 1 },
				{ rank: "high", margin: 1 },
			),
		).toBe(-1);
	});
});
