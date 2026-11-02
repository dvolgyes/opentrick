import { readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import { loadEnv } from "vite";
import { translator } from "../../src/i18n";
import { readMeshConfig } from "../../src/p2p/config";
import { mockBotBidding } from "./bot-mock";
import { RelayHub } from "./relay-hub";

let server: Server;
let site: string;
test.beforeAll(async () => {
	const root = resolve("dist");
	// Serve only built files, under the deployment prefix, with directory redirects and no SPA fallback.
	server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		if (!url.pathname.startsWith("/opentrick/")) {
			response.writeHead(404).end();
			return;
		}
		let file = resolve(root, `.${url.pathname.slice("/opentrick".length)}`);
		if (file !== root && !file.startsWith(root + sep)) {
			response.writeHead(404).end();
			return;
		}
		if (statSync(file, { throwIfNoEntry: false })?.isDirectory()) {
			if (!url.pathname.endsWith("/")) {
				response
					.writeHead(301, { Location: `${url.pathname}/${url.search}` })
					.end();
				return;
			}
			file = resolve(file, "index.html");
		}
		if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
			response.writeHead(404).end();
			return;
		}
		const types: Record<string, string> = {
			".html": "text/html",
			".js": "text/javascript",
			".css": "text/css",
		};
		response.setHeader(
			"Content-Type",
			types[extname(file)] ?? "application/octet-stream",
		);
		response.end(readFileSync(file));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("static server address missing");
	site = `http://127.0.0.1:${address.port}/opentrick/`;
});
test.afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

test.beforeEach(async ({ context }) => {
	const config = readMeshConfig(
		loadEnv("production", process.cwd(), [
			"VITE_TRACKER_",
			"VITE_NOSTR_",
			"VITE_MQTT_",
			"VITE_STUN_",
		]),
	);
	if (!config.ok) throw new Error(config.error);
	for (const hub of [
		new RelayHub("tracker", config.config.trackers),
		new RelayHub("nostr", config.config.nostrRelays),
		new RelayHub("mqtt", config.config.mqttBrokers),
	])
		await hub.install(context, "entry");
});

test("a solo bookmark starts a game and reload keeps that game", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P");
	await page.goto("/solo");
	await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1", {
		timeout: 10_000,
	});
	const game = page.url();
	await page.reload();
	await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1");
	expect(page.url()).toBe(game);
});

test("entry action buttons match the median table green", async ({ page }) => {
	await page.goto("/");
	const median = await page
		.locator(".opening-hero")
		.evaluate(async (banner) => {
			const url =
				getComputedStyle(banner).backgroundImage.match(/^url\("(.*)"\)$/)?.[1];
			if (!url) throw new Error("table texture is missing");
			const image = new Image();
			image.src = url;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("canvas is unavailable");
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(
				0,
				0,
				canvas.width,
				canvas.height,
			).data;
			return [0, 1, 2].map((channel) => {
				const histogram = new Uint32Array(256);
				for (let i = channel; i < pixels.length; i += 4) {
					const value = pixels[i];
					if (value !== undefined)
						histogram[value] = (histogram[value] ?? 0) + 1;
				}
				let count = 0;
				for (let value = 0; value < histogram.length; value++) {
					count += histogram[value] ?? 0;
					if (count >= pixels.length / 8) return value;
				}
				throw new Error("empty texture");
			});
		});
	const check = async (locator: ReturnType<typeof page.getByTestId>) => {
		const color = await locator.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		);
		const channels = color.match(/\d+/g)?.slice(0, 3).map(Number);
		if (channels?.length !== 3)
			throw new Error(`unexpected button color: ${color}`);
		for (let index = 0; index < 3; index++)
			expect(
				Math.abs((channels[index] ?? 0) - (median[index] ?? 0)),
			).toBeLessThanOrEqual(12);
	};
	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 844 });
		for (const id of [
			"create-solo",
			"invite-friends",
			"join-online",
			"preset-bots",
			"create",
		])
			await check(page.getByTestId(id));
	}
	await page.goto("/join");
	await expect(page.getByTestId("community")).toBeVisible();
	await check(page.getByRole("link", { name: "Play with bots" }));
	const backColor = await page
		.getByRole("button", { name: "Back to home" })
		.evaluate((element) => getComputedStyle(element).backgroundColor);
	const [red, green] = backColor.match(/\d+/g)?.map(Number) ?? [];
	expect(red ?? 0).toBeGreaterThan(green ?? 255);
});

test("static project-site bookmarks load every entry directly with the correct assets", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await mockBotBidding(page, () => "P");
	for (const entry of ["", "create", "create/"]) {
		const response = await page.goto(site + entry);
		expect(response?.status()).toBe(200);
		await expect(page.getByTestId("create")).toBeVisible();
		await expect(page.getByTestId("create-solo")).toHaveAttribute(
			"href",
			"/opentrick/solo",
		);
		await expect(page.getByTestId("join-online")).toHaveAttribute(
			"href",
			"/opentrick/join",
		);
	}
	await page.goto(`${site}solo`);
	await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1");
	expect(await page.evaluate(() => document.baseURI)).toBe(site);
	expect((await page.request.head(`${site}bot-models/brl-sl.f32`)).ok()).toBe(
		true,
	);
	const game = page.url();
	await page.reload();
	await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1");
	expect(page.url()).toBe(game);
	const settings = page.getByTestId("settings-dialog");
	await expect(settings).toBeVisible();
	await settings.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Exit", exact: true }).click();
	await expect(page).toHaveURL(site);
	await expect(page.getByTestId("create")).toBeVisible();
	await page.goto(`${site}join`);
	await expect(page.getByTestId("community-status")).toHaveText(
		"Searching for compatible players…",
	);
	await page.reload();
	await expect(page.getByTestId("community-status")).toHaveText(
		"Searching for compatible players…",
	);
	await expect(page.getByTestId("community").getByRole("button")).toHaveText([
		"Back to home",
	]);
	await page.getByRole("button", { name: "Back to home", exact: true }).click();
	await expect(page).toHaveURL(site, { timeout: 1500 });
	await expect(page.getByTestId("create")).toBeVisible();
	expect(errors).toEqual([]);
});

for (const locale of [
	"en",
	"de",
	"hu",
	"no",
	"es",
	"pt",
	"fr",
	"it",
	"nl",
] as const) {
	test(`entry choices fit the screen in ${locale}`, async ({ page }) => {
		await page.addInitScript(
			(locale) => localStorage.setItem("opentrick.locale", locale),
			locale,
		);
		await page.goto("/create/");
		await page.evaluate(() => document.fonts.ready);
		const row = page.locator(".create-solo-row");
		await expect(row.getByTestId("create-solo")).toHaveText(
			translator(locale)("Play with bots"),
		);
		await expect(row.getByTestId("join-online")).toHaveText(
			translator(locale)("Find online players"),
		);
		await expect(
			page.getByText(
				translator(locale)("Have an invitation? Open the link you received."),
			),
		).toBeVisible();
		for (const width of [320, 390, 1280]) {
			await page.setViewportSize({ width, height: 844 });
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await expect(row.getByTestId("invite-friends")).toBeVisible();
			if (width <= 390) {
				const boxes = await page
					.locator(".create-header")
					.locator(".opening-brand, select, .opening-help")
					.evaluateAll((items) =>
						items.map((item) => {
							const box = item.getBoundingClientRect();
							return {
								left: box.left,
								right: box.right,
								middle: box.top + box.height / 2,
							};
						}),
					);
				expect(boxes).toHaveLength(3);
				expect(
					Math.max(...boxes.map((box) => box.middle)) -
						Math.min(...boxes.map((box) => box.middle)),
				).toBeLessThan(2);
				expect(boxes[0]?.right).toBeLessThanOrEqual(boxes[1]?.left ?? 0);
				expect(boxes[1]?.right).toBeLessThanOrEqual(boxes[2]?.left ?? 0);
			}
		}
		await page.goto("/join");
		await expect(page.getByTestId("community")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: translator(locale)("Community game") }),
		).toBeVisible();
		for (const width of [320, 390, 601, 1280]) {
			await page.setViewportSize({ width, height: 844 });
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await expect(
				page.getByRole("button", {
					name: translator(locale)("Help"),
					exact: true,
				}),
			).toBeVisible();
			await expect(
				page.getByRole("button", {
					name: translator(locale)("Back to home"),
					exact: true,
				}),
			).toBeVisible();
			const actions = page.locator(".community-actions");
			const actionsBox = await actions.boundingBox();
			const botsBox = await actions
				.getByRole("link", { name: translator(locale)("Play with bots") })
				.boundingBox();
			const backBox = await actions
				.getByRole("button", { name: translator(locale)("Back to home") })
				.boundingBox();
			if (!actionsBox || !botsBox || !backBox)
				throw new Error("community actions missing");
			expect(Math.abs(botsBox.x - actionsBox.x)).toBeLessThan(2);
			expect(
				Math.abs(backBox.x + backBox.width - actionsBox.x - actionsBox.width),
			).toBeLessThan(2);
			const art = await page.locator(".community-art").boundingBox();
			const heading = await page
				.getByRole("heading", { name: translator(locale)("Community game") })
				.boundingBox();
			if (!art || !heading) throw new Error("community heading missing");
			expect(heading.x).toBeGreaterThanOrEqual(art.x + art.width);
			expect(
				Math.abs(heading.y + heading.height / 2 - art.y - art.height / 2),
			).toBeLessThan(5);
		}
	});
}

test("the opening page exposes bookmarkable actions", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/create");
	const row = page.locator(".create-solo-row");
	await expect(
		row.getByRole("link", { name: "Play with bots", exact: true }),
	).toHaveAttribute("href", "/solo");
	await expect(
		row.getByRole("link", { name: "Find online players", exact: true }),
	).toHaveAttribute("href", "/join");
	await expect(
		page.getByRole("heading", { name: "Choose how to play" }),
	).toBeVisible();
	const boxes = await row
		.locator(".opening-card")
		.evaluateAll((elements) =>
			elements.map((element) => element.getBoundingClientRect().top),
		);
	expect(boxes[0]).toBeLessThan(boxes[1] ?? 0);
	expect(boxes[1]).toBeLessThan(boxes[2] ?? 0);
});
