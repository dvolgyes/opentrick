import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type {} from "./harness/community";
import { HARNESS_URL } from "./ports";
import { RelayHub } from "./relay-hub";

test("leaving public discovery preserves the private formation channel", async ({
	browser,
}) => {
	const hub = new RelayHub("tracker", ["wss://tracker.community.test"]);
	const contexts: BrowserContext[] = [];
	const pages: Page[] = [];
	const errors: string[] = [];
	try {
		for (let index = 0; index < 4; index++) {
			const context = await browser.newContext();
			contexts.push(context);
			await hub.install(context, String(index));
			const page = await context.newPage();
			pages.push(page);
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto(new URL("community.html", HARNESS_URL).href);
			await page.waitForFunction(() => window.communityHarness !== undefined);
			await page.evaluate(() => {
				window.communityHarness.open("waiting-v1");
				window.communityHarness.open("test-party", "AAAAAAAAAAAAAAAAAAAAAA");
			});
		}
		for (const page of pages) {
			await expect
				.poll(
					() =>
						page.evaluate(() => window.communityHarness.peers("waiting-v1")),
					{ timeout: 30_000 },
				)
				.toBe(3);
			await expect
				.poll(
					() =>
						page.evaluate(() => window.communityHarness.peers("test-party")),
					{ timeout: 30_000 },
				)
				.toBe(3);
		}
		await Promise.all(
			pages.map((page) =>
				page.evaluate(() => window.communityHarness.leave("waiting-v1")),
			),
		);
		for (const [index, page] of pages.entries())
			await page.evaluate(
				(id) => window.communityHarness.send("test-party", `after-${id}`),
				index,
			);
		for (const [index, page] of pages.entries()) {
			await expect
				.poll(() =>
					page.evaluate(() =>
						[...window.communityHarness.received("test-party")].sort(),
					),
				)
				.toEqual(
					[0, 1, 2, 3].filter((id) => id !== index).map((id) => `after-${id}`),
				);
			expect(
				await page.evaluate(() => window.communityHarness.peers("waiting-v1")),
			).toBe(0);
			expect(
				await page.evaluate(() => window.communityHarness.problems()),
			).toBe(0);
		}
		expect(errors).toEqual([]);
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});

test("twelve browsers discover each other and exchange bounded announcements", async ({
	browser,
}) => {
	const hub = new RelayHub("tracker", ["wss://tracker.community.test"]);
	const contexts: BrowserContext[] = [];
	const pages: Page[] = [];
	try {
		for (let index = 0; index < 12; index++) {
			const context = await browser.newContext();
			contexts.push(context);
			await hub.install(context, String(index));
			const page = await context.newPage();
			pages.push(page);
			await page.goto(new URL("community.html", HARNESS_URL).href);
			await page.waitForFunction(() => window.communityHarness !== undefined);
			await page.evaluate(() => window.communityHarness.open("waiting-v1"));
		}
		for (const page of pages)
			await expect
				.poll(
					() =>
						page.evaluate(() => window.communityHarness.peers("waiting-v1")),
					{ timeout: 45_000 },
				)
				.toBe(11);
		for (const [index, page] of pages.entries())
			await page.evaluate(
				(index) =>
					window.communityHarness.send("waiting-v1", `announcement-${index}`),
				index,
			);
		for (const page of pages) {
			await expect
				.poll(() =>
					page.evaluate(
						() => window.communityHarness.received("waiting-v1").length,
					),
				)
				.toBe(11);
			expect(
				await page.evaluate(() => window.communityHarness.problems()),
			).toBe(0);
		}
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});
