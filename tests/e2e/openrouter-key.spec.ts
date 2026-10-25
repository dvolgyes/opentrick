import { expect, type Page, test } from "@playwright/test";
import { mockOpenRouter } from "./openrouter-mock";
import { makeCall } from "./room";

/*
 * Saving an OpenRouter key reads the key and its balance from OpenRouter, without a model request, so the player sees
 * at once whether the key works (src/bot/openrouter-balance.ts). A key is accepted when its balance is above $0.10,
 * or when OpenRouter reports no amount. The mock answers with the HTTP status and the amounts that the test sets.
 */

const storedKey = (page: Page) =>
	page.evaluate(() => localStorage.getItem("opentrick.openrouter-api-key"));

test("Create checks the key with OpenRouter, and a rejected key keeps the player on the create page", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	openRouter.keyStatus = 401;
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.locator('input[name="openrouter-key"]').fill("bad-key");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("errors")).toContainText(
		"OpenRouter rejected the API key (401).",
	);
	await expect(page.getByTestId("create")).toBeEnabled();
	await expect(page.getByTestId("room-controls")).toHaveCount(0);
	expect(openRouter.keyChecks).toEqual(["Bearer bad-key"]);
	expect(openRouter.requests).toEqual([]);
	expect(await storedKey(page)).toBe("bad-key");

	openRouter.keyStatus = 503;
	await page.getByTestId("create").click();
	await expect(page.getByTestId("errors")).toContainText(
		"OpenRouter returned HTTP 503 for the key check.",
	);

	openRouter.keyStatus = 200;
	await page.locator('input[name="openrouter-key"]').fill("good-key");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	expect(openRouter.keyChecks.at(-1)).toBe("Bearer good-key");
	expect(openRouter.requests).toEqual([]);
});

test("Create refuses a key whose balance is $0.10 or less, and accepts one above $0.10", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	openRouter.balance = { limitRemaining: 0.1, credits: 10, usage: 0 };
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.locator('input[name="openrouter-key"]').fill("poor-key");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("errors")).toContainText(
		"The OpenRouter balance is $0.10. A key needs more than $0.10.",
	);
	await expect(page.getByTestId("room-controls")).toHaveCount(0);

	openRouter.balance = { limitRemaining: null, credits: 1, usage: 0.85 };
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	expect(openRouter.keyChecks).toEqual(["Bearer poor-key", "Bearer poor-key"]);
	expect(openRouter.requests).toEqual([]);
	expect(await storedKey(page)).toBe("poor-key");
});

test("Create without a key and without bot seats sends no request to OpenRouter", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	expect(openRouter.keyChecks).toEqual([]);
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
	openRouter.balance = { limitRemaining: null, credits: 5, usage: 4.95 };
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await field.fill("empty-account-key");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toContainText(
		"The OpenRouter balance is $0.05. A key needs more than $0.10.",
	);
	await expect(dialog).toBeVisible();
	expect(openRouter.keyChecks).toEqual(["Bearer empty-account-key"]);
	expect(await storedKey(page)).toBeNull();

	openRouter.balance = { limitRemaining: 2.5, credits: 10, usage: 0 };
	await field.fill("good-key");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("bot-status")).toContainText(
		"The OpenRouter key works. Balance: $2.5.",
	);
	expect(openRouter.keyChecks.at(-1)).toBe("Bearer good-key");
	expect(openRouter.requests).toEqual([]);
	expect(await storedKey(page)).toBe("good-key");
});

test("Settings at the table accepts a key whose balance OpenRouter does not report", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();

	openRouter.balance = { limitRemaining: null, credits: 0, usage: 0 };
	openRouter.creditsStatus = 403;
	const dialog = page.getByTestId("settings-dialog");
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await dialog
		.getByRole("textbox", { name: "OpenRouter API key" })
		.fill("good-key");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("bot-status")).toContainText(
		"The OpenRouter key works. OpenRouter did not report the balance.",
	);
	expect(await storedKey(page)).toBe("good-key");
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
	expect(openRouter.keyChecks).toEqual(["Bearer good-key"]);
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
	// The check at create, then the balance read at the start of each board.
	expect(openRouter.keyChecks[0]).toBe("Bearer stored-key");
	await expect.poll(() => openRouter.requests.length).toBeGreaterThan(0);
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
	expect(new Set(openRouter.keyChecks)).toEqual(new Set(["Bearer stored-key"]));
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
	expect(openRouter.keyChecks[0]).toBe(`Bearer sk-or-v1-${first}`);
	expect(await stored()).toBe(`sk-or-v1-${first}`);

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const dialog = page.getByTestId("settings-dialog");
	await dialog
		.getByRole("textbox", { name: "OpenRouter API key" })
		.fill(`sk-${second}`);
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	expect(openRouter.keyChecks.at(-1)).toBe(`Bearer sk-or-v1-${second}`);
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

test("the table shows the cost and the balance, and reads the balance again at the start of each board", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	for (const seat of ["N", "E", "S"])
		await page.locator(`input[name="bot-${seat}"]`).check();
	await page.locator('input[name="openrouter-key"]').fill("good-key");
	await page.getByTestId("create").click();
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-board", "1");
	await expect(page.getByTestId("bot-spend")).toHaveText(
		/^Cost: \$\d+\.\d{4}$/,
	);
	await expect(page.getByTestId("bot-balance")).toHaveText("Balance: $10.0");
	// The check at create, and the read at the start of board 1.
	expect(openRouter.keyChecks).toEqual(["Bearer good-key", "Bearer good-key"]);

	// The bots pass, so the host's pass ends board 1 and board 2 starts.
	openRouter.balance = { limitRemaining: 7.42, credits: 10, usage: 0 };
	await expect(
		page.getByTestId("bid-box").getByRole("button", { name: "Pass" }),
	).toBeEnabled({ timeout: 30_000 });
	await makeCall(page, "P");
	await expect(table).toHaveAttribute("data-board", "2", { timeout: 30_000 });
	await expect(page.getByTestId("bot-balance")).toHaveText("Balance: $7.4");
	expect(openRouter.keyChecks).toHaveLength(3);
});
