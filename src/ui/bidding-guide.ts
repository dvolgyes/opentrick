import { SUIT_SYMBOLS } from "../bridge/cards";
import type { PointSystem } from "../bridge/hand-points";
import type { Locale, Translate } from "../i18n";
import { button, el } from "./dom";

/**
 * The bidding guide of each point scale, one text file per scale and language in src/guides, named
 * `{guide}_{locale}.txt`. A line that starts with "# " is the title, "## " a section, "- " a list item; any other
 * non-empty line is a paragraph. A call in square brackets, such as [1H], [3NT], [X], [XX] or [P], shows as a bid.
 */

export type GuidePart =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "bid"; readonly call: string };

export interface GuideBlock {
	readonly kind: "title" | "section" | "item" | "paragraph";
	readonly parts: readonly GuidePart[];
}

const GUIDE_NAMES: Readonly<Record<PointSystem, string>> = {
	hcp: "milton",
	"hcp-corrected": "milton_corrected",
	vienna: "vienna",
	reith: "reith",
	"four-aces": "four_aces",
	// The guides do not describe an other system; HCP is the common scale.
	other: "milton",
};

const GUIDE_FILES = import.meta.glob<string>("../guides/*.txt", {
	query: "?raw",
	import: "default",
});

const BID = /\[([1-7](?:C|D|H|S|NT)|XX|X|P)\]/g;

const BLOCK_PREFIXES: readonly (readonly [string, GuideBlock["kind"]])[] = [
	["## ", "section"],
	["# ", "title"],
	["- ", "item"],
];

export function guideName(system: PointSystem): string {
	return GUIDE_NAMES[system];
}

/** The guide text of a scale in a language; undefined when that language has no file. */
export async function loadGuide(
	system: PointSystem,
	locale: Locale,
): Promise<string | undefined> {
	const load = GUIDE_FILES[`../guides/${GUIDE_NAMES[system]}_${locale}.txt`];
	return load === undefined ? undefined : await load();
}

function parseParts(text: string): GuidePart[] {
	const parts: GuidePart[] = [];
	let at = 0;
	for (const match of text.matchAll(BID)) {
		if (match.index > at)
			parts.push({ kind: "text", text: text.slice(at, match.index) });
		parts.push({ kind: "bid", call: match[1] ?? "" });
		at = match.index + match[0].length;
	}
	if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
	return parts;
}

export function parseGuide(text: string): GuideBlock[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line) => {
			const [prefix, kind] = BLOCK_PREFIXES.find(([start]) =>
				line.startsWith(start),
			) ?? ["", "paragraph"];
			return { kind, parts: parseParts(line.slice(prefix.length)) };
		});
}

/** A call as the bid box shows it: the level and the suit symbol in the suit's colour, NT green, X and XX named. */
function bidElement(call: string, t: Translate): HTMLElement {
	if (call === "X")
		return el(
			"span",
			{ className: "guide-bid call-double" },
			`${t("double")}(X)`,
		);
	if (call === "XX")
		return el(
			"span",
			{ className: "guide-bid call-redouble" },
			`${t("redouble")}(XX)`,
		);
	if (call === "P")
		return el("span", { className: "guide-bid call-pass" }, t("pass"));
	const level = call.slice(0, 1);
	const strain = call.slice(1);
	const symbol =
		strain === "NT" ? "NT" : SUIT_SYMBOLS[strain as keyof typeof SUIT_SYMBOLS];
	return el(
		"span",
		{ className: `guide-bid strain-${strain}` },
		`${level}${symbol}`,
	);
}

/** The guide as page content; text goes into text nodes only. */
export function renderGuide(
	blocks: readonly GuideBlock[],
	t: Translate,
): HTMLElement[] {
	const content = (parts: readonly GuidePart[]): (Node | string)[] =>
		parts.map((part) =>
			part.kind === "text" ? part.text : bidElement(part.call, t),
		);
	const nodes: HTMLElement[] = [];
	let list: HTMLUListElement | undefined;
	for (const block of blocks) {
		if (block.kind === "item") {
			if (list === undefined) {
				list = el("ul", {});
				nodes.push(list);
			}
			list.append(el("li", {}, ...content(block.parts)));
			continue;
		}
		list = undefined;
		const tag =
			block.kind === "title" ? "h2" : block.kind === "section" ? "h3" : "p";
		nodes.push(el(tag, {}, ...content(block.parts)));
	}
	return nodes;
}

export interface GuideDialog {
	readonly element: HTMLDialogElement;
	/** Shows the guide of this scale; the text loads when the dialog opens. */
	open(system: PointSystem): void;
}

/** A modal with the guide in a scrolling area and a Close button that stays below it. */
export function guideDialog(t: Translate, locale: Locale): GuideDialog {
	const content = el("div", {
		className: "guide-content",
		attrs: { "data-testid": "guide-content", tabindex: "0" },
	});
	const close = button(t("Close"), () => element.close(), {
		className: "guide-close",
	});
	const element = el(
		"dialog",
		{
			className: "guide-dialog",
			attrs: {
				"aria-label": t("Bidding guide"),
				"data-testid": "guide-dialog",
			},
		},
		content,
		close,
	);
	let request = 0;
	return {
		element,
		open(system) {
			const current = ++request;
			content.replaceChildren();
			if (!element.open) element.showModal();
			void (async () => {
				const text =
					(await loadGuide(system, locale)) ?? (await loadGuide(system, "en"));
				if (current !== request) return;
				content.replaceChildren(
					...(text === undefined
						? [el("p", {}, t("The bidding guide could not be loaded."))]
						: renderGuide(parseGuide(text), t)),
				);
				content.scrollTop = 0;
			})();
		},
	};
}
