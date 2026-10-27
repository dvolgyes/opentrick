import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";

import { NetworkSwitch } from "./network";
import { buildRelayUrls, Player } from "./player";
import {
	CONNECT_MS,
	createRoom,
	expectAllConnected,
	hostRows,
	makeCall,
	pick,
} from "./room";

test.describe.configure({ mode: "serial" });

test("a solo host reloads and plays with three local bots while the relays are offline", async ({
	page,
	context,
}) => {
	const network = await NetworkSwitch.install(context, buildRelayUrls());
	await mockBotBidding(page, () => "P");
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	const table = page.getByTestId("table");
	await expect(table).toHaveAttribute("data-at", "3");
	await expect(hostRows(page)).toHaveAttribute("data-seat", "W");
	await network.block();
	await page.reload();
	await expect(hostRows(page)).toHaveAttribute("data-seat", "W", {
		timeout: 5_000,
	});
	await expect(table).toHaveAttribute("data-at", "3");
	await expect(page.getByTestId("waiting")).toBeHidden();
	await expectAllConnected(page, true);
	await makeCall(page, "P");
	await expect(table).toHaveAttribute("data-phase", "complete");
	// The next board also needs all four seats, and the bots must still run without the relays.
	await expect(table).toHaveAttribute("data-board", "2");
	await expect(table).toHaveAttribute("data-at", "2");
	await expect(page.getByTestId("waiting")).toBeHidden();
});

test("host bots play two consecutive boards from auction through the final trick", async ({
	page,
}) => {
	let requests = 0;

	await mockBotBidding(page, (position) => {
		requests++;
		return position.calls.length === 0 ? "1NT" : "P";
	});

	await page.goto("/");
	await page.locator('input[name="me"][value="W"]').check();
	await page.locator('input[name="name-W"]').fill("host west");
	for (const seat of ["N", "E", "S"])
		await page.locator(`input[name="bot-${seat}"]`).check();

	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	// A bot cannot host: the host hands its own seat to the bot after the table exists.
	await page.getByTestId("host-autoplay-toggle").click();
	await expect(page.getByTestId("host-autoplay-toggle")).toHaveText(
		"👱 Disable autoplay",
	);
	const roomUrl = new URL(page.url());
	expect(roomUrl.searchParams.get("b")).toBe("NESW");
	expect(roomUrl.searchParams.has("r")).toBe(false);
	await expect(page.getByTestId("bot-spend")).toHaveCount(0);
	await expect(page.getByTestId("bot-balance")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Pause bots" })).toBeVisible();
	await page.getByRole("button", { name: "Pause bots" }).click();
	await expect(page.getByRole("button", { name: "Resume bots" })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("button", { name: "Resume bots" })).toBeVisible({
		timeout: CONNECT_MS,
	});
	await expect(page.getByRole("button", { name: "Pause bots" })).toBeHidden();
	const pausedRequests = requests;
	await page.waitForTimeout(3_000);
	expect(requests).toBe(pausedRequests);
	await page.getByRole("button", { name: "Resume bots" }).click();
	await expect(page.getByRole("button", { name: "Pause bots" })).toBeVisible();

	await expect
		.poll(
			() =>
				page.locator("[data-phase]").evaluate((element) => ({
					board: element.getAttribute("data-board"),
					phase: element.getAttribute("data-phase"),
				})),
			{ timeout: 110_000 },
		)
		.toEqual({ board: "2", phase: "complete" });
	// Four bids per board; all 104 card decisions run in the host's DDS worker.
	expect(requests).toBeGreaterThanOrEqual(8);
	expect(requests).toBeLessThan(12);
	await expect(page.locator("[data-phase]")).toHaveAttribute("data-at", "56");
});

test("a bot bids and plays when the site is served below a path, as on GitHub Pages", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const origin = new URL(baseURL).origin;
	// GitHub Pages serves the app below /opentrick/, and nothing of it at the root.
	await page.route(`${origin}/**`, async (route) => {
		const url = new URL(route.request().url());
		if (!url.pathname.startsWith("/opentrick/")) {
			await route.fulfill({ status: 404, body: "" });
			return;
		}
		url.pathname = url.pathname.slice("/opentrick".length);
		await route.fulfill({ response: await route.fetch({ url: url.href }) });
	});
	let requests = 0;

	await mockBotBidding(page, (position) => {
		requests++;
		return position.calls.length === 0 ? "1NT" : "P";
	});

	await page.goto("/opentrick/");
	await page.locator('input[name="me"][value="W"]').check();
	await page.locator('input[name="name-W"]').fill("host west");
	for (const seat of ["N", "E", "S"])
		await page.locator(`input[name="bot-${seat}"]`).check();

	await page.getByTestId("create").click();
	await page.getByTestId("host-autoplay-toggle").click();
	// Board 1: North deals, so the North bot bids first.
	await expect(page.getByTestId("bid-history")).toContainText("1NT", {
		timeout: CONNECT_MS,
	});
	expect(requests).toBeGreaterThan(0);
	await expect
		.poll(async () =>
			Number(await page.locator("[data-phase]").getAttribute("data-at")),
		)
		.toBeGreaterThan(4);
	await expect(page.locator("[data-phase]")).toHaveAttribute(
		"data-phase",
		"play",
	);
	expect(requests).toBe(4);
});

test("switching the current bidder to a bot starts it immediately", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host");
	const north = await Player.open(browser, baseURL, "north");
	const east = await Player.open(browser, baseURL, "east");
	const south = await Player.open(browser, baseURL, "south");
	try {
		const hostPage = await host.page("./");

		await mockBotBidding(hostPage, () => "P");

		const link = await createRoom(hostPage);
		const northPage = await north.page(link);
		await pick(northPage, "N");
		const southPage = await south.page(link);
		await pick(southPage, "S");
		const eastPage = await east.page(link);
		await expect(hostPage.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		await expect(eastPage.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		await expect(
			northPage.getByTestId("bid-box").locator("button:enabled").first(),
		).toBeEnabled({ timeout: CONNECT_MS });
		await host.grantPermissions(["microphone"]);
		await north.grantPermissions(["microphone"]);
		await hostPage
			.getByRole("button", { name: "Join call", exact: true })
			.click();
		await northPage
			.getByRole("button", { name: "Join call", exact: true })
			.click();
		await expect(hostPage.getByTestId("call-note")).toContainText(
			"Connected to North.",
		);
		await expect(northPage.getByTestId("call-note")).toContainText(
			"Connected to West.",
		);
		await expect(
			northPage.getByRole("button", { name: "Send mic audio", exact: true }),
		).toHaveAttribute("data-actual", "on");
		await expect(hostPage.getByTestId("call-presence-N")).toBeHidden();
		await expect(eastPage.getByTestId("call-presence-N")).toBeVisible();

		await hostPage
			.getByRole("button", { name: "Settings", exact: true })
			.click();

		await hostPage.getByRole("button", { name: "Save settings" }).click();
		await expect(hostPage.getByTestId("settings-dialog")).toBeHidden();
		await hostPage
			.getByTestId("tile-N")
			.getByRole("button", { name: /Switch to bot$/ })
			.click();
		// A bot that the host chose plays the seat alone: the player's page leaves the call, and nobody expects
		// audio from the seat.
		await expect(
			northPage.getByRole("button", { name: "Leave call", exact: true }),
		).toHaveCount(0);
		await expect(
			northPage.getByRole("button", { name: "Send mic audio", exact: true }),
		).toHaveAttribute("data-actual", "off");
		await expect(hostPage.getByTestId("call-note")).not.toContainText(
			"Connected to North.",
		);
		await expect(eastPage.getByTestId("call-presence-N")).toBeHidden();
		await hostPage
			.getByTestId("tile-N")
			.getByRole("button", { name: /Switch to player$/ })
			.click();
		await expect(
			hostPage.getByTestId("tile-N").locator(".bot-overlay"),
		).toBeHidden();
		// The player is back, and the call stays off until the player joins again: also after a reload.
		await expect(
			northPage.getByRole("button", { name: "Join call", exact: true }),
		).toBeEnabled();
		await northPage.reload();
		await expect(northPage.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		await expect(
			northPage.getByRole("button", { name: "Join call", exact: true }),
		).toBeEnabled();
		await expect(
			northPage.getByRole("button", { name: "Leave call", exact: true }),
		).toHaveCount(0);
		await expect(
			northPage.getByRole("button", { name: "Send mic audio", exact: true }),
		).toHaveAttribute("data-actual", "off");
		await expect(eastPage.getByTestId("call-presence-N")).toBeHidden();
		await hostPage
			.getByTestId("tile-N")
			.getByRole("button", { name: /Switch to bot$/ })
			.click();
		await expect(hostPage.getByTestId("table")).toHaveAttribute(
			"data-at",
			"1",
			{
				timeout: 15_000,
			},
		);
		expect(new URL(hostPage.url()).searchParams.get("b")).toBe("N");
		await hostPage.reload();
		await expect(
			hostPage.getByTestId("tile-N").locator(".bot-overlay"),
		).toBeVisible({
			timeout: CONNECT_MS,
		});
		await expect(
			hostPage.getByRole("button", { name: "Pause bots" }),
		).toBeVisible();
		await hostPage.getByRole("button", { name: "Pause bots" }).click();
		await expect(
			hostPage.getByRole("button", { name: "Resume bots" }),
		).toBeVisible();
		await hostPage
			.getByTestId("tile-E")
			.getByRole("button", { name: /Switch to bot$/ })
			.click();
		await expect(hostPage.getByTestId("table")).toHaveAttribute(
			"data-at",
			"2",
			{
				timeout: 15_000,
			},
		);
		await expect(
			hostPage.getByTestId("tile-E").locator(".bot-overlay"),
		).toBeVisible();
		const autoplay = hostPage.getByTestId("host-autoplay-toggle");
		await expect(autoplay).toHaveText("🤖 Enable autoplay (bot)");
		await autoplay.click();
		await expect(autoplay).toHaveText("👱 Disable autoplay");
		await southPage
			.getByTestId("bid-box")
			.getByRole("button", { name: "Pass" })
			.click();
		await southPage
			.getByTestId("bid-box")
			.getByRole("button", { name: /^Confirm/ })
			.click();
		await expect(hostPage.getByTestId("table")).toHaveAttribute(
			"data-at",
			"4",
			{
				timeout: 15_000,
			},
		);
	} finally {
		await Promise.all(
			[host, north, east, south].map((player) => player.close()),
		);
	}
});

/** West, the host, declares 2NT against three host bots, which call and play their first legal choice. */
async function westDeclaresAgainstBots(page: Page): Promise<Locator> {
	// North opens 1NT and every other bot call is a pass; each bot card is its first legal card.

	await mockBotBidding(page, (position) => {
		return position.calls.length === 0 ? "1NT" : "P";
	});

	await page.goto("/");
	for (const [seat, name] of Object.entries({
		N: "player1",
		E: "player3",
		S: "player2",
		W: "player4",
	}))
		await page.locator(`input[name="name-${seat}"]`).fill(name);
	await page.locator('input[name="me"][value="W"]').check();
	for (const seat of ["N", "E", "S"])
		await page.locator(`input[name="bot-${seat}"]`).check();

	await page.getByTestId("create").click();
	const phase = page.locator("[data-phase]").first();

	// West overcalls 2NT and the bots pass, so West declares.
	const bidBox = page.getByTestId("bid-box");
	await expect(bidBox.getByRole("button", { name: "Level 2" })).toBeEnabled({
		timeout: 30_000,
	});
	await bidBox.getByRole("button", { name: "Level 2" }).click();
	await bidBox.getByRole("button", { name: "No trump" }).click();
	await bidBox.getByRole("button", { name: "Confirm" }).click();
	await expect(phase).toHaveAttribute("data-phase", "play", {
		timeout: 30_000,
	});
	return phase;
}

test("the bots reject the host's claims, so the board is played out", async ({
	page,
}) => {
	test.setTimeout(120_000);
	// Keep the observed completion after the next board replaces the table.
	await page.addInitScript(() => {
		new MutationObserver(() => {
			const completed = document.querySelector('[data-phase="complete"]');
			if (completed?.getAttribute("data-board") === "1") {
				document.documentElement.setAttribute(
					"data-completed-board-1-at",
					completed.getAttribute("data-at") ?? "",
				);
			}
		}).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-phase", "data-board", "data-at"],
		});
	});
	await westDeclaresAgainstBots(page);
	// North dealer: 1NT, pass, pass, West 2NT, and three passes.
	const calls = 7;
	const controls = page.locator(".play-controls");
	const claimAll = controls.getByRole("button", { name: "Claim all" });
	const claim = controls.getByRole("button", { name: "Claim …" });
	const card = page
		.locator('[data-testid="hand-W"], [data-testid="hand-E"]')
		.locator("button.card:enabled")
		.first();
	/** West plays its own and dummy's first legal card until `stop` shows. */
	const playUntil = async (stop: Locator): Promise<void> => {
		for (;;) {
			await expect(card.or(stop).first()).toBeVisible({ timeout: 30_000 });
			if (await stop.isVisible()) return;
			const table = page.locator("[data-phase]");
			const before = await table.getAttribute("data-at");
			// A pending play can remove the button during Playwright's actionability wait.
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
							(await stop.isVisible()) ||
							(await table.getAttribute("data-at")) !== before,
					)
					.toBe(true);
		}
	};

	// North leads, and West claims all tricks at its first turn.
	await expect(claimAll).toBeEnabled({ timeout: 30_000 });
	await claimAll.click();
	await page.getByTestId("claim-confirm").click();

	// The bots reject it, so West plays on until "Claim …" shows with five tricks left, and claims 2 of them.
	await playUntil(claim);
	await expect(claim).toBeEnabled({ timeout: 30_000 });
	await claim.click();
	await expect(page.getByTestId("claim-panel")).toContainText(
		"How many of the remaining 5 tricks will you take?",
	);
	await expect(page.getByTestId("claim-count").getByRole("button")).toHaveText([
		"0",
		"1",
		"2",
		"3",
		"4",
		"5",
	]);
	await page.getByTestId("claim-count-2").click();
	await page.getByTestId("claim-confirm").click();

	// The bots reject this claim too, and board 1 ends after all 52 cards; board 2 is dealt soon after.
	await playUntil(
		page.locator(`html[data-completed-board-1-at="${calls + 52}"]`),
	);
});

/** The bots of `page` answer with the first legal call or card. */
async function firstChoiceBots(page: Page): Promise<void> {
	await mockBotBidding(page, () => "P");
}

test("a player on autoplay stays in the call when the host reloads, and can still stop autoplay", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host");
	const north = await Player.open(browser, baseURL, "north");
	const east = await Player.open(browser, baseURL, "east");
	const south = await Player.open(browser, baseURL, "south");
	try {
		const hostPage = await host.page("./");
		await firstChoiceBots(hostPage);
		const link = await createRoom(hostPage);
		const northPage = await north.page(link);
		await pick(northPage, "N");
		await pick(await south.page(link), "S");
		await east.page(link);
		await expect(hostPage.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		await hostPage
			.getByRole("button", { name: "Settings", exact: true })
			.click();

		await hostPage.getByRole("button", { name: "Save settings" }).click();
		await expect(hostPage.getByTestId("settings-dialog")).toBeHidden();
		await host.grantPermissions(["microphone"]);
		await north.grantPermissions(["microphone"]);
		for (const page of [hostPage, northPage])
			await page
				.getByTestId("call-panel")
				.getByRole("button", { name: "Join call", exact: true })
				.click();
		await expect(hostPage.getByTestId("call-note")).toContainText(
			"Connected to North.",
			{ timeout: CONNECT_MS },
		);

		// North speaks without video, so the voice box covers the bot image; the host's switch shows the bot.
		const botSwitch = hostPage
			.getByTestId("tile-N")
			.getByRole("button", { name: "Switch to player" });
		const autoplay = northPage.getByTestId("player-autoplay-toggle");
		await autoplay.click();
		await expect(autoplay).toHaveText("Stop autoplay", { timeout: CONNECT_MS });
		await expect(botSwitch).toBeVisible();
		await expect(hostPage.getByTestId("voicebox-N")).toBeVisible();
		await expect(
			hostPage.getByTestId("tile-N").locator(".bot-overlay"),
		).toBeHidden();
		await expect(
			northPage.getByRole("button", { name: "Leave call", exact: true }),
		).toBeVisible();

		// The host's reload keeps the seat a bot that its player asked for, so the player stays in the call.
		expect(new URL(hostPage.url()).searchParams.get("autoplay_seats")).toBe(
			"N",
		);
		await hostPage.reload();
		await expect(botSwitch).toBeVisible({ timeout: CONNECT_MS });
		await expect(hostPage.getByTestId("call-note")).toContainText(
			"Connected to North.",
			{ timeout: CONNECT_MS },
		);
		await expect(
			northPage.getByRole("button", { name: "Leave call", exact: true }),
		).toBeVisible();
		await expect(
			northPage.getByRole("button", { name: "Send mic audio", exact: true }),
		).toHaveAttribute("data-actual", "on");

		// The reloaded host still knows that the player asked for the bot, so the player can stop it.
		await autoplay.click();
		await expect(botSwitch).toBeHidden({ timeout: CONNECT_MS });
		await expect(autoplay).toHaveText("Enable autoplay (bot)");
		// The player stopped the bot, so the roster without it does not blame the host.
		await expect(northPage.locator(".player-autoplay-status")).toHaveText(
			"Autoplay stopped.",
		);
		// A later host reload must not bring the bot back.
		await expect
			.poll(() => new URL(hostPage.url()).searchParams.get("b"))
			.toBe("");
		expect(new URL(hostPage.url()).searchParams.has("autoplay_seats")).toBe(
			false,
		);
		await expect(
			northPage.getByRole("button", { name: "Leave call", exact: true }),
		).toBeVisible();

		// When the host stops the bot instead, the player's page says so.
		await autoplay.click();
		await expect(autoplay).toHaveText("Stop autoplay", { timeout: CONNECT_MS });
		await expect(botSwitch).toBeVisible();
		// The host stops the bot at once, often before North's page gets a roster that shows it.
		await botSwitch.click();
		await expect(autoplay).toHaveText("Enable autoplay (bot)", {
			timeout: CONNECT_MS,
		});
		await expect(northPage.locator(".player-autoplay-status")).toHaveText(
			"Autoplay stopped by the host.",
		);
	} finally {
		await Promise.all(
			[host, north, east, south].map((player) => player.close()),
		);
	}
});
