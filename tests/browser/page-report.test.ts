import { afterEach, describe, expect, it } from "vitest";
import { MAX_REPORT_BYTES } from "../../src/p2p/limits";
import { jsonBytes } from "../../src/p2p/wire";
import { pageReport } from "../../src/ui/page-report";

const FACTS = {
	seat: "E",
	phase: "play",
	board: 2,
	at: 31,
	yourTurn: true,
	outbox: 0,
	failures: 0,
	undone: 0,
} as const;

function cardButton(card: string, left: number): HTMLButtonElement {
	const node = document.createElement("button");
	node.dataset.card = card;
	node.style.cssText = `position:fixed;left:${left}px;top:100px;width:80px;height:120px`;
	return node;
}

function hand(...cards: HTMLButtonElement[]): HTMLElement {
	const node = document.createElement("div");
	node.dataset.testid = "hand-E";
	node.append(...cards);
	document.body.append(node);
	return node;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("a page's report", () => {
	it("gives the screen, the window and the visual viewport", () => {
		const report = pageReport(window, "desktop", FACTS);
		expect(report).toMatchObject({
			form: "desktop",
			language: navigator.language,
			screen: {
				width: screen.width,
				height: screen.height,
				availWidth: screen.availWidth,
				availHeight: screen.availHeight,
			},
			window: {
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight,
				outerWidth: window.outerWidth,
				outerHeight: window.outerHeight,
				devicePixelRatio: window.devicePixelRatio,
			},
			visualViewport: { scale: 1 },
			fullscreen: false,
			table: FACTS,
		});
	});

	it("tells which element a click on each card's visible corner reaches", () => {
		const covered = cardButton("S5", 20);
		const free = cardButton("H2", 200);
		const disabled = cardButton("D9", 300);
		disabled.disabled = true;
		const overlap = cardButton("S7", 60);
		hand(covered, overlap, free, disabled);
		const frame = document.createElement("span");
		frame.className = "trump-frame";
		frame.style.cssText =
			"position:fixed;left:180px;top:90px;width:100px;height:140px";
		document.body.append(frame);

		const cards = pageReport(window, "desktop", FACTS).cards;
		expect(cards).toEqual([
			{
				hand: "E",
				card: "S5",
				disabled: false,
				rect: [20, 100, 80, 120],
				hit: "self",
			},
			{
				hand: "E",
				card: "S7",
				disabled: false,
				rect: [60, 100, 80, 120],
				hit: "self",
			},
			{
				hand: "E",
				card: "H2",
				disabled: false,
				rect: [200, 100, 80, 120],
				hit: "span.trump-frame",
			},
			{
				hand: "E",
				card: "D9",
				disabled: true,
				rect: [300, 100, 80, 120],
				hit: "self",
			},
		]);
	});

	it("leaves the cards out when they do not fit the report", () => {
		hand(
			...Array.from({ length: 200 }, (_, index) =>
				cardButton(`S${index}`, index),
			),
		);
		const report = pageReport(window, "desktop", FACTS);
		expect(jsonBytes(report)).toBeLessThanOrEqual(MAX_REPORT_BYTES);
		expect(report.cards).toEqual([]);
		expect(report.cardsLeftOut).toBe(200);
	});
});
