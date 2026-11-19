import { expect, it } from "vitest";
import { mixedReturns } from "../../scripts/self-play/mixed-score";

it("preserves the strain mix, exact pairing and contract-level counts", () => {
	const imps = Array.from(
		{ length: 80 },
		(_, i) => [-2, 1, 3, 4, 9][i % 5] as number,
	);
	const report = mixedReturns(imps);
	expect(report).toMatchObject({
		total: 240,
		mean: 3,
		lower: 3,
		wins: 64,
		losses: 16,
		ties: 0,
		qualifies: true,
	});
	expect(report.strain.C).toBe(-32);
	expect(report.strain.NT).toBe(144);
	expect(report.group).toEqual({ low: 120, game: 90, small: 15, grand: 15 });
});

it("does not promote on a few large wins among identity ties", () => {
	const imps = Array.from({ length: 80 }, (_, i) => (i < 8 ? 20 : 0));
	expect(mixedReturns(imps)).toMatchObject({
		total: 160,
		wins: 8,
		losses: 0,
		ties: 72,
		signP: 1 / 256,
		qualifies: false,
	});
	expect(() => mixedReturns(imps.slice(1))).toThrow();
});
