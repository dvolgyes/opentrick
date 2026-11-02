import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";

test("the opening banner text remains readable against the felt", async ({
	page,
}) => {
	await page.goto("/");
	const contrast = await page
		.locator(".opening-hero")
		.evaluate(async (banner) => {
			const imageCss = getComputedStyle(banner).backgroundImage;
			const imageUrl = imageCss.match(/^url\("(.*)"\)$/)?.[1];
			const label = banner.querySelector(".opening-eyebrow");
			if (!imageUrl || !label)
				throw new Error("Opening texture or label is missing");
			const channels = getComputedStyle(label)
				.color.match(/\d+/g)
				?.slice(0, 3)
				.map(Number);
			if (channels?.length !== 3)
				throw new Error("Opening label color is invalid");
			const image = new Image();
			image.src = imageUrl;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas is unavailable");
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(
				0,
				0,
				canvas.width,
				canvas.height,
			).data;
			const linear = Array.from({ length: 256 }, (_, value) => {
				const channel = value / 255;
				return channel <= 0.04045
					? channel / 12.92
					: ((channel + 0.055) / 1.055) ** 2.4;
			});
			const luminance = (r: number, g: number, b: number): number =>
				(linear[r] ?? 0) * 0.2126 +
				(linear[g] ?? 0) * 0.7152 +
				(linear[b] ?? 0) * 0.0722;
			const foreground = luminance(
				channels[0] ?? 0,
				channels[1] ?? 0,
				channels[2] ?? 0,
			);
			let minimum = Infinity;
			for (let i = 0; i < pixels.length; i += 4) {
				const background = luminance(
					pixels[i] ?? 0,
					pixels[i + 1] ?? 0,
					pixels[i + 2] ?? 0,
				);
				minimum = Math.min(
					minimum,
					(Math.max(foreground, background) + 0.05) /
						(Math.min(foreground, background) + 0.05),
				);
			}
			return minimum;
		});
	expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("the opening banner uses the default game table texture", async ({
	page,
}) => {
	await page.goto("/");
	const banner = page.locator(".opening-hero");
	const opening = await banner.evaluate((element) => {
		const style = getComputedStyle(element);
		return { image: style.backgroundImage, size: style.backgroundSize };
	});
	expect(opening.image).not.toBe("none");
	await mockBotBidding(page, () => "P");
	await page.goto("/solo");
	await expect(page.locator(".felt")).toBeVisible();
	const felt = await page.locator(".felt").evaluate((element) => {
		const style = getComputedStyle(element);
		return { image: style.backgroundImage, size: style.backgroundSize };
	});
	expect(opening).toEqual(felt);
	await page.evaluate(() =>
		localStorage.setItem("opentrick.settings.baize-strength", "off"),
	);
	await page.goto("/");
	const withTextureDisabled = await banner.evaluate((element) => {
		const style = getComputedStyle(element);
		return { image: style.backgroundImage, size: style.backgroundSize };
	});
	expect(withTextureDisabled).toEqual(opening);
});

test("the opening page uses the reference logo and four-card artwork", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	const brand = page.locator(".opening-brand");
	await expect(brand).toHaveAccessibleName("OpenTrick", { timeout: 1000 });
	await expect(brand.locator(".opening-brand-mark")).toBeVisible();
	const art = page.locator(".opening-illustration");
	await expect(art).toHaveAttribute("aria-hidden", "true");
	await expect(art).toBeVisible();
	expect(
		await art
			.locator("[data-suit]")
			.evaluateAll((cards) =>
				cards.map((card) => card.getAttribute("data-suit")),
			),
	).toEqual(["♦", "♣", "♥", "♠"]);
	await page.evaluate(() => document.fonts.ready);
	for (const width of [601, 900, 901, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		const bounds = await page.evaluate(() => {
			const hero = document
				.querySelector(".opening-hero")
				?.getBoundingClientRect();
			const copy = document
				.querySelector(".opening-hero > div:first-child")
				?.getBoundingClientRect();
			const cards = [...document.querySelectorAll(".opening-playing-card")].map(
				(card) => card.getBoundingClientRect(),
			);
			if (!hero || !copy || cards.length !== 4)
				throw new Error("Opening artwork is missing");
			return {
				copyRight: copy.right,
				heroRight: hero.right,
				cardsLeft: Math.min(...cards.map((card) => card.left)),
				cardsRight: Math.max(...cards.map((card) => card.right)),
			};
		});
		expect(bounds.cardsLeft).toBeGreaterThanOrEqual(bounds.copyRight);
		expect(bounds.cardsRight).toBeLessThanOrEqual(bounds.heroRight);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(art).toBeHidden();
});

test("desktop setup can return home without losing entered names", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/create/?n=Reserved");
	const setupUrl = page.url();
	await page.getByTestId("invite-friends").click();
	await page.locator('input[name="name-N"]').fill("Partner");
	const back = page.getByRole("button", { name: "Back to home" });
	await expect(back).toBeVisible({ timeout: 1000 });
	const setupBox = await page.locator(".setup-mode").boundingBox();
	const backBox = await back.boundingBox();
	expect(
		Math.abs(
			(setupBox?.x ?? 0) +
				(setupBox?.width ?? 0) -
				((backBox?.x ?? 0) + (backBox?.width ?? 0)),
		),
	).toBeLessThan(2);
	const colors = await back.evaluate((element) => {
		const style = getComputedStyle(element);
		return { background: style.backgroundColor, text: style.color };
	});
	const channels = colors.background.match(/\d+/g)?.map(Number) ?? [];
	expect(channels[0] ?? 255).toBeLessThan(150);
	expect(channels[0] ?? 0).toBeGreaterThan(channels[1] ?? 255);
	expect(channels[0] ?? 0).toBeGreaterThan(channels[2] ?? 255);
	const luminance = (color: string): number => {
		const channels = color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
		if (channels.length !== 3) throw new Error(`Unexpected color: ${color}`);
		return channels.reduce((sum, channel, index) => {
			const value = channel / 255;
			const linear =
				value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
		}, 0);
	};
	const background = luminance(colors.background);
	const foreground = luminance(colors.text);
	expect(
		(Math.max(background, foreground) + 0.05) /
			(Math.min(background, foreground) + 0.05),
	).toBeGreaterThanOrEqual(4.5);
	await back.click();
	expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
	await expect(page.locator(".opening-brand")).toBeFocused();
	await expect(page.locator('input[name="name-N"]')).toHaveValue("Partner");
	await expect(page).toHaveURL(setupUrl);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(back).toBeHidden();
});

for (const [width, height] of [
	[320, 568],
	[390, 844],
	[1440, 900],
	[1440, 1200],
] as const) {
	test(`invite friends aligns the setup section at ${width}×${height}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height });
		await page.goto("/");
		await page.evaluate(() => document.fonts.ready);
		await page.getByTestId("invite-friends").click();
		const setup = page.locator(".setup-mode");
		const box = await setup.boundingBox();
		expect(Math.abs(box?.y ?? Infinity)).toBeLessThanOrEqual(2);
		await expect(
			setup.getByRole("heading", { name: "Invite friends" }),
		).toBeFocused();
		await expect(page).toHaveURL(/\/$/);
	});
}

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
			.locator(".opening-brand, select, .opening-help")
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
		await header.locator(".opening-help").click();
		const help = page.getByRole("dialog", { name: "How to play" });
		await expect(help).toBeVisible();
		const helpBox = await help.boundingBox();
		expect(helpBox?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect((helpBox?.x ?? 0) + (helpBox?.width ?? 0)).toBeLessThanOrEqual(
			width,
		);
		await help.getByRole("button", { name: "Close" }).click();
	}
});

test("a wrapped mode description keeps its icon aligned with the first line", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 844 });
	await page.goto("/");
	const alignment = await page
		.locator(".opening-card")
		.first()
		.evaluate((card) => {
			const description = card.querySelector("p");
			const icon = card.querySelector(".mode-symbol");
			if (!description || !icon) throw new Error("Missing description or icon");
			description.textContent =
				"Start a game with three computer players and a longer translated description.";
			const range = document.createRange();
			range.selectNodeContents(description);
			const lines = range.getClientRects();
			const iconBox = icon.getBoundingClientRect();
			return {
				count: lines.length,
				difference: Math.abs(iconBox.top - (lines[0]?.top ?? 0)),
			};
		});
	expect(alignment.count).toBeGreaterThan(1);
	expect(alignment.difference).toBeLessThan(5);
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
	await page.getByRole("button", { name: "Help", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "How to play" })).toContainText(
		"open the full table link in the same browser",
	);
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
		for (const card of await cards.all()) {
			const alignment = await card.evaluate((node, mobile) => {
				const icon = node.querySelector<HTMLElement>(".mode-symbol");
				const text = node.querySelector<HTMLElement>(mobile ? "p" : "h3");
				if (!icon || !text) throw new Error("Missing mode title or icon");
				const a = icon.getBoundingClientRect();
				const b = text.getBoundingClientRect();
				return {
					iconX: a.x,
					textX: b.x,
					middleDifference: Math.abs(
						(a.top + a.bottom) / 2 - (b.top + b.bottom) / 2,
					),
					iconSize: getComputedStyle(icon).fontSize,
					textSize: getComputedStyle(text).fontSize,
				};
			}, width === 390);
			expect(alignment.iconX).toBeLessThan(alignment.textX);
			expect(alignment.middleDifference).toBeLessThan(4);
			expect(alignment.iconSize).toBe(alignment.textSize);
		}
	}
});
