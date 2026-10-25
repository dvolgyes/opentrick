import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick, type SeatKey } from "./room";

/*
 * The creator hosts from the West seat. When the creator's browser is gone and a new browser opens the shared link,
 * that browser has no replica of the table, and the link carries the whole table setup. It must not seed a fresh
 * table at the setup's host seat while the other pages have the table (ADR 0005).
 */

test("a new browser that takes the seat of the departed host joins the existing table", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(300_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const creator = await Player.open(browser, baseURL, "creator");
	const others: Player[] = [];
	try {
		const host = await creator.page("./");
		const link = await createRoom(host);
		const pages = new Map<SeatKey, Page>();
		for (const seat of ["N", "E", "S"] as const) {
			const player = await Player.open(browser, baseURL, `player-${seat}`);
			others.push(player);
			const page = await player.page(link);
			await expect(page.getByTestId(`pick-${seat}`)).toBeVisible({
				timeout: CONNECT_MS,
			});
			await pick(page, seat);
			pages.set(seat, page);
		}
		for (const page of [host, ...pages.values()])
			await expect(page.locator(".bridge-table")).toHaveAttribute(
				"data-phase",
				"auction",
				{ timeout: CONNECT_MS },
			);

		await creator.close();
		const newcomer = await Player.open(browser, baseURL, "newcomer");
		others.push(newcomer);
		const page = await newcomer.page(link);
		await expect(page.getByTestId("pick-W")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await page.getByTestId("pick-W").click();
		pages.set("W", page);

		// One of the three pages becomes the host, and the newcomer gets West from it.
		await expect(page.locator(".bridge-table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: 150_000 },
		);
		await expect(page.getByText(/to come back/)).toHaveCount(0, {
			timeout: CONNECT_MS,
		});
		for (const seatPage of pages.values())
			await expect(seatPage.getByText(/superseded/)).toHaveCount(0);
	} finally {
		for (const player of others) await player.close();
		await creator.close();
	}
});
