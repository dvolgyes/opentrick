import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { makeCall } from "./room";

for (const automatic of [false, true]) {
	test(`solo result ${automatic ? "can be held during the countdown" : "waits for Next board by default"}`, async ({
		page,
	}) => {
		await page.addInitScript((enabled) => {
			localStorage.setItem(
				"opentrick.settings.solo-auto-advance",
				enabled ? "1" : "0",
			);
		}, automatic);
		await mockBotBidding(page, () => "P");
		await page.goto("/");
		await page.getByTestId("create-solo").click();
		const table = page.getByTestId("table");
		await expect(table).toHaveAttribute("data-at", "2");
		await makeCall(page, "P");
		await expect(table).toHaveAttribute("data-phase", "complete");
		const scoring = page.getByTestId("scoring");
		await expect(scoring).toBeVisible();
		const next = scoring.getByTestId("next-board");
		await expect(next).toBeEnabled();
		if (automatic) {
			await expect(scoring.getByTestId("scoring-countdown")).toBeVisible();
			await scoring.getByRole("button", { name: "Review" }).click();
			await expect(scoring.getByTestId("scoring-countdown")).toBeHidden();
			await page.waitForTimeout(11_000);
		} else {
			await expect(scoring.getByTestId("scoring-countdown")).toBeHidden();
			await page.waitForTimeout(1500);
		}
		await expect(table).toHaveAttribute("data-board", "1");
		await next.click();
		await expect(table).toHaveAttribute("data-board", "2");
	});
}

test("solo automatic advance deals one board when the countdown ends", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("opentrick.settings.solo-auto-advance", "1"),
	);
	await mockBotBidding(page, () => "P");
	await page.goto("/");
	await page.getByTestId("create-solo").click();
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-at", "2");
	await makeCall(page, "P");
	await expect(table).toHaveAttribute("data-phase", "complete");
	await expect(page.getByTestId("scoring-countdown")).toBeVisible();
	await expect(table).toHaveAttribute("data-board", "2", { timeout: 15_000 });
	await page.waitForTimeout(1500);
	await expect(table).toHaveAttribute("data-board", "2");
});

test("a hidden Next board button reappears when the solo result is held for review", async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem("opentrick.settings.solo-auto-advance", "1");
		localStorage.setItem("opentrick.settings.solo-next-board", "0");
	});
	await mockBotBidding(page, () => "P");
	await page.goto("/");
	await page.getByTestId("create-solo").click();
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-at", "2");
	await makeCall(page, "P");
	await expect(table).toHaveAttribute("data-phase", "complete");
	const scoring = page.getByTestId("scoring");
	await expect(scoring.getByTestId("next-board")).toHaveCount(0);
	await scoring.getByRole("button", { name: "Review" }).click();
	await expect(scoring.getByTestId("next-board")).toBeVisible();
	await scoring.getByTestId("next-board").click();
	await expect(table).toHaveAttribute("data-board", "2");
});
