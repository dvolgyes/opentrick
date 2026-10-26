import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";

import { Player } from "./player";
import { namePlayers } from "./room";

/*
 * A phone shows the compact table (src/ui/room-view.ts sets the form from the device class); phone.spec.ts plays a
 * board on it, and layout.spec.ts checks it at several phone sizes. This test checks the host bot controls on a phone.
 */
test("on a phone the host pauses the bots, finds each top-bar button once, and changes display settings", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "mobile", {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await namePlayers(page, "W", ["N", "E", "S"]);

		await mockBotBidding(page, (position) => {
			return position.calls.length === 0 ? "1NT" : "P";
		});

		await page
			.getByTestId("create")
			.evaluate((button) => (button as HTMLButtonElement).click());
		await expect(
			page.getByRole("button", { name: "Pause bots" }),
		).toBeVisible();
		await expect(page.locator(".bridge-table")).toHaveAttribute(
			"data-phase",
			"auction",
		);
		await page.getByRole("button", { name: "Pause bots" }).click();
		await expect(
			page.getByRole("button", { name: "Resume bots" }),
		).toBeVisible();
		// The phone keeps the seat switches in a closed group below the board.
		await page.getByText("Optional automated players").click();
		await expect(
			page.getByRole("button", { name: /Switch to player$/ }).first(),
		).toBeVisible();
		// During the auction the top bar holds the only Reload, New table and Share URL; Settings holds the key and the models.
		for (const [name, count] of [
			["Reload", 1],
			["New table", 1],
			["Share URL", 1],
			["Copy link", 0],
			["Set API key", 0],
			["Model", 0],
			["Debug", 0],
			["Reload players", 0],
			["Reset", 0],
			["Host controls", 1],
		] as const)
			await expect(
				page.getByRole("button", { name, exact: true }),
				name,
			).toHaveCount(count);
		await expect(
			page
				.locator(".mobile-auction-topbar")
				.getByRole("button", { name: "Reload", exact: true }),
		).toBeVisible();
		// Host controls opens a dialog with the host's Debug, Reload players and Reset; Close closes it.
		await page
			.getByRole("button", { name: "Host controls", exact: true })
			.click();
		const hostControls = page.getByTestId("host-controls-dialog");
		for (const name of ["Debug", "Reload players", "Reset", "Close"])
			await expect(
				hostControls.getByRole("button", { name, exact: true }),
				name,
			).toBeInViewport();
		await hostControls
			.getByRole("button", { name: "Close", exact: true })
			.click();
		await expect(hostControls).toBeHidden();
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByTestId("settings-dialog");
		await expect(settings.getByRole("textbox")).toHaveCount(0);
		await settings.getByLabel("Dark").check();
		await settings.getByRole("button", { name: "Save settings" }).click();
		await expect(settings).toBeHidden();
		expect(
			await page.evaluate(() =>
				localStorage.getItem("opentrick.settings.theme"),
			),
		).toBe("dark");
	} finally {
		await player.close();
	}
});
