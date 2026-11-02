import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { namePlayers } from "./room";

for (const [form, viewport] of [
	["desktop", { width: 1280, height: 800 }],
	["mobile", { width: 360, height: 800 }],
] as const) {
	test(`${form}: confirmation can be turned off during the auction`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await mockBotBidding(page, () => "P");
		await page.goto("/");
		await namePlayers(page, "N", ["E", "S", "W"]);
		await page
			.getByTestId("create")
			.evaluate((node) => (node as HTMLButtonElement).click());
		const table = page.getByTestId("table");
		const box = page.getByTestId("bid-box");
		await expect(table).toHaveAttribute("data-at", "0");
		await box.getByRole("button", { name: "Pass", exact: true }).click();
		await expect(table).toHaveAttribute("data-at", "0");
		await expect(box.locator("button.confirm")).toBeEnabled();

		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByTestId("settings-dialog");
		await settings
			.getByLabel("Require confirmation before sending a bid")
			.uncheck();
		await settings.getByRole("button", { name: "Save settings" }).click();
		await expect(table).toHaveAttribute("data-at", "0");
		await expect(box.locator("button.confirm")).toHaveCount(0);
		await box.getByRole("button", { name: "Level 1", exact: true }).click();
		await expect(table).toHaveAttribute("data-at", "0");
		await box.getByRole("button", { name: "Clubs", exact: true }).click();
		await expect(table).toHaveAttribute("data-at", /^[1-9]\d*$/);
	});
}

test("the host can see, cancel, save and reload the bidding engine in Settings", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P", 250);
	await page.goto("/?r=sl");
	for (const seat of ["N", "E", "S", "W"] as const)
		await page.locator(`input[name="name-${seat}"]`).fill(`Player ${seat}`);
	await page.locator('input[name="me"][value="W"]').check();
	for (const seat of ["N", "E", "S"] as const) {
		await page.locator(`input[name="name-${seat}"]`).fill("");
		await page.locator(`select[name="type-${seat}"]`).selectOption("bot");
	}
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();

	const settings = page.getByTestId("settings-dialog");
	const open = async () => {
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(settings).toBeVisible();
	};
	await open();
	await expect(
		settings.getByLabel("BRL SL (WBridge5 imitation)", { exact: true }),
	).toBeChecked();
	await settings.getByLabel("BRL RL/FSP", { exact: true }).check();
	await settings.getByRole("button", { name: "Cancel", exact: true }).click();
	await open();
	await expect(
		settings.getByLabel("BRL SL (WBridge5 imitation)", { exact: true }),
	).toBeChecked();
	await settings.getByLabel("BRL RL/FSP", { exact: true }).check();
	await settings.getByRole("button", { name: "Save settings" }).click();
	await expect(settings).toBeHidden();
	expect(new URL(page.url()).searchParams.get("r")).toBe("rl-fsp");
	await expect(page.getByTestId("bot-status")).toContainText(
		"Local BRL · rl-fsp",
	);

	await page.reload();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	await open();
	await expect(
		settings.getByLabel("BRL RL/FSP", { exact: true }),
	).toBeChecked();
	await settings
		.getByLabel("BRL SL (WBridge5 imitation)", { exact: true })
		.check();
	await settings.getByRole("button", { name: "Save settings" }).click();
	await page.goto("/");
	await expect(page.locator('select[name="bot-bidder"]')).toHaveValue("sl");
	await page.goto("/?r=rl-fsp");
	await expect(page.locator('select[name="bot-bidder"]')).toHaveValue("rl-fsp");
});
