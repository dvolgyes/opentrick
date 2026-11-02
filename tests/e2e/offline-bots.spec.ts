import { expect, test } from "@playwright/test";
import { makeCall, namePlayers } from "./room";

test("bots can bid and start playing after the app server disconnects", async ({
	page,
	context,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem("opentrick.settings.bot-bid-delay-ms", "1000");
		localStorage.setItem("opentrick.settings.auction-pause-ms", "0");
		localStorage.setItem("opentrick.settings.play-time-ms", "150");
		localStorage.setItem("opentrick.settings.card-play-animation", "0");
		localStorage.setItem("opentrick.settings.trick-animation", "0");
	});
	await page.goto("/");
	await namePlayers(page, "N", ["E", "S", "W"]);
	await page.getByTestId("create").click();
	await makeCall(page, "1NT");
	await page.getByTestId("host-autoplay-toggle").click();
	await page.getByTestId("autoplay-confirm-enable").click();
	const table = page.getByTestId("table");
	await expect
		.poll(async () => Number(await table.getAttribute("data-at")))
		.toBeGreaterThanOrEqual(2);
	await context.setOffline(true);
	await expect(table).toHaveAttribute("data-phase", "play", {
		timeout: 45_000,
	});
	const at = Number(await table.getAttribute("data-at"));
	await expect
		.poll(async () => Number(await table.getAttribute("data-at")), {
			timeout: 30_000,
		})
		.toBeGreaterThan(at);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByTestId("settings-dialog");
	await settings.getByLabel("Card thinking budget (seconds)").fill("2");
	await settings.getByRole("button", { name: "Save settings" }).click();
	const afterRestart = Number(await table.getAttribute("data-at"));
	await expect
		.poll(async () => Number(await table.getAttribute("data-at")), {
			timeout: 30_000,
		})
		.toBeGreaterThan(afterRestart);
});
