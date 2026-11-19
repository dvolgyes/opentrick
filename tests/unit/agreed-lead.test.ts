import { describe, expect, it } from "vitest";
import {
	agreedOpener,
	createDecision,
	openingFourth,
	openingSignal,
	proposeLayout,
	runTable,
	workCounts,
} from "../../scripts/self-play/agreed-lead";
import { makeBoard, random } from "../../scripts/self-play/arena";
import { DdsSolver } from "../../src/bot/dds-solver";
import { analyzePlay } from "../../src/bot/play-engine";
import { playPosition } from "../../src/bot/play-position";
import { createHandSampler } from "../../src/bot/play-sampling";
import { type Card, DECK } from "../../src/bridge/cards";
import { applyAction, type Board, boardStatus } from "../../src/bridge/engine";
import { seatAfter } from "../../src/protocol";

function positions(board: Board, lead?: Card) {
	const rng = random(219);
	return Array.from({ length: 52 }, (_, ply) => {
		const actor = boardStatus(board).actor;
		if (!actor) throw new Error("fixture ran out of actors");
		const position = playPosition(board, actor);
		const card =
			(ply === 0 ? lead : undefined) ??
			position.legal[Math.floor(rng() * position.legal.length)];
		if (!card) throw new Error("fixture ran out of legal cards");
		const result = applyAction(board, actor, { type: "play", card });
		if (!result.ok) throw new Error(result.reason);
		board = result.board;
		return position;
	});
}

const fixture = makeBoard(1736, 1, 0);

function smallWorlds(position: ReturnType<typeof playPosition>) {
	const { view } = position;
	const leader = view.plays[0]?.seat;
	const dummy = view.dummyCards;
	if (!leader || !dummy || !view.plays[0])
		throw new Error("not a receiver view");
	const other = position.contract.declarer;
	const seen = new Set([
		...view.own,
		...dummy,
		...view.plays.map(({ card }) => card),
	]);
	const pool = DECK.filter((card) => !seen.has(card));
	const remaining =
		13 - view.plays.filter(({ seat }) => seat === leader).length;
	const lead = view.plays[0].card;
	const higher = DECK.slice(0, DECK.indexOf(lead)).filter(
		(card) => card[0] === lead[0],
	);
	const worlds = new Map<string, boolean>();
	for (let mask = 0; mask < 2 ** pool.length; mask++) {
		const holdings = pool.filter((_, i) => (mask & (1 << i)) !== 0);
		if (holdings.length !== remaining) continue;
		const hands = {
			[leader]: holdings.slice(),
			[other]: pool.filter((_, i) => (mask & (1 << i)) === 0),
			[view.seat]: [...view.own],
			[view.dummy]: [...dummy],
		};
		for (const { seat, card } of view.plays) hands[seat]?.push(card);
		const matches =
			higher.filter((card) => hands[leader]?.includes(card)).length === 3;
		let legal = true;
		for (const [i, { seat, card }] of view.plays.entries()) {
			const holding = hands[seat];
			const suit = view.plays[i - (i % 4)]?.card[0];
			const index = holding?.indexOf(card) ?? -1;
			if (
				!holding ||
				index < 0 ||
				(card[0] !== suit && holding.some((c) => c[0] === suit))
			) {
				legal = false;
				break;
			}
			holding.splice(index, 1);
		}
		if (legal) worlds.set(holdings.join(","), matches);
	}
	return worlds;
}

describe("agreed 3NT opening lead study", () => {
	it("leads fourth-highest from a longest suit, resolving ties by SUITS order", () => {
		expect(
			openingFourth([
				"H2",
				"HJ",
				"HK",
				"HA",
				"S3",
				"S9",
				"SQ",
				"SA",
				"DJ",
				"D2",
				"C2",
				"CA",
				"CT",
			]),
		).toBe("S3");
		expect(
			openingFourth([
				"H2",
				"HJ",
				"HK",
				"HA",
				"HQ",
				"S3",
				"S9",
				"SQ",
				"SA",
				"DJ",
				"D2",
				"C2",
				"CA",
			]),
		).toBe("HJ");
	});

	it("gates the message by arm and receiver, and rejects prefixes and other strains", () => {
		const { actor } = boardStatus(fixture);
		if (!actor) throw new Error("fixture needs opening leader");
		const opener = agreedOpener(playPosition(fixture, actor));
		for (const position of positions(fixture, opener.card)) {
			expect(openingSignal(position)).toBeUndefined();
			const expected =
				position.turn === seatAfter(actor, 2) && position.view.plays.length > 0;
			expect(Boolean(openingSignal(position, opener))).toBe(expected);
		}
		for (const position of positions(fixture, "C2")) {
			expect(openingSignal(position, opener)).toBeUndefined();
		}
		const solver = {
			solve() {
				throw new Error("unexpected DDS");
			},
		};
		expect(() =>
			runTable(makeBoard(2, 1, 4), "D", solver, 0, workCounts()),
		).toThrow(/full 3NT/);
		expect(() =>
			runTable(makeBoard(2, 2, 0), "D", solver, 0, workCounts()),
		).toThrow(/full 3NT/);
		let actual: Record<string, readonly Card[]> | undefined;
		expect(() =>
			runTable(
				fixture,
				"S",
				{
					solve(hands, _, current) {
						actual = hands;
						expect(current.cards[0]).toBe(opener.card);
						throw new Error("observed first search after opening lead");
					},
				},
				0,
				workCounts(),
			),
		).toThrow(/observed first search/);
		expect(actual).toBeDefined();
	});

	it("samples exactly the independently enumerated small conditional support", () => {
		for (let seed = 1736; seed < 1770; seed++) {
			const board = makeBoard(seed, 1, 0);
			const actor = boardStatus(board).actor;
			if (!actor) throw new Error("fixture needs opening leader");
			const opener = agreedOpener(playPosition(board, actor));
			const lead = opener.card;
			for (const position of positions(board, lead).slice(40)) {
				const signal = openingSignal(position, opener);
				if (
					!signal ||
					!position.view.plays.some(
						({ seat, card }) =>
							seat === actor &&
							card[0] === lead[0] &&
							DECK.indexOf(card) < DECK.indexOf(lead),
					)
				)
					continue;
				const worlds = smallWorlds(position);
				const support = [...worlds]
					.filter(([, matches]) => matches)
					.map(([key]) => key)
					.sort();
				if (support.length < 2 || support.length === worlds.size) continue;
				const sampler = createHandSampler(position.view);
				const rng = random(144);
				const counts = workCounts();
				const observed = new Set<string>();
				for (let i = 0; i < 256; i++) {
					const world = proposeLayout(sampler, rng, signal, counts);
					observed.add(
						DECK.filter((card) => world[actor].includes(card)).join(","),
					);
				}
				expect([...observed].sort()).toEqual(support);
				expect(counts.proposals).toBeGreaterThan(256);
				const impossible = workCounts();
				const rejected = [...worlds].find(([, match]) => !match)?.[0];
				const invalid = {
					N: [],
					E: [],
					S: [],
					W: [],
					[actor]: rejected?.split(",") as Card[],
				};
				expect(() =>
					proposeLayout(() => invalid, rng, signal, impossible),
				).toThrow(/4096/);
				expect(impossible.proposals).toBe(4096);
				return;
			}
		}
		throw new Error("no informative small-world fixture");
	});

	it("matches incumbent DDS choices on development positions with the same streams", async () => {
		const solver = await DdsSolver.create();
		for (const [seed, number] of [
			[1736, 1],
			[1737, 6],
			[1738, 11],
		] as const) {
			const path = positions(makeBoard(seed, number, 0));
			for (const ply of [0, 2, 13, 23, 32, 44, 49, 51]) {
				const position = path[ply];
				if (!position) throw new Error("missing development ply");
				const expected = analyzePlay(position, solver, {
					random: random(ply),
					samples: 3,
					timeMs: 60_000,
				}).card;
				const counts = workCounts();
				const decision = createDecision(solver, counts);
				expect(decision(position, random(ply))).toBe(expected);
				expect(counts.solves).toBe(position.legal.length > 1 ? 3 : 0);
			}
		}
	});
});
