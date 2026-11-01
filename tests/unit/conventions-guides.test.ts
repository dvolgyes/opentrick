import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type PointRange,
	RANGES,
	type RangeKey,
} from "../../src/bridge/convention-rules";
import type { PointSystem } from "../../src/bridge/hand-points";
import { guideName } from "../../src/ui/bidding-guide";
import { GUIDE_ONLY, RULE_SYSTEMS } from "./conventions-fixtures";

/** "15–17" or "22 or more", with half points as "½", as the English guides write a range. */
function pointsNumber(value: number): string {
	return Number.isInteger(value) ? `${value}` : `${Math.floor(value)}½`;
}

function rangeText({ min, max }: PointRange): string {
	if (max === undefined) return `${pointsNumber(min)} or more`;
	return min === max
		? pointsNumber(min)
		: `${pointsNumber(min)}–${pointsNumber(max)}`;
}

/**
 * The section and the part of the guide line that states each range; {range} is the range text, {min} only its
 * minimum.
 */
const GUIDE_LINES: Readonly<Record<RangeKey, readonly [string, string]>> = {
	"open-pass": ["Opening bids", "- {range} points: [P]"],
	"open-weak-two": ["Opening bids", "- {range} points: weak two"],
	"open-preempt": ["Opening bids", "- {range} points: preempt"],
	"open-suit": ["Opening bids", "- {range} points: [1C] [1D] [1H] [1S]"],
	"open-1NT": ["Opening bids", "- {range} points: [1NT]"],
	"open-2NT": ["Opening bids", "- {range} points: [2NT]"],
	"open-2C": ["Opening bids", "- {range} points: [2C]"],
	"open-3NT": ["Opening bids", "- {range} points: [3NT]"],
	"suit-pass": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- {range} points: [P]",
	],
	"suit-low": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- {range} points: raise",
	],
	"suit-invite": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- {range} points: invitational",
	],
	"suit-two-level": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"A new suit at the two level needs {range} points.",
	],
	"suit-force": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- {range} points: game forcing",
	],
	"nt-weak": ["Responses to [1NT]", "- {range} points: [P], unless"],
	"nt-stayman": ["Responses to [1NT]", "- [2C] (Stayman): {range} points"],
	"nt-weak-stayman": [
		"Responses to [1NT]",
		"- Weak Stayman: [2C] also with {range} points",
	],
	"nt-2NT": ["Responses to [1NT]", "- [2NT]: {range} points"],
	"nt-3m": ["Responses to [1NT]", "- [3C] [3D]: {range} points"],
	"nt-3NT": ["Responses to [1NT]", "- [3NT]: {range} points"],
	"nt-3M": ["Responses to [1NT]", "- [3H] [3S]: {range} points"],
	"nt-slam-decline": [
		"Responses to [1NT]",
		"Opener bids four of the major with {range} points",
	],
	"nt-slam-accept": [
		"Responses to [1NT]",
		"with {range} points and three or more cards, [4NT]",
	],
	"nt-gerber": ["Responses to [1NT]", "- [4C] (Gerber): {range} points"],
	"nt-4NT": ["Responses to [1NT]", "- [4NT]: {range} points"],
	"nt-6NT": ["Responses to [1NT]", "- [6NT]: {range} points"],
	"nt-7NT": ["Responses to [1NT]", "[7NT]: {range} points"],
	"nt-invite-pass": ["Responses to [1NT]", "Opener passes with {range} points"],
	"nt-invite-accept": [
		"Responses to [1NT]",
		"and bids [3NT] with {range} points",
	],
	"nt-super-accept": [
		"Responses to [1NT]",
		"jumps to three of it with {range} points",
	],
	"transfer-pass": [
		"Responses to [1NT]",
		"- After the transfer, responder bids [P] with {range} points",
	],
	"transfer-invite": [
		"Responses to [1NT]",
		"[2NT] with exactly five cards and {range} points",
	],
	"transfer-game": [
		"Responses to [1NT]",
		"no singleton or void, and {range} points",
	],
	"nt-super-pass": [
		"Responses to [1NT]",
		"After the super-accept, responder passes with {range} points",
	],
	"nt-super-game": [
		"Responses to [1NT]",
		"bids four of the major with {range} points",
	],
	"stayman-invite": [
		"Responses to [1NT]",
		"four cards in the other major and {range} points",
	],
	"stayman-game": [
		"Responses to [1NT]",
		"[3H] or [3S] in the same way with {range} points",
	],
	"2nt-gerber": ["Responses to [2NT]", "- [4C] (Gerber): {range} points"],
	"2c-waiting": ["Responses to [2C]", "- [2D]: waiting, {range} points"],
	"2c-positive": ["Responses to [2C]", "- [2H] [2S] [3C] [3D]: {range} points"],
	"2c-2NT": ["Responses to [2C]", "- [2NT]: {range} points"],
	"2c-rebid-2NT": [
		"Opening bids",
		"With a balanced {range} points, rebid [2NT]",
	],
	"rebid-low": [
		"Opener's rebid",
		"- {range} points: [1NT] with a balanced hand",
	],
	"rebid-mid": ["Opener's rebid", "- {range} points: a jump raise"],
	"rebid-high": ["Opener's rebid", "- {range} points: a jump in a new suit"],
	"rebid-2NT": ["Opener's rebid", "[2NT] with a balanced {range} points."],
	"reraise-pass": ["Opener's rebid", "[P] with {range} points;"],
	"reraise-try": ["Opener's rebid", "[3H] with {range} points is a game try"],
	"reraise-game": ["Opener's rebid", "[4H] with {range} points."],
	"reraise-compete": [
		"Opener's rebid",
		"[3H] with {range} points and six or more cards",
	],
	"jump-raise-pass": ["Opener's rebid", "otherwise [P] with {range} points."],
	"jump-raise-game": ["Opener's rebid", "[4H] with {range} points (25"],
	"weak-2NT": ["Responses to a weak two", "- [2NT]: {range} points, asks"],
	"weak-2NT-minimum": [
		"Responses to a weak two",
		"opener bids three of the suit with {range} points",
	],
	"weak-2NT-maximum": [
		"Responses to a weak two",
		"With {range} points, opener bids three of the lowest side suit",
	],
	"suit-jacoby": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- [2NT] over [1H] or [1S] (Jacoby 2NT): {range} points",
	],
	"suit-3NT": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- [3NT] over [1H] or [1S]: {range} points",
	],
	"suit-game": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- Four of partner's major ([1H] – [4H]): {range} points",
	],
	"suit-2NT-minor": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"- [2NT] over [1C] or [1D]: {range} points",
	],
	"suit-3NT-minor": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"[3NT] over [1C] or [1D]: {range} points",
	],
	"suit-jump-shift": [
		"Responses to one of a suit: [1C], [1D], [1H], [1S]",
		"[1D] – [3C]): {range} points and a good five-card suit",
	],
	"jacoby-minimum": ["Opener's rebid", "Without one, [4H] with {range} points"],
	"jacoby-middle": ["Opener's rebid", ", [3NT] with {range} points"],
	"jacoby-maximum": ["Opener's rebid", "or [3H] with {range} points."],
	"overcall-one": [
		"Competitive bids",
		"- An overcall at the one level: {range} points",
	],
	"overcall-two": ["Competitive bids", "At the two level: {range} points."],
	"overcall-1NT": ["Competitive bids", "- [1NT] overcall: {range} points"],
	takeout: ["Competitive bids", "- [X] (takeout): {range} points"],
	"takeout-strong": ["Competitive bids", "or any hand with {range} points."],
	redouble: [
		"Competitive bids",
		"- [XX] after partner's opening is doubled: {range} points.",
	],
	"negative-one": [
		"Competitive bids",
		"{range} points after an overcall at the one level",
	],
	"negative-two": [
		"Competitive bids",
		"{range} points after an overcall at the two level",
	],
	"negative-five": ["Competitive bids", "or five cards with {range} points"],
	"contested-new-suit": [
		"Competitive bids",
		"without a jump: five or more cards and {range} points",
	],
	"negative-minimum": [
		"Competitive bids",
		"at the lowest level with {range} points",
	],
	"negative-jump": ["Competitive bids", "one level higher with {range} points"],
	"negative-cuebid": [
		"Competitive bids",
		"With {range} points, bid the opponents' suit",
	],
	"slam-small": ["Targets for the partnership", "- {min} points: small slam."],
	"slam-grand": ["Targets for the partnership", "- {min} points: grand slam."],
};

function guideText(system: PointSystem, locale: string): string {
	return readFileSync(
		new URL(
			`../../src/guides/${guideName(system)}_${locale}.txt`,
			import.meta.url,
		),
		"utf8",
	);
}

function sectionLines(text: string, section: string): string[] {
	const lines = text.split("\n");
	const start = lines.indexOf(`## ${section}`);
	if (start < 0) throw new Error(`no section "## ${section}"`);
	const end = lines.findIndex(
		(line, index) => index > start && line.startsWith("## "),
	);
	return lines.slice(start + 1, end < 0 ? undefined : end);
}

describe("convention rules agree with the guides", () => {
	it.each(RULE_SYSTEMS)(
		"states each %s range in its English guide line",
		(system) => {
			const text = guideText(system, "en");
			for (const [key, range] of Object.entries(RANGES[system]) as [
				RangeKey,
				PointRange,
			][]) {
				const [section, line] = GUIDE_LINES[key];
				const expected = line
					.replace("{range}", rangeText(range))
					.replace("{min}", pointsNumber(range.min));
				expect(
					sectionLines(text, section).some((candidate) =>
						candidate.includes(expected),
					),
					`${key} in convention-rules.ts does not match src/guides/${guideName(system)}_en.txt: no line "${expected}" in "## ${section}"`,
				).toBe(true);
			}
		},
	);

	it.each(
		[...RULE_SYSTEMS, ...GUIDE_ONLY].flatMap((system) =>
			["de", "hu", "no", "es", "pt", "fr", "it", "nl"].map(
				(locale) => [system, locale] as const,
			),
		),
	)(
		"gives the %s guide in %s the same numbers as the English guide",
		(system, locale) => {
			const numbers = (text: string) => (text.match(/\d+½?|½/g) ?? []).sort();
			expect(
				numbers(guideText(system, locale)),
				`src/guides/${guideName(system)}_${locale}.txt has other numbers than ${guideName(system)}_en.txt`,
			).toEqual(numbers(guideText(system, "en")));
		},
	);
});
