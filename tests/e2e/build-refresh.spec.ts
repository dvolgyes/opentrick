import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";

/** Serve an older embedded Git date once; the automatic reload then receives the actual website build. */
async function olderFirstBuild(page: Page, keepOld = false): Promise<void> {
	let count = 0;
	await page.route("**/assets/index-*.js", async (route) => {
		const response = await route.fetch();
		let body = await response.text();
		if (count++ === 0 || keepOld) {
			const pattern = /(build:\{commit:[^,]+,date:)([`"'])[^`"']+\2(\})/;
			expect(
				pattern.test(body),
				"the deployed app embeds its Git commit date",
			).toBe(true);
			body = body.replace(
				pattern,
				(_match, prefix, quote, suffix) =>
					`${prefix}${quote}2000-01-01T00:00:00Z${quote}${suffix}`,
			);
		}
		await route.fulfill({ response, body });
	});
}

test("a cached older website gets one automatic reload and a manual retry instead of a reload loop", async ({
	page,
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL missing");
	await page.goto("/");
	await page.locator('input[name="name-S"]').fill("Host");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	const url = new URL(page.url());
	url.searchParams.delete("pl");
	const guest = await Player.open(browser, baseURL, "cached-guest");
	const guestPage = await guest.page(baseURL);
	try {
		await olderFirstBuild(guestPage, true);
		let documents = 0;
		guestPage.on("framenavigated", (frame) => {
			if (frame === guestPage.mainFrame()) documents++;
		});
		await guestPage.goto(url.toString());
		await expect(
			guestPage.getByText(
				"The website still serves an older build. Reload to try again.",
			),
		).toBeVisible();
		await expect(
			guestPage.getByRole("button", { name: "Reload", exact: true }),
		).toBeEnabled();
		await guestPage.waitForTimeout(1500);
		expect(documents).toBe(2);
		await expect(page).toHaveTitle(/Host \(S\)$/);
	} finally {
		await guest.close();
	}
});

for (const older of ["host", "guest"] as const) {
	test(`the older ${older} reloads itself on reconnect and retains its room and name`, async ({
		page,
		browser,
		baseURL,
	}) => {
		if (!baseURL) throw new Error("baseURL missing");
		if (older === "host") await olderFirstBuild(page);
		await page.goto("/");
		await page.locator('input[name="name-S"]').fill("Host");
		await page.locator('input[name="name-N"]').fill("Guest");
		await page.getByTestId("create").click();
		await expect(page).toHaveTitle(/Host \(S\)$/);
		const initial = new URL(page.url());
		const link = new URL(initial);
		link.searchParams.delete("pl");
		const guest = await Player.open(browser, baseURL, `refresh-${older}`);
		const guestPage = await guest.page(baseURL);
		try {
			if (older === "guest") await olderFirstBuild(guestPage);
			await guestPage.goto(link.toString());
			const outdated = older === "host" ? page : guestPage;
			const current = older === "host" ? guestPage : page;
			await expect
				.poll(() => new URL(outdated.url()).searchParams.has("update_to"))
				.toBe(true);
			await expect(page).toHaveTitle(/Host \(S\)$/);
			await expect(guestPage.getByTestId("pick-N")).toBeEnabled();
			await guestPage.getByTestId("pick-N").click();
			await expect(guestPage).toHaveTitle(/Guest \(N\)$/);
			await expect(page.getByTestId("roster")).toContainText("Guest");
			expect(new URL(page.url()).hash).toBe(initial.hash);
			expect(new URL(guestPage.url()).hash).toBe(initial.hash);
			expect(new URL(current.url()).searchParams.has("update_to")).toBe(false);
			expect(
				await page.evaluate(() =>
					localStorage.getItem("opentrick.player-name"),
				),
			).toBe("Host");
		} finally {
			await guest.close();
		}
	});
}
