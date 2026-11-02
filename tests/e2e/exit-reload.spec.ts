import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";
import { createRoom } from "./room";

/*
 * A browser reload keeps the current table. Confirmed exit opens the site root without the setup query or table link.
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
	test(`on ${form}, Exit confirms before opening the site root`, async ({
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

			await expect(
				page.getByRole("button", { name: "Reload", exact: true }),
			).toHaveCount(0, { timeout: 1500 });
			await page.reload();
			await expect.poll(() => hasMark(page)).toBe(false);
			expect(page.url()).toBe(tableUrl);
			await expect(
				page.getByRole("button", { name: "Exit", exact: true }),
			).toBeVisible({ timeout: 1500 });

			await markDocument(page);
			await page.getByRole("button", { name: "Exit", exact: true }).click();
			const confirm = page.getByRole("dialog", { name: "Exit?" });
			await expect(confirm).toBeVisible({ timeout: 1500 });
			await expect(confirm).toHaveAccessibleDescription(
				"Leave this game and return to the home screen?",
			);
			const cancel = confirm.getByRole("button", {
				name: "Cancel",
				exact: true,
			});
			const leave = confirm.getByRole("button", { name: "Exit", exact: true });
			await expect(cancel).toBeFocused();
			const geometry = await confirm.evaluate((dialog) => {
				const buttons = [...dialog.querySelectorAll("button")];
				return {
					width: dialog.getBoundingClientRect().width,
					buttons: buttons.map((item) => {
						const rect = item.getBoundingClientRect();
						return {
							x: rect.x,
							y: rect.y,
							width: rect.width,
							color: getComputedStyle(item).backgroundColor,
						};
					}),
				};
			});
			const [stay, exit] = geometry.buttons;
			if (!stay || !exit) throw new Error("Exit confirmation buttons missing");
			expect(stay.width).toBeGreaterThan(geometry.width * 0.3);
			expect(exit.width).toBeGreaterThan(geometry.width * 0.3);
			expect(Math.abs(stay.width - exit.width)).toBeLessThan(2);
			expect(Math.abs(stay.y - exit.y)).toBeLessThan(2);
			const stayColor = stay.color.match(/\d+/g)?.map(Number) ?? [];
			const exitColor = exit.color.match(/\d+/g)?.map(Number) ?? [];
			expect(stayColor[1] ?? 0).toBeGreaterThan(stayColor[0] ?? 255);
			expect(exitColor[0] ?? 0).toBeGreaterThan(exitColor[1] ?? 255);
			await cancel.click();
			await expect(confirm).toBeHidden();
			expect(page.url()).toBe(tableUrl);
			expect(await hasMark(page)).toBe(true);
			await page.getByRole("button", { name: "Exit", exact: true }).click();
			await page.keyboard.press("Escape");
			await expect(confirm).toBeHidden();
			expect(page.url()).toBe(tableUrl);
			await page.getByRole("button", { name: "Exit", exact: true }).click();
			await leave.click();
			await expect(page).toHaveURL(new URL("./", baseURL).toString());
			await expect(page.getByTestId("create")).toBeVisible();
			expect(await hasMark(page)).toBe(false);
		} finally {
			await player.close();
		}
	});
}
