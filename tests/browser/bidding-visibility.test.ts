import { afterEach, describe, expect, it } from "vitest";
import "../../src/ui/style.css";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import { playView, renderView } from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

it("moves the bidding Undo between desktop and mobile when the layout changes", () => {
	const view = {
		...playView(),
		phase: "auction" as const,
		bids: [{ call: "P" as const, text: "Pass" }],
	};
	const { root, section } = renderView(view, "desktop");
	const history = root.querySelector<HTMLElement>(
		"[data-testid='bid-history']",
	);
	const board = root.querySelector<HTMLElement>(".mobile-auction-board");
	const controls = root.querySelector<HTMLElement>(".bid-undo");
	if (!history || !board || !controls)
		throw new Error("Missing bidding layout");
	expect(controls.parentElement).toBe(history);
	section.setForm("compact");
	expect(controls.nextElementSibling).toBe(board);
	section.setForm("desktop");
	expect(controls.parentElement).toBe(history);
	expect(root.querySelectorAll(".undo-call")).toHaveLength(1);
});

describe.each(["desktop", "compact"] as const)(
	"bidding visibility in %s",
	(form) => {
		const auction = {
			...playView(),
			phase: "auction" as const,
			bids: [
				{ call: "P" as const, text: "Pass" },
				{ call: "1C" as const, text: "1♣" },
			],
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

		it("keeps Undo by the history and usable when the bid box is hidden", () => {
			const { root, section, handlers } = renderView(
				auction,
				form,
				undefined,
				undefined,
				{ marks: () => ({ ...DEFAULT_SETTINGS, hideBidBoxWhenWaiting: true }) },
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
			const undo = () => {
				const found = root.querySelector<HTMLButtonElement>(".undo-call");
				if (!found) throw new Error("Missing bidding Undo");
				return found;
			};
			const history = root.querySelector<HTMLElement>(
				"[data-testid='bid-history']",
			);
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			const box = root.querySelector<HTMLElement>(".bid-box");
			if (!history || !box || !board) throw new Error("Missing bidding layout");
			const confirm = box.querySelector<HTMLElement>(".confirm");
			const levels = box.querySelector<HTMLElement>(".bid-levels");
			if (!confirm || !levels) throw new Error("Missing bidding controls");
			expect(confirm.getBoundingClientRect().width).toBeCloseTo(
				levels.getBoundingClientRect().width,
				1,
			);
			expect(box.contains(undo())).toBe(false);
			if (form === "desktop") {
				expect(history.contains(undo())).toBe(true);
				const historyRect = history.getBoundingClientRect();
				const undoRect = undo().getBoundingClientRect();
				expect(historyRect.bottom - undoRect.bottom).toBeLessThan(10);
				expect(undoRect.width / historyRect.width).toBeGreaterThan(0.9);
			} else {
				const undoRect = undo().getBoundingClientRect();
				expect(undoRect.top).toBeGreaterThanOrEqual(
					history.getBoundingClientRect().bottom,
				);
				expect(undoRect.bottom).toBeLessThanOrEqual(
					board.getBoundingClientRect().top,
				);
			}
			const pass = box.querySelector<HTMLButtonElement>(".pass");
			if (!pass) throw new Error("Missing Pass");
			pass.click();
			expect(box.querySelector(".pass")?.getAttribute("aria-pressed")).toBe(
				"true",
			);
			box.querySelector<HTMLButtonElement>('[aria-label="Level 1"]')?.click();
			expect(box.querySelector(".pass")?.getAttribute("aria-pressed")).toBe(
				"false",
			);
			box.querySelector<HTMLButtonElement>(".pass")?.click();
			undo().click();
			const dialog = root.querySelector<HTMLDialogElement>(
				'[data-testid="undo-confirm"]',
			);
			expect(dialog?.open).toBe(true);
			root
				.querySelector<HTMLButtonElement>('[data-testid="undo-confirm-cancel"]')
				?.click();
			expect(box.querySelector(".pass")?.getAttribute("aria-pressed")).toBe(
				"true",
			);
			section.render({ ...auction, bids: [], yourTurn: false });
			expect(undo().checkVisibility({ visibilityProperty: true })).toBe(true);
			expect(undo().disabled).toBe(false);
			undo().click();
			expect(dialog?.open).toBe(true);
			root
				.querySelector<HTMLButtonElement>('[data-testid="undo-confirm-send"]')
				?.click();
			expect(handlers.undoRequest).toHaveBeenCalledWith(auction.board);
			section.render({
				...auction,
				undo: { ...auction.undo, canRequest: false },
			});
			box.querySelector<HTMLButtonElement>(".pass")?.click();
			expect(undo().disabled).toBe(true);
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
