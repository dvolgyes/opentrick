import { describe, expect, it, vi } from "vitest";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { type Card, RANKS, rankOf } from "../../src/bridge/cards";
import { createBoard } from "../../src/bridge/engine";
import * as rules from "../../src/bridge/rules";
import * as scoring from "../../src/bridge/scoring";
import { bidding, cards, DEAL, playing } from "./bridge-fixtures";

const deal = {
	...DEAL,
	N: cards("SQ SJ ST S9 S8 HA HK HQ H6 H5 DA DK CA"),
	E: cards("S6 S5 S3 HJ HT H9 H8 H7 DQ DJ DT CK CQ"),
	S: cards("SA SK S7 S4 S2 H4 D9 D8 D7 D6 CJ CT C9"),
};

describe("public rank classes in play analysis", () => {
	it.each([
		["completed", "S3 S7 H2 S8 S9 S6", 2],
		["beaten", "S6 S7 H2 S8 S9 S3", 2],
		["outstanding", "S6 S7 H2 S8 S9 S5", 3],
	] as const)(
		"scores a gap in the %s state correctly",
		(state, plays, classes) => {
			const position = playPosition(
				playing(bidding(createBoard(1, deal), "3NT P P P"), plays),
				"N",
			);
			expect(position.legal).toEqual(["SA", "SK", "S4", "S2"]);
			const distinct = state === "outstanding";
			const worlds = [
				new Map<Card, number>([
					["SA", 8],
					["SK", 8],
					["S4", 7],
					["S2", distinct ? 8 : 7],
				]),
				new Map<Card, number>([
					["SA", 9],
					["SK", 9],
					["S4", 8],
					["S2", distinct ? 7 : 8],
				]),
			];
			const score = (tricks: number) =>
				rules.scoreContract(position.contract, position.vulnerability, tricks);
			const reference = score(9);
			const expected = (count: number) =>
				position.legal
					.map((card) => {
						const final = worlds.slice(0, count).map((world) => {
							const tricks = world.get(card);
							if (tricks === undefined) throw new Error(`missing ${card}`);
							return tricks + position.declarerTricks;
						});
						const mean = (fn: (tricks: number) => number) =>
							final.reduce((sum, tricks) => sum + fn(tricks), 0) / count;
						return {
							card,
							expectedTricks: mean(
								(tricks) => tricks - position.declarerTricks,
							),
							expectedScore: mean(score),
							successProbability: mean((tricks) => Number(tricks >= 9)),
							utility: mean((tricks) =>
								scoring.scoreDifferenceToImps(score(tricks) - reference),
							),
						};
					})
					.sort(
						(a, b) =>
							b.utility - a.utility ||
							b.expectedScore - a.expectedScore ||
							RANKS.indexOf(rankOf(b.card)) - RANKS.indexOf(rankOf(a.card)),
					);
			const first = expected(1);
			const final = expected(2);
			const lookups = worlds.map((world) => vi.spyOn(world, "get"));
			const duplicate = vi.spyOn(rules, "scoreContract");
			const imps = vi.spyOn(scoring, "scoreDifferenceToImps");
			const clock = vi.spyOn(performance, "now").mockReturnValue(0);
			try {
				let count = 0;
				const onProgress = vi.fn();
				const result = analyzePlay(
					position,
					{
						solve: () => {
							const world = worlds[count++];
							if (!world) throw new Error("unexpected world");
							return world;
						},
					},
					{ samples: 2, random: () => 0.5, onProgress },
				);
				expect(result).toMatchObject({
					samples: 2,
					card: "SK",
					evaluations: final,
				});
				expect(onProgress).toHaveBeenCalledExactlyOnceWith(
					expect.objectContaining({ samples: 1, evaluations: first }),
				);
				for (const lookup of lookups)
					expect(lookup).toHaveBeenCalledTimes(classes);
				expect(duplicate).toHaveBeenCalledTimes(3);
				expect(imps).toHaveBeenCalledTimes(3);
			} finally {
				clock.mockRestore();
				imps.mockRestore();
				duplicate.mockRestore();
			}
		},
	);

	it("keeps equal-rank alternatives from different suits in their original order", () => {
		const position = playPosition(
			bidding(createBoard(1, DEAL), "1NT P P P"),
			"E",
		);
		const scores = new Map(position.legal.map((card) => [card, 7]));
		const lookup = vi.spyOn(scores, "get");
		const duplicate = vi.spyOn(rules, "scoreContract");
		const imps = vi.spyOn(scoring, "scoreDifferenceToImps");
		try {
			const result = analyzePlay(
				position,
				{ solve: () => scores },
				{ samples: 1, random: () => 0.5 },
			);
			expect(result.evaluations.map(({ card }) => card)).toEqual(
				cards("S5 S6 S7 H7 H8 H9 HT DT HJ DJ DQ CQ CK"),
			);
			expect(lookup).toHaveBeenCalledTimes(4);
			expect(duplicate).toHaveBeenCalledTimes(2);
			expect(imps).toHaveBeenCalledTimes(1);
		} finally {
			imps.mockRestore();
			duplicate.mockRestore();
		}
	});
});
