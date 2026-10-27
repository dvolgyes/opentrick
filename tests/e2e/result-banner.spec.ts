import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";

/** Half a pixel absorbs subpixel rounding of the layout. */
const SUBPIXEL = 0.5;

test("the result of a board stays in the middle half of the felt, clear of the side hands", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1704, height: 956 });
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
	}
});
