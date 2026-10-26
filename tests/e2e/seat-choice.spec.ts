import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { NOBODY_MS } from "../../src/p2p/limits";
import { mockBotBidding } from "./bot-mock";

import { Player, reportNetwork } from "./player";
import { CONNECT_MS, createRoom, expectSeat, NAME, picks } from "./room";

/**
 * The seat page from the shared link (no pl) lists all four seats. A seat that the page cannot take
 * is disabled and says why: the host's seat, a bot's seat, or a player's seat. When only one seat is free, the
 * page takes it by itself.
 */
test.describe.configure({ mode: "serial" });

const players: Player[] = [];

test.beforeAll(async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	for (const name of ["host", "guest"])
		players.push(await Player.open(browser, baseURL, name));
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern as the first parameter.
test.afterEach(async ({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus) await reportNetwork(players);
});

test.afterAll(async () => {
	for (const player of players) await player.close();
});

async function switchToBot(page: Page, seat: string): Promise<void> {
	await page
		.getByTestId(`tile-${seat}`)
		.getByRole("button", { name: /Switch to bot$/ })
		.click();
	await expect(
		page
			.getByTestId(`tile-${seat}`)
			.getByRole("button", { name: /Switch to player$/ }),
	).toBeVisible();
}

test("the shared link shows the host's and the bots' seats as taken, and takes the last free seat by itself", async () => {
	test.setTimeout(180_000);
	const [host, guest] = players as [Player, Player];
	const hostPage = await host.page("./");
	await mockBotBidding(hostPage, () => "P");

	const link = await createRoom(hostPage);
	await hostPage.getByRole("button", { name: "Settings", exact: true }).click();

	await hostPage.getByRole("button", { name: "Save settings" }).click();
	await switchToBot(hostPage, "N");

	const shared = new URL(link);
	shared.searchParams.delete("pl");
	const page = await guest.page(shared.toString());
	await expect(page.getByTestId("pick-N")).toHaveText("North — player1 (bot)", {
		timeout: CONNECT_MS,
	});
	await expect(page.getByTestId("pick-N")).toBeDisabled();
	await expect(page.getByTestId("pick-W")).toHaveText("West — player4 (host)");
	await expect(page.getByTestId("pick-W")).toBeDisabled();
	await expect(page.getByTestId("pick-E")).toHaveText("East — player3");
	await expect(page.getByTestId("pick-S")).toHaveText("South — player2");
	await expect(picks(page)).toHaveCount(2);

	// The host makes East a bot too: South is the only free seat, so the page takes it.
	await switchToBot(hostPage, "E");
	await expectSeat(page, "S", { timeout: CONNECT_MS });
	await expect(page.getByTestId("table")).toHaveAttribute("data-board", "1", {
		timeout: CONNECT_MS,
	});
});

test("the host's page keeps its bot seats in its URL without a reload, so the refreshed host still shows them as bots", async () => {
	test.setTimeout(180_000);
	const [host, guest] = players as [Player, Player];
	const hostPage = await host.page("./");
	await mockBotBidding(hostPage, () => "P");

	const link = await createRoom(hostPage);
	await hostPage.getByRole("button", { name: "Settings", exact: true }).click();

	await hostPage.getByRole("button", { name: "Save settings" }).click();
	await hostPage.evaluate(() => {
		(window as { notReloaded?: boolean }).notReloaded = true;
	});
	await switchToBot(hostPage, "N");
	await switchToBot(hostPage, "E");
	await expect
		.poll(() => new URL(hostPage.url()).searchParams.get("b"))
		.toBe("NE");
	expect(
		await hostPage.evaluate(
			() => (window as { notReloaded?: boolean }).notReloaded,
		),
	).toBe(true);

	await hostPage.reload();
	for (const seat of ["N", "E"])
		await expect(
			hostPage.getByTestId(`tile-${seat}`).locator(".bot-overlay"),
		).toBeVisible({ timeout: CONNECT_MS });
	const page = await guest.page(link);
	// North and East are the host's bots, so South is the only free seat, and the page takes it.
	await expectSeat(page, "S", { timeout: CONNECT_MS });
});

test("a link whose table nobody has offers its seats only after the page finds no host", async () => {
	const [, guest] = players as [Player, Player];
	const key = randomBytes(16).toString("base64url");
	const names = `n=${NAME.N}&e=${NAME.E}&s=${NAME.S}&w=${NAME.W}`;
	const page = await guest.page(`./?${names}&h=S#k=${key}`);
	await expect(page.getByTestId("pick-E")).toHaveText(
		`East — ${NAME.E} (waiting for the host)`,
	);
	await expect(picks(page)).toHaveCount(0);
	const since = Date.now();
	await expect(picks(page)).toHaveCount(4, { timeout: NOBODY_MS + CONNECT_MS });
	expect(Date.now() - since).toBeGreaterThan(NOBODY_MS - 5_000);
	await expect(page.getByTestId("pick-E")).toHaveText(`East — ${NAME.E}`);
});

test("no uncaught errors", () => {
	expect(players.flatMap((player) => player.errors)).toEqual([]);
});
