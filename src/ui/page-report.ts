import type { Form } from "../call/device-class";
import { MAX_REPORT_BYTES } from "../p2p/limits";
import { jsonBytes } from "../p2p/wire";
import type { JsonObject } from "../protocol";

/** The table as this page shows it; counts only, so that the report stays small. */
export interface TableFacts {
	readonly seat: string;
	readonly phase: string;
	readonly board: number;
	readonly at: number;
	readonly yourTurn: boolean;
	readonly outbox: number;
	readonly failures: number;
	readonly undone: number;
}

/** What the element on top of a point is: "self", another card, or the element's tag and first class. */
function hitName(target: Element | null, card: HTMLElement): string {
	if (target === null) return "none";
	const button = target.closest("button[data-card]");
	if (button === card) return "self";
	if (button instanceof HTMLElement) return `card:${button.dataset.card}`;
	const name = target.classList[0];
	return (
		name === undefined ? target.localName : `${target.localName}.${name}`
	).slice(0, 60);
}

function cardFacts(node: HTMLButtonElement): JsonObject {
	const rect = node.getBoundingClientRect();
	// A card under the next card shows only its left strip, so a player clicks near its rank, top left.
	const x = rect.left + Math.min(12, rect.width / 2);
	const y = rect.top + Math.min(20, rect.height / 2);
	const hand = node.closest<HTMLElement>('[data-testid^="hand-"]');
	return {
		hand: hand?.dataset.testid?.slice("hand-".length) ?? "",
		card: node.dataset.card ?? "",
		disabled: node.disabled,
		rect: [rect.left, rect.top, rect.width, rect.height].map(Math.round),
		hit: hitName(document.elementFromPoint(x, y), node),
	};
}

/**
 * This page's screen, window, table and visible cards, for the host's debug export. It holds no key and no client
 * id, and the cards are left out when the report would not fit MAX_REPORT_BYTES.
 */
export function pageReport(
	view: Window,
	form: Form,
	table: TableFacts | null,
): JsonObject {
	const viewport = view.visualViewport;
	const report: JsonObject = {
		form,
		language: view.navigator.language,
		userAgent: view.navigator.userAgent.slice(0, 300),
		screen: {
			width: view.screen.width,
			height: view.screen.height,
			availWidth: view.screen.availWidth,
			availHeight: view.screen.availHeight,
		},
		window: {
			innerWidth: view.innerWidth,
			innerHeight: view.innerHeight,
			outerWidth: view.outerWidth,
			outerHeight: view.outerHeight,
			devicePixelRatio: view.devicePixelRatio,
		},
		visualViewport: viewport
			? {
					width: viewport.width,
					height: viewport.height,
					scale: viewport.scale,
					offsetTop: viewport.offsetTop,
				}
			: null,
		fullscreen: view.document.fullscreenElement !== null,
		canvasScale: view.document.documentElement.style.getPropertyValue(
			"--room-canvas-scale",
		),
		table: table === null ? null : { ...table },
		cards: [],
	};
	const cards = [
		...view.document.querySelectorAll<HTMLButtonElement>(
			'[data-testid^="hand-"] button[data-card]',
		),
	].map(cardFacts);
	const full = { ...report, cards };
	if (jsonBytes(full) <= MAX_REPORT_BYTES) return full;
	return { ...report, cardsLeftOut: cards.length };
}
