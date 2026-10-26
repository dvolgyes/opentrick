import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockOpenRouterKey } from "./openrouter-mock";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

test.describe.configure({ mode: "serial" });

test("host bots play two consecutive boards from auction through the final trick", async ({
	page,
}) => {
	let requests = 0;
	await mockOpenRouterKey(page);
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
		requests++;
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

	await page.goto("/");
	for (const [seat, name] of [
		["N", "robot north"],
		["E", "bot east"],
		["S", "robot south"],
		["W", "robot west"],
	] as const) {
		await page.locator(`input[name="name-${seat}"]`).fill(name);
	}
	for (const seat of ["N", "E", "S", "W"])
		await page.locator(`input[name="bot-${seat}"]`).check();
	await page.locator('input[name="openrouter-key"]').fill("test-key");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	const roomUrl = new URL(page.url());
	expect(roomUrl.searchParams.get("bot_seats")).toBe("N,E,S,W");
	expect(roomUrl.searchParams.get("bot_model")).toBe("openai/gpt-6-luna");
	expect(roomUrl.searchParams.get("bot_fallback")).toBe("inception/mercury-3");
	expect(roomUrl.searchParams.get("bot_retries")).toBe("5");
	expect(roomUrl.searchParams.get("bot_delay_ms")).toBe("3000");
	expect(roomUrl.search).not.toMatch(/api.?key|test-key/i);
	expect(
		await page.evaluate(() =>
			localStorage.getItem("opentrick.openrouter-api-key"),
		),
	).toBe("test-key");
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
	expect(requests).toBeGreaterThan(100);
});

test("the create page stores the OpenRouter key also when no seat is a bot", async ({
	page,
}) => {
	// Create checks the key and its balance (openrouter-key.spec.ts); this mock passes the check.
	await mockOpenRouterKey(page);
	await page.route("https://openrouter.ai/api/v1/responses", (route) =>
		route.fulfill({
			status: 200,
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "authorization,content-type",
			},
			contentType: "application/json",
			body: JSON.stringify({
				output: [
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: '{"call":"P"}' }],
					},
				],
			}),
		}),
	);
	await page.goto("/");
	await page.locator('input[name="name-W"]').fill("host west");
	await page.locator('input[name="openrouter-key"]').fill(" later-key ");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	expect(page.url()).not.toContain("later-key");
	expect(
		await page.evaluate(() =>
			localStorage.getItem("opentrick.openrouter-api-key"),
		),
	).toBe("later-key");
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(
		page
			.getByTestId("settings-dialog")
			.getByRole("textbox", { name: "OpenRouter API key" }),
	).toHaveValue("later-key");
});

test("a bot bids when the site is served below a path, as on GitHub Pages", async ({
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
	await mockOpenRouterKey(page);
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
		requests++;
		await route.fulfill({
			status: 200,
			headers: { "access-control-allow-origin": "*" },
			contentType: "application/json",
			body: JSON.stringify({
				output: [
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: '{"call":"P"}' }],
					},
				],
			}),
		});
	});

	await page.goto("/opentrick/");
	await page.locator('input[name="name-W"]').fill("host west");
	for (const seat of ["N", "E", "S"]) {
		await page.locator(`input[name="name-${seat}"]`).fill(`bot ${seat}`);
		await page.locator(`input[name="bot-${seat}"]`).check();
	}
	await page.locator('input[name="openrouter-key"]').fill("test-key");
	await page.getByTestId("create").click();
	// Board 1: North deals, so the North bot bids first.
	await expect(page.getByTestId("bid-history")).toContainText("Pass", {
		timeout: CONNECT_MS,
	});
	expect(requests).toBeGreaterThan(0);
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
		await mockOpenRouterKey(hostPage);
		await hostPage.route(
			"https://openrouter.ai/api/v1/responses",
			async (route) => {
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
				const values = body.text.format.schema.properties[kind]
					.enum as string[];
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
									{
										type: "output_text",
										text: JSON.stringify({ [kind]: values[0] }),
									},
								],
							},
						],
					}),
				});
			},
		);

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
		await hostPage
			.getByTestId("settings-dialog")
			.getByRole("textbox", { name: "OpenRouter API key" })
			.fill("test-key");
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
		expect(new URL(hostPage.url()).searchParams.get("bot_seats")).toBe("N");
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
	await mockOpenRouterKey(page);
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

	await page.goto("/");
	for (const seat of ["N", "E", "S"])
		await page.locator(`input[name="bot-${seat}"]`).check();
	await page.locator('input[name="openrouter-key"]').fill("test-key");
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

test("the bots approve the host's claim", async ({ page }) => {
	const phase = await westDeclaresAgainstBots(page);
	// North leads, and West claims all tricks at its first turn.
	const claimAll = page
		.locator(".play-controls")
		.getByRole("button", { name: "Claim all" });
	await expect(claimAll).toBeEnabled({ timeout: 30_000 });
	await claimAll.click();
	await page.getByTestId("claim-confirm").click();
	await expect(phase).toHaveAttribute("data-phase", "complete", {
		timeout: 30_000,
	});
});

test("the bots approve the host's claim of some of the last five tricks", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const phase = await westDeclaresAgainstBots(page);
	// West plays its own and dummy's first legal card until "Claim …" shows with five tricks left.
	const claim = page
		.locator(".play-controls")
		.getByRole("button", { name: "Claim …" });
	const card = page
		.locator('[data-testid="hand-W"], [data-testid="hand-E"]')
		.locator("button.card:enabled")
		.first();
	while (!(await claim.isVisible())) {
		await expect(card.or(claim).first()).toBeVisible({ timeout: 30_000 });
		if (await claim.isVisible()) break;
		await card.click();
	}
	await expect(claim).toBeEnabled({ timeout: 30_000 });
	await claim.click();
	const claims = page.getByTestId("claim-panel");
	await expect(claims).toContainText(
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
	await expect(phase).toHaveAttribute("data-phase", "complete", {
		timeout: 30_000,
	});
});

/** The bots of `page` answer with the first legal call or card. */
async function firstChoiceBots(page: Page): Promise<void> {
	await mockOpenRouterKey(page);
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
							{
								type: "output_text",
								text: JSON.stringify({ [kind]: values[0] }),
							},
						],
					},
				],
			}),
		});
	});
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
		await hostPage
			.getByTestId("settings-dialog")
			.getByRole("textbox", { name: "OpenRouter API key" })
			.fill("test-key");
		await hostPage.getByRole("button", { name: "Save settings" }).click();
		await expect(hostPage.getByTestId("settings-dialog")).toBeHidden();
		await host.grantPermissions(["microphone"]);
		await north.grantPermissions(["microphone"]);
		for (const page of [hostPage, northPage])
			await page
				.getByRole("button", { name: "Join call", exact: true })
				.click();
		await expect(hostPage.getByTestId("call-note")).toContainText(
			"Connected to North.",
			{ timeout: CONNECT_MS },
		);

		const overlay = hostPage.getByTestId("tile-N").locator(".bot-overlay");
		const autoplay = northPage.getByTestId("player-autoplay-toggle");
		await autoplay.click();
		await expect(autoplay).toHaveText("Stop autoplay", { timeout: CONNECT_MS });
		await expect(overlay).toBeVisible();
		await expect(
			northPage.getByRole("button", { name: "Leave call", exact: true }),
		).toBeVisible();

		// The host's reload keeps the seat a bot that its player asked for, so the player stays in the call.
		expect(new URL(hostPage.url()).searchParams.get("autoplay_seats")).toBe(
			"N",
		);
		await hostPage.reload();
		await expect(overlay).toBeVisible({ timeout: CONNECT_MS });
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
		await expect(overlay).toBeHidden({ timeout: CONNECT_MS });
		await expect(autoplay).toHaveText("Enable autoplay (bot)");
		// The player stopped the bot, so the roster without it does not blame the host.
		await expect(northPage.locator(".player-autoplay-status")).toHaveText(
			"Autoplay stopped.",
		);
		// A later host reload must not bring the bot back.
		await expect
			.poll(() => new URL(hostPage.url()).searchParams.get("bot_seats"))
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
		await expect(overlay).toBeVisible();
		// The host stops the bot at once, often before North's page gets a roster that shows it.
		await hostPage
			.getByTestId("tile-N")
			.getByRole("button", { name: "Switch to player" })
			.click();
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
