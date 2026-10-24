import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/** The bots always pass, so the first board stays in the auction while the test runs. */
async function passingBots(page: Page): Promise<void> {
	await page.route("https://openrouter.ai/api/v1/responses", (route) =>
		route.fulfill({
			status: 200,
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "authorization,content-type",
			},
			contentType: "application/json",
			body: JSON.stringify({
				output: [
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: '{"call":"P"}' }],
					},
				],
			}),
		}),
	);
}

function inFullscreen(page: Page): Promise<boolean> {
	return page.evaluate(() => document.fullscreenElement !== null);
}

test("desktop players go to full screen when the game begins, and leave it when a seat becomes empty", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const viewport = { width: 1920, height: 1080 };
	const host = await Player.open(browser, baseURL, "host", { viewport });
	const guest = await Player.open(browser, baseURL, "guest", { viewport });
	let guestOpen = true;
	try {
		const hostPage = await host.page("./");
		await passingBots(hostPage);
		for (const seat of ["E", "S"])
			await hostPage.locator(`input[name="bot-${seat}"]`).check();
		await hostPage.locator('input[name="openrouter-key"]').fill("test-key");
		const link = await createRoom(hostPage);
		// In the lobby a gesture does not start full screen.
		await hostPage.mouse.click(1900, 1000);
		expect(await inFullscreen(hostPage)).toBe(false);

		const guestPage = await guest.page(link);
		await pick(guestPage, "N");
		for (const page of [hostPage, guestPage]) {
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-phase",
				"auction",
				{ timeout: CONNECT_MS },
			);
			expect(await inFullscreen(page)).toBe(false);
			await page.mouse.click(1900, 1000);
			await expect.poll(() => inFullscreen(page)).toBe(true);
		}

		await guest.close();
		guestOpen = false;
		await expect
			.poll(() => inFullscreen(hostPage), { timeout: CONNECT_MS })
			.toBe(false);
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
		if (guestOpen) await guest.close();
	}
});
