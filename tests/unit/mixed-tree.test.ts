import { describe, expect, it, vi } from "vitest";
import { random } from "../../scripts/self-play/arena";
import { publicOrder } from "../../scripts/self-play/mixed-policy";
import { searchMixed } from "../../scripts/self-play/mixed-tree";
import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { type Card, DECK, type Deal, suitOf } from "../../src/bridge/cards";
import { createBoard } from "../../src/bridge/engine";
import { playableCards } from "../../src/bridge/rules";
import { SEATS, type Seat } from "../../src/protocol";
import { bidding, cards, DEAL, playing } from "./bridge-fixtures";

function isNS(seat: Seat): boolean {
	return seat === "N" || seat === "S";
}

function open() {
	return playPosition(bidding(createBoard(1, DEAL), "1NT P P P"), "E");
}

function swap(
	deal: Deal,
	first: Seat,
	firstCard: Card,
	second: Seat,
	secondCard: Card,
): Deal {
	return {
		...deal,
		[first]: deal[first].map((card) =>
			card === firstCard ? secondCard : card,
		),
		[second]: deal[second].map((card) =>
			card === secondCard ? firstCard : card,
		),
	};
}

function sampleWorlds(p: PlayPosition, worlds: readonly Deal[]): () => number {
	const visible = new Set([
		...p.view.own,
		...(p.view.dummyCards ?? []),
		...p.view.plays.map(({ card }) => card),
	]);
	const unseen = DECK.filter((card) => !visible.has(card));
	const hidden = SEATS.filter(
		(seat) =>
			seat !== p.view.seat && (!p.view.dummyCards || seat !== p.view.dummy),
	);
	const draws: number[] = [];
	for (const world of worlds) {
		const layout = hidden.flatMap((seat) =>
			world[seat].filter((card) => !visible.has(card)),
		);
		const shuffled = [...unseen];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const desired = layout[i];
			if (desired === undefined) throw new Error("incomplete test layout");
			const j = shuffled.indexOf(desired);
			if (j < 0 || j > i) throw new Error("invalid test layout");
			draws.push((j + 0.5) / (i + 1));
			shuffled[j] = shuffled[i] as Card;
			shuffled[i] = desired;
		}
	}
	let index = 0;
	return () => {
		const draw = draws[index++];
		if (draw === undefined)
			throw new Error("test sampled an unexpected layout");
		return draw;
	};
}

function contestedRoot(
	p: PlayPosition,
	target: Card,
	ordinary: Deal,
	lastWorld: Deal,
	checkLeaf?: (hands: Deal) => void,
) {
	const iterations = p.legal.length + 1;
	const rng = sampleWorlds(p, [
		...Array.from({ length: iterations }, () => ordinary),
		lastWorld,
	]);
	let calls = 0;
	const solver: DoubleDummySolver = {
		solve(hands, _, current) {
			const call = calls++;
			if (call === 0) {
				return new Map(p.legal.map((card) => [card, card === target ? 13 : 0]));
			}
			if (call === 1 || call === iterations) {
				expect(hands[p.turn]).not.toContain(target);
				checkLeaf?.(hands);
			}
			return new Map(
				hands[current.leader].map((card) => [
					card,
					isNS(current.leader) ? 0 : 11,
				]),
			);
		},
	};
	return searchMixed(p, solver, rng, false, 5_000, iterations);
}

function ruffEnding() {
	const deal: Record<Seat, Card[]> = {
		N: cards("S2 H3"),
		E: cards("H2 D2"),
		S: cards("H4 H5"),
		W: cards("HA C2"),
	};
	const tails = new Set(SEATS.flatMap((seat) => deal[seat]));
	const rest = DECK.filter((card) => !tails.has(card));
	const prefix: Card[] = [];
	for (let i = 0; i < rest.length; i += 4) {
		const four = rest.slice(i, i + 4);
		for (const [index, seat] of SEATS.entries()) {
			const card = four[index];
			if (!card) throw new Error("expected a full trick");
			deal[seat].push(card);
		}
		if (i === 0) prefix.push(...four.slice(1), ...four.slice(0, 1));
		else prefix.push(...four);
	}
	const board = playing(
		bidding(createBoard(1, deal), "1H X XX P P P"),
		prefix.join(" "),
	);
	return { board, deal };
}

describe("mixed-controller information-set search", () => {
	it("shares the opening decision but partitions later decisions by all exposed dummy cards", () => {
		const p = open();
		const changedDummy = swap(DEAL, "S", "D6", "W", "D3");
		const shared = contestedRoot(p, "S7", DEAL, DEAL);
		const exposed = contestedRoot(p, "S7", DEAL, changedDummy);
		expect(shared).toMatchObject({ card: "S7", rootCoverage: 13, revisits: 1 });
		expect(exposed).toMatchObject({
			card: "S7",
			rootCoverage: 13,
			revisits: 0,
		});
	});

	it("shares defensive decisions across private layouts and models the defender's partner", () => {
		const board = bidding(createBoard(1, DEAL), "1NT P P P");
		const p = playPosition(playing(board, "S7 S2"), "W");
		const first = swap(DEAL, "N", "SK", "E", "S6");
		const second = swap(first, "N", "DA", "E", "DQ");
		const result = contestedRoot(p, "H2", first, second, (hands) => {
			expect(hands.E).not.toContain("SK");
			expect(hands.E).toContain("S5");
		});
		expect(result).toMatchObject({ card: "H2", rootCoverage: 13, revisits: 1 });
	});

	it("uses a separate first sample and prioritizes its root estimates for both arms", () => {
		const p = open();
		const rng = random(612);
		const sample = createHandSampler(p.view);
		const seed = sample(rng);
		const firstSimulation = sample(rng);
		const first = p.legal.toSorted(publicOrder).at(-1);
		if (!first) throw new Error("expected a root card");
		for (const biased of [false, true]) {
			let calls = 0;
			const solver: DoubleDummySolver = {
				solve(hands, strain, current) {
					expect(strain).toBe("NT");
					if (++calls === 1) {
						expect(hands).toEqual(seed);
						expect(current).toEqual(p.current);
						return new Map(
							p.legal.map((card) => [card, card === first ? 9 : 7]),
						);
					}
					expect(current.cards).toEqual([]);
					for (const seat of SEATS) {
						expect(hands[seat]).toHaveLength(11);
						for (const card of hands[seat])
							expect(firstSimulation[seat]).toContain(card);
					}
					expect(hands.E).not.toContain(first);
					return new Map(hands[current.leader].map((card) => [card, 5]));
				},
			};
			expect(
				searchMixed(p, solver, random(612), biased, 5_000, 1),
			).toMatchObject({
				simulations: 1,
				rootCoverage: 1,
				rootLegal: 13,
				ddsCalls: 2,
			});
		}
	});

	it("includes seeding in the finite budget and does not favor a poor visited action", () => {
		const p = open();
		const [first, second] = p.legal.toSorted(publicOrder);
		let now = 0;
		const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
		const solver: DoubleDummySolver = {
			solve(hands, _, current) {
				now += 2;
				const tricks =
					hands.E.length === 13 ? 7 : isNS(current.leader) ? 11 : 0;
				return new Map(hands[current.leader].map((card) => [card, tricks]));
			},
		};
		try {
			expect(searchMixed(p, solver, random(654), true, 2)).toMatchObject({
				card: first,
				simulations: 0,
				rootCoverage: 0,
				ddsCalls: 1,
				elapsedMs: 2,
			});
			now = 0;
			expect(searchMixed(p, solver, random(654), true, 3)).toMatchObject({
				card: second,
				simulations: 1,
				rootCoverage: 1,
				ddsCalls: 2,
				elapsedMs: 4,
			});
		} finally {
			clock.mockRestore();
		}
	});

	it("signs equal-make IMP priors from either partnership for every declarer", () => {
		for (const number of [1, 2, 3, 4]) {
			const board = bidding(createBoard(number, DEAL), "1H X XX P P P");
			const declarer = SEATS[number - 1];
			const defender = SEATS[number % 4];
			if (!declarer || !defender) throw new Error("expected table seats");
			const defense = playPosition(board, defender);
			const lead = defense.legal.find((card) => suitOf(card) === "D");
			if (!lead) throw new Error("expected a diamond opening lead");
			const declaring = playPosition(playing(board, lead), declarer);
			for (const p of [defense, declaring]) {
				const [low, ...others] = p.legal.toSorted(publicOrder);
				const high = others.at(-1);
				expect(high).toBeDefined();
				const solver: DoubleDummySolver = {
					solve: () =>
						new Map(
							p.legal.map((card) => [
								card,
								card === high ? 8 : card === low ? 6 : 7,
							]),
						),
				};
				expect(searchMixed(p, solver, random(623), false, 0)).toMatchObject({
					card: high,
					ddsCalls: 1,
					simulations: 0,
				});
			}
		}
	});

	it("finishes a partial trick and the next one with exact terminal scoring", () => {
		const { board, deal } = ruffEnding();
		const p = playPosition(playing(board, "S2 H2"), "N");
		const solver: DoubleDummySolver = {
			solve(hands, strain, current) {
				expect(strain).toBe("H");
				expect(current).toEqual({ leader: "N", cards: ["S2", "H2"] });
				return new Map(
					playableCards(current.cards, hands.S).map((card) => [card, 2]),
				);
			},
		};
		expect(
			searchMixed(p, solver, sampleWorlds(p, [deal, deal]), false, 5_000, 1),
		).toMatchObject({
			card: "H5",
			simulations: 1,
			rootCoverage: 1,
			ddsCalls: 1,
		});
		const repeat = sampleWorlds(
			p,
			Array.from({ length: 9 }, () => deal),
		);
		expect(searchMixed(p, solver, repeat, false, 5_000, 8)).toMatchObject({
			card: "H4",
			simulations: 8,
			rootCoverage: 2,
			ddsCalls: 1,
		});
	});
});
