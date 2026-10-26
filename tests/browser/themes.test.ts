import { afterEach, describe, expect, it } from "vitest";
import "../../src/ui/style.css";
import { THEMES, type Theme } from "../../src/ui/settings";
import { applyTheme } from "../../src/ui/theme";

/** The colour of a token in the current theme, as red, green and blue from 0 to 255. */
function token(name: string, within: HTMLElement = document.body): number[] {
	if (getComputedStyle(within).getPropertyValue(`--${name}`).trim() === "")
		throw new Error(`--${name} is not defined`);
	const probe = document.createElement("span");
	probe.style.color = `var(--${name})`;
	within.append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
	if (channels === null)
		throw new Error(`--${name} is not an opaque colour: ${color}`);
	return channels.slice(1).map(Number);
}

/** The relative luminance of WCAG 2. */
function luminance([red, green, blue]: number[]): number {
	const [r, g, b] = [red, green, blue].map((channel) => {
		const value = (channel ?? 0) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(text: string, surface: string): number {
	const [light, dark] = [
		luminance(token(text)),
		luminance(token(surface)),
	].sort((a, b) => b - a);
	return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The saturation of HSL, from 0 to 1. */
function saturation(color: number[]): number {
	const max = Math.max(...color) / 255;
	const min = Math.min(...color) / 255;
	const lightness = (max + min) / 2;
	return max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
}

/**
 * Text and its surface: 4.5 is the WCAG AA contrast of body text, 3 the contrast of large or bold text, such as the
 * suit symbols, the call colours and the labels on the felt.
 */
const PAIRS: readonly (readonly [string, string, number])[] = [
	["fg", "bg", 4.5],
	["muted", "bg", 4.5],
	["error", "bg", 4.5],
	["error", "sheet-bg", 4.5],
	["dialog-fg", "panel", 4.5],
	["red-suit", "panel", 3],
	["accent-fg", "accent", 4.5],
	["warn-fg", "warn-bg", 4.5],
	["alert-fg", "alert-bg", 4.5],
	["felt-fg", "felt", 4.5],
	["felt-fg", "tile-caption-bg", 4.5],
	["trump-fg", "felt", 3],
	["waiting-fg", "felt", 3],
	["turn-name", "felt-fg", 3],
	["card-fg", "card-bg", 4.5],
	["card-red", "card-bg", 3],
	["sheet-fg", "sheet-bg", 4.5],
	["sheet-fg", "sheet-cell", 4.5],
	["sheet-muted", "sheet-bg", 4.5],
	["sheet-red", "sheet-bg", 3],
	["sheet-red", "sheet-cell", 3],
	["sheet-call-green", "sheet-bg", 3],
	["sheet-call-green", "sheet-cell", 3],
	["sheet-call-orange", "sheet-bg", 3],
	["sheet-success", "sheet-bg", 3],
	["sheet-error", "sheet-bg", 4.5],
	["sheet-neutral", "sheet-bg", 4.5],
	["join-fg", "sheet-bg", 3],
	["gold-fg", "gold", 4.5],
	["gold-fg", "pill-bg", 4.5],
	["control-fg", "control-bg", 4.5],
	["red-suit", "control-bg", 3],
	["on-strong", "confirm-bg", 4.5],
	["on-strong", "reject-bg", 4.5],
];

/** Places elements that match this selector of descendant classes, such as ".bridge-table .auction", and returns the last. */
function place(selector: string): HTMLElement {
	let parent: HTMLElement = document.body;
	for (const part of selector.split(" ")) {
		const element = document.createElement("div");
		element.className = part.slice(1);
		parent.append(element);
		parent = element;
	}
	return parent;
}

/** The panels on the felt; they take the sheet colours, as the right panel does. */
const SHEETS = [
	".table-sidebar",
	".scoring",
	".bridge-table .auction",
	".bid-box",
	".approval",
	".mobile-round-status",
	".mobile-auction-bids",
	".mobile-auction-controls",
	".mobile-tricks",
] as const;

const rgb = (name: string) => `rgb(${token(name).join(", ")})`;

afterEach(() => {
	applyTheme(document.documentElement, "light");
	document.body.replaceChildren();
});

describe("themes", () => {
	it.each(THEMES)("%s keeps every text readable on its surface", (theme) => {
		applyTheme(document.documentElement, theme);
		const weak = PAIRS.filter(
			([text, surface, least]) => contrast(text, surface) < least,
		).map(
			([text, surface]) =>
				`${text} on ${surface}: ${contrast(text, surface).toFixed(2)}`,
		);
		expect(weak).toEqual([]);
	});

	it.each<Theme>(["solarized", "dark"])(
		"%s turns the page dark, the text bright, the felt a darker green and the cards off-white",
		(theme) => {
			const felt = luminance(token("felt"));
			applyTheme(document.documentElement, theme);
			expect(document.documentElement.dataset.theme).toBe(theme);
			expect(getComputedStyle(document.documentElement).colorScheme).toBe(
				"dark",
			);
			expect(luminance(token("bg"))).toBeLessThan(0.05);
			expect(
				luminance(
					getComputedStyle(document.body)
						.backgroundColor.match(/\d+/g)
						?.map(Number) ?? [],
				),
			).toBeLessThan(0.05);
			expect(luminance(token("fg"))).toBeGreaterThan(0.6);
			expect(luminance(token("sheet-bg"))).toBeLessThan(0.05);
			expect(luminance(token("sheet-cell"))).toBeLessThan(0.1);
			const [red = 0, green = 0, blue = 0] = token("felt");
			expect(luminance(token("felt"))).toBeLessThan(felt);
			expect(green).toBeGreaterThan(red);
			expect(green).toBeGreaterThanOrEqual(blue);
			expect(token("card-bg")).not.toEqual([255, 255, 255]);
			expect(luminance(token("card-bg"))).toBeGreaterThan(0.7);
		},
	);

	it("warm stays light with softer, warmer colours than light", () => {
		const felt = saturation(token("felt"));
		applyTheme(document.documentElement, "warm");
		expect(getComputedStyle(document.documentElement).colorScheme).toBe(
			"light",
		);
		const [red = 0, , blue = 0] = token("bg");
		expect(luminance(token("bg"))).toBeGreaterThan(0.8);
		expect(red).toBeGreaterThan(blue);
		expect(token("card-bg")).not.toEqual([255, 255, 255]);
		expect(saturation(token("felt"))).toBeLessThan(felt);
	});

	it.each(THEMES)(
		"%s colours the cards, the sheets and the dialogs with their own ink",
		(theme) => {
			applyTheme(document.documentElement, theme);
			const wrong: string[] = [];
			for (const card of [".face", ".played"]) {
				const shown = place(card);
				const style = getComputedStyle(shown);
				if (style.backgroundColor !== rgb("card-bg"))
					wrong.push(`${card} background ${style.backgroundColor}`);
				if (style.color !== rgb("card-fg"))
					wrong.push(`${card} text ${style.color}`);
				if (token("red-suit", shown).join() !== token("card-red").join())
					wrong.push(`${card} red suit`);
			}
			for (const sheet of SHEETS) {
				const shown = place(sheet);
				const style = getComputedStyle(shown);
				if (
					sheet !== ".table-sidebar" &&
					style.backgroundColor !== rgb("sheet-bg")
				)
					wrong.push(`${sheet} background ${style.backgroundColor}`);
				if (style.color !== rgb("sheet-fg"))
					wrong.push(`${sheet} text ${style.color}`);
				for (const [ink, sheetInk] of [
					["red-suit", "sheet-red"],
					["call-green", "sheet-call-green"],
					["call-orange", "sheet-call-orange"],
					["muted", "sheet-muted"],
				] as const)
					if (token(ink, shown).join() !== token(sheetInk).join())
						wrong.push(`${sheet} ${ink}`);
			}
			const bid = place(".bid-box .bid-calls");
			const call = document.createElement("button");
			bid.append(call);
			if (getComputedStyle(call).backgroundColor !== rgb("sheet-cell"))
				wrong.push("bid button background");
			const record = place(".mobile-round-status .mobile-round-record");
			record.dataset.ownSide = "true";
			record.dataset.result = "negative";
			const score = document.createElement("strong");
			record.append(score);
			if (getComputedStyle(score).color !== rgb("sheet-error"))
				wrong.push("lost points");
			expect(wrong).toEqual([]);
			const dialog = document.createElement("dialog");
			document.body.append(dialog);
			dialog.show();
			const shown = getComputedStyle(dialog);
			expect([shown.backgroundColor, shown.color]).toEqual([
				`rgb(${token("panel").join(", ")})`,
				`rgb(${token("dialog-fg").join(", ")})`,
			]);
		},
	);
});
