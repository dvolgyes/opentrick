import { expect, type Page, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { namePlayers } from "./room";

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
	await mockBotBidding(page, (position) => {
		return position.calls.length === 0 ? "1NT" : "P";
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
			await namePlayers(page, "W", ["N", "E", "S"]);

			await page.getByTestId("create").tap();
			const auction = page.getByTestId("mobile-auction");
			await expect(auction).toBeVisible();
			await expectCompactPage(page);
			// Board 1: under the points of each side, neither side is vulnerable.
			const vulnerability = auction.locator(".mobile-round-vulnerability");
			await expect(vulnerability).toHaveText([
				"not vulnerable",
				"not vulnerable",
			]);

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
			await expect(vulnerability.first()).toBeVisible();

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

/**
 * A fake screen lock on `page` that counts the requests, and a visibility the test can change. `wake` reads the
 * requests and the held locks; `hideAndShow` releases the locks as the browser does for a hidden page, then shows the
 * page again.
 */
async function fakeWakeLock(page: Page): Promise<{
	readonly wake: () => Promise<{ requests: number; held: number }>;
	readonly hideAndShow: () => Promise<void>;
}> {
	await page.addInitScript(() => {
		const state = {
			requests: 0,
			locks: [] as { released: boolean }[],
			visibility: "visible",
		};
		Object.assign(window, { wakeTest: state });
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => state.visibility,
		});
		Object.defineProperty(navigator, "wakeLock", {
			configurable: true,
			value: {
				request: async () => {
					state.requests++;
					const lock = {
						released: false,
						release: async () => {
							lock.released = true;
						},
					};
					state.locks.push(lock);
					return lock;
				},
			},
		});
	});
	const wake = () =>
		page.evaluate(() => {
			const state = (
				window as unknown as {
					wakeTest: { requests: number; locks: { released: boolean }[] };
				}
			).wakeTest;
			return {
				requests: state.requests,
				held: state.locks.filter((lock) => !lock.released).length,
			};
		});
	const hideAndShow = async () => {
		await page.evaluate(() => {
			const state = (
				window as unknown as {
					wakeTest: { locks: { released: boolean }[]; visibility: string };
				}
			).wakeTest;
			state.visibility = "hidden";
			for (const lock of state.locks) lock.released = true;
			document.dispatchEvent(new Event("visibilitychange"));
			state.visibility = "visible";
			document.dispatchEvent(new Event("visibilitychange"));
		});
	};
	return { wake, hideAndShow };
}

test("a phone keeps its screen on in the lobby, while the host waits for the other players", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const context = await browser.newContext({
		baseURL,
		viewport: PHONES[0],
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await context.newPage();
		const { wake, hideAndShow } = await fakeWakeLock(page);
		await page.goto("/");
		await namePlayers(page);
		await page.getByTestId("create").tap();

		await expect.poll(() => phase(page), { timeout: 30_000 }).toBe("waiting");
		await expect.poll(wake).toEqual({ requests: 1, held: 1 });
		await hideAndShow();
		await expect.poll(wake).toEqual({ requests: 2, held: 1 });
	} finally {
		await context.close();
	}
});

test("a phone keeps its screen on from the start page through the bidding and the play", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const context = await browser.newContext({
		baseURL,
		viewport: PHONES[0],
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await context.newPage();
		const { wake, hideAndShow } = await fakeWakeLock(page);
		await mockBots(page);
		await page.goto("/");
		await namePlayers(page, "W", ["N", "E", "S"]);

		await expect.poll(wake).toEqual({ requests: 1, held: 1 });
		await page.getByTestId("create").tap();

		await expect.poll(() => phoneTurn(page), { timeout: 30_000 }).toBe(true);
		expect(await phase(page)).toBe("auction");
		expect(await wake()).toEqual({ requests: 1, held: 1 });
		await hideAndShow();
		await expect.poll(wake).toEqual({ requests: 2, held: 1 });

		// West passes 1NT, so the bots declare and the board goes to play with West on lead.
		const auction = page.getByTestId("mobile-auction");
		await auction
			.getByTestId("bid-box")
			.getByRole("button", { name: "Pass" })
			.tap();
		await auction.getByRole("button", { name: "Confirm" }).tap();
		await expect.poll(() => phase(page), { timeout: 30_000 }).toBe("play");
		expect(await wake()).toEqual({ requests: 2, held: 1 });
	} finally {
		await context.close();
	}
});

for (const locale of [
	"en-US",
	"hu-HU",
	"de-DE",
	"fr-FR",
	"es-ES",
	"pt-PT",
	"it-IT",
	"nl-NL",
	"nb-NO",
]) {
	test(`a 360 px phone in ${locale} shows each top bar button whole`, async ({
		browser,
		baseURL,
	}) => {
		if (!baseURL) throw new Error("baseURL is not configured");
		const context = await browser.newContext({
			baseURL,
			viewport: { width: 360, height: 800 },
			isMobile: true,
			hasTouch: true,
			locale,
		});
		try {
			const page = await context.newPage();
			await mockBots(page);
			await page.goto("/");
			await namePlayers(page, "W", ["N", "E", "S"]);

			await page.getByTestId("create").tap();
			const topbar = page.locator(".mobile-auction-topbar");
			await expect(topbar).toBeVisible();
			await expectCompactPage(page);

			// A label wider than its button is cut off, and a bar wider than its box cuts off its last button.
			expect(
				await topbar.evaluate((bar) => ({
					bar: bar.scrollWidth - bar.clientWidth,
					clipped: [...bar.querySelectorAll("button")]
						.filter((button) => button.checkVisibility())
						.filter((button) => button.scrollWidth > button.clientWidth)
						.map(
							(button) =>
								button.getAttribute("aria-label") ?? button.textContent,
						),
				})),
			).toEqual({ bar: 0, clipped: [] });
		} finally {
			await context.close();
		}
	});
}
