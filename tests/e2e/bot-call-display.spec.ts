import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { createRoom } from "./room";

for (const layout of ["desktop", "compact"] as const) {
	test(`disables the call only while every present seat is a bot (${layout})`, async ({
		page,
	}) => {
		await page.setViewportSize(
			layout === "compact"
				? { width: 360, height: 800 }
				: { width: 1280, height: 720 },
		);
		await mockBotBidding(page, () => "P");
		await page.goto("/");
		await createRoom(page, ["N", "E", "S"]);
		const controls =
			layout === "compact"
				? page.locator('.icon-group[aria-label="Room call"]')
				: page.getByTestId("call-panel");
		const join = controls.getByRole("button", { name: "Join call" });
		await expect(join).toBeEnabled();
		if (layout === "desktop") {
			await page.context().grantPermissions(["microphone"]);
			await join.click();
			await expect(
				controls.getByRole("button", { name: "Leave call" }),
			).toBeEnabled();
		}
		await page.getByTestId("host-autoplay-toggle").click();
		await page.getByTestId("autoplay-confirm-enable").click();
		await expect(controls).toHaveAttribute("data-bots-only", "true");
		await expect(join).toBeDisabled();
		await expect(controls).toHaveCSS("filter", "grayscale(1) brightness(0.6)");
		if (layout === "desktop") {
			await page.reload();
			await expect(controls).toHaveAttribute("data-bots-only", "true");
			await expect(join).toBeDisabled();
			await expect(
				controls.getByRole("button", { name: "Leave call" }),
			).toHaveCount(0);
		}
		await page.getByTestId("host-autoplay-toggle").click();
		await expect(controls).toHaveAttribute("data-bots-only", "false");
		await expect(join).toBeEnabled();
	});
}

test("desktop bidding windows stay above an overlapping video tile and turn frame", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P");
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	await expect(page.getByTestId("table")).toHaveAttribute(
		"data-phase",
		"auction",
	);
	const hits = await page.evaluate(() => {
		const felt = document.querySelector<HTMLElement>(".felt");
		const tileSlot = document.querySelector<HTMLElement>(".video-left");
		const tile = tileSlot?.querySelector<HTMLElement>(".tile");
		if (!felt || !tileSlot || !tile) throw new Error("missing video tile");
		Object.assign(tileSlot.style, {
			top: "0",
			left: "0",
			width: "100%",
			height: "100%",
		});
		Object.assign(tile.style, { width: "100%", height: "100%" });
		const frame = document.createElement("div");
		frame.className = "seat";
		frame.dataset.turnFrame = "true";
		Object.assign(frame.style, {
			position: "absolute",
			inset: "0",
			zIndex: "5",
		});
		felt.append(frame);
		return [".bid-row .history-panel", ".bid-row .bid-box"].map((selector) => {
			const target = document.querySelector<HTMLElement>(selector);
			if (!target) throw new Error(`missing ${selector}`);
			const box = target.getBoundingClientRect();
			const hit = document.elementFromPoint(
				(box.left + box.right) / 2,
				(box.top + box.bottom) / 2,
			);
			return hit !== null && target.contains(hit);
		});
	});
	expect(hits).toEqual([true, true]);
});
