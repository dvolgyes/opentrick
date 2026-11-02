import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { createRoom, makeCall } from "./room";

test("both card backs remain available when the app server goes away", async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem("opentrick.settings.bot-bid-delay-ms", "0");
	});
	await mockBotBidding(page, () => "P", 0);
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-at", "3");
	const back = table.locator(".hand .back-art").first();
	await expect
		.poll(() => back.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
	const oddBack = await back.getAttribute("src");
	const origin = new URL(page.url()).origin;
	const blocked: string[] = [];
	await page.route(`${origin}/**`, (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/__test_bid__") return route.fallback();
		blocked.push(path);
		return route.abort();
	});
	await makeCall(page, "P");
	await expect(table).toHaveAttribute("data-phase", "complete");
	await expect(table).toHaveAttribute("data-board", "2", { timeout: 25_000 });
	await expect
		.poll(() => back.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
	expect(await back.getAttribute("src")).not.toBe(oddBack);
	expect(
		blocked.filter((path) => path.includes("bridge-call-card-back")),
	).toEqual([]);
});
