import { describe, expect, it } from "vitest";
import { scoreHoldUp } from "../../scripts/self-play/hold-up-score";

function arm(card: string | null, score = 400) {
	return {
		card,
		score,
		made: score > 0,
		declarerTricks: score < 0 ? 8 : 9 + (score - 400) / 30,
		elapsedMs: card === null ? 0 : 2,
		wallMs: card === null ? 0 : 3,
		iterations: card === null ? 0 : 4,
		nodes: card === null ? 0 : 5,
		revisits: card === null ? 0 : 6,
	};
}

function board(index: number, fork = true) {
	return {
		index,
		seed: 1_680_000_000 + index,
		distribution: index.toString(16).padStart(64, "0"),
		contract: "3NT",
		vulnerability: "none",
		fork,
		forkData: fork ? { ace: "SA", duck: "S2", bias: true, ply: 3 } : null,
		base: fork ? arm("S2", -50) : arm(null),
		take: fork ? arm("SA") : arm(null),
		plain: fork ? arm("S3", 430) : arm(null),
		biased: fork ? arm("S4", 460) : arm(null),
	};
}

function jsonl(rows: readonly unknown[]) {
	return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function boards(forkCount = 256) {
	return Array.from({ length: 256 }, (_, index) =>
		board(index, index < forkCount),
	);
}

describe("hold-up report", () => {
	it("uses the score difference once, in the preregistered contrast order", () => {
		const report = scoreHoldUp(jsonl(boards()));
		expect(report.policy).toBe("biased");
		expect(report.arms.base).toEqual({
			makes: 0,
			changedChoices: 0,
			elapsedMs: 512,
			wallMs: 768,
			iterations: 1024,
			nodes: 1280,
			revisits: 1536,
		});
		expect(report.arms.biased.makes).toBe(256);
		expect(report.arms.biased.changedChoices).toBe(256);
		expect(
			report.contrasts.map(({ candidate, control, mean }) => [
				candidate,
				control,
				mean,
			]),
		).toEqual([
			["take", "base", 10],
			["plain", "base", 10],
			["plain", "take", 1],
			["biased", "base", 11],
			["biased", "take", 2],
			["biased", "plain", 1],
		]);
		expect(report.contrasts[0]).toMatchObject({
			wins: 256,
			losses: 0,
			ties: 0,
			total: 2560,
			mean: 10,
			makeDifference: 256,
			changedChoices: 256,
			lower: 10,
			signP: 2 ** -256,
			passed: true,
		});
	});

	it("uses all 256 boards, including ties, and requires at least 12 non-ties", () => {
		const rows = boards(11).map((row) => ({
			...row,
			plain: row.take,
			biased: row.take,
		}));
		const report = scoreHoldUp(jsonl(rows));
		expect(report.policy).toBe("incumbent");
		expect(report.contrasts[0]).toMatchObject({
			wins: 11,
			losses: 0,
			ties: 245,
			total: 110,
			mean: 110 / 256,
			signP: 2 ** -11,
			lower: 40 / 256,
			passed: false,
		});
	});

	it("rejects positive mean when sign evidence is weak or the lower bound is too small", () => {
		const weakSign = boards().map((row, index) => {
			const take = arm("SA", index < 130 ? 490 : 400);
			return { ...row, base: arm("S2", 430), take, plain: take, biased: take };
		});
		const weakLower = boards(12).map((row) => {
			const take = row.fork ? arm("SA", 430) : row.base;
			return {
				...row,
				base: row.fork ? arm("S2") : row.base,
				take,
				plain: take,
				biased: take,
			};
		});
		expect(scoreHoldUp(jsonl(weakSign)).contrasts[0]).toMatchObject({
			wins: 130,
			losses: 126,
			mean: 134 / 256,
			passed: false,
		});
		expect(scoreHoldUp(jsonl(weakLower)).contrasts[0]).toMatchObject({
			wins: 12,
			losses: 0,
			signP: 2 ** -12,
			passed: false,
		});
	});

	it("requires all comparisons for the strongest policy", () => {
		const take = boards().map((row) => ({
			...row,
			plain: row.take,
			biased: row.take,
		}));
		expect(scoreHoldUp(jsonl(take)).policy).toBe("take");
		const plain = boards().map((row) => ({ ...row, biased: row.plain }));
		expect(scoreHoldUp(jsonl(plain)).policy).toBe("plain");
		const biasedLosesToTake = boards().map((row) => ({
			...row,
			take: arm("SA", 490),
		}));
		expect(scoreHoldUp(jsonl(biasedLosesToTake)).policy).toBe("take");
	});

	it("rejects incomplete, unordered, duplicate or invalid evidence", () => {
		const rows = boards();
		expect(() => scoreHoldUp(jsonl(rows.slice(1)))).toThrow(/256/);
		expect(() => scoreHoldUp(jsonl([board(1), ...rows.slice(1)]))).toThrow(
			/index/,
		);
		expect(() =>
			scoreHoldUp(jsonl(rows.with(1, { ...board(1), seed: 1_680_001_000 }))),
		).toThrow(/seed/);
		expect(() =>
			scoreHoldUp(
				jsonl(
					rows.with(1, { ...board(1), distribution: board(0).distribution }),
				),
			),
		).toThrow(/distribution/);
		expect(() =>
			scoreHoldUp(
				jsonl([
					{ ...board(0), base: { ...arm("S2"), score: null } },
					...rows.slice(1),
				]),
			),
		).toThrow(/score/);
	});

	it("rejects divergent outcomes on non-forks or when root choices agree", () => {
		const rows = boards(1);
		expect(() =>
			scoreHoldUp(
				jsonl(rows.with(1, { ...board(1, false), take: arm(null, 430) })),
			),
		).toThrow(/non-fork outcomes/);
		expect(() =>
			scoreHoldUp(jsonl(rows.with(0, { ...board(0), plain: arm("SA", 430) }))),
		).toThrow(/identical root choices/);
	});
});
