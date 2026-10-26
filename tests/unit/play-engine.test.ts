import { describe, expect, it, vi } from "vitest";
import { DdsSolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { sampleHands } from "../../src/bot/play-sampling";
import { DECK } from "../../src/bridge/cards";
import { dealCards } from "../../src/bridge/deal";
import {
	applyAction,
	type Board,
	boardStatus,
	createBoard,
	legalActions,
} from "../../src/bridge/engine";
import { SEATS } from "../../src/protocol";
import { bidding, DEAL, playing } from "./bridge-fixtures";

function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

describe("single-dummy play engine", () => {
	it("uses the time budget beyond 96 samples and spends it on more worlds when solves are faster", () => {
		const position = playPosition(
			bidding(createBoard(1, DEAL), "1NT P P P"),
			"E",
		);
		let clock = 0;
		const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
		const run = (cost: number) =>
			analyzePlay(
				position,
				{
					solve: () => {
						clock += cost;
						return new Map(position.legal.map((card) => [card, 7]));
					},
				},
				{ timeMs: 500, random: random(917) },
			);
		try {
			const slower = run(4);
			const faster = run(1);
			expect(slower.samples).toBeGreaterThan(96);
			expect(faster.samples).toBeGreaterThan(slower.samples);
			expect(slower.elapsedMs).toBeGreaterThanOrEqual(500);
			expect(slower.elapsedMs).toBeLessThan(505);
			expect(faster.elapsedMs).toBeGreaterThanOrEqual(500);
			expect(faster.elapsedMs).toBeLessThan(502);
		} finally {
			now.mockRestore();
		}
	});
	it("matches exhaustive minimax on two-trick endings in all strains and partial tricks", async () => {
		const solver = await DdsSolver.create();
		const rng = random(461821);
		const finalTricks = (board: Board, ns: boolean): number => {
			const status = boardStatus(board);
			if (status.phase === "complete")
				return ns ? status.tricksNS : status.tricksEW;
			if (status.phase !== "play") throw new Error("not in play");
			const values = legalActions(board, status.actor).map((action) => {
				const result = applyAction(board, status.actor, action);
				if (!result.ok) throw new Error(result.reason);
				return finalTricks(result.board, ns);
			});
			return (
				(status.turn === "N" || status.turn === "S") === ns
					? Math.max
					: Math.min
			)(...values);
		};
		for (const strain of ["S", "H", "D", "C", "NT"] as const) {
			let board = bidding(
				createBoard(
					1,
					dealCards((bound) => Math.floor(rng() * bound)),
				),
				`1${strain} P P P`,
			);
			for (let ply = 0; ply < 48; ply++) {
				const status = boardStatus(board);
				if (status.phase !== "play") throw new Error("not in play");
				const actions = legalActions(board, status.actor);
				if (ply >= 44) {
					const ns = status.turn === "N" || status.turn === "S";
					const scores = solver.solve(status.remaining, strain, status.current);
					for (const action of actions) {
						if (action.type !== "play") throw new Error("not a card");
						const result = applyAction(board, status.actor, action);
						if (!result.ok) throw new Error(result.reason);
						expect(
							scores.get(action.card),
							`${strain} ${ply} ${action.card}`,
						).toBe(
							finalTricks(result.board, ns) -
								(ns ? status.tricksNS : status.tricksEW),
						);
					}
				}
				const action = actions[Math.floor(rng() * actions.length)];
				if (!action) throw new Error("no legal continuation");
				const result = applyAction(board, status.actor, action);
				if (!result.ok) throw new Error(result.reason);
				board = result.board;
			}
		}
	});
	it("protects a certain contract instead of gambling for an overtrick", () => {
		const board = playing(
			bidding(createBoard(1, DEAL), "3NT P P P"),
			"S7 S2 H2",
		);
		const position = {
			...playPosition(board, "N"),
			legal: ["SA", "SK"] as const,
		};
		let count = 0;
		const solver = {
			solve: () =>
				new Map([
					["SA" as const, 9],
					["SK" as const, count++ % 2 ? 8 : 10],
				]),
		};
		const result = analyzePlay(position, solver, {
			samples: 20,
			random: random(7),
		});
		expect(result.card).toBe("SA");
		expect(
			result.evaluations.find((item) => item.card === "SA")?.successProbability,
		).toBe(1);
	});
	it("sends no hidden cards or full deal to the search", () => {
		const board = bidding(createBoard(1, DEAL), "1NT P P P");
		const changed = {
			...board,
			deal: { ...board.deal, N: board.deal.S, S: board.deal.N },
		};
		expect(playPosition(board, "E")).toEqual(playPosition(changed, "E"));
		expect(playPosition(board, "E")).not.toHaveProperty("deal");
	});
	it("samples complete unseen hands without showing dummy before the lead", () => {
		const position = playPosition(
			bidding(createBoard(1, DEAL), "1NT P P P"),
			"E",
		);
		const rng = random(19);
		for (let i = 0; i < 100; i++) {
			const hands = sampleHands(position.view, rng);
			expect(hands.E).toEqual(position.view.own);
			expect(SEATS.map((seat) => hands[seat].length)).toEqual([13, 13, 13, 13]);
			expect(new Set(SEATS.flatMap((seat) => hands[seat])).size).toBe(52);
		}
	});
	it("respects exposed dummy, played cards, and a shown void", () => {
		const board = playing(
			bidding(createBoard(1, DEAL), "1NT P P P"),
			"S7 S2 H2 SA",
		);
		const position = playPosition(board, "N");
		const rng = random(33);
		for (let i = 0; i < 100; i++) {
			const hands = sampleHands(position.view, rng);
			expect(hands.S).toEqual(position.view.dummyCards);
			expect(hands.W.every((card) => !card.startsWith("S"))).toBe(true);
			expect(
				SEATS.flatMap((seat) => hands[seat]).some((card) =>
					board.cards.includes(card),
				),
			).toBe(false);
			expect(SEATS.flatMap((seat) => hands[seat])).toHaveLength(48);
		}
	});
	it("uses declarer's information while choosing a dummy card", () => {
		const board = playing(bidding(createBoard(1, DEAL), "1NT P P P"), "S7");
		const position = playPosition(board, "N");
		expect(position.turn).toBe("S");
		expect(position.view.own).toEqual(DEAL.N);
		expect(position.legal).toEqual(["S4", "S3", "S2"]);
		expect(() => playPosition(board, "S")).toThrow(/turn/);
	});
	it("solves a known ending and expands equivalent cards", async () => {
		const solver = await DdsSolver.create();
		const scores = solver.solve(
			{ N: ["SA", "SK"], E: ["SQ", "SJ"], S: ["S9", "S8"], W: ["S7", "S6"] },
			"NT",
			{ leader: "N", cards: [] },
		);
		expect(scores.get("SA")).toBe(2);
		expect(scores.get("SK")).toBe(2);
	});
	it("solves partial tricks, including a trump overruff", async () => {
		const solver = await DdsSolver.create();
		const scores = solver.solve({ N: [], E: [], S: [], W: ["H4"] }, "H", {
			leader: "N",
			cards: ["SA", "H2", "H3"],
		});
		expect(scores.get("H4")).toBe(1);
	});
	it("plays full random boards legally for declarer and defenders from every seat", async () => {
		const solver = await DdsSolver.create();
		for (const seed of [41, 93, 157]) {
			const rng = random(seed);
			let board = bidding(
				createBoard(
					1,
					dealCards((bound) => Math.floor(rng() * bound)),
				),
				"4H P P P",
			);
			for (let step = 0; step < 52; step++) {
				const status = boardStatus(board);
				if (status.phase !== "play") throw new Error("board ended early");
				const position = playPosition(board, status.actor);
				const result = analyzePlay(position, solver, {
					samples: 2,
					timeMs: 1000,
					random: rng,
				});
				expect(legalActions(board, status.actor)).toContainEqual({
					type: "play",
					card: result.card,
				});
				const applied = applyAction(board, status.actor, {
					type: "play",
					card: result.card,
				});
				if (!applied.ok) throw new Error(applied.reason);
				board = applied.board;
			}
			expect(boardStatus(board).phase).toBe("complete");
			expect(new Set(board.cards).size).toBe(DECK.length);
		}
	}, 60_000);
	it("rejects inconsistent card input before calling WebAssembly", async () => {
		const solver = await DdsSolver.create();
		expect(() =>
			solver.solve({ N: ["SA"], E: ["SA"], S: ["SQ"], W: ["SJ"] }, "NT", {
				leader: "N",
				cards: [],
			}),
		).toThrow(/duplicate/i);
	});
});
