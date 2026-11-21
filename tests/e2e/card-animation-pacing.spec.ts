import { devices, expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { createRoom, makeCall } from "./room";

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

test("a phone shows trick collection without individual card flights", async ({
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
		const flights = await page.evaluateHandle(() => {
			const seen = { count: 0 };
			new MutationObserver((changes) => {
				for (const change of changes)
					for (const node of change.addedNodes)
						if (node instanceof Element && node.matches(".card-flight"))
							seen.count++;
			}).observe(document.body, { childList: true, subtree: true });
			return seen;
		});
		await page.getByTestId("host-autoplay-toggle").click();
		await page.getByTestId("autoplay-confirm-enable").click();
		const top = page.locator(".trick-collection-overlay .played.pos-top");
		const bottom = page.locator(".trick-collection-overlay .played.pos-bottom");
		await expect(top).toBeVisible({ timeout: 30_000 });
		const [topBox, bottomBox] = await Promise.all([
			top.boundingBox(),
			bottom.boundingBox(),
		]);
		if (!topBox || !bottomBox) throw new Error("missing completed trick cards");
		expect(topBox.y + topBox.height).toBeLessThanOrEqual(bottomBox.y);
		expect((await flights.jsonValue()).count).toBe(0);
	} finally {
		await context.close();
	}
});

test("one tap plays a legal card on a tablet in desktop layout", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const context = await browser.newContext({
		baseURL,
		...devices["iPad Pro 11 landscape"],
	});
	try {
		await context.addInitScript(() => {
			localStorage.setItem("opentrick.settings.bidder", "sl");
			localStorage.setItem("opentrick.settings.landscape-desktop", "1");
			localStorage.setItem("opentrick.settings.auction-pause-ms", "0");
			localStorage.setItem("opentrick.settings.play-time-ms", "1000");
			localStorage.setItem("opentrick.settings.card-play-duration-ms", "2000");
		});
		const page = await context.newPage();
		await mockBotBidding(page, () => "P", 0);
		await page.goto("/");
		await createRoom(page, ["N", "E", "S"]);
		await expect(page.locator(".room")).toHaveAttribute(
			"data-layout",
			"desktop",
		);
		await makeCall(page, "1C");
		for (const seat of ["E", "W"]) {
			const hand = page.getByTestId(`hand-${seat}`);
			const card = hand.locator("button.card:enabled").first();
			await expect(card).toBeVisible();
			const id = await card.getAttribute("data-card");
			await card.tap();
			await expect(hand.locator(`button.card[data-card="${id}"]`)).toHaveCount(
				0,
			);
			await expect(
				page.locator(
					`:is(.trick, .trick-collection-overlay) .played[data-card="${id}"]`,
				),
			).toBeVisible({ timeout: 1000 });
			await expect(page.locator(".card-flight")).toHaveCount(0);
		}
	} finally {
		await context.close();
	}
});
