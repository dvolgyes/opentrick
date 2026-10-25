import { expect, type Locator, type Page, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick, type SeatKey } from "./room";

/*
 * Each page sends its player's bidding system from Settings to the host, and every page shows it below that
 * player's name in the auction (src/ui/room-view.ts, src/ui/table.ts `renderAuction`).
 */

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

/** The bidding system below a seat's name in the visible auction. */
const systemOf = (page: Page, seat: SeatKey): Locator =>
	page
		.locator(".auction th:visible")
		.filter({ hasText: `(${seat})` })
		.locator(".auction-system");

test("each player sees the others' bidding systems, and a change in Settings reaches the other pages", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host", {
		viewport: { width: 1920, height: 1080 },
	});
	const guest = await Player.open(browser, baseURL, "guest", {
		viewport: { width: 1920, height: 1080 },
	});
	try {
		await host.addInitScript(() =>
			localStorage.setItem("opentrick.settings.points", "vienna"),
		);
		const hostPage = await host.page("./");
		await passingBots(hostPage);
		for (const seat of ["E", "S"])
			await hostPage.locator(`input[name="bot-${seat}"]`).check();
		await hostPage.locator('input[name="openrouter-key"]').fill("test-key");
		const link = await createRoom(hostPage);
		const guestPage = await guest.page(link);
		await pick(guestPage, "N");
		for (const page of [hostPage, guestPage])
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-phase",
				"auction",
				{ timeout: CONNECT_MS },
			);

		for (const page of [hostPage, guestPage]) {
			await expect(systemOf(page, "W")).toHaveText("Vienna", {
				timeout: CONNECT_MS,
			});
			await expect(systemOf(page, "N")).toHaveText("corr. HCP", {
				timeout: CONNECT_MS,
			});
			await expect(systemOf(page, "E")).toHaveText("HCP");
		}

		await guestPage
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		const dialog = guestPage.getByTestId("settings-dialog");
		await dialog.getByLabel("Other", { exact: true }).check();
		await dialog.getByRole("button", { name: "Save settings" }).click();
		for (const page of [hostPage, guestPage])
			await expect(systemOf(page, "N")).toHaveText("Other", {
				timeout: CONNECT_MS,
			});

		// The guide of the host's system opens on the guest's page.
		await systemOf(guestPage, "W").click();
		await expect(
			guestPage.getByTestId("guide-dialog").getByRole("heading", { level: 2 }),
		).toHaveText("Bidding guide: Vienna points (7-5-3-1)");
	} finally {
		await guest.close();
		await host.close();
	}
});

test("Settings shows or hides the points and the turn text at once, also without a new bidding system", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host", {
		viewport: { width: 1920, height: 1080 },
	});
	try {
		const page = await host.page("./");
		await passingBots(page);
		for (const seat of ["N", "E", "S"])
			await page.locator(`input[name="bot-${seat}"]`).check();
		await page.locator('input[name="openrouter-key"]').fill("test-key");
		await createRoom(page);
		await expect(page.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		const pills = page.locator(".hcp-pill:visible");
		const turn = page.getByTestId("turn-pill");
		await expect(pills).toHaveCount(1);
		await expect(turn).toHaveCount(1, { timeout: CONNECT_MS });

		const dialog = page.getByTestId("settings-dialog");
		async function save(label: string, on: boolean): Promise<void> {
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			await dialog.getByLabel(label).setChecked(on);
			await dialog.getByRole("button", { name: "Save settings" }).click();
			await expect(dialog).toBeHidden();
		}
		// The bots pass and West is to bid, so the table state stays the same after each Save.
		await save("Show the points next to the cards", false);
		await expect(pills).toHaveCount(0);
		await save("Show as text whose turn it is to bid", false);
		await expect(turn).toHaveCount(0);
		await save("Show the points next to the cards", true);
		await expect(pills).toHaveCount(1);
		await save("Show as text whose turn it is to bid", true);
		await expect(turn).toHaveCount(1);
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});
