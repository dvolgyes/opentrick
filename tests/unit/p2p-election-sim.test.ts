import { describe, expect, it } from "vitest";
import { emptyStats, SEEDS } from "./p2p-election-sim-model";
import { simulate } from "./p2p-election-sim-world";

describe("election simulation", () => {
	it(`keeps the election invariants for ${SEEDS} seeds`, () => {
		const stats = emptyStats();
		const violations: string[] = [];
		for (let seed = 1; seed <= SEEDS; seed++) {
			violations.push(...simulate(seed, stats));
		}
		expect(violations).toEqual([]);
		// Every disturbance and every rule must occur, or the invariants could hold trivially.
		for (const [name, count] of Object.entries(stats)) {
			expect(count, name).toBeGreaterThan(0);
		}
	}, 300_000);
});
