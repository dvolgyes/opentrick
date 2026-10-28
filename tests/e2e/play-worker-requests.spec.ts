import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { createRoom } from "./room";

test("four bots play a complete board without fetching the play worker for every card", async ({
	page,
}) => {
	test.setTimeout(420_000);
	await page.addInitScript(() =>
		localStorage.setItem("opentrick.settings.play-time-ms", "5000"),
	);
	await mockBotBidding(
		page,
		(position) => (position.calls.length === 0 ? "1NT" : "P"),
		0,
	);
	const workerRequests: string[] = [];
	page.on("request", (request) => {
		if (/\/play-worker-[^/]+\.js$/.test(new URL(request.url()).pathname))
			workerRequests.push(request.url());
	});
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	await page.getByTestId("host-autoplay-toggle").click();
	await page.getByTestId("autoplay-confirm-enable").click();
	await expect(page.getByTestId("host-autoplay-toggle")).toHaveText(
		"Disable bot",
	);
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-phase", "complete", {
		timeout: 370_000,
	});
	await expect(table).toHaveAttribute("data-at", "56");
	expect(workerRequests.length).toBeGreaterThan(0);
	expect(workerRequests.length).toBeLessThan(10);
	console.info(
		`Four bots played 52 cards; play worker requests: ${workerRequests.length}`,
	);
});
