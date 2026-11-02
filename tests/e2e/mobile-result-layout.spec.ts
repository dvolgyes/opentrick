import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { Player } from "./player";
import { makeCall, namePlayers } from "./room";

test("the phone result keeps the game board and controls in place", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "mobile-result", {
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await mockBotBidding(page, () => "P", 0);
		await page.getByTestId("create-solo").click();
		const table = page.getByTestId("table");
		await expect(table).toHaveAttribute("data-at", "2");
		const topbar = page.locator(".mobile-auction-topbar");
		const before = await topbar.boundingBox();
		if (!before) throw new Error("mobile controls are missing");
		await makeCall(page, "P");
		await expect(table).toHaveAttribute("data-phase", "complete");
		await expect(topbar).toBeVisible();
		const after = await topbar.boundingBox();
		if (!after) throw new Error("result controls are missing");
		expect(Math.abs(after.y - before.y)).toBeLessThan(2);
		await expect(page.getByTestId("scoring")).toBeVisible();
		await expect(page.locator(".mobile-auction-board .hand .card")).toHaveCount(
			52,
		);
		await page.locator(".mobile-board-right .hcp-pill").click();
		await expect(page.getByTestId("points-dialog")).toBeVisible();
		await page
			.getByTestId("points-dialog")
			.getByRole("button", { name: "OK" })
			.click();
		for (const width of [320, 390, 430]) {
			await page.setViewportSize({ width, height: 844 });
			const geometry = await page
				.locator(".mobile-auction-board")
				.evaluate((board) => {
					const bounds = board.getBoundingClientRect();
					const rect = (selector: string) => {
						const element = board.querySelector<HTMLElement>(selector);
						if (!element) throw new Error(`Missing ${selector}`);
						return element.getBoundingClientRect();
					};
					return {
						topGap:
							rect(".mobile-board-top .mobile-board-name").top - bounds.top,
						bottomGap:
							bounds.bottom - rect(".mobile-auction-hand .hand").bottom,
						rightGap: bounds.right - rect(".mobile-board-right .hand").right,
						coveredCards: [
							...board.querySelectorAll<HTMLElement>(".hand .card"),
						].filter((card) => {
							const item = card.getBoundingClientRect();
							const score = rect(".scoring");
							return (
								item.left < score.right &&
								item.right > score.left &&
								item.top < score.bottom &&
								item.bottom > score.top
							);
						}).length,
						rows: [
							".mobile-board-top",
							".mobile-board-left",
							".mobile-board-right",
							".mobile-auction-hand",
						].map((position) => {
							const label = rect(
								`${position} :is(.mobile-board-name, .seat-label)`,
							);
							const pill = rect(`${position} .hcp-pill`);
							return (
								Math.min(label.bottom, pill.bottom) -
								Math.max(label.top, pill.top)
							);
						}),
					};
				});
			expect(geometry.topGap, `${width}px top gap`).toBeLessThan(12);
			expect(geometry.bottomGap, `${width}px bottom gap`).toBeLessThan(12);
			expect(geometry.rightGap, `${width}px right alignment`).toBeLessThan(12);
			expect(geometry.coveredCards, `${width}px covered cards`).toBe(0);
			for (const overlap of geometry.rows) expect(overlap).toBeGreaterThan(0);
		}
		await page.getByTestId("next-board").click();
		await expect(table).toHaveAttribute("data-board", "2");
	} finally {
		await player.close();
	}
});

test("a claimed phone result keeps trump labels and reveals all hands", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "mobile-trump-result", {
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await page.evaluate(() => {
			localStorage.setItem("opentrick.settings.bot-bid-delay-ms", "0");
			localStorage.setItem("opentrick.settings.auction-pause-ms", "0");
		});
		await mockBotBidding(page, () => "P", 0);
		await namePlayers(page, "N", ["E", "S", "W"]);
		await page.getByTestId("create").click();
		await makeCall(page, "1H");
		await expect(page.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"play",
		);
		const claim = page
			.locator(".mobile-auction-controls .play-controls")
			.getByRole("button", { name: "Claim all", exact: true });
		await expect(claim).toBeEnabled();
		await claim.click();
		await page.getByTestId("claim-confirm").click();
		await expect(page.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"complete",
		);
		const board = page.locator(".mobile-auction-board");
		await expect(board.locator(".hand .card")).toHaveCount(52);
		for (const position of ["top", "left", "right", "bottom"]) {
			const hand = board.locator(
				position === "bottom"
					? ".mobile-auction-hand"
					: `.mobile-board-${position}`,
			);
			if ((await hand.locator(".trump").count()) > 0)
				await expect(hand.locator(".trump-label")).toBeVisible();
		}
	} finally {
		await player.close();
	}
});

test("a phone can hold an automatic result and start the next board", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "mobile-review", {
		viewport: { width: 320, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await page.evaluate(() =>
			localStorage.setItem("opentrick.settings.solo-auto-advance", "1"),
		);
		await mockBotBidding(page, () => "P", 0);
		await page.getByTestId("create-solo").click();
		await expect(page.getByTestId("table")).toHaveAttribute("data-at", "2");
		await makeCall(page, "P");
		const scoring = page.getByTestId("scoring");
		await expect(scoring.getByTestId("scoring-countdown")).toBeVisible();
		await expect(scoring.getByTestId("next-board")).toBeVisible();
		await scoring.getByRole("button", { name: "Review", exact: true }).click();
		await expect(scoring.getByTestId("scoring-countdown")).toBeHidden();
		await scoring.getByTestId("next-board").click();
		await expect(page.getByTestId("table")).toHaveAttribute("data-board", "2");
	} finally {
		await player.close();
	}
});

test("autoplay confirmation uses the same action colors as exit", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P", 0);
	await page.goto("/");
	await page.getByTestId("create-solo").click();
	await page.getByTestId("host-autoplay-toggle").click();
	const autoplay = page.getByTestId("autoplay-confirm");
	const color = (selector: string) =>
		autoplay
			.getByTestId(selector)
			.evaluate((button) => getComputedStyle(button).backgroundColor);
	const colors = [
		await color("autoplay-cancel"),
		await color("autoplay-confirm-enable"),
	];
	await page.getByTestId("autoplay-cancel").click();
	await page.getByRole("button", { name: "Exit", exact: true }).click();
	const exit = page.getByRole("dialog", { name: "Exit?" });
	const exitColors = await exit
		.locator(".approval-actions button")
		.evaluateAll((buttons) =>
			buttons.map((button) => getComputedStyle(button).backgroundColor),
		);
	expect(colors).toEqual(exitColors);
	expect(colors[0]).not.toBe(colors[1]);
});
