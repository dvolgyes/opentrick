import { expect, type Page, test } from "@playwright/test";

// A phone gets the compact table. The host plays West from the phone against three host bots, whose model this file mocks.
const PHONES = [
	{ width: 390, height: 844 },
	{ width: 360, height: 800 },
];

const SUIT_BUTTONS = {
	C: "Clubs",
	D: "Diamonds",
	H: "Hearts",
	S: "Spades",
} as const;

/** The first call of a board is 1NT; every later bot call is a pass, and every bot card is its first legal card. */
async function mockBots(page: Page): Promise<void> {
	await page.route("https://openrouter.ai/api/v1/responses", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await route.fulfill({
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-methods": "POST, OPTIONS",
					"access-control-allow-headers": "authorization,content-type",
				},
			});
			return;
		}
		const body = route.request().postDataJSON();
		const kind = body.text.format.name === "bridge_call" ? "call" : "card";
		const values = body.text.format.schema.properties[kind].enum as string[];
		const choice =
			kind === "call" && body.input.includes("No calls yet")
				? (values.find((value) => value === "1NT") ?? values[0])
				: kind === "call"
					? (values.find((value) => value === "P") ?? values[0])
					: values[0];
		await route.fulfill({
			status: 200,
			headers: { "access-control-allow-origin": "*" },
			contentType: "application/json",
			body: JSON.stringify({
				output: [
					{
						type: "message",
						role: "assistant",
						content: [
							{ type: "output_text", text: JSON.stringify({ [kind]: choice }) },
						],
					},
				],
			}),
		});
	});
}

const phase = (page: Page) =>
	page.locator("[data-phase]").first().getAttribute("data-phase");

const phoneTurn = async (page: Page) =>
	(await page.title()).startsWith("TURN - ");

/** The page has no horizontal scroll, and the room is not the scaled Full HD canvas. */
async function expectCompactPage(page: Page): Promise<void> {
	await expect(page.locator("main > .room")).toHaveAttribute(
		"data-form",
		"compact",
	);
	expect(
		await page.evaluate(() => ({
			overflow:
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
			transform: getComputedStyle(document.querySelector("main") as Element)
				.transform,
		})),
	).toEqual({ overflow: 0, transform: "none" });
}

/** The cards of the own hand and of dummy whose button has no width, so a tap cannot reach them. */
const hiddenCards = (page: Page) =>
	page
		.getByTestId("mobile-auction")
		.evaluate((auction) =>
			[
				...auction.querySelectorAll(
					":is(.mobile-auction-hand, .mobile-board-top) button.card",
				),
			]
				.filter((card) => card.getBoundingClientRect().width < 1)
				.map((card) => card.getAttribute("aria-label")),
		);

for (const viewport of PHONES) {
	test(`a ${viewport.width}×${viewport.height} phone declares a board in the compact layout`, async ({
		browser,
		baseURL,
	}) => {
		if (!baseURL) throw new Error("baseURL is not configured");
		const context = await browser.newContext({
			baseURL,
			viewport,
			isMobile: true,
			hasTouch: true,
		});
		try {
			const page = await context.newPage();
			await mockBots(page);
			await page.goto("/");
			for (const seat of ["N", "E", "S"])
				await page.locator(`input[name="bot-${seat}"]`).check();
			await page.locator('input[name="openrouter-key"]').fill("test-key");
			await page.getByTestId("create").tap();
			const auction = page.getByTestId("mobile-auction");
			await expect(auction).toBeVisible();
			await expectCompactPage(page);

			// North opens 1NT and East passes. West overcalls in the longest suit, so its trump suit has at least four cards.
			await expect.poll(() => phoneTurn(page), { timeout: 30_000 }).toBe(true);
			await expect(auction.locator(".bid-box")).toBeInViewport();
			const longest = await auction
				.locator(".mobile-auction-hand button.card")
				.evaluateAll((cards) => {
					const counts = new Map<string, number>();
					for (const card of cards) {
						const suit = card.getAttribute("data-suit") ?? "";
						counts.set(suit, (counts.get(suit) ?? 0) + 1);
					}
					return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
				});
			if (longest === undefined)
				throw new Error("the phone shows no own cards");
			await auction.getByRole("button", { name: "Level 2" }).tap();
			await auction
				.getByRole("button", {
					name: SUIT_BUTTONS[longest as keyof typeof SUIT_BUTTONS],
					exact: true,
				})
				.tap();
			await auction.getByRole("button", { name: "Confirm" }).tap();
			await expect.poll(() => phase(page), { timeout: 30_000 }).toBe("play");

			// West declares, so the phone plays its own cards and dummy's (East, at the top) until the last trick.
			const taps = { dummy: 0, own: 0 };
			while ((await phase(page)) === "play") {
				if (!(await phoneTurn(page))) {
					await page.waitForTimeout(100);
					continue;
				}
				expect(await hiddenCards(page)).toEqual([]);
				await expectCompactPage(page);
				// One script finds the card and its hand. A re-render can detach a button between two steps, and a
				// detached button is in no hand.
				const next = await page.evaluate(() => {
					const button = document.querySelector(
						"[data-testid='mobile-auction'] button.card:not([disabled])",
					);
					return button === null
						? undefined
						: {
								id: button.getAttribute("data-card"),
								dummy: button.closest(".mobile-board-top") !== null,
							};
				});
				if (next === undefined) continue;
				const { id, dummy } = next;
				await auction.locator(`button.card[data-card="${id}"]`).tap();
				taps[dummy ? "dummy" : "own"]++;
				// The played card leaves its hand before the phone acts again.
				await expect(
					auction.locator(
						`:is(.mobile-auction-hand, .mobile-board-top) [data-card="${id}"]`,
					),
				).toHaveCount(0);
			}
			expect(taps).toEqual({ dummy: 13, own: 13 });
			await expect(page.locator("[data-phase]").first()).toHaveAttribute(
				"data-phase",
				"complete",
			);
			await expect(page.locator(".hcp-pill:visible")).toHaveCount(4);
		} finally {
			await context.close();
		}
	});
}
