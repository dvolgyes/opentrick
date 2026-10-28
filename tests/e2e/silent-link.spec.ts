import { expect, type Page, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { freeze } from "./lifecycle";

import { Player } from "./player";
import { CONNECT_MS, createRoom, pick, rosterSeat } from "./room";

/**
 * With "Check the connection more often" on, the host closes the link of a page that sends nothing for 15 s
 * (ADR 0004, silent links). A paused page keeps its WebRTC link up, so only the silence shows that it is gone.
 */

/** The bots always pass, so the first board stays in the auction while the test runs. */
async function passingBots(page: Page): Promise<void> {
	await mockBotBidding(page, () => "P");
}

// Debug button: the part of its export that this test reads.
// interface Exported {
// 	readonly view: {
// 		readonly network: {
// 			readonly silentCloses: readonly { readonly silentMs: number }[];
// 		};
// 	};
// }

test("the host closes the link of a paused player after 15 s of silence, and the player connects again after it resumes", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(180_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host");
	const guest = await Player.open(browser, baseURL, "guest");
	try {
		await host.grantPermissions(["clipboard-read", "clipboard-write"]);
		const hostPage = await host.page("./");
		await hostPage.evaluate(() =>
			localStorage.setItem("opentrick.settings.relay-checks", "1"),
		);
		await passingBots(hostPage);
		const link = await createRoom(hostPage, ["E", "S"]);
		const guestPage = await guest.page(link);
		await pick(guestPage, "N");
		for (const page of [hostPage, guestPage])
			await expect(page.getByTestId("table")).toHaveAttribute(
				"data-phase",
				"auction",
				{ timeout: CONNECT_MS },
			);

		const thaw = await freeze(guestPage);
		// 15 s of silence, a tick, and Trystero's leave.
		await expect(rosterSeat(hostPage, "N")).toHaveAttribute(
			"data-state",
			"offline",
			{ timeout: 30_000 },
		);
		await thaw();
		await expect(rosterSeat(hostPage, "N")).toHaveAttribute(
			"data-state",
			"online",
			{ timeout: CONNECT_MS },
		);
		await expect(guestPage.getByTestId("banner")).toBeHidden({
			timeout: CONNECT_MS,
		});

		// Debug button (hidden in room-view.ts): the export showed one silent close after 15 to 20 s. Restore these
		// checks with the button; tests/unit/p2p-mesh.test.ts covers the silence timing meanwhile.
		// await hostPage
		// 	.getByRole("button", { name: "Host controls", exact: true })
		// 	.click();
		// await hostPage.getByTestId("debug-export").click();
		// await expect(hostPage.getByTestId("debug-status")).toHaveText(
		// 	"Debug export copied.",
		// 	{ timeout: CONNECT_MS },
		// );
		// const exported: Exported = JSON.parse(
		// 	await hostPage.evaluate(() => navigator.clipboard.readText()),
		// );
		// const closes = exported.view.network.silentCloses;
		// expect(closes).toHaveLength(1);
		// expect(closes[0]?.silentMs).toBeGreaterThanOrEqual(15_000);
		// expect(closes[0]?.silentMs).toBeLessThan(20_000);
		expect([...host.errors, ...guest.errors]).toEqual([]);
	} finally {
		await host.close();
		await guest.close();
	}
});
