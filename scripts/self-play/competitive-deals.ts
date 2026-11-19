import { createHash } from "node:crypto";
import { type PlayPosition, playPosition } from "../../src/bot/play-position";
import {
	type Card,
	DECK,
	isDeal,
	rankOf,
	SUITS,
	type Suit,
	suitOf,
} from "../../src/bridge/cards";
import { SHAPES } from "../../src/bridge/convention-rules";
import { randomBelowFrom, shuffle } from "../../src/bridge/deal";
import { applyAction, type Board, createBoard } from "../../src/bridge/engine";
import { boardSetup, type Call } from "../../src/bridge/rules";
import type { BidOrigin } from "../../src/game/bridge";
import { seatAfter } from "../../src/protocol";

const MAX_DRAWS = 500_000;
const HCP = {
	A: 4,
	K: 3,
	Q: 2,
	J: 1,
	T: 0,
	"9": 0,
	"8": 0,
	"7": 0,
	"6": 0,
	"5": 0,
	"4": 0,
	"3": 0,
	"2": 0,
} as const;

/** One xoshiro128** state per seed, initialized from a 128-bit SHA-256 prefix. */
function stream(seed: number): () => number {
	if (!Number.isSafeInteger(seed)) throw new Error(`invalid seed: ${seed}`);
	const state = createHash("sha256")
		.update(`competitive-deals:${seed}`)
		.digest();
	let a = state.readUInt32LE(0);
	let b = state.readUInt32LE(4);
	let c = state.readUInt32LE(8);
	let d = state.readUInt32LE(12);
	if ((a | b | c | d) === 0) d = 1;
	return () => {
		const product = Math.imul(b, 5);
		const result = Math.imul((product << 7) | (product >>> 25), 9);
		const shift = b << 9;
		c ^= a;
		d ^= b;
		b ^= c;
		a ^= d;
		c ^= shift;
		d = (d << 11) | (d >>> 21);
		return result >>> 0;
	};
}

function handSummary(cards: readonly Card[]) {
	const lengths: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
	let hcp = 0;
	for (const card of cards) {
		lengths[suitOf(card)]++;
		hcp += HCP[rankOf(card)];
	}
	return { lengths, hcp };
}

function balanced(lengths: Readonly<Record<Suit, number>>): boolean {
	let doubletons = 0;
	for (const suit of SUITS) {
		if (lengths[suit] < 2) return false;
		if (lengths[suit] === 2 && ++doubletons > 1) return false;
	}
	return true;
}

/** Opener: 12–14 HCP, longest suit a 5+ major (higher on ties). Odd boards: 15–18 balanced HCP
 * and a stopper overcall, 10–12 HCP opposite with neither a four-card major nor a six-card minor.
 * Even boards: 14–16 HCP and 5+ cards in a good other major, 10–11 HCP and 3+ support opposite.
 * Both lanes require 25+ combined HCP for game; opener's partner consequently holds at most 3 HCP. */
export function competitiveDeal(
	seed: number,
	number: number,
): { board: Board; hints: PlayPosition["hints"]; draws: number } {
	const { dealer } = boardSetup(number);
	const overcaller = seatAfter(dealer, 1);
	const leader = seatAfter(dealer, 2);
	const advancer = seatAfter(dealer, 3);
	const notrump = number % 2 === 1;
	const below = randomBelowFrom(stream(seed));
	for (let draws = 1; draws <= MAX_DRAWS; draws++) {
		const deck = shuffle(DECK, below);
		const openerCards = deck.slice(0, 13);
		const opener = handSummary(openerCards);
		if (opener.hcp < 12 || opener.hcp > 14) continue;
		const opened = opener.lengths.H > opener.lengths.S ? "H" : "S";
		const other = opened === "H" ? "S" : "H";
		const openedLength = opener.lengths[opened];
		if (
			openedLength < 5 ||
			opener.lengths.C > openedLength ||
			opener.lengths.D > openedLength
		)
			continue;

		const overcallerCards = deck.slice(13, 26);
		const opponent = handSummary(overcallerCards);
		if (notrump) {
			if (opponent.hcp < 15 || opponent.hcp > 18 || !balanced(opponent.lengths))
				continue;
			if (
				!SHAPES.stoppers.some(
					({ honour, length }) =>
						opponent.lengths[opened] >= length &&
						overcallerCards.some((card) => card === `${opened}${honour}`),
				)
			)
				continue;
		} else {
			if (
				opponent.hcp < 14 ||
				opponent.hcp > 16 ||
				opponent.lengths[other] < 5 ||
				SUITS.some((suit) => opponent.lengths[suit] > opponent.lengths[other])
			)
				continue;
			const ranks = overcallerCards
				.filter((card) => suitOf(card) === other)
				.map(rankOf);
			if (
				!SHAPES.goodSuit.some(
					({ honours, count }) =>
						ranks.filter((rank) => honours.includes(rank)).length >= count,
				)
			)
				continue;
		}

		const advancerCards = deck.slice(39);
		const response = handSummary(advancerCards);
		if (
			response.hcp < 10 ||
			response.hcp > (notrump ? 12 : 11) ||
			opponent.hcp + response.hcp < 25
		)
			continue;
		if (
			notrump
				? response.lengths.H >= 4 ||
					response.lengths.S >= 4 ||
					response.lengths.C >= 6 ||
					response.lengths.D >= 6
				: response.lengths[other] < 3
		)
			continue;

		const deal = {
			[dealer]: openerCards,
			[overcaller]: overcallerCards,
			[leader]: deck.slice(26, 39),
			[advancer]: advancerCards,
		};
		if (!isDeal(deal))
			throw new Error("competitive fixture did not allocate a complete deal");
		const calls: readonly Call[] = notrump
			? [`1${opened}`, "1NT", "P", "3NT", "P", "P", "P"]
			: [
					`1${opened}`,
					opened === "H" ? "1S" : "2H",
					"P",
					`3${other}`,
					"P",
					`4${other}`,
					"P",
					"P",
					"P",
				];
		let board = createBoard(number, deal);
		for (const [index, call] of calls.entries()) {
			const result = applyAction(board, seatAfter(dealer, index), {
				type: "call",
				call,
			});
			if (!result.ok)
				throw new Error(`illegal competitive deal auction: ${result.reason}`);
			board = result.board;
		}
		const origins: (BidOrigin | null)[] = calls.map((_, index) =>
			index === 0 ? { controller: "seat", system: "hcp" } : null,
		);
		return {
			board,
			hints: playPosition(board, leader, {}, origins).hints,
			draws,
		};
	}
	throw new Error(
		`no competitive deal for seed ${seed}, board ${number} after ${MAX_DRAWS} draws`,
	);
}
