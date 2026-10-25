import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/*
 * A page that waits for the other players keeps the screen on, so that the phone does not sleep and stop the page,
 * and tells the person to keep the page open and in front: a phone stops a page in the background.
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

test("a page that waits for the host keeps the screen on and asks to stay in front, on the seat page and after it takes a seat", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "awake-host");
	const guest = await Player.open(browser, baseURL, "awake-guest");
	try {
		const created = await host.page("./");
		const link = await createRoom(created);
		await created.close();

		await guest.addInitScript(installWakeLockProbe);
		const page = await guest.page(link);
		await expect(page.getByTestId("pick-N")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect(page.getByTestId("keep-open")).toBeVisible();
		await expect.poll(() => heldLocks(page)).toBe(1);

		await pick(page, "N");
		await expect(page.getByTestId("banner")).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect(page.getByTestId("keep-open")).toBeVisible();
		await expect.poll(() => heldLocks(page)).toBe(1);
		expect(guest.errors).toEqual([]);
	} finally {
		await host.close();
		await guest.close();
	}
});
