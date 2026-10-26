import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";
import { createRoom } from "./room";

/*
 * Reload loads the table page again from the server, so a player picks up a new version of the site and stays at the
 * table. Exit loads the create page at the root of the site, without the setup query or the table link.
 */
const FORMS = {
	desktop: {},
	phone: {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	},
} as const;

/** A mark in the window object; a new document from the server does not have it. */
async function markDocument(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as { opentrickMark?: boolean }).opentrickMark = true;
	});
}

async function hasMark(page: Page): Promise<boolean> {
	return page.evaluate(
		() => (window as { opentrickMark?: boolean }).opentrickMark === true,
	);
}

for (const [form, options] of Object.entries(FORMS)) {
	test(`on ${form}, Reload loads the table again and Exit opens the create page at the site root`, async ({
		browser,
		baseURL,
	}) => {
		if (!baseURL) throw new Error("baseURL is not configured");
		const player = await Player.open(browser, baseURL, form, options);
		try {
			const page = await player.page("./");
			await createRoom(page);
			const tableUrl = page.url();
			await markDocument(page);

			await page.getByRole("button", { name: "Reload", exact: true }).click();
			await expect.poll(() => hasMark(page)).toBe(false);
			expect(page.url()).toBe(tableUrl);
			await expect(
				page.getByRole("button", { name: "New table", exact: true }),
			).toBeVisible();

			await markDocument(page);
			await page
				.getByRole("button", { name: "New table", exact: true })
				.click();
			await expect(page).toHaveURL(new URL("./", baseURL).toString());
			await expect(page.getByTestId("create")).toBeVisible();
			expect(await hasMark(page)).toBe(false);
		} finally {
			await player.close();
		}
	});
}
