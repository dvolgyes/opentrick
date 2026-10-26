import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";

test("the host can see, cancel, save and reload the bidding engine in Settings", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P", 250);
	await page.goto("/?bot_bidder=sl");
	for (const seat of ["N", "E", "S", "W"] as const)
		await page.locator(`input[name="name-${seat}"]`).fill(`Player ${seat}`);
	await page.locator('input[name="me"][value="W"]').check();
	for (const seat of ["N", "E", "S"] as const)
		await page.locator(`input[name="bot-${seat}"]`).check();
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	await page.getByRole("button", { name: "Pause bots", exact: true }).click();

	const settings = page.getByTestId("settings-dialog");
	const open = async () => {
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(settings).toBeVisible();
	};
	await open();
	await expect(settings.getByLabel("Local · WBridge5 imitation")).toBeChecked();
	await settings.getByLabel("Local · RL/FSP learned system").check();
	await settings.getByRole("button", { name: "Cancel", exact: true }).click();
	await open();
	await expect(settings.getByLabel("Local · WBridge5 imitation")).toBeChecked();
	await settings.getByLabel("Local · RL/FSP learned system").check();
	await settings.getByRole("button", { name: "Save settings" }).click();
	await expect(settings).toBeHidden();
	expect(new URL(page.url()).searchParams.get("bot_bidder")).toBe("rl-fsp");
	await page.getByRole("button", { name: "Resume bots", exact: true }).click();
	await expect(page.getByTestId("bot-status")).toContainText(
		"Local BRL · rl-fsp",
	);

	await page.reload();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	await open();
	await expect(
		settings.getByLabel("Local · RL/FSP learned system"),
	).toBeChecked();
	await settings.getByLabel("Local · WBridge5 imitation").check();
	await settings.getByRole("button", { name: "Save settings" }).click();
	await page.goto("/");
	await expect(page.locator('select[name="bot-bidder"]')).toHaveValue("sl");
	await page.goto("/?bot_bidder=rl-fsp");
	await expect(page.locator('select[name="bot-bidder"]')).toHaveValue("rl-fsp");
});
