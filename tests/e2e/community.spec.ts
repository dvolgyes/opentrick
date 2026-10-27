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
	link = "/#community",
): Promise<void> {
	await page.goto(link);
	await page.getByTestId("community-name").fill(name);
	const select = page.getByTestId("community-shape");
	if (await select.count()) await select.selectOption(shape);
	await page.getByTestId("community-ready").check();
	await page.getByTestId("community-enter").click();
}

test("two solos agree to merge, unanimously fill with bots, and reload into the reserved game", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("base URL missing");
	const { contexts, pages, errors } = await players(browser, baseURL, 2);
	try {
		const [a, b] = pages;
		if (!a || !b) throw new Error("players missing");
		await enter(a, "Alice");
		await enter(b, "Bob");
		await expect
			.poll(
				async () =>
					(await a.getByTestId("community-accept").count()) +
					(await b.getByTestId("community-accept").count()),
				{ timeout: 45_000 },
			)
			.toBe(1);
		for (const page of pages)
			if (await page.getByTestId("community-accept").count())
				await page.getByTestId("community-accept").click();
		for (const page of pages)
			await expect(
				page.getByTestId("community-members").locator("li"),
			).toHaveCount(2, { timeout: 45_000 });
		await a.getByTestId("community-wait").fill("0");
		await a.getByTestId("community-bots").check();
		await expect(a.getByTestId("table")).toBeHidden();
		await b.getByTestId("community-wait").fill("0");
		await b.getByTestId("community-bots").check();
		for (const page of pages)
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-board",
				"1",
				{ timeout: 45_000 },
			);
		const keyA = new URL(a.url()).hash;
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
		await enter(a, "Alice", "1");
		await expect(a.getByTestId("community-status")).toHaveText(
			"Waiting for your group to be ready.",
		);
		await enter(b, "Bob", "0", a.url());
		for (const page of pages) {
			await expect(page.getByTestId("community-status")).toHaveText(
				"Searching for compatible players…",
				{ timeout: 45_000 },
			);
			await expect(
				page.getByTestId("community-members").locator("li"),
			).toHaveCount(2);
			await expect(
				page.getByTestId("community-members").locator('[data-seat="N"]'),
			).toHaveText("North: Alice");
			await expect(
				page.getByTestId("community-members").locator('[data-seat="S"]'),
			).toHaveText("South: Bob");
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
			await page.getByTestId("community-wait").fill("0");
			await page.getByTestId("community-bots").check();
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
		await enter(a, "Alice", "1");
		await enter(b, "Bob", "0", a.url());
		await enter(c, "Carol", "1");
		await enter(d, "Dan", "0", c.url());
		await expect
			.poll(
				async () =>
					(await a.getByTestId("community-accept").count()) +
					(await c.getByTestId("community-accept").count()),
				{ timeout: 45_000 },
			)
			.toBe(1);
		for (const page of [a, c])
			if (await page.getByTestId("community-accept").count())
				await page.getByTestId("community-accept").click();
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
