import { expect, type Page, test } from "@playwright/test";
import { translator } from "../../src/i18n";
import { deriveTableId } from "../../src/p2p/keys";
import { mockBotBidding } from "./bot-mock";

import { Player } from "./player";
import { CONNECT_MS, makeCall, namePlayers } from "./room";

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
	expect(result.boxes).toHaveLength(result.form === "compact" ? 2 : 3);
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

test("mobile keeps settings at the top and the remaining actions fill their row", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "mobile-layout", {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await mockBotBidding(page, () => "P");
		await namePlayers(page, "W", ["N", "E", "S"]);
		await page
			.getByTestId("create")
			.evaluate((node) => (node as HTMLButtonElement).click());
		await expect(page.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
		);
		await expect(
			page
				.locator(".mobile-auction-topbar")
				.getByRole("button", { name: "Settings", exact: true }),
		).toBeVisible({ timeout: 1500 });
		for (const name of ["Reload", "Pause bots", "Resume bots"])
			await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
				0,
				{ timeout: 1500 },
			);
		await expect(page.getByTestId("bot-status")).toContainText("Running");
		await expect(page.getByTestId("bot-status")).toBeHidden();
		const row = page.locator(".room-bot-controls");
		const host = row.getByRole("button", {
			name: "Host controls",
			exact: true,
		});
		const autoplay = row.getByRole("button", {
			name: "Enable autoplay",
			exact: true,
		});
		for (const width of [320, 360, 390]) {
			await page.setViewportSize({ width, height: 800 });
			const top = await page.locator(".mobile-auction-topbar").boundingBox();
			const box = await row.boundingBox();
			const left = await host.boundingBox();
			const right = await autoplay.boundingBox();
			if (!top || !box || !left || !right)
				throw new Error("mobile controls missing");
			expect(box.y - top.y - top.height).toBeLessThan(12);
			expect(box.y).toBeGreaterThanOrEqual(top.y + top.height);
			expect(Math.abs(left.x - box.x)).toBeLessThan(2);
			expect(Math.abs(right.x + right.width - box.x - box.width)).toBeLessThan(
				2,
			);
			expect(Math.abs(left.y - right.y)).toBeLessThan(2);
			expect(left.x + left.width).toBeLessThanOrEqual(right.x);
		}
		await page
			.locator(".mobile-auction-topbar")
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await expect(page.getByTestId("settings-dialog")).toBeVisible();
	} finally {
		await player.close();
	}
});

test("mobile settings remain in the top bar while waiting for players", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "waiting-mobile", {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await namePlayers(page, "W");
		await page
			.getByTestId("create")
			.evaluate((node) => (node as HTMLButtonElement).click());
		await expect(page.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"waiting",
		);
		const top = page.locator(".mobile-auction-topbar");
		await expect(
			top.getByRole("button", { name: "Settings", exact: true }),
		).toBeVisible({ timeout: 1500 });
		await expect(
			page.getByRole("button", { name: "Settings", exact: true }),
		).toHaveCount(1);
		await top.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(page.getByTestId("settings-dialog")).toBeVisible();
	} finally {
		await player.close();
	}
});

test("mobile undo confirms and takes back the declarer's last card", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "mobile-undo", {
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await mockBotBidding(page, () => "P");
		await namePlayers(page, "W", ["N", "E", "S"]);
		await page
			.getByTestId("create")
			.evaluate((node) => (node as HTMLButtonElement).click());
		const table = page.getByTestId("table");
		await expect(page.getByTestId("hand-W")).toHaveAttribute(
			"data-turn",
			"true",
			{
				timeout: CONNECT_MS,
			},
		);
		await makeCall(page, "1C");
		await expect(table).toHaveAttribute("data-phase", "play", {
			timeout: CONNECT_MS,
		});
		const dummy = page.locator(".mobile-board-top");
		await dummy
			.locator("button.card:enabled")
			.first()
			.click({ timeout: CONNECT_MS });
		await expect(page.getByTestId("hand-W")).toHaveAttribute(
			"data-turn",
			"true",
			{
				timeout: CONNECT_MS,
			},
		);
		await expect(dummy.locator("button.card")).toHaveCount(12);
		await expect(
			page.getByRole("button", { name: "Claim all", exact: true }),
		).toBeVisible();
		const undo = page.getByTestId("undo-request");
		await expect(undo).toBeEnabled();
		await undo.click();
		const confirmation = page.getByTestId("undo-confirm");
		await expect(confirmation).toContainText(
			"Ask to undo your last played card?",
		);
		await confirmation.getByTestId("undo-confirm-cancel").click();
		await expect(dummy.locator("button.card")).toHaveCount(12);
		await undo.click();
		await confirmation.getByTestId("undo-confirm-send").click();
		await expect(dummy.locator("button.card")).toHaveCount(13, {
			timeout: CONNECT_MS,
		});
	} finally {
		await player.close();
	}
});

test("desktop removes the date and routine reload and pause controls", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P");
	await page.goto("/solo");
	await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1");
	await expect(
		page.locator(".room-header-controls").getByTestId("build-version"),
	).toBeHidden({ timeout: 1500 });
	for (const name of ["Reload", "Pause bots", "Resume bots"])
		await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
			0,
			{ timeout: 1500 },
		);
	await expect(
		page.getByRole("button", { name: "Settings", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Exit", exact: true }),
	).toBeVisible();
	await expect(page.getByTestId("bot-status")).toBeHidden();
});

test("a phone can retry bots left paused by an earlier version", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "paused-mobile", {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await mockBotBidding(page, () => "P");
		await page.goto("/solo");
		await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1");
		const key = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("k");
		if (!key) throw new Error("table key missing");
		const tableId = await deriveTableId(key);
		await page.evaluate(
			(id) => localStorage.setItem(`opentrick.bots-paused.${id}`, "1"),
			tableId,
		);
		await page.reload();
		const retry = page.getByTestId("retry-bots");
		await expect(retry).toBeVisible();
		await expect(page.getByTestId("bot-alert")).toHaveText("Bots paused.");
		await expect(page.getByTestId("bot-alert")).toBeVisible();
		const before = Number(
			await page.getByTestId("table").getAttribute("data-at"),
		);
		await retry.click();
		await expect(retry).toBeHidden();
		await expect(page.getByTestId("bot-status")).toBeHidden();
		await expect
			.poll(async () =>
				Number(await page.getByTestId("table").getAttribute("data-at")),
			)
			.toBeGreaterThan(before);
	} finally {
		await player.close();
	}
});

test("a phone can retry after the local bot fails", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "failed-mobile", {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		let workers = 0;
		await page.route(/\/bid-worker-[^/]+\.js$/, (route) => {
			workers += 1;
			return route.fulfill({
				contentType: "text/javascript",
				body:
					workers === 1
						? "self.onmessage = () => self.postMessage({ok: false});"
						: 'self.onmessage = ({data}) => self.postMessage({ok: true, analysis: {call: "P", policy: data.policy, candidates: []}});',
			});
		});
		await page.goto("/solo");
		await expect(page.getByTestId("bot-alert")).toHaveText(
			"The local bot failed.",
		);
		await expect(page.getByTestId("bot-alert")).toBeVisible();
		const retry = page.getByTestId("retry-bots");
		await expect(retry).toBeVisible();
		const before = Number(
			await page.getByTestId("table").getAttribute("data-at"),
		);
		await retry.click();
		await expect(retry).toBeHidden();
		await expect
			.poll(async () =>
				Number(await page.getByTestId("table").getAttribute("data-at")),
			)
			.toBeGreaterThan(before);
		expect(workers).toBeGreaterThanOrEqual(2);
	} finally {
		await player.close();
	}
});

test("desktop bot recovery remains clickable with the bidding guide open", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P");
	await page.goto("/solo/");
	await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1");
	const key = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("k");
	if (!key) throw new Error("table key missing");
	const tableId = await deriveTableId(key);
	await page.evaluate(
		(id) => localStorage.setItem(`opentrick.bots-paused.${id}`, "1"),
		tableId,
	);
	await page.reload();
	await expect(page.getByTestId("side-guide")).toBeVisible();
	await expect(page.getByTestId("bot-alert")).toHaveText("Bots paused.");
	await page.getByTestId("retry-bots").click({ timeout: 4000 });
	await expect(page.getByTestId("retry-bots")).toBeHidden();
});

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
		await expect(
			page.getByRole("button", {
				name: translator(locale)("Exit"),
				exact: true,
			}),
		).toBeVisible();
		await expectBotControlsInOneRow(page);
		const previousLabel = await autoplay.textContent();
		await autoplay.click();
		await page.getByTestId("autoplay-confirm-enable").click();
		await expect(autoplay).not.toHaveText(previousLabel ?? "");
		await expectBotControlsInOneRow(page);
		await page.setViewportSize({ width: 320, height: 800 });
		await expectBotControlsInOneRow(page);
		const t = translator(locale);
		await page.getByRole("button", { name: t("Exit"), exact: true }).click();
		const confirmation = page.getByRole("dialog", { name: `${t("Exit")}?` });
		await expect(confirmation).toContainText(
			t("Leave this game and return to the home screen?"),
		);
		const bounds = await confirmation.boundingBox();
		if (!bounds) throw new Error("Exit confirmation missing");
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
		await confirmation
			.getByRole("button", { name: t("Cancel"), exact: true })
			.click();
		await expect(confirmation).toBeHidden();
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
test("on a phone the host finds each top-bar button once and changes display settings", async ({
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
		await expect(page.getByRole("button", { name: "Pause bots" })).toHaveCount(
			0,
		);
		await expectBotControlsInOneRow(page);
		await page.setViewportSize({ width: 320, height: 800 });
		await expectBotControlsInOneRow(page);
		await page.setViewportSize({ width: 360, height: 800 });
		const ownBot = page.getByTestId("host-autoplay-toggle");
		await expect(ownBot).toHaveText("Enable autoplay");
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
		await expect(page.getByRole("button", { name: "Resume bots" })).toHaveCount(
			0,
		);
		await expectBotControlsInOneRow(page);
		// During the auction the top bar holds Settings, Exit and Send link to players.
		for (const [name, count] of [
			["Reload", 0],
			["Settings", 1],
			["Exit", 1],
			["Send link to players", 1],
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
				.getByRole("button", { name: "Settings", exact: true }),
		).toBeVisible();
		// Host controls opens a dialog with the host's Reload players and Reset (Debug is hidden for now), and the seat
		// switches in a closed group; Close closes it.
		await page
			.getByRole("button", { name: "Host controls", exact: true })
			.click();
		const hostControls = page.getByTestId("host-controls-dialog");
		for (const name of ["Reload players", "Reset", "Close"])
			await expect(
				hostControls.getByRole("button", { name, exact: true }),
				name,
			).toBeInViewport();
		await hostControls.getByText("Optional automated players").click();
		await expect(
			hostControls.getByRole("button", { name: /Switch to player$/ }).first(),
		).toBeVisible();
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
