import { afterEach, describe, expect, it } from "vitest";
import "../../src/ui/style.css";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import { playView, renderView } from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

describe.each(["desktop", "compact"] as const)(
	"bidding visibility in %s",
	(form) => {
		const auction = {
			...playView(),
			phase: "auction" as const,
			bids: [{ call: "P" as const, text: "Pass" }],
		};

		it("shows each optional button only when enabled", () => {
			let settings = {
				...DEFAULT_SETTINGS,
				guideButton: false,
				botBidHint: true,
			};
			const { root, section } = renderView(
				auction,
				form,
				undefined,
				undefined,
				{
					marks: () => settings,
				},
			);
			const buttons = () =>
				[...root.querySelectorAll(".bid-guide button")].map(
					(button) => button.textContent,
				);
			expect(buttons()).toEqual(["Bot: …"]);
			settings = { ...settings, guideButton: true };
			section.render(auction);
			expect(buttons()).toEqual(["Guide", "Bot: …"]);
			settings = { ...settings, botBidHint: false };
			section.render(auction);
			expect(buttons()).toEqual(["Guide"]);
			settings = { ...settings, guideButton: false };
			section.render(auction);
			expect(root.querySelector(".bid-guide")).toBeNull();
		});

		it("hides the whole box while waiting and restores it for the next turn", () => {
			let settings = { ...DEFAULT_SETTINGS, hideBidBoxWhenWaiting: true };
			const { root, section } = renderView(
				auction,
				form,
				undefined,
				undefined,
				{
					marks: () => settings,
				},
			);
			const box = root.querySelector<HTMLElement>(".bid-box");
			if (!box) throw new Error("No bid box");
			const visible = (node: HTMLElement) =>
				node.checkVisibility({ visibilityProperty: true });
			expect(visible(box)).toBe(true);
			section.render({ ...auction, bids: [], yourTurn: false });
			expect(visible(box)).toBe(false);
			if (form === "compact") {
				const overlay = root.querySelector<HTMLElement>(".mobile-bid-overlay");
				expect(overlay && visible(overlay)).toBe(false);
				expect(
					root
						.querySelector<HTMLElement>(".mobile-auction-board")
						?.checkVisibility(),
				).toBe(true);
			}
			section.render(auction);
			expect(visible(box)).toBe(true);
			settings = { ...settings, hideBidBoxWhenWaiting: false };
			section.render({ ...auction, bids: [], yourTurn: false });
			expect(visible(box)).toBe(true);
		});

		it("keeps the history and board in place while hiding the box", () => {
			const { root, section } = renderView(
				auction,
				form,
				undefined,
				undefined,
				{
					marks: () => ({ ...DEFAULT_SETTINGS, hideBidBoxWhenWaiting: true }),
				},
			);
			const screen = document.createElement("main");
			screen.dataset.screen = "table";
			screen.dataset.form = form;
			screen.style.setProperty(
				"--room-canvas-scale",
				String(Math.min(innerWidth / 1920, innerHeight / 1080)),
			);
			screen.append(...document.body.children);
			document.body.replaceChildren(screen);
			const history = root.querySelector<HTMLElement>(
				"[data-testid='bid-history']",
			);
			const box = root.querySelector<HTMLElement>(".bid-box");
			if (!history || !box) throw new Error("Missing auction elements");
			const bounds = (node: HTMLElement) => {
				const { x, y, width, height } = node.getBoundingClientRect();
				return { x, y, width, height };
			};
			const positions = () => {
				const hand = root.querySelector<HTMLElement>('[data-testid="hand-N"]');
				if (!hand) throw new Error("Missing hand");
				return [bounds(history), bounds(box), bounds(hand)];
			};
			const before = positions();
			section.render({ ...auction, bids: [], yourTurn: false });
			expect(positions()).toEqual(before);
			expect(box.checkVisibility({ visibilityProperty: true })).toBe(false);
			const rect = box.getBoundingClientRect();
			const target = document.elementFromPoint(
				rect.x + rect.width / 2,
				rect.y + rect.height / 2,
			);
			expect(target && box.contains(target)).toBe(false);
			if (form === "compact") {
				const overlay = root.querySelector<HTMLElement>(".mobile-bid-overlay");
				expect(overlay && target && overlay.contains(target)).toBe(false);
			}
			const button = box.querySelector<HTMLButtonElement>("button");
			if (!button) throw new Error("Missing bid button");
			button.focus();
			expect(document.activeElement).not.toBe(button);
			section.render(auction);
			expect(positions()).toEqual(before);
		});
	},
);
