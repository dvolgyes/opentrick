import { describe, expect, it } from "vitest";
import { summarize } from "../../scripts/self-play/statistics";

describe("self-play statistics", () => {
	it("summarizes empty, single, tied, and mixed paired-deal IMPs", () => {
		expect(summarize([])).toEqual({
			deals: 0,
			wins: 0,
			losses: 0,
			ties: 0,
			total: 0,
			mean: null,
			lower95: null,
			signP: 1,
		});
		expect(summarize([4])).toMatchObject({
			deals: 1,
			wins: 1,
			losses: 0,
			ties: 0,
			total: 4,
			mean: 4,
			lower95: null,
			signP: 0.5,
		});
		expect(summarize([0, 0])).toMatchObject({
			deals: 2,
			wins: 0,
			losses: 0,
			ties: 2,
			total: 0,
			mean: 0,
			signP: 1,
		});
		expect(summarize([2, -1, 0])).toMatchObject({
			deals: 3,
			wins: 1,
			losses: 1,
			ties: 1,
			total: 1,
			mean: 1 / 3,
			signP: 0.75,
		});
	});

	it("uses deterministic percentile bootstrap and handles constant outcomes", () => {
		const observed = summarize([3, 3, 3]);
		expect(observed.lower95).toBe(3);
		expect(summarize([-2, -2]).lower95).toBe(-2);
		const mixed = [-24, 0, 24, 24];
		expect(summarize([0, 0, 0, 24]).lower95).toBe(0);
		expect(summarize(mixed).lower95).toBe(-12);
	});

	it("calculates exact one-sided sign-test answers", () => {
		expect(summarize([1, 1, -1]).signP).toBe(0.5);
		expect(summarize([1, 1, 1]).signP).toBe(0.125);
		expect(summarize(Array(1000).fill(1)).signP).toBe(2 ** -1000);
		const nearEven = [...Array(551).fill(1), ...Array(550).fill(-1)];
		expect(summarize(nearEven).signP).toBeCloseTo(0.5, 12);
	});

	it("rejects IMPs outside the bounded integer domain", () => {
		for (const invalid of [
			24.1,
			-25,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
		]) {
			expect(() => summarize([invalid])).toThrow(RangeError);
		}
	});
});
