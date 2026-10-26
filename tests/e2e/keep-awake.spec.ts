import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/*
 * Every page keeps the screen on, so that a phone does not sleep and stop the page. The page does not ask the person
 * to keep it open.
 */

/** Replaces the Screen Wake Lock API with a fake that counts the locks that the page holds. */
function installWakeLockProbe(): void {
	const probe = { requests: 0, held: 0 };
	(window as unknown as { wakeLockProbe: typeof probe }).wakeLockProbe = probe;
	Object.defineProperty(navigator, "wakeLock", {
		configurable: true,
		value: {
			request: async () => {
				probe.requests++;
				probe.held++;
				let released = false;
				return {
					get released() {
						return released;
					},
					release: async () => {
						if (released) return;
						released = true;
						probe.held--;
					},
				};
			},
		},
	});
}

const heldLocks = (page: Page): Promise<number> =>
	page.evaluate(
		() =>
			(window as unknown as { wakeLockProbe: { held: number } }).wakeLockProbe
				.held,
	);

test("the create page, the seat page, the table and a broken link each keep the screen on without a keep-open note", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "awake-host");
	const guest = await Player.open(browser, baseURL, "awake-guest");
	try {
		await host.addInitScript(installWakeLockProbe);
		const created = await host.page("./");
		await expect(created.getByTestId("create")).toBeVisible();
		await expect.poll(() => heldLocks(created)).toBe(1);
		const link = await createRoom(created);
		await expect.poll(() => heldLocks(created)).toBe(1);

		await guest.addInitScript(installWakeLockProbe);
		const page = await guest.page(link);
		await expect(page.getByTestId("pick-N")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect.poll(() => heldLocks(page)).toBe(1);

		await pick(page, "N");
		await expect(page).toHaveTitle(/\(N\)$/, { timeout: CONNECT_MS });
		await expect.poll(() => heldLocks(page)).toBe(1);
		await expect(page.getByText(/keep this page open/i)).toHaveCount(0);
		await expect(created.getByText(/keep this page open/i)).toHaveCount(0);

		const broken = await guest.page("./#v=p2p-v1&k=broken");
		await expect(
			broken.getByText("This link is not valid", { exact: false }),
		).toBeVisible();
		await expect.poll(() => heldLocks(broken)).toBe(1);
		expect(guest.errors).toEqual([]);
	} finally {
		await host.close();
		await guest.close();
	}
});
