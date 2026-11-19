import { describe, expect, it, vi } from "vitest";
import { makeBoard, random } from "../../scripts/self-play/arena";
import { DdsSolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { boardStatus } from "../../src/bridge/engine";

function ending() {
	const board = makeBoard(7_510_000, 1, 40);
	const { actor } = boardStatus(board);
	if (!actor) throw new Error("missing actor");
	return playPosition(board, actor);
}

describe("finite-population search", () => {
	it("stops after ten legal layouts and retains the soft auction weights", async () => {
		const pos = ending();
		const solver = await DdsSolver.create();
		const uniform = analyzePlay(pos, solver, { random: random(7) });
		const weighted = analyzePlay(
			{
				...pos,
				hints: [
					{
						seat: "N",
						system: "hcp",
						meaning: { range: { min: 7, max: 7 }, shape: { kind: "none" } },
					},
				],
			},
			solver,
			{ random: random(7) },
		);
		const ck = (a: typeof weighted) =>
			a.evaluations.find(({ card }) => card === "CK")?.expectedTricks;
		expect(uniform.samples).toBe(10);
		expect(weighted.samples).toBe(10);
		expect(ck(uniform)).toBe(2);
		const w = (hcp: number) => Math.exp(-((7 - hcp) ** 2) / 18);
		const sum = 3 + 3 * w(5) + 3 * w(3) + w(1);
		expect(ck(weighted)).toBeCloseTo(
			(3 + 7 * w(5) + 7 * w(3) + 3 * w(1)) / sum,
			12,
		);
		expect(weighted.effectiveSamples).toBeCloseTo(
			sum ** 2 / (3 + 3 * w(5) ** 2 + 3 * w(3) ** 2 + w(1) ** 2),
			12,
		);
		expect(
			analyzePlay(pos, solver, { samples: 16, random: random(7) }).samples,
		).toBe(16);
		expect(
			analyzePlay(pos, solver, {
				samples: 16,
				exactLimit: 9,
				random: random(7),
			}).samples,
		).toBe(16);
		expect(
			analyzePlay(pos, solver, {
				samples: 16,
				exactLimit: 10,
				random: random(7),
			}).samples,
		).toBe(10);
	});

	it("returns a legal sampled prefix when the clock expires during enumeration", async () => {
		const pos = ending();
		const solver = await DdsSolver.create();
		let clock = 0;
		const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
		try {
			const first = new Set<string>();
			for (let seed = 1; seed <= 32; seed++) {
				const a = analyzePlay(
					pos,
					{
						solve(hands, trump, current) {
							first.add(hands.N.join(" "));
							clock += 100;
							return solver.solve(hands, trump, current);
						},
					},
					{ random: random(seed), timeMs: 1 },
				);
				expect(a.samples).toBe(1);
				expect(pos.legal).toContain(a.card);
			}
			expect(first.size).toBeGreaterThan(1);
		} finally {
			now.mockRestore();
		}
	});
});
