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
