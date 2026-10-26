import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { Player } from "./player";

async function editNames(page: Page) {
	await page.getByTestId("host-controls").click();
	await page.getByTestId("edit-player-names").click();
	return page.getByTestId("player-editor");
}

test("an unnamed creator from a reusable setup link names themselves before seeding the room", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL missing");
	const url = new URL(baseURL);
	url.search = new URLSearchParams({
		north: "player",
		east: "player",
		south: "player",
		west: "player",
		host: "south",
		selected_player: "S",
	}).toString();
	url.hash = `v=p2p-v1&k=${randomBytes(32).toString("base64url")}`;
	await page.goto(url.toString());
	await expect(page.getByTestId("name-entry")).toBeVisible({ timeout: 30_000 });
	await page.getByTestId("personal-name").fill("Seeder");
	await page.getByRole("button", { name: "Join game", exact: true }).click();
	await expect(page).toHaveTitle(/Seeder \(S\)$/, { timeout: 30_000 });
	await expect(page.getByTestId("host-controls")).toBeVisible();
});

test("the creation and seating crosses fit a phone without changing compass directions", async ({
	page,
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL missing");
	await page.setViewportSize({ width: 360, height: 780 });
	const checkCross = async (current: Page) => {
		const boxes = await current
			.getByTestId("seat-grid")
			.locator("[data-seat]")
			.evaluateAll((cards) =>
				Object.fromEntries(
					cards.map((card) => {
						const r = card.getBoundingClientRect();
						return [card.getAttribute("data-seat"), { x: r.x, y: r.y }];
					}),
				),
			);
		expect(boxes.N?.y).toBeLessThan(boxes.E?.y ?? 0);
		expect(boxes.S?.y).toBeGreaterThan(boxes.W?.y ?? 0);
		expect(boxes.W?.x).toBeLessThan(boxes.E?.x ?? 0);
		expect(
			await current.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
	};
	await page.goto("/");
	await checkCross(page);
	await page.locator('input[name="name-S"]').fill("Host");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	const url = new URL(page.url());
	url.searchParams.set("selected_player", "none");
	const guest = await Player.open(browser, baseURL, "phone-guest");
	try {
		const other = await guest.page(url.toString());
		await other.setViewportSize({ width: 360, height: 780 });
		await expect(other.getByTestId("pick-N")).toBeEnabled();
		await checkCross(other);
	} finally {
		await guest.close();
	}
});

test("South hosts a compass layout and an unnamed entrant edits a persistent name suggestion", async ({
	page,
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL missing");
	await page.goto("/");
	await expect(page.locator('input[name="me"][value="S"]')).toBeChecked();
	const card = (seat: string) =>
		page.getByTestId("seat-grid").locator(`[data-seat="${seat}"]`);
	const north = await card("N").boundingBox();
	const south = await card("S").boundingBox();
	const west = await card("W").boundingBox();
	const east = await card("E").boundingBox();
	expect(north && south && west && east).toBeTruthy();
	expect(north?.y).toBeLessThan(west?.y ?? 0);
	expect(south?.y).toBeGreaterThan(east?.y ?? 0);
	expect(west?.x).toBeLessThan(east?.x ?? 0);
	await page.locator('input[name="name-S"]').fill("Alice");
	await page.getByTestId("create").click();
	await expect(page).toHaveTitle(/Alice \(S\)$/);
	expect(
		await page.evaluate(() => localStorage.getItem("opentrick.player-name")),
	).toBe("Alice");
	const url = new URL(page.url());
	url.searchParams.set("selected_player", "none");
	const guest = await Player.open(browser, baseURL, "name-guest");
	const guestPage = await guest.page(baseURL);
	try {
		await guestPage.goto("/");
		await guestPage.evaluate(() =>
			localStorage.setItem("opentrick.player-name", "Bob"),
		);
		await guestPage.goto(url.toString());
		await guestPage.getByTestId("pick-E").click();
		const entry = guestPage.getByTestId("name-entry");
		await expect(entry).toBeVisible();
		await expect(entry.getByTestId("personal-name")).toHaveValue("Bob");
		await entry.getByTestId("personal-name").fill("Céline");
		await entry.getByRole("button", { name: "Join game", exact: true }).click();
		await expect(guestPage).toHaveTitle(/Céline \(E\)$/);
		await expect(page.getByTestId("roster")).toContainText("Céline");
		await guestPage.reload();
		await expect(guestPage).toHaveTitle(/Céline \(E\)$/);
		await expect(guestPage.getByTestId("name-entry")).toHaveCount(0);
		const editor = await editNames(page);
		await editor.getByTestId("rename-E").fill("Dana");
		await editor
			.locator('[data-seat="E"]')
			.getByRole("button", { name: "Save name" })
			.click();
		await expect(guestPage).toHaveTitle(/Dana \(E\)$/);
		expect(
			await guestPage.evaluate(() =>
				localStorage.getItem("opentrick.player-name"),
			),
		).toBe("Céline");
		await editor.getByRole("button", { name: "Close", exact: true }).click();
		await page.reload();
		await expect(page.getByTestId("roster")).toContainText("Dana");
		await guestPage.goto("/");
		await expect(guestPage.locator('input[name="name-S"]')).toHaveValue(
			"Céline",
		);
	} finally {
		await guest.close();
	}
});

test("preassigned names join directly and a host can open a bot seat for a named human", async ({
	page,
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL missing");
	await page.goto("/");
	await page.locator('input[name="name-S"]').fill("Host");
	await page.locator('input[name="name-N"]').fill("North friend");
	await page.locator('input[name="name-E"]').fill("Bridge bot");
	await page.locator('input[name="bot-E"]').check();
	await page.locator('input[name="bot-W"]').check();
	await page.getByTestId("create").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	const url = new URL(page.url());
	url.searchParams.set("selected_player", "none");
	const guest = await Player.open(browser, baseURL, "preassigned-guest");
	const guestPage = await guest.page(baseURL);
	try {
		await guestPage.goto(url.toString());
		await expect(guestPage).toHaveTitle(/North friend \(N\)$/);
		await expect(guestPage.getByTestId("name-entry")).toHaveCount(0);
		await expect(page.locator("[data-phase]")).toHaveAttribute(
			"data-phase",
			"auction",
		);
		const actionCount = await page
			.locator("[data-phase]")
			.getAttribute("data-at");
		const editor = await editNames(page);
		await editor
			.locator('[data-seat="E"]')
			.getByRole("button", { name: "Open seat for a new player" })
			.click();
		await editor.getByRole("button", { name: "Close", exact: true }).click();
		const second = await Player.open(browser, baseURL, "replacement-guest");
		const secondPage = await second.page(baseURL);
		try {
			await secondPage.goto(url.toString());
			await expect(secondPage.getByTestId("name-entry")).toBeVisible();
			await secondPage.getByTestId("personal-name").fill("Erin");
			await secondPage
				.getByRole("button", { name: "Join game", exact: true })
				.click();
			await expect(secondPage).toHaveTitle(/Erin \(E\)$/);
			await expect(guestPage.getByTestId("roster")).toContainText("Erin");
			await expect(page.locator("[data-phase]")).toHaveAttribute(
				"data-at",
				actionCount ?? "",
			);
		} finally {
			await second.close();
		}
	} finally {
		await guest.close();
	}
});
