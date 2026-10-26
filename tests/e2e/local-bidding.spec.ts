import { expect, test } from "@playwright/test";

test("new tables default to local SL with no remote model controls", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.locator('select[name="bot-bidder"]')).toHaveValue("sl");
	await expect(page.locator('input[name="openrouter-key"]')).toHaveCount(0);
	await expect(page.locator(".model-priority-list")).toHaveCount(0);
	await expect(page.locator('input[name="bot-retries"]')).toHaveCount(0);
});

for (const policy of ["sl", "rl-fsp"] as const)
	test(`local ${policy} bidding and card play finish a board without an API key`, async ({
		page,
	}) => {
		test.setTimeout(150_000);
		let apiRequests = 0;
		await page.route("https://openrouter.ai/**", async (route) => {
			apiRequests++;
			await route.abort();
		});
		await page.goto("/");
		await page.locator('select[name="bot-bidder"]').selectOption(policy);
		for (const seat of ["N", "E", "S"] as const) {
			await page.locator(`input[name="name-${seat}"]`).fill(`Local ${seat}`);
			await page.locator(`input[name="bot-${seat}"]`).check();
		}
		await page.locator('input[name="name-W"]').fill("You");
		await page.getByTestId("create").click();
		await expect(page.getByTestId("room-controls")).toBeVisible();
		expect(new URL(page.url()).searchParams.get("bot_bidder")).toBe(policy);
		const autoplay = page.getByTestId("host-autoplay-toggle");
		await autoplay.click();
		await expect(autoplay).toHaveText("👱 Disable autoplay");
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByTestId("settings-dialog");
		await settings.getByLabel("Solarized", { exact: true }).check();
		await settings.getByLabel("Dark", { exact: true }).check();
		await settings.getByRole("button", { name: "Save settings" }).click();
		await expect(page.locator("html")).toHaveAttribute(
			"data-theme",
			"solarized",
		);
		await expect(page.locator("html")).toHaveAttribute("data-scheme", "dark");
		await expect(page.getByTestId("settings-dialog")).toBeHidden();
		await expect
			.poll(
				() =>
					page
						.locator("[data-phase]")
						.evaluate(
							(element) =>
								element.getAttribute("data-phase") === "complete" &&
								Number(element.getAttribute("data-at")) >= 56,
						),
				{ timeout: 120_000 },
			)
			.toBe(true);
		expect(apiRequests).toBe(0);
		await expect(page.getByTestId("bot-status")).toContainText("Local BRL");
	});

test("a local bidder works below a URL path and ignores a saved OpenRouter key", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const origin = new URL(baseURL).origin;
	await page.route(`${origin}/**`, async (route) => {
		const url = new URL(route.request().url());
		if (!url.pathname.startsWith("/opentrick/")) {
			await route.fulfill({ status: 404, body: "" });
			return;
		}
		url.pathname = url.pathname.slice("/opentrick".length);
		await route.fulfill({ response: await route.fetch({ url: url.href }) });
	});
	await page.addInitScript(() =>
		localStorage.setItem("opentrick.openrouter-api-key", "unused-test-key"),
	);
	let apiRequests = 0;
	await page.route("https://openrouter.ai/**", async (route) => {
		apiRequests++;
		await route.abort();
	});
	await page.goto("/opentrick/?bot_bidder=sl");
	for (const seat of ["N", "E", "S", "W"])
		await page.locator(`input[name="bot-${seat}"]`).check();
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	await expect
		.poll(() =>
			page.locator("[data-phase]").getAttribute("data-at").then(Number),
		)
		.toBeGreaterThan(0);
	expect(apiRequests).toBe(0);
});
