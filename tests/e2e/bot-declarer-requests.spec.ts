import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { Player } from "./player";
import { CONNECT_MS, createRoom, makeCall } from "./room";

for (const form of ["desktop", "mobile"] as const) {
	test(`${form}: human dummy can undo and claim against three bots`, async ({
		browser,
		baseURL,
	}) => {
		if (!baseURL) throw new Error("baseURL is not configured");
		const player = await Player.open(
			browser,
			baseURL,
			`bot-declarer-${form}`,
			form === "mobile"
				? {
						viewport: { width: 390, height: 844 },
						isMobile: true,
						hasTouch: true,
					}
				: { viewport: { width: 1920, height: 1080 } },
		);
		try {
			const page = await player.page("./");
			await page.evaluate(() => {
				new MutationObserver(() => {
					if (
						document.documentElement.dataset.completedBoard !== "1" &&
						document.querySelector('[data-phase="complete"][data-board="1"]')
					)
						document.documentElement.dataset.completedBoard = "1";
				}).observe(document, {
					subtree: true,
					attributes: true,
					childList: true,
				});
			});
			// North passes, East opens, South and the human West pass; East declares and West is dummy.
			await mockBotBidding(page, (position) =>
				position.calls.length === 1 ? "1C" : "P",
			);
			await createRoom(page, ["N", "E", "S"]);
			await makeCall(page, "P");
			const table = page.getByTestId("table");
			await expect(table).toHaveAttribute("data-phase", "play", {
				timeout: CONNECT_MS,
			});
			if (form === "mobile") {
				const controls = page.locator(".mobile-auction-controls");
				const board = page.locator(".mobile-auction-board");
				const [actionsBox, boardBox] = await Promise.all([
					controls.boundingBox(),
					board.boundingBox(),
				]);
				if (!actionsBox || !boardBox)
					throw new Error("mobile board or actions are missing");
				expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(
					boardBox.y,
				);
				const summary = page.locator(".mobile-tricks .tricks-needed");
				await expect(summary).toContainText("needed");
				expect(
					await summary.evaluate(
						(node) => node.scrollWidth <= node.clientWidth,
					),
				).toBe(true);
				await expect(page.locator(".mobile-tricks .tricks-goal")).toHaveCount(
					0,
				);
			}
			const own = page.getByTestId("hand-W");
			const card = own.locator("button.card:enabled").first();
			await expect(card).toBeVisible({ timeout: CONNECT_MS });
			await card.click();
			await expect(own.locator("button.card")).toHaveCount(12);
			const undo = page.getByTestId("undo-request");
			await expect(undo).toBeEnabled();
			await undo.click();
			await page.getByTestId("undo-confirm-send").click();
			await expect(own.locator("button.card")).toHaveCount(13, {
				timeout: CONNECT_MS,
			});
			await expect(undo).toBeEnabled();
			await undo.click();
			await expect(page.getByTestId("undo-confirm")).toContainText(
				"Ask to undo your last bid?",
			);
			await page.getByTestId("undo-confirm-send").click();
			await expect(table).toHaveAttribute("data-phase", "auction", {
				timeout: CONNECT_MS,
			});
			await makeCall(page, "P");
			await expect(table).toHaveAttribute("data-phase", "play", {
				timeout: CONNECT_MS,
			});
			const claim = page.getByRole("button", {
				name: "Claim all",
				exact: true,
			});
			await expect(claim).toBeEnabled();
			await claim.click();
			await page.getByTestId("claim-confirm").click();
			await expect(page.locator('html[data-completed-board="1"]')).toBeAttached(
				{ timeout: CONNECT_MS },
			);
			expect(player.errors).toEqual([]);
		} finally {
			await player.close();
		}
	});

	test(`${form}: human dummy can claim a chosen number of tricks`, async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(180_000);
		if (!baseURL) throw new Error("baseURL is not configured");
		const player = await Player.open(
			browser,
			baseURL,
			`bot-declarer-choice-${form}`,
			form === "mobile"
				? {
						viewport: { width: 390, height: 844 },
						isMobile: true,
						hasTouch: true,
					}
				: { viewport: { width: 1920, height: 1080 } },
		);
		try {
			const page = await player.page("./");
			await page.evaluate(() => {
				new MutationObserver(() => {
					if (
						document.documentElement.dataset.completedBoard !== "1" &&
						document.querySelector('[data-phase="complete"][data-board="1"]')
					)
						document.documentElement.dataset.completedBoard = "1";
				}).observe(document, {
					subtree: true,
					attributes: true,
					childList: true,
				});
			});
			await mockBotBidding(page, (position) =>
				position.calls.length === 1 ? "1C" : "P",
			);
			await createRoom(page, ["N", "E", "S"]);
			await makeCall(page, "P");
			const table = page.getByTestId("table");
			await expect(table).toHaveAttribute("data-phase", "play", {
				timeout: CONNECT_MS,
			});
			const claim = page.getByRole("button", { name: "Claim …", exact: true });
			const claimReady = page
				.locator(".play-controls button:enabled")
				.filter({ hasText: "Claim …" });
			const card = page
				.locator(
					'[data-testid="hand-W"], [data-testid="hand-E"], .mobile-board-top',
				)
				.locator("button.card:enabled:visible")
				.first();
			while (!(await claimReady.isVisible())) {
				await expect(card.or(claimReady).first()).toBeVisible({
					timeout: CONNECT_MS,
				});
				if (await claimReady.isVisible()) break;
				const before = await table.getAttribute("data-at");
				const clicked = await card.evaluateAll((buttons) => {
					const button = buttons[0];
					if (!(button instanceof HTMLButtonElement) || button.disabled)
						return false;
					button.click();
					return true;
				});
				if (clicked)
					await expect
						.poll(
							async () =>
								(await claimReady.isVisible()) ||
								(await table.getAttribute("data-at")) !== before,
						)
						.toBe(true);
			}
			await expect(claim).toBeEnabled();
			await claim.click();
			await page.getByTestId("claim-count-2").click();
			await page.getByTestId("claim-confirm").click();
			await expect(page.locator('html[data-completed-board="1"]')).toBeAttached(
				{ timeout: CONNECT_MS },
			);
			expect(player.errors).toEqual([]);
		} finally {
			await player.close();
		}
	});
}

test("taking back autoplay permits repeated undo of the bot's plays", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await mockBotBidding(page, () => "P");
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	await makeCall(page, "1C");
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-phase", "play", {
		timeout: CONNECT_MS,
	});
	const autoplay = page.getByTestId("host-autoplay-toggle");
	await autoplay.click();
	await page.getByTestId("autoplay-confirm-enable").click();
	await expect(autoplay).toHaveText("Take back control");
	await expect
		.poll(async () => Number(await table.getAttribute("data-at")), {
			timeout: 90_000,
		})
		.toBeGreaterThanOrEqual(15);
	await autoplay.click();
	await expect(autoplay).toHaveText("Autoplay my seat");
	const undo = page.getByTestId("undo-request");
	let undos = 0;
	while ((await table.getAttribute("data-phase")) === "play" && undos < 20) {
		await expect(undo).toBeEnabled();
		const before = Number(await table.getAttribute("data-at"));
		await undo.click();
		await page.getByTestId("undo-confirm-send").click();
		await expect
			.poll(async () => Number(await table.getAttribute("data-at")), {
				timeout: CONNECT_MS,
			})
			.toBeLessThan(before);
		undos++;
	}
	expect(undos).toBeGreaterThanOrEqual(3);
	await expect(table).toHaveAttribute("data-phase", "auction");
});
