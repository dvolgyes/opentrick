import assert from "node:assert/strict";
import { DdsSolver, type DoubleDummySolver } from "../../src/bot/dds-solver";
import { solveTwoTrickScores } from "../../src/bot/two-trick-solver";
import { type Card, RANKS, SUITS } from "../../src/bridge/cards";

function at<T>(items: readonly T[], i: number): T {
	const value = items[i];
	if (value === undefined) throw new Error(`No item at index ${i}`);
	return value;
}

function label(card: number): Card {
	return `${at(SUITS, card >> 4)}${at(RANKS, 12 - (card & 15))}`;
}

function winner(cards: readonly number[], lead: number, trump: number) {
	const suit = at(cards, lead) >> 4;
	const grade = (card: number) =>
		(card & 15) + 16 * (card >> 4 === trump ? 2 : card >> 4 === suit ? 1 : 0);
	let best = lead;
	for (let seat = 0; seat < 4; seat++)
		if (grade(at(cards, seat)) > grade(at(cards, best))) best = seat;
	return best;
}

type Pair = readonly [number, number];

function* allocations(
	cards: readonly number[],
	held: Pair[] = [],
): Generator<readonly Pair[]> {
	if (cards.length === 0) {
		yield held;
		return;
	}
	for (let i = 0; i < cards.length; i++)
		for (let j = i + 1; j < cards.length; j++) {
			held.push([at(cards, i), at(cards, j)]);
			yield* allocations(
				cards.filter((_, k) => k !== i && k !== j),
				held,
			);
			held.pop();
		}
}

function* shapes() {
	for (let s = 8; s >= 2; s--)
		for (let h = Math.min(s, 8 - s); h >= 0; h--)
			for (let d = Math.min(h, 8 - s - h); d >= 0; d--) {
				const c = 8 - s - h - d;
				if (c >= 0 && c <= d) yield [s, h, d, c];
			}
}

function verify(solve: DoubleDummySolver["solve"], stride: number) {
	const counts = {
		shapes: 0,
		roots: 0,
		prefixes: 0,
		checked: 0,
		cardValues: 0,
		nontrivial: 0,
	};
	function ending(held: readonly Pair[], trump: number) {
		counts.roots++;
		const first: number[] = [];
		const last: number[] = [];
		function search(seat: number): number {
			if (seat === 4) {
				const one = winner(first, 0, trump);
				const two = winner(last, one, trump);
				return Number(one % 2 === 0) + Number(two % 2 === 0);
			}
			const hand = at(held, seat);
			const led = seat === 0 ? -1 : at(first, 0) >> 4;
			const follow = hand.some((card) => card >> 4 === led);
			const ns = seat % 2 === 0;
			let value = ns ? 0 : 2;
			const expected = new Map<Card, number>();
			for (const pick of [0, 1] as const) {
				const card = hand[pick];
				if (follow && card >> 4 !== led) continue;
				first[seat] = card;
				last[seat] = hand[pick === 0 ? 1 : 0];
				const tricks = search(seat + 1);
				expected.set(label(card), ns ? tricks : 2 - tricks);
				value = ns ? Math.max(value, tricks) : Math.min(value, tricks);
			}
			counts.prefixes++;
			if (
				expected.size === 2 &&
				expected.get(label(hand[0])) !== expected.get(label(hand[1]))
			)
				counts.nontrivial++;
			if (counts.prefixes % stride === 0) {
				const remaining = (i: number) =>
					i < seat ? [label(at(last, i))] : at(held, i).map(label);
				const hands = {
					N: remaining(0),
					E: remaining(1),
					S: remaining(2),
					W: remaining(3),
				};
				const current = {
					leader: "N" as const,
					cards: first.slice(0, seat).map(label),
				};
				const result = solve(
					hands,
					trump < 0 ? "NT" : at(SUITS, trump),
					current,
				);
				assert.equal(result.size, expected.size);
				for (const [card, score] of expected) {
					if (result.get(card) !== score)
						throw new Error(
							JSON.stringify({
								hands,
								trump,
								current,
								card,
								expected: score,
								actual: result.get(card),
							}),
						);
					counts.cardValues++;
				}
				counts.checked++;
			}
			return value;
		}
		search(0);
	}
	for (const shape of shapes()) {
		counts.shapes++;
		const cards = shape.flatMap((n, s) =>
			Array.from({ length: n }, (_, r) => (s << 4) + r),
		);
		const trumps = shape.filter((n) => n > 0).length;
		for (const held of allocations(cards))
			for (let trump = -1; trump < trumps; trump++) ending(held, trump);
	}
	return counts;
}

const [mode, ...extra] = process.argv.slice(2);
if (extra.length || (mode !== "candidate" && mode !== "native-sample"))
	throw new Error("Usage: canonical-endings.ts candidate|native-sample");
const native = mode === "native-sample" ? await DdsSolver.create() : undefined;
console.log(
	JSON.stringify(
		native
			? verify(native.solve.bind(native), 257)
			: verify(solveTwoTrickScores, 1),
	),
);
