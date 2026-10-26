import { expect, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/*
 * A page that waits for the host shows how far its connection got, below the waiting text: the trackers, the
 * Nostr relays and the MQTT brokers that it reaches, whether WebRTC works in the browser, its direct connections,
 * and whether STUN found its public address.
 */

const SUMMARY =
	/^Trackers reachable: (\d+ of \d+|not started) · Nostr relays reachable: (\d+ of \d+|not started) · MQTT brokers reachable: (\d+ of \d+|not started) · WebRTC in this browser: (checking|works|failed) · Direct connections: \d+ · Public address found: (yes|no)$/;

test("a page without a host shows the tracker, relay and connection counts in the lobby, and in the banner after it takes a seat", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "summary-host");
	const guest = await Player.open(browser, baseURL, "summary-guest");
	try {
		const created = await host.page("./");
		const link = await createRoom(created);
		await created.close();

		const page = await guest.page(link);
		await expect(page.getByTestId("pick-N")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect(page.getByTestId("table-status")).not.toBeEmpty();
		await expect(page.getByTestId("connection-summary")).toHaveText(SUMMARY);
		// The Network panel of the seat page starts closed; a click shows each tracker and relay line.
		const network = page.getByTestId("network");
		await expect(network).not.toHaveAttribute("open");
		await network.locator("summary").click();
		await expect(network.getByText("Trackers reachable")).toBeVisible();

		await pick(page, "N");
		await expect(page.getByTestId("banner")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect(page.getByTestId("banner-detail")).toHaveText(SUMMARY);
		await expect(page.getByTestId("network")).not.toHaveAttribute("open");
		expect(guest.errors).toEqual([]);
	} finally {
		await host.close();
		await guest.close();
	}
});
