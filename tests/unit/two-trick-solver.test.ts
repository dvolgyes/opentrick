import assert from "node:assert/strict";
import { test } from "vitest";
import { random } from "../../scripts/self-play/arena";
import { DdsSolver } from "../../src/bot/dds-solver";
import type { RemainingHands } from "../../src/bot/play-sampling";
import { solveTwoTrickScores } from "../../src/bot/two-trick-solver";
import { type Card, DECK, RANKS, SUITS } from "../../src/bridge/cards";
import type { CurrentTrick } from "../../src/bridge/engine";
import type { Strain } from "../../src/bridge/rules";
import { SEATS, type Seat } from "../../src/protocol";

function at<T>(items: readonly T[], index: number): T {
	const item = items[index];
	assert.ok(item !== undefined);
	return item;
}

function legal(cards: readonly Card[], hand: readonly Card[]) {
	const following = hand.filter((card) => card[0] === cards[0]?.[0]);
	return following.length ? following : hand;
}

function replaceHand(hands: RemainingHands, seat: Seat, card: Card) {
	return { ...hands, [seat]: hands[seat].filter((held) => held !== card) };
}

function oracle(
	hands: RemainingHands,
	strain: Strain,
	current: CurrentTrick,
	coverage: Set<string>,
) {
	const first = SEATS.indexOf(current.leader);
	const root = current.cards.length;
	const side = (first + root) % 2;
	function value(
		remaining: RemainingHands,
		cards: readonly Card[],
		leader: number,
	): number {
		if (cards.length === 4) {
			let winner = 0;
			const rank = (card: Card) =>
				RANKS.indexOf(card[1] as (typeof RANKS)[number]);
			for (let i = 1; i < 4; i++) {
				const card = at(cards, i);
				const best = at(cards, winner);
				if (card[0] === strain && best[0] !== strain) coverage.add("ruff");
				if (
					card[0] === strain &&
					best[0] === strain &&
					rank(card) > rank(best) &&
					cards[0]?.[0] !== strain
				)
					coverage.add("undertrump");
				if (card[0] !== strain && card[0] !== cards[0]?.[0])
					coverage.add("discard");
				if (card[0] === best[0] ? rank(card) < rank(best) : card[0] === strain)
					winner = i;
			}
			const next = (leader + winner) % 4;
			return Number(next % 2 === side) + value(remaining, [], next);
		}
		const turn = (leader + cards.length) % 4;
		const seat = at(SEATS, turn);
		const children = legal(cards, remaining[seat]).map((card) =>
			value(replaceHand(remaining, seat, card), [...cards, card], leader),
		);
		if (!children.length) return 0;
		return turn % 2 === side ? Math.max(...children) : Math.min(...children);
	}
	const seat = at(SEATS, (first + root) % 4);
	return new Map(
		legal(current.cards, hands[seat]).map((card) => [
			card,
			value(replaceHand(hands, seat, card), [...current.cards, card], first),
		]),
	);
}

function orderedValues(scores: ReadonlyMap<Card, number>) {
	return [...scores].sort(([a], [b]) => a.localeCompare(b));
}

test("two tricks: complete per-card values match native DDS and independent minimax", async () => {
	const dds = await DdsSolver.create();
	const draw = random(12501200);
	const strains = [...SUITS, "NT"] as const;
	const seen = new Set<string>();
	const coverage = new Set<string>();
	const strata = new Map<
		string,
		{ checked: number; changedOrder: number; differentCardValues: number }
	>();
	let values = 0;
	let attempts = 0;
	while (seen.size < 8192) {
		assert.ok(++attempts < 100_000);
		const deck = [...DECK];
		for (let i = 0; i < 8; i++) {
			const j = i + Math.floor(draw() * (deck.length - i));
			[deck[i], deck[j]] = [at(deck, j), at(deck, i)];
		}
		const strain = at(strains, seen.size % 5);
		const offset = Math.floor(seen.size / 5) % 4;
		const first = Math.floor(seen.size / 20) % 4;
		const leader = at(SEATS, first);
		let hands: RemainingHands = {
			N: deck.slice(0, 2),
			E: deck.slice(2, 4),
			S: deck.slice(4, 6),
			W: deck.slice(6, 8),
		};
		const ranks = deck
			.slice(0, 8)
			.sort((a, b) => DECK.indexOf(a) - DECK.indexOf(b));
		const cards: Card[] = [];
		for (let i = 0; i < offset; i++) {
			const seat = at(SEATS, (first + i) % 4);
			const choices = legal(cards, hands[seat]);
			const card = at(choices, Math.floor(draw() * choices.length));
			cards.push(card);
			hands = replaceHand(hands, seat, card);
		}
		const encode = (card: Card) =>
			`${card[0]}${ranks.filter((item) => item[0] === card[0]).indexOf(card)}`;
		const key = JSON.stringify([
			strain,
			cards.map(encode),
			...SEATS.map((_, i) =>
				hands[at(SEATS, (first + i) % 4)].map(encode).sort(),
			),
		]);
		if (seen.has(key)) continue;
		seen.add(key);
		const current = { leader, cards };
		const expected = oracle(hands, strain, current, coverage);
		const native = dds.solve(hands, strain, current);
		const actual = solveTwoTrickScores(hands, strain, current);
		values += actual.size;
		assert.deepEqual(orderedValues(actual), orderedValues(expected), key);
		assert.deepEqual(orderedValues(actual), orderedValues(native), key);
		const reversed = {
			N: [...hands.N].reverse(),
			E: [...hands.E].reverse(),
			S: [...hands.S].reverse(),
			W: [...hands.W].reverse(),
		};
		assert.deepEqual(
			orderedValues(solveTwoTrickScores(reversed, strain, current)),
			orderedValues(expected),
			key,
		);
		const rotated = { N: hands.W, E: hands.N, S: hands.E, W: hands.S };
		const rotatedCurrent = { leader: at(SEATS, (first + 1) % 4), cards };
		assert.deepEqual(
			orderedValues(solveTwoTrickScores(rotated, strain, rotatedCurrent)),
			orderedValues(expected),
			key,
		);
		const label = `${strain}/${offset}`;
		const row = strata.get(label) ?? {
			checked: 0,
			changedOrder: 0,
			differentCardValues: 0,
		};
		row.checked++;
		if (JSON.stringify([...actual]) !== JSON.stringify([...native]))
			row.changedOrder++;
		if (new Set(actual.values()).size > 1) row.differentCardValues++;
		strata.set(label, row);
	}
	assert.deepEqual([...coverage].sort(), ["discard", "ruff", "undertrump"]);
	assert.ok([...strata.values()].some((row) => row.changedOrder !== 0));
	assert.ok([...strata.values()].every((row) => row.differentCardValues !== 0));
	console.log(JSON.stringify({ values, strata: Object.fromEntries(strata) }));
}, 120_000);
