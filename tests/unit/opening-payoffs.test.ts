import { beforeAll, describe, expect, it } from "vitest";
import { playPair } from "../../scripts/self-play/arena";
import { competitiveDeal } from "../../scripts/self-play/competitive-deals";
import { boardSearch } from "../../scripts/self-play/defensive-search";
import { openingPayoffs } from "../../scripts/self-play/opening-payoffs";
import { partnerOpening } from "../../scripts/self-play/partner-opening";
import {
	partscoreDeal,
	suitOnly,
} from "../../scripts/self-play/partscore-leads";
import { DdsSolver } from "../../src/bot/dds-solver";
import { playPosition } from "../../src/bot/play-position";
import { type Card, suitOf } from "../../src/bridge/cards";
import { boardStatus } from "../../src/bridge/engine";

const samples = 2;
const seed = 71;
let solver: DdsSolver;

beforeAll(async () => {
	solver = await DdsSolver.create();
});

describe("opening lead payoffs", () => {
	it.each([
		{
			fixture: () => competitiveDeal(910028, 1),
			partnership: "NS",
			cards: ["D2", "S3", "S3", "SJ"],
			points: [-430, -490, -490, 100],
		},
		{
			fixture: () => partscoreDeal(910098, 2),
			partnership: "EW",
			cards: ["C3", "HJ", "HQ", "HQ"],
			points: [100, -140, -110, -110],
		},
	])("matches complete arena tables for $partnership defenders", (test) => {
		const { board, hints } = test.fixture();
		let calls = 0;
		const payoffs = openingPayoffs(
			{
				solve(...args) {
					calls++;
					return solver.solve(...args);
				},
			},
			board,
			hints,
			samples,
			seed,
		);
		const { incumbent, ranked, standard, high } = payoffs;
		const actions = [incumbent, ranked, standard, high];
		expect(actions.map(({ card }) => card)).toEqual(test.cards);
		expect(actions.map(({ points }) => points)).toEqual(test.points);
		expect(payoffs.tables).toBe(new Set(test.cards).size);
		expect(payoffs.calls).toBe(calls);
		expect(calls).toBeGreaterThan(0);

		const search = boardSearch(solver, samples, hints);
		const baseline = search.policy().play;
		const gaps = new Map<Card, number>();
		const control = search.policy((position, best, evaluations) => {
			if (position.view.plays.length !== 0) return undefined;
			const utility = evaluations[0]?.utility;
			for (const card of [
				best,
				suitOnly(position, best, evaluations),
				partnerOpening("standard", position, best),
				partnerOpening("high", position, best),
			]) {
				const option = evaluations.find((score) => score.card === card);
				if (utility !== undefined && option)
					gaps.set(option.card, utility - option.utility);
			}
			return undefined;
		}).play;
		const ns = test.partnership === "NS";
		const sign = ns ? 1 : -1;
		const scores = new Map<Card, number>();
		for (const action of actions) {
			if (!scores.has(action.card)) {
				const pair = playPair(
					board,
					control,
					(position, rng) =>
						position.view.plays.length === 0
							? action.card
							: baseline(position, rng),
					seed,
				);
				const [defense, reference] = ns
					? [pair.candidateNS, pair.candidateEW]
					: [pair.candidateEW, pair.candidateNS];
				expect(reference.cards[0]).toBe(incumbent.card);
				expect(defense.cards[0]).toBe(action.card);
				expect(defense.cards).toHaveLength(52);
				expect(incumbent.points).toBe(sign * reference.scoreNS);
				scores.set(
					action.card,
					pair.candidateNS.scoreNS - pair.candidateEW.scoreNS,
				);
			}
			expect(action.points - incumbent.points).toBe(scores.get(action.card));
			expect(action.gap).toBe(gaps.get(action.card));
		}
		if (ns) expect(high.gap).toBeGreaterThan(1);
	});

	it("plays only the incumbent when opening leader is void in partner's suit", () => {
		const { board, hints } = competitiveDeal(910038, 6);
		const status = boardStatus(board);
		if (status.phase !== "play") throw new Error("missing opening position");
		const position = playPosition(board, status.actor);
		expect(hints[0]?.meaning.shape).toMatchObject({ suit: "H" });
		expect(position.legal.some((card) => suitOf(card) === "H")).toBe(false);
		const { incumbent, ranked, standard, high, tables } = openingPayoffs(
			solver,
			board,
			hints,
			samples,
			seed,
		);
		const baseline = boardSearch(solver, samples, hints).policy().play;
		const { candidateNS } = playPair(board, baseline, baseline, seed);
		expect(incumbent).toEqual({
			card: candidateNS.cards[0],
			gap: 0,
			points: -candidateNS.scoreNS,
		});
		expect([ranked, standard, high]).toEqual(Array(3).fill(incumbent));
		expect(tables).toBe(1);
	});
});
