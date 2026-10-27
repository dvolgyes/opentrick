import {
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { loadEnv } from "vite";
import { readMeshConfig } from "../../src/p2p/config";
import { mockBotBidding } from "./bot-mock";
import { RelayHub } from "./relay-hub";
import { makeCall } from "./room";

async function players(
	browser: Browser,
	baseURL: string,
	count: number,
): Promise<{ contexts: BrowserContext[]; pages: Page[]; errors: string[] }> {
	const parsed = readMeshConfig(
		loadEnv("production", process.cwd(), [
			"VITE_TRACKER_",
			"VITE_NOSTR_",
			"VITE_MQTT_",
			"VITE_STUN_",
		]),
	);
	if (!parsed.ok) throw new Error(parsed.error);
	const hubs = [
		new RelayHub("tracker", parsed.config.trackers),
		new RelayHub("nostr", parsed.config.nostrRelays),
		new RelayHub("mqtt", parsed.config.mqttBrokers),
	];
	const contexts: BrowserContext[] = [];
	const pages: Page[] = [];
	const errors: string[] = [];
	for (let index = 0; index < count; index++) {
		const context = await browser.newContext({ baseURL, locale: "en" });
		contexts.push(context);
		for (const hub of hubs) await hub.install(context, String(index));
		await context.addInitScript(() => {
			if (!navigator.mediaDevices) return;
			navigator.mediaDevices.getUserMedia = async () => {
				throw new Error("community attempted media capture");
			};
		});
		const page = await context.newPage();
		pages.push(page);
		page.on("pageerror", (error) => errors.push(error.message));
		await mockBotBidding(page, () => "P");
	}
	return { contexts, pages, errors };
}

async function enter(
	page: Page,
	name: string,
	shape = "0",
	link = "/",
	mode = "both",
	bidder = "sl",
): Promise<void> {
	await page.goto(link);
	if (link.includes("#community=")) {
		await page.getByTestId("community-name").fill(name);
		await page.getByTestId("community-enter").click();
		return;
	}
	await page.locator('input[name="name-N"]').fill(name);
	await page.locator('input[name="me"][value="N"]').check();
	if (shape === "1")
		await page
			.locator('input[name="name-S"]')
			.fill(name === "Alice" ? "Bob" : "Dan");
	await page.getByTestId(`preset-${mode}`).click();
	await page.locator('select[name="bot-bidder"]').selectOption(bidder);
	await page.getByTestId("create").click();
}

async function setWait(page: Page, minutes: string): Promise<void> {
	await page.getByText("Bot wait", { exact: true }).click();
	await page.getByTestId("community-wait").fill(minutes);
	await page.getByTestId("community-wait").press("Tab");
}

test("centre presets preserve named friends, configure both checkboxes, and fit a phone", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.locator('input[name="name-S"]').fill("Alice");
	await page.locator('input[name="name-N"]').fill("Bob");
	for (const [preset, bot, online] of [
		["bots", true, false],
		["online", false, true],
		["both", true, true],
	] as const) {
		await page.getByTestId(`preset-${preset}`).click();
		for (const seat of ["E", "W"]) {
			await expect(page.locator(`input[name="bot-${seat}"]`)).toBeChecked({
				checked: bot,
			});
			await expect(page.locator(`input[name="online-${seat}"]`)).toBeChecked({
				checked: online,
			});
			await expect(
				page.locator(`input[name="me"][value="${seat}"]`),
			).toBeDisabled();
		}
		for (const seat of ["N", "S"]) {
			await expect(page.locator(`input[name="bot-${seat}"]`)).not.toBeChecked();
			await expect(
				page.locator(`input[name="online-${seat}"]`),
			).not.toBeChecked();
		}
	}
	await page.locator('input[name="name-E"]').fill("Carol");
	await expect(page.locator('input[name="bot-E"]')).not.toBeChecked();
	await expect(page.locator('input[name="online-E"]')).not.toBeChecked();
	await expect(page.locator('input[name="me"][value="E"]')).toBeEnabled();
	const grid = page.getByTestId("seat-grid");
	const east = await grid.locator('[data-seat="E"]').boundingBox();
	const west = await grid.locator('[data-seat="W"]').boundingBox();
	const center = await page.getByTestId("preset-both").boundingBox();
	if (!east || !west || !center) throw new Error("seat grid missing");
	expect(east.x + east.width).toBeLessThanOrEqual(center.x);
	expect(center.x + center.width).toBeLessThanOrEqual(west.x);
	for (const seat of ["N", "S"]) {
		const box = await grid.locator(`[data-seat="${seat}"]`).boundingBox();
		expect(Math.abs((box?.width ?? 0) - east.width)).toBeLessThan(1);
	}
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: "/tmp/community-create-mobile.png",
		fullPage: true,
	});
});

test("solo online entry starts searching without a separate community setup form", async ({
	page,
}) => {
	await page.goto("/");
	await page.locator('input[name="solo-name"]').fill("Alice");
	await expect(page.getByTestId("create-solo")).toHaveText(
		"Start solo game (with bots)",
	);
	await page.getByTestId("join-online").click();
	await expect(page.getByTestId("community-status")).toHaveText(
		"Searching for compatible players…",
	);
	await expect(page.getByTestId("community-name")).toHaveCount(0);
	await expect(page.getByTestId("community-ready")).toHaveCount(0);
	await expect(
		page.getByTestId("community-members").locator('[data-seat="S"]'),
	).toContainText("Alice");
});

test("two solos merge automatically, wait for both bot timers, and reload into the reserved game", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("base URL missing");
	const { contexts, pages, errors } = await players(browser, baseURL, 2);
	try {
		const [a, b] = pages;
		if (!a || !b) throw new Error("players missing");
		await enter(a, "Alice", "0", "/", "both", "rl-fsp");
		await enter(b, "Bob", "0", "/", "both", "rl-fsp");
		for (const page of pages) {
			await expect(page.getByTestId("community-members")).toContainText(
				"Alice",
				{ timeout: 45_000 },
			);
			await expect(page.getByTestId("community-members")).toContainText("Bob", {
				timeout: 45_000,
			});
			await expect(page.getByTestId("community-accept")).toHaveCount(0);
		}
		await setWait(a, "0");
		await expect(a.getByTestId("table")).toBeHidden();
		await setWait(b, "0");
		for (const page of pages)
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-board",
				"1",
				{ timeout: 45_000 },
			);
		const keyA = new URL(a.url()).hash;
		for (const page of pages) {
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			await expect(
				page
					.getByTestId("settings-dialog")
					.getByLabel("BRL RL/FSP", { exact: true }),
			).toBeChecked();
			await page
				.getByTestId("settings-dialog")
				.getByRole("button", { name: "Cancel", exact: true })
				.click();
		}
		expect(new URL(b.url()).hash === keyA).toBe(true);
		await a.reload();
		await expect(a.getByTestId("table")).toHaveAttribute("data-board", "1", {
			timeout: 45_000,
		});
		expect(errors).toEqual([]);
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});

test("friends confirm an opposite pair before it appears in discovery", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("base URL missing");
	const { contexts, pages, errors } = await players(browser, baseURL, 2);
	try {
		const [a, b] = pages;
		if (!a || !b) throw new Error("players missing");
		await enter(a, "Alice", "1", "/", "online");
		await expect(a.getByTestId("community-status")).toHaveText(
			"Waiting for invited players…",
		);
		await enter(b, "Bob", "0", a.url());
		for (const page of pages) {
			await expect(page.getByTestId("community-status")).toHaveText(
				"Searching for compatible players…",
				{ timeout: 45_000 },
			);
			await expect(
				page.getByTestId("community-members").locator(".seat-card"),
			).toHaveCount(4);
			await expect(
				page.getByTestId("community-members").locator('[data-seat="N"]'),
			).toContainText("Alice");
			await expect(
				page.getByTestId("community-members").locator('[data-seat="S"]'),
			).toContainText("Bob");
		}
		expect(errors).toEqual([]);
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});

test("an absent player gets bot cover for the board and returns to the reserved seat", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("base URL missing");
	const { contexts, pages, errors } = await players(browser, baseURL, 2);
	try {
		const [a, b] = pages;
		if (!a || !b) throw new Error("players missing");
		await enter(a, "Alice", "1");
		await enter(b, "Bob", "0", a.url());
		for (const page of pages) {
			await expect(page.getByTestId("community-status")).toHaveText(
				"Searching for compatible players…",
				{ timeout: 45_000 },
			);
			await setWait(page, "0");
		}
		for (const page of pages)
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-board",
				"1",
				{ timeout: 45_000 },
			);
		const url = b.url();
		const south = a
			.locator(".name[data-bot]")
			.filter({ hasText: /^S - Bob/ })
			.first();
		await expect(south).toHaveAttribute("data-bot", "false");
		await b.goto("about:blank");
		await expect(south).toHaveAttribute("data-bot", "true", {
			timeout: 45_000,
		});
		await b.goto(url);
		await expect(b.getByTestId("table")).toHaveAttribute("data-board", "1", {
			timeout: 45_000,
		});
		// North has not bid, so this is still the same board after South returns.
		await expect(south).toHaveAttribute("data-bot", "true");
		await makeCall(a, "P");
		await expect(a.getByTestId("table")).toHaveAttribute("data-board", "2", {
			timeout: 45_000,
		});
		await expect(south).toHaveAttribute("data-bot", "false");
		await expect(b).toHaveTitle(/Bob \(S\)$/);
		await expect(b.getByTestId("table")).toHaveAttribute("data-at", "1", {
			timeout: 20_000,
		});
		await makeCall(b, "P");
		await expect(b.getByTestId("table")).toHaveAttribute("data-at", "2");
		expect(errors).toEqual([]);
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});

test("two opposite pairs merge into a four-human game and play after leaving discovery", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("base URL missing");
	const { contexts, pages, errors } = await players(browser, baseURL, 4);
	try {
		const [a, b, c, d] = pages;
		if (!a || !b || !c || !d) throw new Error("players missing");
		await enter(a, "Alice", "1", "/", "online");
		await enter(b, "Bob", "0", a.url());
		await enter(c, "Carol", "1", "/", "online");
		await enter(d, "Dan", "0", c.url());
		for (const page of pages) {
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-board",
				"1",
				{ timeout: 45_000 },
			);
			await expect(
				page.getByRole("button", { name: "Join call", exact: true }),
			).toBeDisabled();
		}
		expect(new Set(pages.map((page) => new URL(page.url()).hash)).size).toBe(1);
		const seats = new Map<string, Page>();
		for (const page of pages) {
			const seat = /\(([NESW])\)$/.exec(await page.title())?.[1];
			if (!seat) throw new Error("player seat missing from title");
			seats.set(seat, page);
		}
		expect(seats.size).toBe(4);
		for (const seat of ["N", "E", "S", "W"]) {
			const page = seats.get(seat);
			if (!page) throw new Error("player missing");
			await makeCall(page, "P");
		}
		for (const page of pages)
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-board",
				"2",
				{ timeout: 30_000 },
			);
		expect(errors).toEqual([]);
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});
