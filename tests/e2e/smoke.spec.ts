import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";
import {
	CONNECT_MS,
	createRoom,
	expectAllConnected,
	expectSeat,
	lines,
	MESSAGE,
	pick,
	picks,
	sendDraft,
} from "./room";

test("one browser: create, three seats from one link, ordered messages", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "player");
	try {
		const host = await player.page("./");
		const link = await createRoom(host);

		// The tabs share one browser, so active seats stay with their current tabs.
		const guests: Page[] = [];
		const order = [
			{ seat: "N", choices: 3 },
			{ seat: "E", choices: 2 },
			{ seat: "S", choices: 1 },
		] as const;
		for (const { seat, choices } of order) {
			const page = await player.page(link);
			if (choices === 1) {
				await expectSeat(page, seat, {
					timeout: CONNECT_MS,
				});
			} else {
				await expect(
					page.getByRole("heading", { name: "Choose your seat" }),
				).toBeVisible({ timeout: CONNECT_MS });
				await expect(picks(page)).toHaveCount(choices);
				await pick(page, seat);
			}
			guests.push(page);
		}

		for (const page of [host, ...guests]) {
			await expect(
				page.getByTestId("roster").locator('li[data-state="online"]'),
			).toHaveCount(4, { timeout: CONNECT_MS });
			await expectAllConnected(page, true, {
				timeout: CONNECT_MS,
			});
		}
		await expect(host.getByTestId("send")).toBeEnabled();
		await sendDraft(host);
		// Each reply waits for the previous one, so the expected order is fixed.
		for (const [index, page] of guests.entries()) {
			await expect(lines(page)).toHaveCount(index + 1);
			await sendDraft(page);
		}

		const expected = [MESSAGE.W, MESSAGE.N, MESSAGE.E, MESSAGE.S];
		for (const page of [host, ...guests]) {
			await expect(lines(page).locator(".text")).toHaveText(expected);
			await expect(lines(page).locator(".receipt")).toHaveText(
				expected.map(() => "Received by 3 of 3"),
			);
			await expect(page.getByTestId("pending").locator("li")).toHaveCount(0);
			await expect(page.getByTestId("banner")).toBeHidden();
		}
		expect(player.errors).toEqual([]);
	} finally {
		await player.close();
	}
});

test("the page shows the commit date of its build, and the commit on hover", async ({
	page,
}) => {
	const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
		encoding: "utf8",
	}).trim();
	await page.goto("./");
	const version = page.getByTestId("build-version");
	await expect(version).toBeVisible();
	await expect(version).toHaveText(
		/^[A-Z][a-z]{2} \d{1,2},'\d{2}, [0-2]\d:[0-5]\d$/,
	);
	await expect(version).toHaveAttribute("title", commit);
});
