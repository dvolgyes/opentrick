import { describe, expect, it } from "vitest";
import { POINT_SYSTEMS } from "../../src/bridge/hand-points";
import type { Locale } from "../../src/i18n";
import { guideName, loadGuide, parseGuide } from "../../src/ui/bidding-guide";

const LOCALES = [
	"en",
	"de",
	"hu",
	"no",
	"es",
	"pt",
	"fr",
	"it",
	"nl",
] as const satisfies readonly Locale[];

const GUIDES = ["milton", "milton_corrected", "vienna", "reith", "four_aces"];

/** The bids of a guide, sorted, from every block. */
function bids(text: string): string[] {
	return parseGuide(text)
		.flatMap((block) => block.parts)
		.flatMap((part) => (part.kind === "bid" ? [part.call] : []))
		.sort();
}

describe("bidding guide text", () => {
	it("reads titles, sections, list items and paragraphs, with bids as their own parts", () => {
		expect(
			parseGuide(
				"# Guide\nCount A=4.\n\n## Openings\n- [1NT]: 15–17, or [P].\n- [X] and [XX] after [2C]\n",
			),
		).toEqual([
			{ kind: "title", parts: [{ kind: "text", text: "Guide" }] },
			{ kind: "paragraph", parts: [{ kind: "text", text: "Count A=4." }] },
			{ kind: "section", parts: [{ kind: "text", text: "Openings" }] },
			{
				kind: "item",
				parts: [
					{ kind: "bid", call: "1NT" },
					{ kind: "text", text: ": 15–17, or " },
					{ kind: "bid", call: "P" },
					{ kind: "text", text: "." },
				],
			},
			{
				kind: "item",
				parts: [
					{ kind: "bid", call: "X" },
					{ kind: "text", text: " and " },
					{ kind: "bid", call: "XX" },
					{ kind: "text", text: " after " },
					{ kind: "bid", call: "2C" },
				],
			},
		]);
	});

	it("keeps a bracket that is not a call as text", () => {
		expect(parseGuide("- [8C] [1N] [x]")).toEqual([
			{ kind: "item", parts: [{ kind: "text", text: "[8C] [1N] [x]" }] },
		]);
	});

	it("has no file for a language without a guide", async () => {
		expect(await loadGuide("hcp", "xx" as Locale)).toBeUndefined();
	});

	it("names one guide for each scale; an other system shows the HCP guide", () => {
		expect(POINT_SYSTEMS.map(guideName)).toEqual([
			"milton",
			"milton_corrected",
			"vienna",
			"reith",
			"four_aces",
			"milton",
		]);
	});
});

describe("bidding guide files", () => {
	it.each(GUIDES)(
		"has %s in each language, with the same bids as the English guide",
		async (guide) => {
			const system = POINT_SYSTEMS.find(
				(candidate) => guideName(candidate) === guide,
			);
			if (system === undefined) throw new Error(`no scale for ${guide}`);
			const english = (await loadGuide(system, "en")) ?? "";
			expect(bids(english).length).toBeGreaterThan(40);
			for (const locale of LOCALES) {
				const text = await loadGuide(system, locale);
				if (text === undefined) throw new Error(`no ${guide}_${locale}.txt`);
				// A translation that loses or adds a bracket is a broken bid.
				expect(text.match(/\[/g)?.length, locale).toBe(bids(text).length);
				expect(bids(text), locale).toEqual(bids(english));
				expect(
					parseGuide(text).map((block) => block.kind),
					locale,
				).toEqual(parseGuide(english).map((block) => block.kind));
				expect(parseGuide(text)[0]?.kind, locale).toBe("title");
			}
		},
	);

	it.each(GUIDES)(
		"starts each opening of %s with its minimum points, lowest first, up to a [3NT] opening",
		async (guide) => {
			const system = POINT_SYSTEMS.find(
				(candidate) => guideName(candidate) === guide,
			);
			if (system === undefined) throw new Error(`no scale for ${guide}`);
			for (const locale of LOCALES) {
				const blocks = parseGuide((await loadGuide(system, locale)) ?? "");
				const start = blocks.findIndex((block) => block.kind === "section");
				const end = blocks.findIndex(
					(block, index) => index > start && block.kind === "section",
				);
				const openings = blocks.slice(start + 1, end);
				const minimums = openings.map((block) => {
					const first = block.parts[0];
					const match =
						first?.kind === "text" ? /^(\d+)(½)?/.exec(first.text) : null;
					if (match === null)
						throw new Error(`${guide}_${locale}: an opening has no minimum`);
					return Number(match[1]) + (match[2] === undefined ? 0 : 0.5);
				});
				expect(minimums, locale).toEqual([...minimums].sort((a, b) => a - b));
				expect(
					openings.flatMap((block) =>
						block.parts.flatMap((part) =>
							part.kind === "bid" ? [part.call] : [],
						),
					),
					locale,
				).toContain("3NT");
			}
		},
	);
});
