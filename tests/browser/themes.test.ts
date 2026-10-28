import { afterEach, describe, expect, it } from "vitest";
import "../../src/ui/style.css";
import { type Scheme, THEMES, type Theme } from "../../src/ui/settings";
import { applyTheme, watchTheme } from "../../src/ui/theme";

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
	["bid-nt", "sheet-bg", 3],
	["bid-nt", "sheet-cell", 3],
	["bid-nt", "bg", 3],
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

/** Each theme in its light and its dark scheme. */
const PALETTES = THEMES.flatMap((theme) =>
	(["light", "dark"] as const).map((scheme) => [theme, scheme] as const),
);

/** The system preference of a test: a media query whose answer the test changes. */
class SystemScheme extends EventTarget {
	matches = false;
	readonly queries: string[] = [];
	matchMedia(query: string) {
		this.queries.push(query);
		return this;
	}
	change(dark: boolean): void {
		this.matches = dark;
		this.dispatchEvent(new Event("change"));
	}
}

afterEach(() => {
	applyTheme(document.documentElement, "normal", "light", false);
	document.body.replaceChildren();
});

describe("themes", () => {
	it.each(PALETTES)(
		"%s %s keeps felt labels readable against the actual baize",
		async (theme, scheme) => {
			applyTheme(document.documentElement, theme, scheme, false);
			const felt = place(".felt");
			const imageUrl = /^url\("(.*)"\)$/.exec(
				getComputedStyle(felt).backgroundImage,
			)?.[1];
			if (!imageUrl) throw new Error("missing baize image");
			const image = new Image();
			image.src = imageUrl;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("canvas is unavailable");
			ctx.drawImage(image, 0, 0);
			const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			let lightest = 0;
			for (let i = 0; i < data.length; i += 64)
				lightest = Math.max(
					lightest,
					luminance([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]),
				);
			for (const [name, minimum] of [
				["felt-fg", 4.5],
				["trump-fg", 3],
				["waiting-fg", 3],
			] as const)
				expect(
					(luminance(token(name)) + 0.05) / (lightest + 0.05),
					name,
				).toBeGreaterThanOrEqual(minimum);
		},
	);
	it.each(PALETTES)(
		"%s %s keeps every text readable on its surface",
		(theme, scheme) => {
			applyTheme(document.documentElement, theme, scheme, false);
			const weak = PAIRS.filter(
				([text, surface, least]) => contrast(text, surface) < least,
			).map(
				([text, surface]) =>
					`${text} on ${surface}: ${contrast(text, surface).toFixed(2)}`,
			);
			expect(weak).toEqual([]);
		},
	);

	it.each(THEMES)(
		"%s dark turns the page dark, the text bright, the fallback felt darker and the cards off-white",
		(theme) => {
			const felt = luminance(token("felt"));
			applyTheme(document.documentElement, theme, "dark", false);
			expect(document.documentElement.dataset.theme).toBe(theme);
			expect(document.documentElement.dataset.scheme).toBe("dark");
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

	it("solarized light keeps a light page in the cream of solarized, with a green felt", () => {
		const page = token("bg");
		applyTheme(document.documentElement, "solarized", "light", false);
		expect(getComputedStyle(document.documentElement).colorScheme).toBe(
			"light",
		);
		const [red = 0, , blue = 0] = token("bg");
		expect(token("bg")).not.toEqual(page);
		expect(luminance(token("bg"))).toBeGreaterThan(0.8);
		expect(red).toBeGreaterThan(blue);
		expect(luminance(token("fg"))).toBeLessThan(0.1);
		const [feltRed = 0, feltGreen = 0] = token("felt");
		expect(feltGreen).toBeGreaterThan(feltRed);
		expect(saturation(token("felt"))).toBeGreaterThan(0.2);
	});

	it("solarized dark gives the cards and the turn pill one muted beige, darker than the names on the felt", () => {
		applyTheme(document.documentElement, "solarized", "dark", false);
		const [red = 0, , blue = 0] = token("card-bg");
		expect(luminance(token("card-bg"))).toBeLessThan(0.8);
		expect(luminance(token("card-bg"))).toBeLessThan(
			luminance(token("felt-fg")),
		);
		expect(red - blue).toBeGreaterThan(24);
		expect(token("pill-bg")).toEqual(token("card-bg"));
	});

	it.each<[Scheme, boolean, string]>([
		["auto", false, "light"],
		["auto", true, "dark"],
		["light", true, "light"],
		["dark", false, "dark"],
	])(
		"the %s scheme with a dark system preference %s shows the %s palette",
		(scheme, prefersDark, shown) => {
			applyTheme(document.documentElement, "solarized", scheme, prefersDark);
			expect(document.documentElement.dataset.scheme).toBe(shown);
			expect(getComputedStyle(document.documentElement).colorScheme).toBe(
				shown,
			);
		},
	);

	it("follows a change of the system preference only in the automatic scheme, and stops following", () => {
		const root = document.documentElement;
		const system = new SystemScheme();
		let chosen: { theme: Theme; scheme: Scheme } = {
			theme: "normal",
			scheme: "auto",
		};
		const stop = watchTheme(root, system, () => chosen);
		expect(system.queries).toEqual(["(prefers-color-scheme: dark)"]);
		expect([root.dataset.theme, root.dataset.scheme]).toEqual([
			"normal",
			"light",
		]);
		system.change(true);
		expect(root.dataset.scheme).toBe("dark");
		chosen = { theme: "solarized", scheme: "light" };
		system.change(false);
		system.change(true);
		expect([root.dataset.theme, root.dataset.scheme]).toEqual([
			"solarized",
			"light",
		]);
		chosen = { theme: "normal", scheme: "auto" };
		stop();
		system.change(false);
		expect([root.dataset.theme, root.dataset.scheme]).toEqual([
			"solarized",
			"light",
		]);
	});

	it.each(PALETTES)(
		"%s %s colours the cards, the sheets and the dialogs with their own ink",
		(theme, scheme) => {
			applyTheme(document.documentElement, theme, scheme, false);
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
