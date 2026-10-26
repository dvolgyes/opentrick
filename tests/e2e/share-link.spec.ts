import { expect, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom } from "./room";

/*
 * The copied table link has no pl, so no browser takes a seat by itself from it: not even the
 * creator's browser, which remembers its seat for each room (src/session.ts). Taking a seat names it in the URL.
 */

test("Copy link copies a link without a seat, and the creator's browser opens that link without taking its seat", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "share-host");
	try {
		await host.grantPermissions(["clipboard-read", "clipboard-write"]);
		const page = await host.page("./");
		const own = new URL(await createRoom(page));
		const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
		await page.evaluate(() => navigator.clipboard.writeText(""));
		await page.getByRole("button", { name: "Copy link", exact: true }).click();
		await expect.poll(clipboard).not.toBe("");
		const link = await clipboard();
		const shared = new URL(link);
		expect(shared.searchParams.has("pl")).toBe(false);
		expect(shared.toString()).toBe(own.toString());

		await page.close();
		const again = await host.page(link);
		await expect(again.getByTestId("pick-W")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect(again).toHaveTitle("Bridge");
		expect(new URL(again.url()).searchParams.has("pl")).toBe(false);
		await again.getByTestId("pick-W").click();
		await expect(again).toHaveTitle(/player4 \(W\)$/);
		expect(new URL(again.url()).searchParams.get("pl")).toBe("W");
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});

/** Replaces the Web Share API with a fake that records what the page shares. */
function installShareProbe(): void {
	const shared: ShareData[] = [];
	(window as unknown as { sharedData: ShareData[] }).sharedData = shared;
	Object.defineProperty(navigator, "share", {
		configurable: true,
		value: async (data: ShareData) => {
			shared.push(data);
		},
	});
}

test("on a phone the link button opens the device's share sheet with the link that has no seat", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "share-phone", {
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		await host.grantPermissions(["clipboard-read", "clipboard-write"]);
		await host.addInitScript(installShareProbe);
		const page = await host.page("./");
		const own = new URL(await createRoom(page));
		await page.evaluate(() => navigator.clipboard.writeText(""));
		await page.getByRole("button", { name: "Share URL", exact: true }).click();
		const sharedData = () =>
			page.evaluate(
				() => (window as unknown as { sharedData: ShareData[] }).sharedData,
			);
		await expect.poll(async () => (await sharedData()).length).toBe(1);
		const [data] = await sharedData();
		const shared = new URL(data?.url ?? "");
		expect(shared.searchParams.has("pl")).toBe(false);
		expect(shared.toString()).toBe(own.toString());
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("");
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});
