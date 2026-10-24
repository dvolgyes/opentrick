import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./openrouter-mock";

/*
 * Saving an OpenRouter key sends one bot bid to the first model in the priority list, so the player sees at once
 * whether the key and the model work (src/bot/key-check.ts). The mock answers with the HTTP status that the test sets.
 */

test("Create checks the key with the first model, and a rejected key keeps the player on the create page", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	openRouter.status = 401;
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.locator('input[name="openrouter-key"]').fill("bad-key");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("errors")).toContainText(
		"OpenRouter rejected the API key (401)",
	);
	await expect(page.getByTestId("create")).toBeEnabled();
	await expect(page.getByTestId("room-controls")).toHaveCount(0);
	expect(openRouter.requests).toEqual([
		{ model: "inception/mercury-3", key: "Bearer bad-key" },
	]);
	expect(
		await page.evaluate(() =>
			localStorage.getItem("opentrick.openrouter-api-key"),
		),
	).toBe("bad-key");

	openRouter.status = 200;
	await page.locator('input[name="openrouter-key"]').fill("good-key");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	expect(openRouter.requests.at(-1)).toEqual({
		model: "inception/mercury-3",
		key: "Bearer good-key",
	});
});

test("Create without a key and without bot seats sends no request to OpenRouter", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	expect(openRouter.requests).toEqual([]);
});

test("Save key at the table checks the key, keeps the dialog open on a failure, and closes it when the key works", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();

	const dialog = page.getByTestId("api-key-dialog");
	const field = dialog.getByRole("textbox", { name: "OpenRouter API key" });
	openRouter.status = 402;
	await page.getByRole("button", { name: "Set API key" }).click();
	await field.fill("empty-account-key");
	await dialog.getByRole("button", { name: "Save key" }).click();
	await expect(dialog).toContainText("insufficient balance (402)");
	await expect(dialog).toBeVisible();
	expect(openRouter.requests).toEqual([
		{ model: "inception/mercury-3", key: "Bearer empty-account-key" },
	]);

	openRouter.status = 200;
	await field.fill("good-key");
	await dialog.getByRole("button", { name: "Save key" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("bot-status")).toContainText(
		"The OpenRouter key works with inception/mercury-3.",
	);
	expect(openRouter.requests.at(-1)).toEqual({
		model: "inception/mercury-3",
		key: "Bearer good-key",
	});
	expect(
		await page.evaluate(() =>
			localStorage.getItem("opentrick.openrouter-api-key"),
		),
	).toBe("good-key");
});

test("a key stored in this browser fills a new create page and runs the bots, also after a reload", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	// The key stays in this browser from an earlier visit; the player does not type it again.
	await page.evaluate(() =>
		localStorage.setItem("opentrick.openrouter-api-key", "stored-key"),
	);
	await page.reload();
	await expect(page.locator('input[name="openrouter-key"]')).toHaveValue(
		"stored-key",
	);
	for (const seat of ["N", "E", "S", "W"]) {
		await page.locator(`input[name="name-${seat}"]`).fill(`robot ${seat}`);
		await page.locator(`input[name="bot-${seat}"]`).check();
	}
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	// The key check, then at least one bot call.
	await expect.poll(() => openRouter.requests.length).toBeGreaterThan(1);
	await page.getByRole("button", { name: "Pause bots" }).click();
	await page.reload();
	const beforeResume = openRouter.requests.length;
	await page.getByRole("button", { name: "Resume bots" }).click();
	await expect
		.poll(() => openRouter.requests.length, { timeout: 60_000 })
		.toBeGreaterThan(beforeResume);
	expect(new Set(openRouter.requests.map((request) => request.key))).toEqual(
		new Set(["Bearer stored-key"]),
	);
});
