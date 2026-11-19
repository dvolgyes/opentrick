import { describe, expect, it } from "vitest";
import {
	createHandSampler,
	type RemainingHands,
} from "../../src/bot/play-sampling";
import type { VisiblePlay } from "../../src/bridge/card-knowledge";
import { type Card, DECK, type Suit, suitOf } from "../../src/bridge/cards";
import type { Seat } from "../../src/protocol";

const OWN: Card[] = ["DK", "DQ"];
const DUMMY: Card[] = ["CK", "CQ"];
const UNSEEN: Card[] = ["SA", "HA", "HK", "HQ", "HJ"];
const EXCLUDED = new Map<Card, Seat>([["HA", "W"]]);

function endgame(): VisiblePlay {
	const remaining = new Set([...OWN, ...DUMMY, ...UNSEEN]);
	const played = DECK.filter((card) => !remaining.has(card));
	const nextCard = (suit: Suit): Card => {
		const [card] = played.splice(
			played.findIndex((value) => suitOf(value) === suit),
			1,
		);
		if (!card || suitOf(card) !== suit) throw new Error(`missing ${suit} card`);
		return card;
	};
	const seats = ["N", "E", "S", "W"] as const;
	const tricks: Suit[][] = [
		["S", "D", "S", "S"],
		["S", "C", "S", "S"],
		["S", "C", "S", "S"],
		["S", "H", "S", "S"],
		["H", "H", "H", "H"],
		["H", "H", "H", "H"],
		["D", "D", "D", "D"],
		["D", "D", "D", "D"],
		["C", "C", "C", "C"],
		["C", "C", "C", "C"],
		["D", "D", "C"],
	];
	return {
		seat: "N",
		declarer: "N",
		dummy: "S",
		trump: "NT",
		own: OWN,
		dummyCards: DUMMY,
		plays: tricks.flatMap((suits, index) =>
			seats.slice(0, suits.length).map((seat, offset) => ({
				seat,
				trick: index + 1,
				card: nextCard(suits[offset] as Suit),
			})),
		),
	};
}

function layoutKey(hands: RemainingHands): string {
	return [hands.E.toSorted().join(","), hands.W.toSorted().join(",")].join("/");
}

function exhaustiveReference(excluded?: ReadonlyMap<Card, Seat>): Set<string> {
	const keys = new Set<string>();
	for (let mask = 0; mask < 2 ** UNSEEN.length; mask++) {
		const hands: Record<Seat, Card[]> = { N: OWN, S: DUMMY, E: [], W: [] };
		UNSEEN.forEach((card, index) => {
			hands[mask & (1 << index) ? "E" : "W"].push(card);
		});
		if (hands.E.length !== 2 || hands.E.some((card) => suitOf(card) === "S"))
			continue;
		if (
			excluded &&
			[...excluded].some(([card, seat]) => hands[seat].includes(card))
		)
			continue;
		keys.add(layoutKey(hands));
	}
	return keys;
}

function firstTwo(layouts: Iterable<RemainingHands>): string {
	const prefix: string[] = [];
	for (const hands of layouts) {
		prefix.push(layoutKey(hands));
		if (prefix.length === 2) break;
	}
	return prefix.join(";");
}

describe("finite hidden-hand layouts", () => {
	it("matches exhaustive ownership assignments with uneven capacities, a void and exclusions", () => {
		const view = endgame();
		const saturated = new Map<Card, Seat>([
			["HA", "W"],
			["HK", "W"],
		]);
		for (const [excluded, count] of [
			[undefined, 6],
			[EXCLUDED, 3],
			[saturated, 1],
		] as const) {
			const expected = exhaustiveReference(excluded);
			expect(expected.size).toBe(count);
			const sampler = createHandSampler(view, excluded);
			const random = () => 0.5;
			expect(sampler.enumerate(expected.size - 1, random)).toBeUndefined();
			const layouts = Array.from(
				sampler.enumerate(expected.size, random) ?? [],
			);
			expect(layouts).toHaveLength(expected.size);
			for (const hands of layouts) {
				expect(hands.N).toEqual(OWN);
				expect(hands.S).toEqual(DUMMY);
			}
			expect(new Set(layouts.map(layoutKey))).toEqual(expected);
			const reordered = createHandSampler(
				{ ...view, own: OWN.toReversed(), dummyCards: DUMMY.toReversed() },
				excluded,
			);
			expect(
				Array.from(reordered.enumerate(expected.size, random) ?? [], layoutKey),
			).toEqual(layouts.map(layoutKey));
		}
	});

	it("makes every ordered two-layout prefix reachable once across equal-probability shuffle draws", () => {
		const sampler = createHandSampler(endgame(), EXCLUDED);
		const prefixes = new Set<string>();
		for (let a = 0; a < 3; a++) {
			for (let b = 0; b < 2; b++) {
				const values = [(a + 0.5) / 3, (b + 0.5) / 2];
				const layouts = sampler.enumerate(3, () => values.shift() ?? NaN);
				prefixes.add(firstTwo(layouts ?? []));
				expect(values).toHaveLength(0);
			}
		}
		const expected = [...exhaustiveReference(EXCLUDED)];
		expect(prefixes).toEqual(
			new Set(
				expected.flatMap((a) =>
					expected.filter((b) => b !== a).map((b) => `${a};${b}`),
				),
			),
		);
	});

	it("declines opening and large two-hand populations without consuming randomness", () => {
		const opening: VisiblePlay = {
			seat: "E",
			declarer: "N",
			dummy: "S",
			trump: "NT",
			own: DECK.slice(13, 26),
			dummyCards: undefined,
			plays: [],
		};
		const random = () => {
			throw new Error("unexpected random draw");
		};
		const openingSampler = createHandSampler(opening);
		expect(openingSampler.enumerate(256, random)).toBeUndefined();
		const sampled = openingSampler(() => 0.5);
		expect(new Set(Object.values(sampled).flat())).toEqual(new Set(DECK));
		const exposed = createHandSampler({
			...opening,
			seat: "N",
			own: DECK.slice(0, 13),
			dummyCards: DECK.slice(26, 39),
			plays: [{ trick: 1, seat: "E", card: "HA" }],
		});
		expect(exposed.enumerate(Infinity, random)).toBeUndefined();
		expect(createHandSampler(endgame()).enumerate(0, random)).toBeUndefined();
	});
});
