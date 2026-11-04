import { expect, test } from "@playwright/test";
import { Player } from "./player";
import { CONNECT_MS, createRoom, expectSeat, pick, rosterSeat } from "./room";

/*
 * The copied table link has no pl. A browser that opens it reopens the seat that it remembers for the room, so the
 * creator's browser comes back to its own seat. Taking a seat names it in the URL.
 */

test("Invitation URL copies a link without a seat, and the creator's browser reopens its own seat from it", async ({
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
		const notice = page.getByTestId("invitation-copied");
		await expect(notice).toHaveText(
			"Invitation copied to clipboard. Share it with the other players.",
		);
		await expect(notice).toBeVisible();
		await expect(notice).toBeHidden({ timeout: 5_000 });
		const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
		expect(await clipboard()).toBe(own.toString());
		await page.evaluate(() => navigator.clipboard.writeText(""));
		await page
			.getByRole("button", { name: "Invitation URL", exact: true })
			.click();
		await expect(notice).toBeVisible();
		await page.waitForTimeout(2_000);
		await expect(notice).toBeVisible();
		await expect(notice).toBeHidden({ timeout: 5_000 });
		await expect.poll(clipboard).not.toBe("");
		const link = await clipboard();
		const shared = new URL(link);
		expect(shared.searchParams.has("pl")).toBe(false);
		expect(shared.toString()).toBe(own.toString());

		await page.close();
		const again = await host.page(link);
		await expectSeat(again, "W", { timeout: CONNECT_MS });
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});

test("a solo host gets no automatic invitation notice", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "share-solo");
	try {
		await host.grantPermissions(["clipboard-read", "clipboard-write"]);
		const page = await host.page("./");
		const link = await createRoom(page, ["N", "E", "S"]);
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(link);
		await expect(page.getByTestId("invitation-copied")).toBeHidden();
	} finally {
		await host.close();
	}
});

test("shows the automatic invitation notice after first-time settings close", async ({
	page,
}) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto("./");
	await page.evaluate(() =>
		localStorage.removeItem("opentrick.settings.bidder"),
	);
	const link = await createRoom(page);
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(link);
	const settings = page.getByTestId("settings-dialog");
	const notice = page.getByTestId("invitation-copied");
	await expect(settings).toBeVisible();
	await expect(notice).toBeHidden({ timeout: 250 });
	await settings.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(notice).toBeVisible();
	await expect(notice).toBeHidden({ timeout: 5_000 });
});

test("a refused clipboard write never reports an invitation as copied", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "share-refused");
	try {
		await host.addInitScript(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: async () => {
						(
							window as unknown as { clipboardAttempts: number }
						).clipboardAttempts =
							((window as unknown as { clipboardAttempts?: number })
								.clipboardAttempts ?? 0) + 1;
						throw new DOMException("Denied", "NotAllowedError");
					},
				},
			});
		});
		const page = await host.page("./");
		await createRoom(page);
		const notice = page.getByTestId("invitation-copied");
		await expect(notice).toBeHidden();
		await page
			.getByRole("button", { name: "Invitation URL", exact: true })
			.click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { clipboardAttempts: number })
							.clipboardAttempts,
				),
			)
			.toBe(2);
		await expect(notice).toBeHidden();
	} finally {
		await host.close();
	}
});

test("does not show the automatic notice after the last human seat is taken", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "share-filled-host");
	const guest = await Player.open(browser, baseURL, "share-filled-guest");
	try {
		await host.addInitScript(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: () =>
						new Promise<void>((resolve) => {
							(window as unknown as { finishCopy: () => void }).finishCopy =
								resolve;
						}),
				},
			});
		});
		const page = await host.page("./");
		const link = await createRoom(page, ["E", "S"]);
		const guestPage = await guest.page(link);
		await pick(guestPage, "N");
		await expect(rosterSeat(page, "N")).toHaveAttribute(
			"data-state",
			"online",
			{ timeout: CONNECT_MS },
		);
		await page.evaluate(async () => {
			(window as unknown as { finishCopy: () => void }).finishCopy();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		await expect(page.getByTestId("invitation-copied")).toBeHidden();
	} finally {
		await guest.close();
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
		await page.getByRole("button", { name: "Invite", exact: true }).click();
		await expect(
			page
				.getByRole("button", { name: "Invite", exact: true })
				.locator(".icon"),
		).toBeVisible();
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
