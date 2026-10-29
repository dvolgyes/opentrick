import { expect, type Page, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";

/** Half a pixel absorbs subpixel rounding of the layout. */
const SUBPIXEL = 0.5;

/** Starts a solo board that the bots play to its end, and returns the result banner. */
async function playToResult(page: Page) {
	await page.addInitScript(() =>
		localStorage.setItem("opentrick.settings.play-time-ms", "150"),
	);
	await mockBotBidding(page, (position) =>
		position.calls.length === 0 ? "4H" : "P",
	);
	await page.goto("/");
	await page.getByTestId("create-solo").click();
	await page.getByTestId("host-autoplay-toggle").click();
	await page.getByTestId("autoplay-confirm-enable").click();
	const banner = page.getByTestId("scoring");
	await expect(banner).toBeVisible({ timeout: 110_000 });
	return banner;
}

/** The cards and seat names of the shown deal that the banner covers. */
function coveredCards(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const banner = document.querySelector('[data-testid="scoring"]');
		if (!banner) throw new Error("the banner is not shown");
		const box = banner.getBoundingClientRect();
		return [
			...document.querySelectorAll<HTMLElement>(".hand .card, .seat-label"),
		]
			.filter((part) => {
				const rect = part.getBoundingClientRect();
				return (
					part.checkVisibility() &&
					rect.left < box.right &&
					rect.right > box.left &&
					rect.top < box.bottom &&
					rect.bottom > box.top
				);
			})
			.map((part) => part.textContent ?? "");
	});
}

test("the result of a board stays in the middle half of the felt, clear of the hands", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1704, height: 956 });
	const banner = await playToResult(page);
	// The next board starts after a countdown, so the three sizes are measured while the result shows.
	for (const viewport of [
		{ width: 1704, height: 956 },
		{ width: 1920, height: 1080 },
		{ width: 1280, height: 720 },
	]) {
		await page.setViewportSize(viewport);
		const [box, felt] = await Promise.all([
			banner.boundingBox(),
			page.locator(".felt").boundingBox(),
		]);
		if (!box || !felt) throw new Error("the banner or the felt is not shown");
		const size = `${viewport.width}×${viewport.height}`;
		expect(box.x, size).toBeGreaterThanOrEqual(
			felt.x + felt.width / 4 - SUBPIXEL,
		);
		expect(box.x + box.width, size).toBeLessThanOrEqual(
			felt.x + (felt.width * 3) / 4 + SUBPIXEL,
		);
		expect(await coveredCards(page), size).toEqual([]);
	}
});

test("a phone held sideways shows the result on the middle of the felt, clear of the hands", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const context = await browser.newContext({
		baseURL,
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await context.newPage();
		const banner = await playToResult(page);
		for (const viewport of [
			{ width: 844, height: 390 },
			{ width: 800, height: 360 },
		]) {
			await page.setViewportSize(viewport);
			await expect(page.locator(".room")).toHaveAttribute(
				"data-layout",
				"sideways",
			);
			const [box, felt] = await Promise.all([
				banner.boundingBox(),
				page.locator(".felt").boundingBox(),
			]);
			if (!box || !felt) throw new Error("the banner or the felt is not shown");
			const size = `${viewport.width}×${viewport.height}`;
			expect(
				Math.abs(box.y + box.height / 2 - (felt.y + felt.height / 2)),
				size,
			).toBeLessThan(2);
			expect(
				Math.abs(box.x + box.width / 2 - (felt.x + felt.width / 2)),
				size,
			).toBeLessThan(2);
			expect(await coveredCards(page), size).toEqual([]);
		}
	} finally {
		await context.close();
	}
});
