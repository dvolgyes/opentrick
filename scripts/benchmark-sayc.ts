import { readFile } from "node:fs/promises";
import { BidNetwork, LOCAL_BIDDERS } from "../src/bot/bid-network";
import { bidPosition } from "../src/bot/bid-position";
import { type Card, SUITS, suitOf } from "../src/bridge/cards";
import { dealCards } from "../src/bridge/deal";
import { createBoard } from "../src/bridge/engine";
import type { Call } from "../src/bridge/rules";
import { seatAfter } from "../src/protocol";

// Frozen before the run: 32 hands per case, seed 271828, no policy tuning.
// These are uncontested SAYC requirements from ACBL's sayc_book.pdf, not strength labels.
interface Hand {
	readonly points: number;
	readonly lengths: Readonly<Record<(typeof SUITS)[number], number>>;
	readonly balanced: boolean;
}
interface Case {
	readonly name: string;
	readonly calls: readonly Call[];
	readonly fits: (hand: Hand) => boolean;
	readonly expected: (hand: Hand) => readonly Call[];
}
const cases: readonly Case[] = [
	{
		name: "weak balanced pass",
		calls: [],
		fits: (h) => h.balanced && h.points <= 9,
		expected: () => ["P"],
	},
	{
		name: "15–17 balanced",
		calls: [],
		fits: (h) => h.balanced && h.points >= 15 && h.points <= 17,
		expected: () => ["1NT"],
	},
	{
		name: "20–21 balanced",
		calls: [],
		fits: (h) => h.balanced && h.points >= 20 && h.points <= 21,
		expected: () => ["2NT"],
	},
	{
		name: "22–24 balanced",
		calls: [],
		fits: (h) => h.balanced && h.points >= 22 && h.points <= 24,
		expected: () => ["2C"],
	},
	{
		name: "five-card major",
		calls: [],
		fits: (h) =>
			!h.balanced &&
			h.points >= 13 &&
			h.points <= 18 &&
			Math.max(h.lengths.H, h.lengths.S) >= 5 &&
			Math.max(h.lengths.C, h.lengths.D) <= Math.max(h.lengths.H, h.lengths.S),
		expected: (h) => [h.lengths.S >= h.lengths.H ? "1S" : "1H"],
	},
	{
		name: "minor opening",
		calls: [],
		fits: (h) =>
			!h.balanced &&
			h.points >= 13 &&
			h.points <= 18 &&
			h.lengths.H < 5 &&
			h.lengths.S < 5,
		expected: (h) => [
			h.lengths.D > h.lengths.C ||
			(h.lengths.D === h.lengths.C && h.lengths.D >= 4)
				? "1D"
				: "1C",
		],
	},
	{
		name: "heart transfer response",
		calls: ["1NT", "P"],
		fits: (h) => h.points <= 9 && h.lengths.H >= 5 && h.lengths.S < 4,
		expected: () => ["2D"],
	},
	{
		name: "spade transfer response",
		calls: ["1NT", "P"],
		fits: (h) => h.points <= 9 && h.lengths.S >= 5 && h.lengths.H < 4,
		expected: () => ["2H"],
	},
	{
		name: "accept hearts with doubleton",
		calls: ["1NT", "P", "2D", "P"],
		fits: (h) =>
			h.balanced && h.points >= 15 && h.points <= 17 && h.lengths.H === 2,
		expected: () => ["2H"],
	},
	{
		name: "accept spades with doubleton",
		calls: ["1NT", "P", "2H", "P"],
		fits: (h) =>
			h.balanced && h.points >= 15 && h.points <= 17 && h.lengths.S === 2,
		expected: () => ["2S"],
	},
	{
		name: "Stayman response",
		calls: ["1NT", "P"],
		fits: (h) =>
			h.points >= 8 &&
			h.points <= 9 &&
			h.lengths.H <= 4 &&
			h.lengths.S <= 4 &&
			Math.max(h.lengths.H, h.lengths.S) === 4,
		expected: () => ["2C"],
	},
	{
		name: "Stayman answer",
		calls: ["1NT", "P", "2C", "P"],
		fits: (h) => h.balanced && h.points >= 15 && h.points <= 17,
		expected: (h) => [
			h.lengths.H === 4 ? "2H" : h.lengths.S === 4 ? "2S" : "2D",
		],
	},
];
function describe(cards: readonly Card[]): Hand {
	const lengths = Object.fromEntries(
		SUITS.map((suit) => [
			suit,
			cards.filter((card) => suitOf(card) === suit).length,
		]),
	) as Hand["lengths"];
	return {
		points: cards.reduce(
			(sum, card) => sum + ({ A: 4, K: 3, Q: 2, J: 1 }[card[1] ?? ""] ?? 0),
			0,
		),
		lengths,
		balanced: ["4333", "4432", "5332"].includes(
			Object.values(lengths)
				.sort((a, b) => b - a)
				.join(""),
		),
	};
}
const networks = await Promise.all(
	LOCAL_BIDDERS.map(async (policy) => {
		const bytes = await readFile(`public/bot-models/brl-${policy}.f32`);
		return new BidNetwork(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			policy,
		);
	}),
);
let state = 271828;
const randomBelow = (bound: number) => {
	state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
	return Math.floor((state / 2 ** 32) * bound);
};
console.log(
	JSON.stringify({
		type: "protocol",
		seed: state,
		perCase: 32,
		cases: cases.map((c) => c.name),
		source: "https://web2.acbl.org/documentLibrary/play/sayc_book.pdf",
		scope:
			"agreement on specified SAYC situations, not complete system compliance or playing strength",
	}),
);
for (const scenario of cases) {
	const matches = [0, 0];
	let found = 0;
	for (let attempt = 0; found < 32 && attempt < 5_000_000; attempt++) {
		const deal = dealCards(randomBelow);
		const hand = describe(deal.N);
		if (!scenario.fits(hand)) continue;
		const board = {
			...createBoard(1, deal),
			dealer: seatAfter("N", (4 - (scenario.calls.length % 4)) % 4),
			calls: scenario.calls,
		};
		const position = bidPosition(board, "N");
		const expected = scenario.expected(hand);
		const calls = networks.map((network, i) => {
			const chosen = network.choose(position).call;
			if (expected.includes(chosen)) matches[i] = (matches[i] ?? 0) + 1;
			return chosen;
		});
		console.log(
			JSON.stringify({
				type: "position",
				case: scenario.name,
				position,
				expected,
				choices: Object.fromEntries(
					LOCAL_BIDDERS.map((policy, i) => [policy, calls[i]]),
				),
			}),
		);
		found++;
	}
	if (found !== 32) throw new Error(`insufficient hands for ${scenario.name}`);
	console.log(
		JSON.stringify({
			type: "summary",
			case: scenario.name,
			positions: found,
			matches: Object.fromEntries(
				LOCAL_BIDDERS.map((policy, i) => [policy, matches[i]]),
			),
		}),
	);
}
