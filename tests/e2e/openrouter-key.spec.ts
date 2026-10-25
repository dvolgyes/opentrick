import { expect, test } from "@playwright/test";
import { mockOpenRouter } from "./openrouter-mock";
import { makeCall } from "./room";

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
		{ model: "openai/gpt-6-luna", key: "Bearer bad-key" },
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
		model: "openai/gpt-6-luna",
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

test("Settings at the table checks a new key, keeps the dialog open on a failure, and gives the working key to the bots", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	// Settings holds the key and the model order, so the side panel has no separate buttons for them.
	await expect(
		page.getByRole("button", { name: "Set API key", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Model", exact: true }),
	).toHaveCount(0);

	const dialog = page.getByTestId("settings-dialog");
	const field = dialog.getByRole("textbox", { name: "OpenRouter API key" });
	openRouter.status = 402;
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await field.fill("empty-account-key");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toContainText("insufficient balance (402)");
	await expect(dialog).toBeVisible();
	expect(openRouter.requests).toEqual([
		{ model: "openai/gpt-6-luna", key: "Bearer empty-account-key" },
	]);

	openRouter.status = 200;
	await field.fill("good-key");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("bot-status")).toContainText(
		"The OpenRouter key works with openai/gpt-6-luna.",
	);
	expect(openRouter.requests.at(-1)).toEqual({
		model: "openai/gpt-6-luna",
		key: "Bearer good-key",
	});
	expect(
		await page.evaluate(() =>
			localStorage.getItem("opentrick.openrouter-api-key"),
		),
	).toBe("good-key");
});

test("a model order saved in Settings at the table goes to the running bots and to the table link", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	for (const seat of ["N", "E", "S"])
		await page.locator(`input[name="bot-${seat}"]`).check();
	await page.locator('input[name="openrouter-key"]').fill("good-key");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("table")).toHaveAttribute(
		"data-phase",
		"auction",
	);

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const dialog = page.getByTestId("settings-dialog");
	await dialog
		.getByRole("button", { name: "Move inception/mercury-3 · Responses up" })
		.click();
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	expect(
		new URL(page.url()).searchParams.get("bot_models")?.split(",").slice(0, 2),
	).toEqual(["inception/mercury-3", "openai/gpt-6-luna"]);

	// The next bot call after the host's bid asks the new first model.
	await expect(
		page
			.getByTestId("bid-box")
			.getByRole("button", { name: "Level 1", exact: true }),
	).toBeEnabled();
	const before = openRouter.requests.length;
	await makeCall(page, "1C");
	await expect
		.poll(() => openRouter.requests.slice(before).map(({ model }) => model))
		.toContain("inception/mercury-3");
	expect(
		openRouter.requests.slice(before).map(({ model }) => model),
	).not.toContain("openai/gpt-6-luna");
});

test("a seat switched to a bot without a key opens Settings, and the seat becomes a bot after the key works", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	const north = page.getByTestId("tile-N");
	await north.getByRole("button", { name: /Switch to bot$/ }).click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("bot-status")).toContainText(
		"Set an OpenRouter API key before switching a seat to a bot.",
	);
	await dialog
		.getByRole("textbox", { name: "OpenRouter API key" })
		.fill("good-key");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	await expect(
		north.getByRole("button", { name: /Switch to player$/ }),
	).toBeVisible();
	expect(openRouter.requests).toEqual([
		{ model: "openai/gpt-6-luna", key: "Bearer good-key" },
	]);
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

test("a key without its sk-or-v1- start, or with parts of it, gets the full start before the check and the save", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	const stored = () =>
		page.evaluate(() => localStorage.getItem("opentrick.openrouter-api-key"));
	const first = "0123456789abcdef".repeat(4);
	const second = "fedcba9876543210".repeat(4);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.locator('input[name="bot-N"]').check();
	await page.locator('input[name="openrouter-key"]').fill(`  or-v1-${first} `);
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	expect(openRouter.requests[0]).toEqual({
		model: "openai/gpt-6-luna",
		key: `Bearer sk-or-v1-${first}`,
	});
	expect(await stored()).toBe(`sk-or-v1-${first}`);

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const dialog = page.getByTestId("settings-dialog");
	await dialog
		.getByRole("textbox", { name: "OpenRouter API key" })
		.fill(`sk-${second}`);
	const before = openRouter.requests.length;
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	expect(openRouter.requests[before]).toEqual({
		model: "openai/gpt-6-luna",
		key: `Bearer sk-or-v1-${second}`,
	});
	expect(await stored()).toBe(`sk-or-v1-${second}`);
});

/** A key field that shows the key as typed, and that a phone keyboard does not change. */
const SHOWN_KEY_FIELD = [
	["type", "text"],
	["autocapitalize", "off"],
	["spellcheck", "false"],
] as const;

test("the key is shown as typed, not masked, on the create page and in Settings", async ({
	page,
}) => {
	await mockOpenRouter(page);
	const key = `sk-or-v1-${"0123456789abcdef".repeat(4)}`;
	await page.goto("/");
	const create = page.locator('input[name="openrouter-key"]');
	await page.locator('input[name="name-W"]').fill("host west");
	await page.locator('input[name="bot-N"]').check();
	await create.fill(key);
	for (const [name, value] of SHOWN_KEY_FIELD)
		await expect(create).toHaveAttribute(name, value);
	await expect(create).toHaveValue(key);
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page
		.getByTestId("settings-dialog")
		.getByRole("textbox", { name: "OpenRouter API key" });
	for (const [name, value] of SHOWN_KEY_FIELD)
		await expect(settings).toHaveAttribute(name, value);
	await expect(settings).toHaveValue(key);
});
