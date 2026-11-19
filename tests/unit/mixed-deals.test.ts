import { describe, expect, it } from "vitest";
import { random } from "../../scripts/self-play/arena";
import { mixedDeal } from "../../scripts/self-play/mixed-deals";
import { type Card, rankOf, SUITS, suitOf } from "../../src/bridge/cards";
import { dealCards, randomBelowFrom } from "../../src/bridge/deal";
import { boardStatus, parseBoard } from "../../src/bridge/engine";
import {
	boardSetup,
	type Level,
	type Strain,
	scoreContract,
} from "../../src/bridge/rules";
import { seatAfter } from "../../src/protocol";

const DEV_SEED = -172_903;

function hcp(hand: readonly Card[]): number {
	const honorPoints: Partial<Record<Card[1], number>> = {
		A: 4,
		K: 3,
		Q: 2,
		J: 1,
	};
	return hand.reduce(
		(points, card) => points + (honorPoints[rankOf(card)] ?? 0),
		0,
	);
}

function count(hand: readonly Card[], suit: Strain): number {
	return hand.filter((card) => suitOf(card) === suit).length;
}

const strains = ["C", "D", "H", "S", "NT"] as const;
const levelMatrix = [
	[1, 1, 1, 1, 1],
	[2, 2, 2, 2, 2],
	[2, 2, 2, 2, 2],
	[1, 1, 1, 1, 1],
	[3, 3, 3, 3, 2],
	[2, 2, 2, 2, 2],
	[2, 2, 2, 2, 2],
	[2, 2, 2, 2, 2],
	[5, 5, 4, 4, 3],
	[5, 5, 4, 4, 3],
	[5, 5, 4, 4, 3],
	[5, 5, 4, 4, 3],
	[5, 5, 4, 4, 3],
	[5, 5, 4, 4, 3],
	[6, 6, 6, 6, 6],
	[7, 7, 7, 7, 7],
] as const satisfies readonly (readonly Level[])[];

const cases = levelMatrix.flatMap((levels, profile) =>
	levels.map((level, column) => {
		const strain = strains[column];
		if (!strain) throw new Error(`missing test strain for column ${column}`);
		return { index: profile * 5 + column, strain, level };
	}),
);

describe("mixed study fixture", () => {
	it.each(cases)(
		"generates legal case $index with $level$strain",
		({ index, strain, level }) => {
			const board = mixedDeal(index, DEV_SEED);
			const setup = boardSetup(index + 1);
			const status = boardStatus(board);
			const doubling =
				index >= 35 && index < 40 ? "XX" : index >= 30 && index < 35 ? "X" : "";
			expect(board.number).toBe(index + 1);
			expect(board.dealer).toBe(setup.dealer);
			expect(board.vulnerability).toBe(setup.vulnerability);
			expect(board.cards).toEqual([]);
			expect(board.calls).toEqual([
				`${level}${strain}`,
				...(doubling === "XX" ? ["X", "XX"] : doubling === "X" ? ["X"] : []),
				"P",
				"P",
				"P",
			]);
			expect(parseBoard(board)).toEqual(board);
			expect(status.phase).toBe("play");
			expect(status.turn).toBe(seatAfter(setup.dealer, 1));
			expect(status.contract).toEqual({
				level,
				strain,
				declarer: setup.dealer,
				doubling,
			});
			if (status.phase !== "play") throw new Error("expected opening lead");
			const made = scoreContract(
				status.contract,
				board.vulnerability,
				level + 6,
			);
			expect(Math.sign(made)).toBe(index % 2 === 0 ? 1 : -1);
			const declarer = board.deal[setup.dealer];
			const partner = board.deal[seatAfter(setup.dealer, 2)];
			const points = hcp(declarer) + hcp(partner);
			const [min, max] =
				level === 7
					? [34, 37]
					: level === 6
						? [30, 34]
						: index < 40
							? [18, 24]
							: level === 5
								? [27, 32]
								: [25, 31];
			expect(points).toBeGreaterThanOrEqual(min);
			expect(points).toBeLessThanOrEqual(max);
			if (strain === "NT") {
				const shape = SUITS.map((suit) => count(declarer, suit))
					.sort((a, b) => b - a)
					.join("");
				expect(["4333", "4432", "5332"]).toContain(shape);
				expect(hcp(declarer)).toBeGreaterThanOrEqual(hcp(partner));
			} else {
				expect(
					count(declarer, strain) + count(partner, strain),
				).toBeGreaterThanOrEqual(8);
				expect(count(declarer, strain)).toBeGreaterThanOrEqual(
					count(partner, strain),
				);
			}
		},
	);

	it("returns the first accepted deal from the independent seed stream", () => {
		const rng = random(DEV_SEED);
		const below = randomBelowFrom(() => rng() * 2 ** 32);
		let expected: ReturnType<typeof dealCards> | undefined;
		for (let proposal = 0; proposal < 2_000_000; proposal++) {
			const deal = dealCards(below);
			const points = hcp(deal.N) + hcp(deal.S);
			const north = count(deal.N, "C");
			const south = count(deal.S, "C");
			if (
				points >= 18 &&
				points <= 24 &&
				north + south >= 8 &&
				north >= south
			) {
				expected = deal;
				break;
			}
		}
		expect(expected).toBeDefined();
		expect(mixedDeal(0, DEV_SEED).deal).toEqual(expected);
		expect(mixedDeal(0, DEV_SEED).deal).toEqual(expected);
	});

	it.each([-1, 80, 0.5, Number.NaN])("rejects invalid index %s", (index) => {
		expect(() => mixedDeal(index, DEV_SEED)).toThrow(/index/);
	});
});
