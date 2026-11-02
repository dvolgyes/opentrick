import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { createRoom } from "./room";

test("host bots wait for a played card's flight before starting another play", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.addInitScript(() => {
		localStorage.setItem("opentrick.settings.bot-card-delay-ms", "0");
		localStorage.setItem("opentrick.settings.bot-bid-delay-ms", "0");
		localStorage.setItem("opentrick.settings.auction-pause-ms", "0");
		localStorage.setItem("opentrick.settings.card-play-duration-ms", "5000");
	});
	await mockBotBidding(
		page,
		(position) => (position.calls.length === 0 ? "1NT" : "P"),
		0,
	);
	await page.route(/\/play-worker-[^/]+\.js$/, (route) =>
		route.fulfill({
			contentType: "text/javascript",
			body: `self.onmessage = ({data}) => {
			const analysis = {card: data.position.legal[0], samples: 1, effectiveSamples: 1, elapsedMs: 0, evaluations: []};
			self.postMessage({ok: true, partial: true, analysis});
			setTimeout(() => self.postMessage({ok: true, analysis}), data.timeMs + 100);
		};`,
		}),
	);
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	await page.getByTestId("host-autoplay-toggle").click();
	await page.getByTestId("autoplay-confirm-enable").click();
	const table = page.getByTestId("table");
	await expect(page.locator(".card-flight")).toHaveCount(1, {
		timeout: 30_000,
	});
	const at = Number(await table.getAttribute("data-at"));
	await page.waitForFunction(
		() => {
			const flight = document.querySelector<HTMLElement>(".card-flight");
			return Number(flight?.getAnimations()[0]?.currentTime) >= 4000;
		},
		undefined,
		{ timeout: 8000 },
	);
	await expect(table).toHaveAttribute("data-at", String(at));
	await expect
		.poll(async () => Number(await table.getAttribute("data-at")), {
			timeout: 10_000,
		})
		.toBeGreaterThan(at);
});

test("phone bots wait for the played-card animation before the next play", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const context = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		await context.addInitScript(() => {
			Math.random = () => 0.5;
			localStorage.setItem("opentrick.settings.bidder", "sl");
			localStorage.setItem("opentrick.settings.bot-card-delay-ms", "0");
			localStorage.setItem("opentrick.settings.bot-bid-delay-ms", "0");
			localStorage.setItem("opentrick.settings.auction-pause-ms", "0");
			localStorage.setItem("opentrick.settings.play-time-ms", "1000");
			localStorage.setItem("opentrick.settings.card-play-duration-ms", "2000");
			localStorage.setItem(
				"opentrick.settings.card-play-rotation-degrees",
				"0",
			);
			localStorage.setItem("opentrick.settings.trick-winner-pause-ms", "5000");
		});
		const page = await context.newPage();
		await mockBotBidding(
			page,
			(position) => (position.calls.length === 0 ? "1NT" : "P"),
			0,
		);
		await page.route(/\/play-worker-[^/]+\.js$/, (route) =>
			route.fulfill({
				contentType: "text/javascript",
				body: `self.onmessage = ({data}) => {
				const analysis = {card: data.position.legal[0], samples: 1, effectiveSamples: 1, elapsedMs: 0, evaluations: []};
				self.postMessage({ok: true, partial: true, analysis});
				setTimeout(() => self.postMessage({ok: true, analysis}), data.timeMs + 100);
			};`,
			}),
		);
		await page.goto("/");
		await createRoom(page, ["N", "E", "S"]);
		await expect(page.locator(".room")).toHaveAttribute(
			"data-layout",
			"compact",
		);
		await page.getByTestId("host-autoplay-toggle").click();
		await page.getByTestId("autoplay-confirm-enable").click();
		await expect(page.locator(".card-flight")).toHaveCount(1, {
			timeout: 30_000,
		});
		const table = page.getByTestId("table");
		const at = Number(await table.getAttribute("data-at"));
		await page.waitForFunction(
			() => {
				const flight = document.querySelector<HTMLElement>(".card-flight");
				return Number(flight?.getAnimations()[0]?.currentTime) >= 1400;
			},
			undefined,
			{ timeout: 5000 },
		);
		await expect(table).toHaveAttribute("data-at", String(at));
		await expect
			.poll(async () => Number(await table.getAttribute("data-at")), {
				timeout: 10_000,
			})
			.toBeGreaterThan(at);
		const top = page.locator(".trick-collection-overlay .played.pos-top");
		const bottom = page.locator(".trick-collection-overlay .played.pos-bottom");
		await expect(top).toBeVisible({ timeout: 30_000 });
		const [topBox, bottomBox] = await Promise.all([
			top.boundingBox(),
			bottom.boundingBox(),
		]);
		if (!topBox || !bottomBox) throw new Error("missing completed trick cards");
		expect(topBox.y + topBox.height).toBeLessThanOrEqual(bottomBox.y);
	} finally {
		await context.close();
	}
});
