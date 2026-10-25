import { expect, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom } from "./room";

/*
 * The copied table link says selected_player=none, so no browser takes a seat by itself from it: not even the
 * creator's browser, which remembers its seat for each room (src/session.ts). Taking a seat names it in the URL.
 */

test("Copy link copies selected_player=none, and the creator's browser opens that link without taking its seat", async ({
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
		expect(shared.searchParams.getAll("selected_player")).toEqual(["none"]);
		shared.searchParams.delete("selected_player");
		expect(shared.toString()).toBe(own.toString());

		await page.close();
		const again = await host.page(link);
		await expect(again.getByTestId("pick-W")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect(again).toHaveTitle("Bridge");
		expect(new URL(again.url()).searchParams.get("selected_player")).toBe(
			"none",
		);
		await again.getByTestId("pick-W").click();
		await expect(again).toHaveTitle(/player4 \(W\)$/);
		expect(new URL(again.url()).searchParams.get("selected_player")).toBe("W");
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});
