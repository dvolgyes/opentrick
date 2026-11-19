import type { Translate } from "../i18n";
import {
	type Card,
	type Rank,
	rankOf,
	SUIT_SYMBOLS,
	SUITS,
	type Suit,
	sortCards,
	suitOf,
} from "./cards";

/**
 * The bidding systems a player can choose, named by their hand evaluation scale. "other" is a system that the bidding
 * guides do not describe; its points are HCP. Sources for the honour values:
 * https://en.wikipedia.org/wiki/Honor_point_count (Work 4-3-2-1, Vienna 7-5-3-1, Reith 6-4-3-2-1, Four Aces 3-2-1-½).
 */
export const POINT_SYSTEMS = [
	"hcp",
	"hcp-corrected",
	"vienna",
	"reith",
	"four-aces",
	"other",
] as const;
export type PointSystem = (typeof POINT_SYSTEMS)[number];

/** `total` is `raw` plus `correction`. */
export interface HandPoints {
	readonly total: number;
	readonly raw: number;
	readonly correction: number;
}

type HonourScale = Readonly<Partial<Record<Rank, number>>>;

const WORK: HonourScale = { A: 4, K: 3, Q: 2, J: 1 };

const SCALES: Readonly<Record<PointSystem, HonourScale>> = {
	hcp: WORK,
	"hcp-corrected": WORK,
	vienna: { A: 7, K: 5, Q: 3, J: 1 },
	reith: { A: 6, K: 4, Q: 3, J: 2, T: 1 },
	"four-aces": { A: 3, K: 2, Q: 1, J: 0.5 },
	other: WORK,
};

/** The name in the points text, for example "corrected HCP: 16 (13 +3)". */
const SHORT_NAMES: Readonly<Record<PointSystem, string>> = {
	hcp: "HCP",
	"hcp-corrected": "corrected HCP",
	vienna: "Vienna",
	reith: "Reith",
	"four-aces": "Four Aces",
	other: "HCP",
};

const A = 1;
const K = 2;
const Q = 4;
const J = 8;
const T = 16;
const HONOUR_BITS: Readonly<Partial<Record<Rank, number>>> = { A, K, Q, J, T };
/** Unsupported doubleton honours count 1 less; Jx is any jack with a lower card. */
const WEAK_DOUBLETONS: ReadonlySet<number> = new Set([
	A | J,
	K | Q,
	K | J,
	Q | J,
]);

/**
 * The shapes, longest suit first, that add distribution points: the three-suited hands and the two-suited hands
 * without a six-card suit. Balanced hands add none; hands with a six-card suit are valued by playing tricks, so they
 * add none either.
 */
const DISTRIBUTION_SHAPES = [
	"4441",
	"5440",
	"5422",
	"5431",
	"5521",
	"5530",
] as const;
const LENGTH_BITS = Array.from({ length: 6 }, (_, length) => 1 << (3 * length));
const shapeKey = (shape: string): number =>
	[...shape].reduce(
		(key, length) => key + (LENGTH_BITS[Number(length)] ?? 0),
		0,
	);
const FLAT_SHAPE = shapeKey("4333");
const DISTRIBUTION_BY_KEY = new Map<number, string>(
	DISTRIBUTION_SHAPES.map((shape) => [shapeKey(shape), shape]),
);

/** The opener's distribution points of a short suit, by its length. Dummy's values need a known trump fit. */
const SHORTNESS_POINTS: readonly number[] = [3, 2, 1];
const SHORTNESS_NAMES: readonly string[] = [
	"void {suit} ({shape})",
	"singleton {suit} ({shape})",
	"doubleton {suit} ({shape})",
];

type DescribeCorrection = (
	points: number,
	reason: string,
	values?: Readonly<Record<string, string>>,
) => void;

function suitCorrection(length: number, bits: number, honours: number): number {
	if (length === 1) return bits & (K | Q | J) ? -1 : 0;
	if (length === 2)
		return (bits & ~T) === J || WEAK_DOUBLETONS.has(bits) ? -1 : 0;
	return length >= 5 && honours >= 3 ? 1 : 0;
}

function suitText(cards: readonly Card[], suit: Suit): string {
	const ranks = sortCards(cards.filter((card) => suitOf(card) === suit)).map(
		(card) => {
			const rank = rankOf(card);
			return rank === "T" ? "10" : rank;
		},
	);
	return `${SUIT_SYMBOLS[suit]}${ranks.join("")}`;
}

/**
 * The corrections of corrected HCP for a dealt hand of 13 cards: unsupported honours, a 4333 shape, all four aces, good
 * long suits, and the distribution points of unbalanced hands.
 */
function hcpCorrection(
	cards: readonly Card[],
	describe?: DescribeCorrection,
): number {
	const lengths = { S: 0, H: 0, D: 0, C: 0 };
	const bits = { S: 0, H: 0, D: 0, C: 0 };
	const honours = { S: 0, H: 0, D: 0, C: 0 };
	for (const card of cards) {
		const suit = suitOf(card);
		lengths[suit]++;
		const bit = HONOUR_BITS[rankOf(card)];
		if (bit) {
			bits[suit] |= bit;
			honours[suit]++;
		}
	}
	let correction = 0;
	let aces = A;
	let shape = 0;
	for (const suit of SUITS) {
		const length = lengths[suit];
		aces &= bits[suit];
		shape += LENGTH_BITS[length] ?? 0;
		const points = suitCorrection(length, bits[suit], honours[suit]);
		correction += points;
		if (describe && points !== 0) {
			describe(
				points,
				length === 1
					? "singleton honour {cards}"
					: length === 2
						? "unsupported honours {cards}"
						: "good suit {cards}",
				{ cards: suitText(cards, suit) },
			);
		}
	}
	if (shape === FLAT_SHAPE) {
		correction--;
		describe?.(-1, "4333 shape");
	}
	if (aces) {
		correction++;
		describe?.(1, "all four aces");
	}
	const distribution = DISTRIBUTION_BY_KEY.get(shape);
	if (distribution !== undefined) {
		for (const suit of SUITS) {
			const length = lengths[suit];
			const points = SHORTNESS_POINTS[length];
			if (points === undefined) continue;
			correction += points;
			if (describe) {
				const reason = SHORTNESS_NAMES[length];
				if (reason !== undefined)
					describe(points, reason, {
						suit: SUIT_SYMBOLS[suit],
						shape: distribution,
					});
			}
		}
	}
	return correction;
}

function rawPoints(scale: HonourScale, cards: readonly Card[]): number {
	return cards.reduce((sum, card) => sum + (scale[rankOf(card)] ?? 0), 0);
}

/** The points of a hand on a scale. */
export function countHandPoints(
	system: PointSystem,
	cards: readonly Card[],
): HandPoints {
	const raw = rawPoints(SCALES[system], cards);
	const correction = system === "hcp-corrected" ? hcpCorrection(cards) : 0;
	return { total: raw + correction, raw, correction };
}

/**
 * How the points of a hand add up, one line each: the scale with the honour count, for example "A=4, K=3, Q=2, J=1: 13",
 * then each correction, for example "-1 singleton honour ♥K".
 */
export function explainHandPoints(
	system: PointSystem,
	cards: readonly Card[],
	t: Translate,
): readonly string[] {
	const scale = SCALES[system];
	const values = Object.entries(scale)
		.map(([rank, points]) => `${rank === "T" ? "10" : rank}=${points}`)
		.join(", ");
	const lines = [`${values}: ${rawPoints(scale, cards)}`];
	if (system === "hcp-corrected")
		hcpCorrection(cards, (points, reason, values) => {
			lines.push(
				`${points > 0 ? "+" : "-"}${Math.abs(points)} ${t(reason, values)}`,
			);
		});
	return lines;
}

/** "{name}: {total}", and " ({raw} {±correction})" only when the correction is not 0. */
export function formatHandPoints(
	system: PointSystem,
	points: HandPoints,
	t: Translate,
): string {
	const text = `${t(SHORT_NAMES[system])}: ${points.total}`;
	if (points.correction === 0) return text;
	const sign = points.correction > 0 ? "+" : "-";
	return `${text} (${points.raw} ${sign}${Math.abs(points.correction)})`;
}
