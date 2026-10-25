import { expect, type Page, test } from "@playwright/test";
import { mockOpenRouterKey } from "./openrouter-mock";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/** The bots always pass, so the first board stays in the auction while the test runs. */
async function passingBots(page: Page): Promise<void> {
	await mockOpenRouterKey(page);
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

/** Every localStorage value long enough to be a secret, such as the client id. */
function storedSecrets(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		Object.keys(localStorage)
			.map((key) => localStorage.getItem(key) ?? "")
			.filter((value) => value.length >= 16),
	);
}

test("the host copies a debug export with each player's page report, and reloads the players", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host", {
		viewport: { width: 1920, height: 1080 },
	});
	// A desktop browser whose window lost its top to the screen edge and the browser's own bars.
	const guest = await Player.open(browser, baseURL, "guest", {
		viewport: { width: 1910, height: 800 },
	});
	try {
		await host.grantPermissions(["clipboard-read", "clipboard-write"]);
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
		await expect(guestPage.getByTestId("debug-export")).toBeHidden();
		await expect(guestPage.getByTestId("reload-players")).toBeHidden();

		await hostPage.getByTestId("debug-export").click();
		await expect(hostPage.getByTestId("debug-status")).toHaveText(
			"Debug export copied.",
			{ timeout: CONNECT_MS },
		);
		// The debug message sits under the sidebar's top row, above the room buttons.
		const status = await hostPage.getByTestId("debug-status").boundingBox();
		const copy = await hostPage.getByTestId("copy-board-url").boundingBox();
		expect(
			(status?.y ?? Number.NaN) + (status?.height ?? 0),
			"the debug message above the room buttons",
		).toBeLessThanOrEqual(copy?.y ?? Number.NaN);
		const text = await hostPage.evaluate(() => navigator.clipboard.readText());
		const exported = JSON.parse(text);
		expect(exported.kind).toBe("opentrick-debug-export");
		expect(exported.asked).toBe(1);
		const north = exported.seats.find(
			(item: { seat: string }) => item.seat === "N",
		);
		expect(north.source).toBe("player");
		expect(north.detail.form).toBe("desktop");
		expect(north.detail.window.innerHeight).toBe(800);
		expect(north.detail.window.innerWidth).toBe(1910);
		expect(north.detail.table.phase).toBe("auction");
		expect(north.detail.cards).toHaveLength(13);
		for (const card of north.detail.cards) expect(card.hit).toBe("self");
		expect(
			exported.seats
				.filter((item: { source: string }) => item.source === "bot")
				.map((item: { seat: string }) => item.seat),
		).toEqual(["E", "S"]);

		const tableKey = new URL(link).hash.match(/[#&]k=([^&]+)/)?.[1];
		if (!tableKey) throw new Error(`the link has no table key: ${link}`);
		const secrets = [
			"test-key",
			tableKey,
			...(await storedSecrets(hostPage)),
			...(await storedSecrets(guestPage)),
		];
		for (const secret of secrets) expect(text).not.toContain(secret);

		await expect(hostPage.getByTestId("reload-players")).toHaveAttribute(
			"data-outdated",
			"false",
		);
		const reloaded = guestPage.waitForEvent("load");
		await hostPage.getByTestId("reload-players").click();
		await expect(hostPage.getByTestId("debug-status")).toHaveText(
			"Asked 1 pages to reload.",
		);
		await reloaded;
		await expect(guestPage.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		expect([...host.errors, ...guest.errors]).toEqual([]);
	} finally {
		await host.close();
		await guest.close();
	}
});
