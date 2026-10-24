import type { Translate } from "../i18n";
import {
	type Card,
	type Rank,
	rankOf,
	SUITS,
	sortCards,
	suitOf,
} from "./cards";

/**
 * The hand evaluation scales a player can show. "none" shows no points. Sources for the honour values:
 * https://en.wikipedia.org/wiki/Honor_point_count (Work 4-3-2-1, Vienna 7-5-3-1, Reith 6-4-3-2-1, Four Aces 3-2-1-½).
 */
export const POINT_SYSTEMS = [
	"none",
	"hcp",
	"hcp-corrected",
	"vienna",
	"reith",
	"four-aces",
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

const SCALES: Readonly<Record<Exclude<PointSystem, "none">, HonourScale>> = {
	hcp: WORK,
	"hcp-corrected": WORK,
	vienna: { A: 7, K: 5, Q: 3, J: 1 },
	reith: { A: 6, K: 4, Q: 3, J: 2, T: 1 },
	"four-aces": { A: 3, K: 2, Q: 1, J: 0.5 },
};

/** The name in the points text, for example "corrected HCP: 16 (13 +3)". */
const SHORT_NAMES: Readonly<Record<Exclude<PointSystem, "none">, string>> = {
	hcp: "HCP",
	"hcp-corrected": "corrected HCP",
	vienna: "Vienna",
	reith: "Reith",
	"four-aces": "Four Aces",
};

/** Unsupported doubleton honours count 1 less; Jx is any jack with a lower card. */
const WEAK_DOUBLETONS: ReadonlySet<string> = new Set(["AJ", "KQ", "KJ", "QJ"]);
const GOOD_SUIT_HONOURS: ReadonlySet<Rank> = new Set(["A", "K", "Q", "J", "T"]);

/**
 * The shapes, longest suit first, that add distribution points: the three-suited hands and the two-suited hands
 * without a six-card suit. Balanced hands add none; hands with a six-card suit are valued by playing tricks, so they
 * add none either.
 */
const DISTRIBUTION_SHAPES: ReadonlySet<string> = new Set([
	"4441",
	"5440",
	"5422",
	"5431",
	"5521",
	"5530",
]);

/** The opener's distribution points of a short suit, by its length. Dummy's values need a known trump fit. */
const SHORTNESS_POINTS: readonly number[] = [3, 2, 1];

/** The honour value of one suit's ranks, highest first, for its length. */
function suitCorrection(ranks: readonly Rank[]): number {
	const [first, second] = ranks;
	if (ranks.length === 1)
		return first === "K" || first === "Q" || first === "J" ? -1 : 0;
	if (ranks.length === 2)
		return first === "J" || WEAK_DOUBLETONS.has(`${first}${second}`) ? -1 : 0;
	const honours = ranks.filter((rank) => GOOD_SUIT_HONOURS.has(rank)).length;
	return ranks.length >= 5 && honours >= 3 ? 1 : 0;
}

/**
 * The corrections of corrected HCP for a dealt hand of 13 cards: unsupported honours, a 4333 shape, all four aces, good
 * long suits, and the distribution points of unbalanced hands.
 */
function hcpCorrection(cards: readonly Card[]): number {
	const suits = SUITS.map((suit) =>
		sortCards(cards.filter((card) => suitOf(card) === suit)).map(rankOf),
	);
	const honours = suits.reduce((sum, ranks) => sum + suitCorrection(ranks), 0);
	const shape = suits
		.map((ranks) => ranks.length)
		.sort((a, b) => b - a)
		.join("");
	const aces = suits.every((ranks) => ranks.includes("A")) ? 1 : 0;
	const flat = shape === "4333" ? -1 : 0;
	const distribution = DISTRIBUTION_SHAPES.has(shape)
		? suits.reduce(
				(sum, ranks) => sum + (SHORTNESS_POINTS[ranks.length] ?? 0),
				0,
			)
		: 0;
	return honours + aces + flat + distribution;
}

/** The points of a hand on a scale; undefined for "none". */
export function countHandPoints(
	system: PointSystem,
	cards: readonly Card[],
): HandPoints | undefined {
	if (system === "none") return undefined;
	const scale = SCALES[system];
	const raw = cards.reduce(
		(sum, card) => sum + (scale[card[1] as Rank] ?? 0),
		0,
	);
	const correction = system === "hcp-corrected" ? hcpCorrection(cards) : 0;
	return { total: raw + correction, raw, correction };
}

/** "{name}: {total}", and " ({raw} {±correction})" only when the correction is not 0. */
export function formatHandPoints(
	system: Exclude<PointSystem, "none">,
	points: HandPoints,
	t: Translate,
): string {
	const text = `${t(SHORT_NAMES[system])}: ${points.total}`;
	if (points.correction === 0) return text;
	const sign = points.correction > 0 ? "+" : "-";
	return `${text} (${points.raw} ${sign}${Math.abs(points.correction)})`;
}
