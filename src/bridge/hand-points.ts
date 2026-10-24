import type { Translate } from "../i18n";
import type { Card, Rank } from "./cards";

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

/** The correction rules of corrected HCP are not defined yet, so the correction is 0 for every hand. */
function hcpCorrection(_cards: readonly Card[]): number {
	return 0;
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
