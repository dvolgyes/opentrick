import { expect, type Locator, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom } from "./room";

/*
 * The seat page checks this browser's WebRTC inside the page and shows the result in the Network panel: whether a
 * data channel works, and the types and address families of the local candidates, never an address. A browser can
 * turn WebRTC off, as an iPhone in Lockdown Mode does.
 */

/** The value of one line of the Network panel. */
const line = (network: Locator, label: string): Locator =>
	network
		.locator("dt", { hasText: label })
		.locator("xpath=following-sibling::dd[1]");

test("the seat page shows that WebRTC works and which kinds of local candidates the browser gives", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "check-host");
	const guest = await Player.open(browser, baseURL, "check-guest");
	try {
		const created = await host.page("./");
		const link = await createRoom(created);
		await created.close();

		const page = await guest.page(link);
		const network = page.getByTestId("network");
		await expect(network).toHaveAttribute("open", "");
		await expect(line(network, "Data channel inside this page")).toHaveText(
			"works",
			{ timeout: CONNECT_MS },
		);
		await expect(line(network, "Local candidates")).toHaveText(
			/^(host|srflx) (IPv4|IPv6|mDNS)/,
		);
		expect(guest.errors).toEqual([]);
	} finally {
		await host.close();
		await guest.close();
	}
});

test("a browser without WebRTC says that WebRTC is turned off, instead of connecting for ever", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "no-webrtc-host");
	const guest = await Player.open(browser, baseURL, "no-webrtc");
	try {
		const created = await host.page("./");
		const link = await createRoom(created);
		await created.close();

		await guest.addInitScript(() => {
			for (const name of [
				"RTCPeerConnection",
				"webkitRTCPeerConnection",
				"RTCDataChannel",
				"RTCSessionDescription",
				"RTCIceCandidate",
			])
				delete (window as unknown as Record<string, unknown>)[name];
		});
		const page = await guest.page(link);
		await expect(page.locator("#app")).toHaveText(
			/^This browser has WebRTC turned off, so this page cannot reach the other players\. On an iPhone or iPad, Lockdown Mode/,
		);
		expect(guest.errors).toEqual([]);
	} finally {
		await host.close();
		await guest.close();
	}
});
