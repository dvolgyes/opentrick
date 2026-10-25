import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockOpenRouterKey } from "./openrouter-mock";
import { Player } from "./player";
import { CONNECT_MS, createRoom, makeCall } from "./room";

/** The bots pass every call and play a random legal card. */
async function mockBots(page: Page): Promise<void> {
	await mockOpenRouterKey(page);
	await page.route("https://openrouter.ai/api/v1/responses", async (route) => {
		const headers = {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "POST, OPTIONS",
			"access-control-allow-headers": "authorization,content-type",
		};
		if (route.request().method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers });
			return;
		}
		const body = route.request().postDataJSON();
		const kind = body.text.format.name === "bridge_call" ? "call" : "card";
		const values = body.text.format.schema.properties[kind].enum as string[];
		const choice =
			kind === "call"
				? (values.find((value) => value === "P") ?? values[0])
				: values[Math.floor(Math.random() * values.length)];
		await route.fulfill({
			status: 200,
			headers,
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

/** The control is drawn inside the window and is the element under its centre, so a click reaches it. */
async function expectReachable(page: Page, control: Locator): Promise<void> {
	await expect(control).toBeVisible();
	const hit = await control.evaluate((node) => {
		const box = node.getBoundingClientRect();
		const inside =
			box.top >= 0 &&
			box.left >= 0 &&
			box.bottom <= window.innerHeight &&
			box.right <= window.innerWidth;
		const target = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		return { inside, self: target === node || node.contains(target) };
	});
	expect(hit, (await control.textContent()) ?? "").toEqual({
		inside: true,
		self: true,
	});
	expect(page.viewportSize()).toEqual({ width: 1920, height: 1080 });
}

test("a hosting declarer with three bots sees the turn pill and can reach the claim buttons", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host", {
		viewport: { width: 1920, height: 1080 },
	});
	try {
		const page = await host.page("./");
		await mockBots(page);
		for (const seat of ["N", "E", "S"])
			await page.locator(`input[name="bot-${seat}"]`).check();
		await page.locator('input[name="openrouter-key"]').fill("test-key");
		await createRoom(page);
		const table = page.getByTestId("table");
		await expect(table).toHaveAttribute("data-phase", "auction", {
			timeout: CONNECT_MS,
		});

		// North deals; the bots pass, West opens 1♣, and the bots pass it out, so West declares and East is dummy.
		await expect(page.getByTestId("turn-pill")).toHaveText("YOUR TURN TO BID", {
			timeout: CONNECT_MS,
		});
		await makeCall(page, "1C");
		await expect(table).toHaveAttribute("data-phase", "play", {
			timeout: CONNECT_MS,
		});

		// North leads; West plays dummy's card, South follows, and West's own card is next.
		const dummy = page.getByTestId("hand-E");
		await expect(dummy.getByTestId("turn-pill")).toHaveText(
			"YOUR TURN TO PLAY",
			{ timeout: CONNECT_MS },
		);
		await dummy.locator("button.card:enabled").first().click();
		const own = page.getByTestId("hand-W");
		await expect(own).toHaveAttribute("data-turn", "true", {
			timeout: CONNECT_MS,
		});
		await expect(own.getByTestId("turn-pill")).toHaveText("YOUR TURN TO PLAY");
		await expect(page.getByTestId("turn-pill")).toHaveCount(1);

		for (const name of ["Claim …", "Claim all"])
			await expectReachable(
				page,
				page.getByRole("button", { name, exact: true }),
			);

		// The sidebar reads top to bottom: the host's debug buttons in the top row, bidding, tricks, the controls,
		// statistics, and the bot status last.
		const parts = {
			debug: page.getByTestId("debug-export"),
			bidding: page.getByTestId("bid-history"),
			tricks: page.getByTestId("tricks-panel"),
			claim: page.getByRole("button", { name: "Claim all", exact: true }),
			statistics: page.getByTestId("scores"),
			botStatus: page.getByTestId("bot-status"),
		};
		const tops: Record<string, number> = {};
		for (const [part, locator] of Object.entries(parts)) {
			await expect(locator, part).toBeVisible();
			tops[part] = (await locator.boundingBox())?.y ?? Number.NaN;
		}
		const order = Object.keys(tops).sort(
			(a, b) => (tops[a] ?? 0) - (tops[b] ?? 0),
		);
		expect(order, JSON.stringify(tops)).toEqual(Object.keys(parts));
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});

test("the stored settings turn off the bid turn text and frame, and keep the play turn text", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "host", {
		viewport: { width: 1920, height: 1080 },
	});
	try {
		const page = await host.page("./");
		await mockBots(page);
		await page.evaluate(() => {
			localStorage.setItem("opentrick.settings.bid-turn-text", "0");
			localStorage.setItem("opentrick.settings.bid-turn-frame", "0");
		});
		for (const seat of ["N", "E", "S"])
			await page.locator(`input[name="bot-${seat}"]`).check();
		await page.locator('input[name="openrouter-key"]').fill("test-key");
		await createRoom(page);
		const table = page.getByTestId("table");
		const own = page.getByTestId("hand-W");
		await expect(own).toHaveAttribute("data-turn", "true", {
			timeout: CONNECT_MS,
		});
		await expect(table).toHaveAttribute("data-phase", "auction");
		await expect(page.getByTestId("turn-pill")).toHaveCount(0);
		await expect(own).toHaveAttribute("data-turn-frame", "false");
		expect(
			await own.evaluate((node) => getComputedStyle(node).outlineStyle),
		).toBe("none");

		await makeCall(page, "1C");
		await expect(
			page.getByTestId("hand-E").getByTestId("turn-pill"),
		).toHaveText("YOUR TURN TO PLAY", { timeout: CONNECT_MS });
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});
