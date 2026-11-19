import { describe, expect, it } from "vitest";
import { random } from "../../scripts/self-play/arena";
import { cardingPolicy } from "../../scripts/self-play/carding";
import { policy } from "../../scripts/self-play/policy";
import type { DoubleDummySolver } from "../../src/bot/dds-solver";
import type { PlayPosition } from "../../src/bot/play-position";
import type { RemainingHands } from "../../src/bot/play-sampling";
import { type Card, DECK } from "../../src/bridge/cards";
import { type Seat, seatAfter } from "../../src/protocol";

const position: PlayPosition = {
	view: {
		seat: "N",
		declarer: "N",
		dummy: "S",
		trump: "NT",
		own: DECK.filter((card) => card.startsWith("C")),
		dummyCards: DECK.filter((card) => card.startsWith("D")),
		plays: [{ seat: "E", card: "H4", trick: 1 }],
	},
	turn: "S",
	current: { leader: "E", cards: ["H4"] },
	contract: { declarer: "N", strain: "NT", level: 3, doubling: "" },
	vulnerability: "none",
	declarerTricks: 0,
	legal: ["DA", "D2"],
	hints: [],
};

function capture(legal = position.legal) {
	const layouts: RemainingHands[] = [];
	const solver: DoubleDummySolver = {
		solve(hands) {
			layouts.push(hands);
			return new Map(legal.map((card) => [card, 0]));
		},
	};
	return { layouts, solver };
}

describe("benchmark carding inference", () => {
	it("reuses the incumbent draws when the H4 lead came from the random prefix", () => {
		const baseline = capture();
		const candidate = capture();
		const budget = { samples: 64 };
		const incumbent = policy("incumbent", baseline.solver, budget);
		const call = cardingPolicy(candidate.solver, budget, 1);
		expect(call(position, random(42))).toBe(incumbent(position, random(42)));
		expect(candidate.layouts).toEqual(baseline.layouts);
		expect(candidate.layouts.some(({ E }) => E.includes("H3"))).toBe(true);
	});

	it("keeps valid first draws and replaces invalid ones using the same RNG", () => {
		const budget = { samples: 1 };
		let kept = 0;
		let replaced = 0;
		const alternatives = new Set<string>();
		for (let seed = 0; seed < 32; seed++) {
			const baseline = capture();
			const incumbent = policy("incumbent", baseline.solver, budget);
			const baseRandom = random(seed);
			let baseCalls = 0;
			incumbent(position, () => {
				baseCalls++;
				return baseRandom();
			});
			const candidate = capture();
			const draw = random(seed);
			let calls = 0;
			const call = cardingPolicy(candidate.solver, budget, 0);
			const card = call(position, () => {
				calls++;
				return draw();
			});
			expect(card).toBe("D2");
			const [layout] = candidate.layouts;
			const [original] = baseline.layouts;
			if (!layout || !original) throw new Error("missing layout");
			expect(layout.W).toContain("H3");
			expect(layout.E).not.toContain("H3");
			expect(layout.E).toHaveLength(12);
			expect(layout.W).toHaveLength(13);
			const allCards = [
				...layout.N,
				...layout.E,
				...layout.S,
				...layout.W,
				"H4",
			];
			expect(new Set(allCards)).toEqual(new Set(DECK));
			if (original.E.includes("H3")) {
				expect(calls).toBeGreaterThan(baseCalls);
				alternatives.add([...layout.E].sort().join(" "));
				replaced++;
			} else {
				expect(layout).toEqual(original);
				expect(calls).toBe(baseCalls);
				kept++;
			}
		}
		expect(kept).toBeGreaterThan(0);
		expect(replaced).toBeGreaterThan(0);
		expect(alternatives.size).toBeGreaterThan(1);
	});

	it("rejects a trusted exclusion that contradicts a proven void", () => {
		const completed: PlayPosition = {
			...position,
			turn: "N",
			current: { leader: "E", cards: ["H4", "D3", "S2"] },
			legal: ["CA", "C2"],
			view: {
				...position.view,
				dummyCards: position.view.dummyCards?.filter((card) => card !== "D3"),
				plays: [
					...position.view.plays,
					{ seat: "S", card: "D3", trick: 1 },
					{ seat: "W", card: "S2", trick: 1 },
				],
			},
		};
		const { layouts, solver } = capture(completed.legal);
		expect(() =>
			cardingPolicy(solver, { samples: 3 }, 0)(completed, random(42)),
		).toThrow(/H3.*no possible owner/);
		expect(layouts).toHaveLength(0);
		expect(
			cardingPolicy(solver, { samples: 3 }, 1)(completed, random(42)),
		).toBe("C2");
		expect(layouts).toHaveLength(1);
		expect(layouts[0]?.E).toContain("H3");
	});

	it("solves a newly exact allocation once for either budget", () => {
		const tricks: [Seat, Card[]][] = [
			["E", ["C4", "C5", "C3", "CA"]],
			["N", ["CK", "C7", "C8", "C6"]],
			["N", ["CQ", "C9", "CT", "CJ"]],
			["N", ["SA", "S4", "S5", "S3"]],
			["N", ["SK", "S7", "S8", "S6"]],
			["N", ["SQ", "S9", "ST", "SJ"]],
			["N", ["H7", "HA", "H9", "H5"]],
			["E", ["D4", "D5", "D3", "DA"]],
			["N", ["DK", "D7", "D8", "D6"]],
			["N", ["DQ", "D9", "DT", "DJ"]],
			["N", ["S2", "H4", "D2", "C2"]],
		];
		const endgame: PlayPosition = {
			...position,
			turn: "N",
			current: { leader: "N", cards: [] },
			declarerTricks: 10,
			legal: ["H6", "H2"],
			view: {
				...position.view,
				own: ["H6", "H2"],
				dummyCards: ["HT", "H8"],
				plays: tricks.flatMap(([leader, cards], trick) =>
					cards.map((card, offset) => ({
						seat: seatAfter(leader, offset),
						card,
						trick: trick + 1,
					})),
				),
			},
		};
		const baseline = capture(endgame.legal);
		policy("incumbent", baseline.solver, { samples: 8 })(endgame, random(42));
		expect(baseline.layouts).toHaveLength(8);
		for (const budget of [{ samples: 8 }, { timeMs: 1 }]) {
			const { layouts, solver } = capture(endgame.legal);
			expect(cardingPolicy(solver, budget, 24)(endgame, random(42))).toBe("H2");
			expect(layouts).toHaveLength(1);
			expect(new Set(layouts[0]?.W)).toEqual(new Set(["HK", "H3"]));
			expect(new Set(layouts[0]?.E)).toEqual(new Set(["HQ", "HJ"]));
		}
	});

	it("rejects auction hints before sampling", () => {
		const { layouts, solver } = capture();
		const call = cardingPolicy(solver, { samples: 1 }, 1);
		expect(() =>
			call(
				{
					...position,
					hints: [
						{ seat: "N", system: "hcp", meaning: { shape: { kind: "none" } } },
					],
				},
				random(42),
			),
		).toThrow(/auction hints/);
		expect(layouts).toHaveLength(0);
	});
});
