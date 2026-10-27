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
	await page.goto(`${site}join`);
	await expect(page.getByTestId("community-status")).toHaveText(
		"Searching for compatible players…",
	);
	await page.reload();
	await expect(page.getByTestId("community-status")).toHaveText(
		"Searching for compatible players…",
	);
	await expect(page.getByTestId("community").getByRole("button")).toHaveText([
		"Create new game",
	]);
	await page
		.getByRole("button", { name: "Create new game", exact: true })
		.click();
	await expect(page).toHaveURL(`${site}create/`);
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
	test(`solo controls stay on one row in ${locale}`, async ({ page }) => {
		await page.addInitScript(
			(locale) => localStorage.setItem("opentrick.locale", locale),
			locale,
		);
		await page.goto("/create/");
		const row = page.locator(".create-solo-row");
		await expect(row.getByTestId("create-solo")).toHaveText(
			translator(locale)("Play with bots"),
		);
		await expect(row.getByTestId("join-online")).toHaveText(
			translator(locale)("Online players"),
		);
		for (const width of [320, 390, 1280]) {
			await page.setViewportSize({ width, height: 844 });
			const boxes = await row.locator("input, a").evaluateAll((elements) =>
				elements.map((element) => {
					const rect = element.getBoundingClientRect();
					return {
						middle: rect.top + rect.height / 2,
						left: rect.left,
						right: rect.right,
					};
				}),
			);
			expect(
				Math.max(...boxes.map((box) => box.middle)) -
					Math.min(...boxes.map((box) => box.middle)),
			).toBeLessThan(2);
			expect(Math.max(...boxes.map((box) => box.right))).toBeLessThanOrEqual(
				width,
			);
			expect(boxes[0]?.right).toBeLessThanOrEqual(boxes[1]?.left ?? 0);
		}
	});
}

test("the compact solo row exposes bookmarkable actions without wrapping", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/create");
	const row = page.locator(".create-solo-row");
	await expect(
		row.getByRole("link", { name: "Play with bots", exact: true }),
	).toHaveAttribute("href", "/solo");
	await expect(
		row.getByRole("link", { name: "Online players", exact: true }),
	).toHaveAttribute("href", "/join");
	const boxes = await row.locator("input, a").evaluateAll((elements) =>
		elements.map((element) => {
			const rect = element.getBoundingClientRect();
			return { middle: rect.top + rect.height / 2, right: rect.right };
		}),
	);
	expect(boxes).toHaveLength(3);
	expect(
		Math.max(...boxes.map((box) => box.middle)) -
			Math.min(...boxes.map((box) => box.middle)),
	).toBeLessThan(2);
	expect(Math.max(...boxes.map((box) => box.right))).toBeLessThanOrEqual(390);
});
