import { afterEach, describe, expect, it } from "vitest";
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
			expect(box.checkVisibility()).toBe(true);
			section.render({ ...auction, bids: [], yourTurn: false });
			expect(box.checkVisibility()).toBe(false);
			if (form === "compact") {
				const overlay = root.querySelector<HTMLElement>(".mobile-bid-overlay");
				expect(overlay?.checkVisibility()).toBe(false);
				expect(
					root
						.querySelector<HTMLElement>(".mobile-auction-board")
						?.checkVisibility(),
				).toBe(true);
			}
			section.render(auction);
			expect(box.checkVisibility()).toBe(true);
			settings = { ...settings, hideBidBoxWhenWaiting: false };
			section.render({ ...auction, bids: [], yourTurn: false });
			expect(box.checkVisibility()).toBe(true);
		});
	},
);
