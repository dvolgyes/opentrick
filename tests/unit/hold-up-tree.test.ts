import { describe, expect, it, vi } from "vitest";
import { random } from "../../scripts/self-play/arena";
import { holdUpFork } from "../../scripts/self-play/hold-up";
import {
	holdUpDefenderCard,
	holdUpLeafTricks,
	holdUpUcb,
	searchHoldUp,
} from "../../scripts/self-play/hold-up-tree";
import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { playPosition } from "../../src/bot/play-position";
import {
	createHandSampler,
	type RemainingHands,
} from "../../src/bot/play-sampling";
import { createBoard } from "../../src/bridge/engine";
import { playableCards } from "../../src/bridge/rules";
import { SEATS, type Seat } from "../../src/protocol";
import { bidding, cards, DEAL, playing } from "./bridge-fixtures";

function fork(active = true, eastWest = false) {
	const north = cards("SA SK SQ SJ ST S9 S8 HA H3 H9 DA DK CA");
	const east = cards("S7 S6 S5 HJ HT HK H8 H7 DQ DJ DT CK CQ");
	const south = active
		? DEAL.S
		: cards("S4 S3 S2 H6 HQ H4 D9 D8 D7 D6 CJ CT C9");
	const west = cards(
		`${active ? "HQ" : "H5"} H2 D5 D4 D3 D2 C8 C7 C6 C5 C4 C3 C2`,
	);
	const deal = eastWest
		? { N: west, E: north, S: east, W: south }
		: { N: north, E: east, S: south, W: west };
	return playPosition(
		playing(
			bidding(createBoard(eastWest ? 2 : 1, deal), "3NT P P P"),
			"HJ H4 H2",
		),
		eastWest ? "E" : "N",
	);
}

function fixedSolver(tricks: number): DoubleDummySolver {
	return {
		solve: (hands, _, { leader }) => {
			const card = hands[leader][0];
			if (!card) throw new Error("empty DDS leader hand");
			return new Map([[card, tricks]]);
		},
	};
}

function withoutTime({
	elapsedMs,
	...result
}: ReturnType<typeof searchHoldUp>) {
	expect(elapsedMs).toBeGreaterThanOrEqual(0);
	return result;
}

describe("3NT hold-up information-set search", () => {
	it("reuses non-root decisions across sampled worlds and keeps a seeded cap", () => {
		const position = fork();
		const sample = createHandSampler(position.view);
		const rng = random(917);
		const worlds = new Set(
			Array.from({ length: 256 }, () => sample(rng).E.toSorted().join(" ")),
		);
		expect(worlds.size).toBe(256);
		const run = () =>
			withoutTime(
				searchHoldUp(position, fixedSolver(5), random(917), false, 5_000, 256),
			);
		const result = run();
		expect(result).toEqual(run());
		expect(result.iterations).toBe(256);
		expect(result.revisits).toBeGreaterThan(0);
		expect(result.nodes).toBeGreaterThan(1);
		expect(position.legal).toContain(result.card);
		expect(result.root.map(({ card }) => card)).toEqual(["H3", "H9", "HA"]);
		expect(result.root.reduce((total, { visits }) => total + visits, 0)).toBe(
			256,
		);
	});

	it("uses only public first visits and solves exactly once after two simulated tricks", () => {
		const position = fork();
		const firstVisits = (tricks: number, cap: number) => {
			const roots: string[] = [];
			const solver: DoubleDummySolver = {
				solve: (hands, strain, current) => {
					expect(strain).toBe("NT");
					expect(current.cards).toEqual([]);
					for (const seat of SEATS) expect(hands[seat]).toHaveLength(11);
					const played = position.legal.filter(
						(card) => !hands.N.includes(card),
					);
					roots.push(played.join("/"));
					return fixedSolver(tricks).solve(hands, strain, current);
				},
			};
			const result = searchHoldUp(
				{ ...position, legal: position.legal.toReversed() },
				solver,
				random(917),
				true,
				5_000,
				cap,
			);
			expect(result.root.map(({ visits }) => visits)).toEqual(
				[0, 1, 2].map((index) => Number(index < cap)),
			);
			return roots;
		};
		for (const [index, card] of ["H3", "H9", "HA"].entries()) {
			const cap = index + 1;
			const low = firstVisits(1, cap);
			expect(firstVisits(10, cap)).toEqual(low);
			expect(low).toHaveLength(cap);
			expect(low[index]?.split("/")).toContain(card);
		}
	});
	it("has no prior at an inactive fork and decays only the active duck's UCB bonus", () => {
		const position = fork(false);
		expect(holdUpFork(position)?.bias).toBe(false);
		expect(holdUpFork(fork())?.bias).toBe(true);
		const run = (biased: boolean) =>
			withoutTime(
				searchHoldUp(position, fixedSolver(5), random(923), biased, 5_000, 128),
			);
		expect(run(true)).toEqual(run(false));
		for (const visits of [1, 3, 15]) {
			const ucb = -2 + 6 * Math.sqrt(Math.log(20) / visits);
			expect(holdUpUcb(20, visits, -2, false)).toBeCloseTo(ucb);
			expect(holdUpUcb(20, visits, -2, true)).toBeCloseTo(
				ucb + 2 / (1 + visits),
			);
		}
	});

	it("does not start an iteration at the deadline, but always runs one", () => {
		let time = 0;
		const clock = vi.spyOn(performance, "now").mockImplementation(() => time);
		const base = fixedSolver(5);
		const solver: DoubleDummySolver = {
			solve: (...args) => {
				time += 2;
				return base.solve(...args);
			},
		};
		try {
			const position = fork();
			expect(
				searchHoldUp(position, solver, random(917), false, 0),
			).toMatchObject({ iterations: 1, elapsedMs: 2 });
			expect(
				searchHoldUp(position, solver, random(917), false, 4),
			).toMatchObject({ iterations: 2, elapsedMs: 4 });
		} finally {
			clock.mockRestore();
		}
	});

	it("uses the actor's cards and public trick for legal defender play", () => {
		const hand = cards("SA S9 S6 S2 HA HJ H8 H2 CT D2");
		const worlds = [
			{ N: cards("DA"), E: hand, S: cards("SK"), W: cards("H3") },
			{ N: cards("SK"), E: hand.toReversed(), S: cards("H3"), W: cards("DA") },
		];
		for (const world of worlds) {
			for (const [leader, trick, expected] of [
				["E", "", "S2"],
				["N", "HT", "HJ"],
				["W", "HK H3", "H2"],
				["N", "DK", "D2"],
				["N", "CK", "CT"],
			] as const) {
				const current = { leader, cards: trick ? cards(trick) : [] };
				const card = holdUpDefenderCard(world.E, current);
				expect(card).toBe(expected);
				expect(playableCards(current.cards, world.E)).toContain(card);
			}
		}
		expect(
			holdUpDefenderCard(cards("SQ SK S2 H4 H8"), { leader: "E", cards: [] }),
		).toBe("SK");
		expect(
			holdUpDefenderCard(cards("S7 S4 S3 H4 H8"), { leader: "E", cards: [] }),
		).toBe("S3");
		expect(
			holdUpDefenderCard(cards("H2 S2 C2"), { leader: "N", cards: ["DA"] }),
		).toBe("S2");
	});

	it("converts the DDS maximum from either leader partnership to declarer tricks", () => {
		const hands: RemainingHands = {
			N: cards("S2 SA"),
			E: cards("H2 HA"),
			S: cards("D2 DA"),
			W: cards("C2 CA"),
		};
		const solver: DoubleDummySolver = {
			solve: (remaining, strain, current) => {
				expect(remaining).toBe(hands);
				expect(strain).toBe("NT");
				expect(current.cards).toEqual([]);
				const [low, high] = remaining[current.leader];
				if (!low || !high) throw new Error("expected two DDS choices");
				return new Map([
					[low, 1],
					[high, 2],
				]);
			},
		};
		for (const [leader, declarer, expected] of [
			["N", "S", 9],
			["W", "N", 7],
			["E", "W", 9],
			["S", "E", 7],
		] as const satisfies readonly [Seat, Seat, number][]) {
			expect(holdUpLeafTricks(hands, leader, declarer, 7, solver)).toBe(
				expected,
			);
		}
	});

	it("reports declarer-side IMPs for either table direction", () => {
		for (const eastWest of [false, true]) {
			const position = fork(true, eastWest);
			const result = searchHoldUp(
				position,
				fixedSolver(5),
				random(917),
				false,
				5_000,
				1,
			);
			expect(result.root.find(({ visits }) => visits === 1)?.mean).toBeLessThan(
				0,
			);
		}
	});
});
