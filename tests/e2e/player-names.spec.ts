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

test("the create screen keeps bots out of the host seat, names each bot bot, and refuses contradictions", async ({
	page,
}) => {
	await page.goto("/");
	// The build date and the language share the title row; the bidding bot and the scoring share the next row.
	const header = page.locator(".create-header");
	await expect(header.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(header.getByTestId("build-version")).toBeVisible();
	await expect(header.getByLabel("Language")).toBeVisible();
	await expect(page.locator("body > .language-control")).toHaveCount(0);
	const options = page.locator(".create-options");
	const bidder = options.getByLabel("Bidding bot");
	await expect(bidder.locator("option")).toHaveText(["BRL", "WBridge5"]);
	await expect(options.locator('select[name="scoring"]')).toBeVisible();
	// The solo label, its field and its button share one row, also on a narrow phone; the field is at most 20
	// characters wide.
	const soloRow = page.locator(".create-solo-row");
	const soloName = soloRow.locator('input[name="solo-name"]');
	await expect(soloName).toHaveValue("Human");
	await expect(soloRow.getByTestId("create-solo")).toBeVisible();
	const fieldWidth = await soloName.evaluate((field) => {
		const probe = document.createElement("span");
		probe.textContent = "0".repeat(20);
		probe.style.font = getComputedStyle(field).font;
		document.body.append(probe);
		const limit = probe.getBoundingClientRect().width;
		probe.remove();
		return { width: field.getBoundingClientRect().width, limit };
	});
	expect(fieldWidth.width).toBeLessThanOrEqual(fieldWidth.limit + 1);
	for (const width of [1280, 320]) {
		await page.setViewportSize({ width, height: 800 });
		const centres = await Promise.all(
			["label", "input", "button"].map(async (selector) => {
				const box = await soloRow.locator(selector).first().boundingBox();
				return (box?.y ?? 0) + (box?.height ?? 0) / 2;
			}),
		);
		expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(2);
	}
	// A seat card shows its name field without a "Name" label, and its host and bot choices in one row, also on a
	// phone.
	await page.setViewportSize({ width: 360, height: 800 });
	for (const seat of ["N", "E", "S", "W"]) {
		const card = page.getByTestId("seat-grid").locator(`[data-seat="${seat}"]`);
		await expect(card.getByText("Name", { exact: true })).toHaveCount(0);
		const [hostChoice, botChoice] = await Promise.all([
			card.locator('input[name="me"]').boundingBox(),
			card.locator(`input[name="bot-${seat}"]`).boundingBox(),
		]);
		expect(Math.abs((hostChoice?.y ?? 0) - (botChoice?.y ?? 100))).toBeLessThan(
			2,
		);
	}

	const name = (seat: string) => page.locator(`input[name="name-${seat}"]`);
	const bot = (seat: string) => page.locator(`input[name="bot-${seat}"]`);
	const host = (seat: string) =>
		page.locator(`input[name="me"][value="${seat}"]`);
	for (const seat of ["N", "E", "S", "W"]) {
		await expect(name(seat)).toHaveValue("");
		await expect(bot(seat)).not.toBeChecked();
	}
	await expect(host("S")).toBeChecked();
	await expect(bot("S")).toBeDisabled();

	await bot("N").check();
	await expect(name("N")).toHaveValue("bot");
	await expect(host("N")).toBeDisabled();
	await name("N").fill("Nora");
	await expect(bot("N")).not.toBeChecked();
	await expect(host("N")).toBeEnabled();
	await bot("E").check();
	await bot("E").uncheck();
	await expect(name("E")).toHaveValue("");

	await name("W").fill("bot");
	await page.getByTestId("create").click();
	await expect(page.getByTestId("errors")).toHaveText(
		"South: enter a name.West: only a bot can have the name “bot”.",
	);
	await expect(page.getByTestId("room-controls")).toHaveCount(0);
});

test("a solo game seats the saved name at South as host against three bots", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("opentrick.player-name", "Céline"),
	);
	await page.goto("/");
	await expect(page.locator('input[name="solo-name"]')).toHaveValue("Céline");
	await expect(page.locator('input[name="name-S"]')).toHaveValue("Céline");
	await page.getByTestId("create-solo").click();
	await expect(page.getByTestId("room-controls")).toBeVisible();
	await expect(page).toHaveTitle(/Céline \(S\)$/);
	const params = new URL(page.url()).searchParams;
	expect(
		["north", "east", "south", "west", "host", "bot_seats"].map((key) =>
			params.get(key),
		),
	).toEqual(["bot", "bot", "Céline", "bot", "south", "N,E,W"]);
});
