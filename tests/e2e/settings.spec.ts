import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockOpenRouter } from "./openrouter-mock";
import { Player } from "./player";

/*
 * Settings opens a dialog of the player's own choices, kept in this browser's local storage under the opentrick
 * prefix (src/ui/settings.ts). A new key or a custom model must pass one OpenRouter request before Save stores it.
 */
const CUSTOM = "vendor/custom-model";

async function openTable(page: Page): Promise<void> {
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
}

async function openSettings(page: Page): Promise<Locator> {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	return dialog;
}

const modelOrder = (dialog: Locator): Promise<string[]> =>
	dialog
		.locator(".model-priority-list li")
		.evaluateAll((items) =>
			items.map((item) => item.getAttribute("data-model") ?? ""),
		);

test("Settings shows the defaults, and Save keeps the choices in this browser after a reload", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await openTable(page);
	let dialog = await openSettings(page);
	await expect(dialog.getByLabel("Language")).toHaveValue("auto");
	await expect(dialog.getByLabel("Corrected Milton HCP")).toBeChecked();
	await expect(dialog.getByLabel("Light")).toBeChecked();
	for (const flag of [
		"Frame the player whose turn it is to bid",
		"Frame the player whose turn it is to play",
		"Show as text whose turn it is to bid",
		"Show as text whose turn it is to play",
		"Show the network quality",
	])
		await expect(dialog.getByLabel(flag)).toBeChecked();
	const relayChecks = dialog.getByLabel("Check the connection more often");
	await expect(relayChecks).not.toBeChecked();
	await expect(relayChecks).toHaveAccessibleDescription(
		/network connection is unstable/,
	);
	// An empty custom model is last, and it does not move.
	expect((await modelOrder(dialog)).at(-1)).toBe("custom");
	await expect(
		dialog.getByRole("button", { name: "Move Custom model (not set) up" }),
	).toBeDisabled();

	await dialog.getByLabel("Vienna (7-5-3-1)").check();
	await dialog.getByLabel("Dark").check();
	await dialog.getByLabel("Frame the player whose turn it is to bid").uncheck();
	await dialog.getByLabel("Show the network quality").uncheck();
	await relayChecks.check();
	const firstModel = (await modelOrder(dialog))[0];
	await dialog
		.locator(".model-priority-list li")
		.nth(1)
		.getByRole("button", { name: /up$/ })
		.click();
	const order = await modelOrder(dialog);
	expect(order[1]).toBe(firstModel);
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(dialog).toBeHidden();
	expect(openRouter.requests).toEqual([]);
	expect(
		await page.evaluate(() =>
			Object.keys(localStorage)
				.filter((name) => name.startsWith("opentrick.settings."))
				.sort(),
		),
	).toEqual([
		"opentrick.settings.bid-turn-frame",
		"opentrick.settings.bid-turn-text",
		"opentrick.settings.model-order",
		"opentrick.settings.network-quality",
		"opentrick.settings.play-turn-frame",
		"opentrick.settings.play-turn-text",
		"opentrick.settings.points",
		"opentrick.settings.relay-checks",
		"opentrick.settings.theme",
	]);

	await page.reload();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	dialog = await openSettings(page);
	await expect(dialog.getByLabel("Vienna (7-5-3-1)")).toBeChecked();
	await expect(dialog.getByLabel("Dark")).toBeChecked();
	await expect(
		dialog.getByLabel("Frame the player whose turn it is to bid"),
	).not.toBeChecked();
	await expect(
		dialog.getByLabel("Frame the player whose turn it is to play"),
	).toBeChecked();
	await expect(dialog.getByLabel("Show the network quality")).not.toBeChecked();
	await expect(
		dialog.getByLabel("Check the connection more often"),
	).toBeChecked();
	expect(await modelOrder(dialog)).toEqual(order);

	// Cancel keeps the stored choices.
	await dialog.getByLabel("No", { exact: true }).check();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	dialog = await openSettings(page);
	await expect(dialog.getByLabel("Vienna (7-5-3-1)")).toBeChecked();
});

test("a custom model needs a key and a working check, then goes first in the model order", async ({
	page,
}) => {
	const openRouter = await mockOpenRouter(page);
	await openTable(page);
	const dialog = await openSettings(page);
	const custom = dialog.getByRole("textbox", { name: "Custom model" });
	const key = dialog.getByLabel("OpenRouter API key");
	const save = dialog.getByRole("button", { name: "Save settings" });

	await custom.fill("not a model");
	await save.click();
	await expect(dialog.getByRole("status")).toHaveText(
		"Enter an OpenRouter model id, for example vendor/model.",
	);
	await custom.fill(CUSTOM);
	expect((await modelOrder(dialog))[0]).toBe("custom");
	await save.click();
	await expect(dialog.getByRole("status")).toHaveText(
		"Enter an OpenRouter API key to use a custom model.",
	);
	expect(openRouter.requests).toEqual([]);

	openRouter.status = 404;
	await key.fill("good-key");
	await save.click();
	await expect(dialog.getByRole("status")).toContainText(
		`The OpenRouter key check with ${CUSTOM} failed: OpenRouter could not find this model (404).`,
	);
	await expect(dialog).toBeVisible();
	expect(openRouter.requests).toEqual([
		{ model: CUSTOM, key: "Bearer good-key" },
	]);
	expect(
		await page.evaluate(() => [
			localStorage.getItem("opentrick.settings.custom-model"),
			localStorage.getItem("opentrick.openrouter-api-key"),
		]),
	).toEqual([null, null]);

	openRouter.status = 200;
	await save.click();
	await expect(dialog).toBeHidden();
	expect(openRouter.requests.at(-1)).toEqual({
		model: CUSTOM,
		key: "Bearer good-key",
	});
	expect(
		await page.evaluate(() => [
			localStorage.getItem("opentrick.settings.custom-model"),
			localStorage.getItem("opentrick.openrouter-api-key"),
			localStorage.getItem("opentrick.settings.model-order")?.split(",")[0],
		]),
	).toEqual([CUSTOM, "good-key", "custom"]);

	// An empty custom model goes last; set again, it goes first.
	await openSettings(page);
	await expect(dialog.locator(".model-priority-list li").first()).toContainText(
		CUSTOM,
	);
	await custom.fill("");
	expect((await modelOrder(dialog)).at(-1)).toBe("custom");
	await save.click();
	await expect(dialog).toBeHidden();
	await openSettings(page);
	await custom.fill(CUSTOM);
	expect((await modelOrder(dialog))[0]).toBe("custom");
});

test("a new language in Settings reloads the page in that language", async ({
	page,
}) => {
	await openTable(page);
	const dialog = await openSettings(page);
	await dialog.getByLabel("Language").selectOption("de");
	await dialog.getByRole("button", { name: "Save settings" }).click();
	await expect(
		page.getByRole("button", { name: "Einstellungen", exact: true }),
	).toBeVisible();
	expect(
		await page.evaluate(() => localStorage.getItem("opentrick.locale")),
	).toBe("de");
});

test("on a phone, Settings is below the board and its dialog fits the screen", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "phone", {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await page.locator('input[name="name-W"]').fill("host west");
		await page.getByTestId("create").click();
		const settings = page.getByRole("button", {
			name: "Settings",
			exact: true,
		});
		await settings.scrollIntoViewIfNeeded();
		await expect(settings).toBeVisible();
		const board = await page.getByTestId("table").boundingBox();
		const button = await settings.boundingBox();
		if (!board || !button) throw new Error("the board or Settings has no box");
		expect(button.y).toBeGreaterThanOrEqual(board.y + board.height);
		await settings.click();
		const dialog = page.getByTestId("settings-dialog");
		await expect(dialog).toBeVisible();
		const box = await dialog.boundingBox();
		if (!box) throw new Error("the settings dialog has no box");
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(360);
		expect(box.y + box.height).toBeLessThanOrEqual(800);
		const save = dialog.getByRole("button", { name: "Save settings" });
		await save.scrollIntoViewIfNeeded();
		await expect(save).toBeInViewport();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	} finally {
		await player.close();
	}
});
