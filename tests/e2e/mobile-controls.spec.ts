import { expect, type Page, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";

import { Player } from "./player";
import { namePlayers } from "./room";

async function expectBotControlsInOneRow(page: Page): Promise<void> {
	const result = await page.locator(".room-bot-controls").evaluate((row) => {
		const bounds = row.getBoundingClientRect();
		const buttons = [...row.querySelectorAll("button")].filter((item) =>
			item.checkVisibility(),
		);
		return {
			form: row.closest<HTMLElement>(".room")?.dataset.form,
			lang: document.documentElement.lang,
			bounds: { left: bounds.left, right: bounds.right },
			boxes: buttons.map((item) => {
				const box = item.getBoundingClientRect();
				return {
					text: item.textContent,
					font: getComputedStyle(item).fontSize,
					top: box.top,
					bottom: box.bottom,
					left: box.left,
					right: box.right,
					clipped: item.scrollWidth > item.clientWidth,
				};
			}),
		};
	});
	expect(result.boxes).toHaveLength(4);
	expect(Math.max(...result.boxes.map((box) => box.top))).toBeLessThan(
		Math.min(...result.boxes.map((box) => box.bottom)),
	);
	for (const box of result.boxes) {
		expect(box.left).toBeGreaterThanOrEqual(result.bounds.left - 1);
		expect(box.right, JSON.stringify(result)).toBeLessThanOrEqual(
			result.bounds.right + 1,
		);
		expect(box.clipped).toBe(false);
	}
}

for (const locale of [
	"hu",
	"de",
	"no",
	"es",
	"pt",
	"fr",
	"it",
	"nl",
] as const) {
	test(`keeps the translated bot controls on one desktop row (${locale})`, async ({
		page,
	}) => {
		await page.addInitScript(
			(language) => localStorage.setItem("opentrick.locale", language),
			locale,
		);
		await mockBotBidding(page, () => "P");
		await page.goto("/");
		await namePlayers(page, "W", ["N", "E", "S"]);
		await page
			.getByTestId("create")
			.evaluate((button) => (button as HTMLButtonElement).click());
		const autoplay = page.getByTestId("host-autoplay-toggle");
		await expect(autoplay).toBeVisible();
		await expectBotControlsInOneRow(page);
		const pause = page.locator(".room-bot-controls button:visible").nth(2);
		const pauseLabel = await pause.textContent();
		await pause.click();
		await expect(pause).not.toHaveText(pauseLabel ?? "");
		const previousLabel = await autoplay.textContent();
		await autoplay.click();
		await page.getByTestId("autoplay-confirm-enable").click();
		await expect(autoplay).not.toHaveText(previousLabel ?? "");
		await expectBotControlsInOneRow(page);
		await page.setViewportSize({ width: 320, height: 800 });
		await expectBotControlsInOneRow(page);
	});
}

for (const size of ["M", "XXXL"] as const) {
	test(`keeps the bottom of the phone board visible while bidding changes at ${size}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 500 });
		await page.addInitScript(
			(value) =>
				localStorage.setItem("opentrick.settings.suit-font-size", value),
			size,
		);
		await mockBotBidding(page, (position) =>
			position.calls.length === 0 ? "1NT" : "P",
		);
		await page.goto("/");
		await namePlayers(page, "W", ["N", "E", "S"]);
		await page.getByTestId("create").click();
		await expect(page.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
		);
		const board = page.locator(".mobile-auction-board");
		const bottomVisible = () =>
			board.evaluate((element) => {
				const viewport = window.visualViewport;
				const bottom =
					(viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
				const edge = element.getBoundingClientRect().bottom;
				return edge >= (viewport?.offsetTop ?? 0) - 1 && edge <= bottom + 1;
			});
		await expect.poll(bottomVisible).toBe(true);
		await page.locator(".mobile-round-status > summary").click();
		await expect.poll(bottomVisible).toBe(true);
		await page.evaluate(
			(value) => {
				document.documentElement.dataset.suitFontSize = value;
			},
			size === "M" ? "XXXL" : "M",
		);
		await expect.poll(bottomVisible).toBe(true);
		await page.setViewportSize({ width: 390, height: 420 });
		await expect.poll(bottomVisible).toBe(true);
		await expect(page.getByTestId("bid-box")).toBeVisible();
	});
}

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
		await expectBotControlsInOneRow(page);
		await page.setViewportSize({ width: 320, height: 800 });
		await expectBotControlsInOneRow(page);
		await page.setViewportSize({ width: 360, height: 800 });
		const ownBot = page.getByTestId("host-autoplay-toggle");
		await expect(ownBot).toHaveText("Enable bot");
		await expect(ownBot).toHaveAttribute(
			"title",
			"Temporarily replace player with a bot",
		);
		await expect(
			page.locator(".room-bot-controls").getByTestId("host-autoplay-toggle"),
		).toBeVisible();
		await expect(
			page.locator(".seat-label").getByTestId("host-autoplay-toggle"),
		).toHaveCount(0);
		await expect(page.locator(".bridge-table")).toHaveAttribute(
			"data-phase",
			"auction",
		);
		await page.getByRole("button", { name: "Pause bots" }).click();
		await expect(
			page.getByRole("button", { name: "Resume bots" }),
		).toBeVisible();
		await expectBotControlsInOneRow(page);
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
				localStorage.getItem("opentrick.settings.scheme"),
			),
		).toBe("dark");
	} finally {
		await player.close();
	}
});
