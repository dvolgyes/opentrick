import { expect, type Page, test } from "@playwright/test";
import { type Locale, translatedMessageKeys, translator } from "../../src/i18n";
import { mockBotBidding } from "./bot-mock";

// The host plays West in Hungarian against three host bots, on a desktop and on a phone. At each stage of a board,
// every visible text and label must be Hungarian: no English catalog text, and no common English word.

const LOCALE: Locale = "hu";
const t = translator(LOCALE);

const FORMS = [
	{ name: "desktop", viewport: { width: 1920, height: 1080 }, mobile: false },
	{ name: "phone", viewport: { width: 390, height: 844 }, mobile: true },
] as const;

/** Player names without English words, so that only the interface can fail the check. */
const NAMES = { N: "Anna", E: "Béla", S: "Csaba", W: "Dóra" } as const;

/** Words of `text`, without the letters and digits that touch it on either side. */
function wordPattern(text: string): RegExp {
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
}

const huValues = translatedMessageKeys.map((key) => t(key));

/**
 * The English fragments of each catalog text that Hungarian translates differently: the parts between the
 * placeholders, with at least two words or one word of 4 letters. A fragment that a Hungarian text also contains,
 * such as a name, cannot show a missing translation.
 */
const ENGLISH_FRAGMENTS = [
	...new Set(
		translatedMessageKeys
			.filter((key) => t(key) !== key)
			.flatMap((key) => key.split(/\{[a-zA-Z0-9_]+\}/))
			.map((fragment) => fragment.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))
			.filter(
				(fragment) =>
					/\p{L}{4}/u.test(fragment) || /\p{L}+\s+\p{L}+/u.test(fragment),
			),
	),
]
	.filter(
		(fragment) => !huValues.some((value) => wordPattern(fragment).test(value)),
	)
	.map((fragment) => ({ fragment, pattern: wordPattern(fragment) }));

/** Common English words, and the English side names, that no Hungarian text of the page uses. */
const ENGLISH_WORDS =
	/(?<![\p{L}\p{N}])(the|to|your|you|for|and|of|with|from|player|waiting|turn|play|bid|call|level|pass|confirm|clubs|diamonds|hearts|spades|trump|double|redouble|asking|attempt|seconds|retrying|tricks|dealer|vulnerable|board|by|auction|n-s|e-w)(?![\p{L}\p{N}])/iu;

/** The visible texts of the page, and the labels and titles of its visible elements. */
async function shownTexts(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const texts = new Set<string>();
		const visible = (node: Element) =>
			node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
		);
		for (
			let node = walker.nextNode();
			node !== null;
			node = walker.nextNode()
		) {
			const text = node.textContent?.trim() ?? "";
			const parent = node.parentElement;
			if (
				text !== "" &&
				parent !== null &&
				parent.closest("script, style") === null &&
				visible(parent)
			)
				texts.add(text);
		}
		for (const node of document.body.querySelectorAll("*")) {
			if (!visible(node)) continue;
			for (const name of [
				"aria-label",
				"aria-description",
				"title",
				"placeholder",
				"alt",
			]) {
				const value = node.getAttribute(name)?.trim();
				if (value) texts.add(value);
			}
		}
		texts.add(document.title);
		return [...texts];
	});
}

/** Each shown text with English in it, as "stage: text (reason)". */
async function englishOn(page: Page, stage: string): Promise<string[]> {
	const found: string[] = [];
	for (const text of await shownTexts(page)) {
		if (Object.values(NAMES).includes(text as never)) continue;
		const fragment = ENGLISH_FRAGMENTS.find(({ pattern }) =>
			pattern.test(text),
		);
		const word = ENGLISH_WORDS.exec(text)?.[0];
		if (fragment !== undefined)
			found.push(`${stage}: ${text} (catalog text "${fragment.fragment}")`);
		else if (word !== undefined)
			found.push(`${stage}: ${text} (English word "${word}")`);
	}
	return found;
}

/** The first call of a board is 1NT; every later bot call is a pass, and every bot card is its first legal card. */
async function mockBots(page: Page): Promise<void> {
	await mockBotBidding(page, (position) => {
		return position.calls.length === 0 ? "1NT" : "P";
	});
}

const phase = (page: Page) =>
	page.locator("[data-phase]").first().getAttribute("data-phase");

for (const form of FORMS) {
	test(`a ${form.name} shows a whole board in Hungarian`, async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(240_000);
		if (!baseURL) throw new Error("baseURL is not configured");
		const context = await browser.newContext({
			baseURL,
			viewport: form.viewport,
			isMobile: form.mobile,
			hasTouch: form.mobile,
			locale: "hu-HU",
		});
		const found = new Set<string>();
		const check = async (page: Page, stage: string) => {
			for (const line of await englishOn(page, stage)) found.add(line);
		};
		try {
			const page = await context.newPage();
			await mockBots(page);
			await page.goto("/");
			await expect(page.getByTestId("create")).toBeVisible();
			await check(page, "create");
			for (const [seat, name] of Object.entries(NAMES))
				await page.locator(`input[name="name-${seat}"]`).fill(name);
			await page.locator('input[name="me"][value="W"]').check();
			for (const seat of ["N", "E", "S"]) {
				await page.locator(`input[name="name-${seat}"]`).fill("");
				await page.locator(`input[name="bot-${seat}"]`).check();
			}

			await page.getByTestId("create").click();
			await expect.poll(() => phase(page)).toBe("auction");

			// North opens 1NT; East and South pass. The bots' turns show their names.
			const pass = page.locator("button.pass:visible:not([disabled])");
			while ((await pass.count()) === 0) {
				await check(page, "auction, a bot to bid");
				await page.waitForTimeout(200);
			}
			await check(page, "auction, West to bid");
			await pass.click();
			await check(page, "auction, Pass chosen");
			await page.locator("button.confirm:visible").click();
			await expect.poll(() => phase(page), { timeout: 30_000 }).toBe("play");

			// North declares 1NT and East leads. West plays the first legal card at each turn.
			let checks = 0;
			while ((await phase(page)) === "play") {
				if (checks++ % 5 === 0) await check(page, "play");
				const next = page.locator("button.card:visible:not([disabled])");
				if ((await next.count()) === 0) {
					await page.waitForTimeout(100);
					continue;
				}
				await check(page, "play, West to play");
				await next
					.first()
					.click({ timeout: 2_000 })
					.catch(() => undefined);
			}
			await expect(page.locator("[data-phase]").first()).toHaveAttribute(
				"data-phase",
				"complete",
			);
			await check(page, "board complete");
			await page.locator("button.settings-button:visible").first().click();
			await check(page, "settings");
		} finally {
			await context.close();
		}
		expect([...found].sort()).toEqual([]);
	});
}
