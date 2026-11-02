import { expect, test } from "@playwright/test";

test("the opening header fits on one mobile row without the build date", async ({
	page,
}) => {
	await page.goto("/");
	await page.evaluate(() => document.fonts.ready);
	const header = page.locator(".create-header");
	await expect(header.getByTestId("build-version")).toBeHidden({
		timeout: 1000,
	});
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 800 });
		const boxes = await header
			.locator(".opening-brand, select, summary")
			.evaluateAll((items) =>
				items.map((item) => {
					const box = item.getBoundingClientRect();
					return {
						left: box.left,
						right: box.right,
						middle: box.top + box.height / 2,
					};
				}),
			);
		expect(boxes).toHaveLength(3);
		expect(
			Math.max(...boxes.map((box) => box.middle)) -
				Math.min(...boxes.map((box) => box.middle)),
		).toBeLessThan(2);
		expect(boxes[0]?.right).toBeLessThanOrEqual(boxes[1]?.left ?? 0);
		expect(boxes[1]?.right).toBeLessThanOrEqual(boxes[2]?.left ?? 0);
		expect(boxes[2]?.right ?? Infinity).toBeLessThanOrEqual(width);
		await header.locator("summary").click();
		const help = header.locator(".opening-help p");
		await expect(help).toBeVisible();
		const helpBox = await help.boundingBox();
		expect(helpBox?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect((helpBox?.x ?? 0) + (helpBox?.width ?? 0)).toBeLessThanOrEqual(
			width,
		);
		await header.locator("summary").click();
	}
});

test("the welcome area and the space below it are compact", async ({
	page,
}) => {
	await page.goto("/");
	await page.evaluate(() => document.fonts.ready);
	for (const [width, expectedPadding] of [
		[390, 24],
		[1280, 64],
	] as const) {
		await page.setViewportSize({ width, height: 800 });
		const hero = page.locator(".opening-hero");
		const padding = await hero.evaluate((element) =>
			Number.parseFloat(getComputedStyle(element).paddingTop),
		);
		const heroBox = await hero.boundingBox();
		const modesBox = await page
			.locator(".opening-hero + .create-mode")
			.boundingBox();
		expect(padding).toBeCloseTo(expectedPadding, 1);
		expect(
			(modesBox?.y ?? 0) - ((heroBox?.y ?? 0) + (heroBox?.height ?? 0)),
		).toBeLessThanOrEqual(24);
	}
});

test("the opening page offers three paths and preserves named seats in presets", async ({
	page,
}) => {
	await page.goto("/");
	for (const font of ["DM Sans", "Libre Caslon Display"]) {
		expect(
			await page.evaluate(
				async (family) =>
					(await document.fonts.load(`16px "${family}"`)).length,
				font,
			),
		).toBeGreaterThan(0);
	}
	await expect(
		page.getByRole("heading", { name: "Welcome to the table" }),
	).toBeVisible();
	await expect(page.getByTestId("create-solo")).toHaveAttribute(
		"href",
		"/solo",
	);
	await expect(page.getByTestId("join-online")).toHaveAttribute(
		"href",
		"/join",
	);
	await page.getByLabel("Your display name (optional)").fill("Alice");
	await expect(page.locator('input[name="name-S"]')).toHaveValue("Alice");
	await page.getByRole("button", { name: "Invite friends" }).click();
	await expect(
		page.getByRole("heading", { name: "Invite friends", level: 2 }),
	).toBeFocused();
	await page.locator('input[name="name-N"]').fill("Partner");
	await page.getByTestId("preset-both").click();
	await expect(page.locator('input[name="name-N"]')).toHaveValue("Partner");
	await expect(page.locator('select[name="type-N"]')).toHaveValue("friend");
	await expect(page.locator('select[name="type-E"]')).toHaveValue("both");
	await expect(page.locator('select[name="type-S"]')).toBeDisabled();
	await page.setViewportSize({ width: 320, height: 800 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
});

test("help explains how to return to a table", async ({ page }) => {
	await page.goto("/");
	await page.getByText("Help", { exact: true }).click();
	await expect(
		page.getByText("Use the same browser and the full table link to return."),
	).toBeVisible();
});

test("invitation guidance tells players to open their link", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByText("Have an invitation? Open the link you received."),
	).toBeVisible({ timeout: 1000 });
	await expect(page.locator("#invitation-link")).toHaveCount(0);
});

test("mode cards keep the requested order and compact mobile layout", async ({
	page,
}) => {
	await page.goto("/");
	const cards = page.locator(".opening-card");
	await page.setViewportSize({ width: 1280, height: 844 });
	await expect(cards.locator("h3")).toHaveText(
		["Play with bots", "Invite friends", "Find online players"],
		{ timeout: 1000 },
	);
	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 844 });
		expect(
			await cards
				.locator("[data-testid]")
				.evaluateAll((items) =>
					items.map((item) => item.getAttribute("data-testid")),
				),
		).toEqual(["create-solo", "invite-friends", "join-online"]);
		const positions = await cards.evaluateAll((items) =>
			items.map((item) => {
				const box = item.getBoundingClientRect();
				return { x: box.x, y: box.y };
			}),
		);
		const axis = width === 390 ? "y" : "x";
		expect(positions[0]?.[axis]).toBeLessThan(positions[1]?.[axis] ?? 0);
		expect(positions[1]?.[axis]).toBeLessThan(positions[2]?.[axis] ?? 0);
		if (width === 390) {
			for (const card of await cards.all()) {
				await expect(card.locator("h3")).toBeHidden();
				const icon = await card.locator(".mode-symbol").boundingBox();
				const description = await card.locator("p").boundingBox();
				const action = await card.locator("[data-testid]").boundingBox();
				expect(icon?.x ?? 0).toBeLessThan(description?.x ?? 0);
				expect(Math.abs((icon?.y ?? 0) - (description?.y ?? 0))).toBeLessThan(
					10,
				);
				expect(action?.y ?? 0).toBeGreaterThan(
					(description?.y ?? 0) + (description?.height ?? 0) - 1,
				);
			}
		}
	}
});
