import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCampaign } from "../../scripts/self-play/cumulative-leads";
import type { OpeningPayoffs } from "../../scripts/self-play/opening-payoffs";

function payoff(high: number): OpeningPayoffs {
	const incumbent = { card: "S2", points: 50, gap: 0 } as const;
	return {
		incumbent,
		ranked: incumbent,
		standard: incumbent,
		high: { card: "HQ", points: high, gap: 0.24 },
		calls: 0,
		tables: 2,
	};
}

const measure = (epoch: number, index: number) =>
	payoff(index >= 64 ? -1000 : epoch === 0 ? 450 : 20);

const stateFile = (directory: string) => join(directory, "state.json");
const run = (
	directory: string,
	mode: "init" | "resume",
	count: number,
	score = measure,
	revision = "revision",
) => runCampaign(directory, mode, revision, count, score, () => {});

describe("cumulative opening lead campaign", () => {
	it("replays an interrupted epoch without counting it twice or fitting on holdouts", () => {
		const resumed = mkdtempSync(join(tmpdir(), "cumulative-resume-"));
		const clean = mkdtempSync(join(tmpdir(), "cumulative-clean-"));
		const fresh = mkdtempSync(join(tmpdir(), "cumulative-fresh-"));
		try {
			run(clean, "init", 2);
			expect(() =>
				run(resumed, "init", 2, (epoch, index) => {
					if (epoch === 1 && index === 70) throw new Error("interrupted");
					return measure(epoch, index);
				}),
			).toThrow("interrupted");
			writeFileSync(join(resumed, "state.tmp"), "partial write", {
				mode: 0o600,
			});
			const calls: number[][] = [];
			const resumedEpoch = run(resumed, "resume", 1, (epoch, index) => {
				calls.push([epoch, index]);
				return measure(epoch, index);
			});
			expect(calls).toEqual(Array.from({ length: 160 }, (_, i) => [1, i]));
			expect(readFileSync(stateFile(resumed), "utf8")).toBe(
				readFileSync(stateFile(clean), "utf8"),
			);
			expect(resumedEpoch.rules).toEqual({
				nt: { rank: "high", margin: 0.25 },
				suit: { rank: "high", margin: 0.25 },
			});
			expect(resumedEpoch.changed).toBe(false);
			expect(resumedEpoch.champion.ties).toBe(96);
			expect(run(fresh, "init", 1, (_, i) => measure(1, i)).rules).toEqual({
				nt: null,
				suit: null,
			});
		} finally {
			for (const directory of [resumed, clean, fresh])
				rmSync(directory, { recursive: true, force: true });
		}
	});

	it("can nominate an unchanged rule against both fixed controls", () => {
		const directory = mkdtempSync(join(tmpdir(), "cumulative-nominate-"));
		try {
			const result = run(directory, "init", 2, () => payoff(450));
			expect(result.changed).toBe(false);
			expect(result.champion.ties).toBe(96);
			expect(result.incumbent.wins).toBe(96);
			expect(result.standard.wins).toBe(96);
			expect(result.nominate).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("refuses unrelated, missing, revision-mismatched and corrupt state before scoring", () => {
		const directory = mkdtempSync(join(tmpdir(), "cumulative-corrupt-"));
		const noScore = () => {
			throw new Error("must not score");
		};
		try {
			expect(() => run(directory, "resume", 1, noScore)).toThrow("Missing");
			const unrelated = join(directory, "unrelated");
			writeFileSync(unrelated, "keep me");
			expect(() => run(directory, "init", 1, noScore)).toThrow("empty");
			expect(readFileSync(unrelated, "utf8")).toBe("keep me");
			rmSync(unrelated);
			run(directory, "init", 1);
			expect(() => run(directory, "resume", 1, noScore, "different")).toThrow(
				"revision",
			);
			const state = stateFile(directory);
			const broken = readFileSync(state, "utf8").replace(
				'"nextEpoch":1',
				'"nextEpoch":2',
			);
			writeFileSync(state, broken);
			expect(() => run(directory, "resume", 1, noScore)).toThrow("checksum");
			expect(readFileSync(state, "utf8")).toBe(broken);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
