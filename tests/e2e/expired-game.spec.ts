import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { CONNECT_MS, hostRows, namePlayers } from "./room";

/** A solo link has no other page to wait for, so it starts well before the 30 s seed wait of a shared link. */
const SOLO_START_MS = 15_000;

test.beforeEach(async ({ page }) => {
	// Set up wall-clock control before the app creates its timers; keep monotonic time and timers running.
	await page.clock.setFixedTime(Date.now());
});

for (const solo of [true, false]) {
	test(`an expired ${solo ? "solo" : "multiplayer"} tab offers both restart options`, async ({
		page,
	}) => {
		await mockBotBidding(page, () => "P");
		await page.goto("/");
		await namePlayers(page, "S", solo ? ["N", "E", "W"] : []);
		await page.getByLabel("South name").fill("test");
		await page.getByTestId("create").click();
		const table = page.getByTestId("table");
		await expect(hostRows(page)).toHaveAttribute("data-seat", "S");
		if (solo) await expect(table).toHaveAttribute("data-at", "2");
		const bookmark = page.url();
		await page.clock.setFixedTime(Date.now() + 9 * 60 * 60 * 1000);
		await expect(page.getByTestId("banner")).toHaveAttribute(
			"data-kind",
			"expired",
		);
		const restart = page.getByRole("button", {
			name: "Restart this game",
			exact: true,
		});
		await expect(restart).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Create new game", exact: true }),
		).toBeVisible();
		await restart.click();
		await expect(hostRows(page)).toHaveAttribute("data-seat", "S", {
			timeout: CONNECT_MS,
		});
		if (solo)
			await expect(table).toHaveAttribute("data-at", "2", {
				timeout: CONNECT_MS,
			});
		await expect(page).toHaveURL(bookmark);
		if (solo) await expect(page.getByTestId("waiting")).toBeHidden();
		// A subsequent expiry can instead open the new-table form without carrying the old key.
		await page.clock.setFixedTime(Date.now() + 18 * 60 * 60 * 1000);
		await expect(page.getByTestId("banner")).toHaveAttribute(
			"data-kind",
			"expired",
		);
		await page
			.getByRole("button", { name: "Create new game", exact: true })
			.click();
		await expect(page.getByTestId("create")).toBeVisible();
		expect(new URL(page.url()).hash).toBe("");
		expect(new URL(page.url()).search).toBe("");
	});
}

test("a solo bookmark starts a game without saved state and still works after expiry", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await mockBotBidding(page, () => "P");
	const key = randomBytes(16).toString("base64url");
	await page.goto(`/?n=bot&e=bot&s=test&w=bot&h=S&b=NEW&pl=S#k=${key}`);
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-at", "2", {
		timeout: SOLO_START_MS,
	});
	const bookmark = page.url();
	await page.clock.setFixedTime(Date.now() + 9 * 60 * 60 * 1000);
	await expect(page.getByTestId("banner")).toHaveAttribute(
		"data-kind",
		"expired",
	);
	await page.reload();
	await expect(table).toHaveAttribute("data-at", "2", {
		timeout: SOLO_START_MS,
	});
	await expect(page).toHaveURL(bookmark);
	await expect(page.getByTestId("waiting")).toBeHidden();
});

test("a solo link without a seat seats its only player and starts at once, also after expiry", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await mockBotBidding(page, () => "P");
	const key = randomBytes(16).toString("base64url");
	// A shared link names no seat, and expiry makes the browser forget the seat that it had.
	await page.goto(`/?n=bot&e=bot&s=test&w=bot&h=S&b=NEW#k=${key}`);
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-at", "2", {
		timeout: SOLO_START_MS,
	});
	await page.clock.setFixedTime(Date.now() + 9 * 60 * 60 * 1000);
	await expect(page.getByTestId("banner")).toHaveAttribute(
		"data-kind",
		"expired",
	);
	// The page wrote its seat into the address, so this opens the seatless link again.
	await page.goto(`/?n=bot&e=bot&s=test&w=bot&h=S&b=NEW#k=${key}`);
	await expect(table).toHaveAttribute("data-at", "2", {
		timeout: SOLO_START_MS,
	});
	await expect(page.getByTestId("waiting")).toBeHidden();
});
