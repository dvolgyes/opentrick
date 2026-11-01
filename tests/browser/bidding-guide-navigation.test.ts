import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../src/ui/style.css";
import { POINT_SYSTEMS } from "../../src/bridge/hand-points";
import { type Locale, translator } from "../../src/i18n";
import { guideDialog } from "../../src/ui/bidding-guide";

afterEach(async () => {
	document.body.replaceChildren();
	await page.viewport(414, 896);
});

it("links to the transfer and Stayman rules for every system and language", async () => {
	await page.viewport(320, 568);
	const locales: readonly Locale[] = [
		"en",
		"de",
		"hu",
		"no",
		"es",
		"pt",
		"fr",
		"it",
		"nl",
	];
	for (const locale of locales) {
		for (const system of POINT_SYSTEMS) {
			const guide = guideDialog(translator(locale), locale);
			document.body.append(guide.element);
			guide.open(system);
			const links = () =>
				guide.element.querySelectorAll<HTMLButtonElement>(
					".guide-jumps button",
				);
			await expect
				.poll(() => links().length, { message: `${system}, ${locale}` })
				.toBe(2);
			for (const link of links())
				expect(link.scrollWidth, `${system}, ${locale}`).toBeLessThanOrEqual(
					link.clientWidth,
				);
			for (const [id, bid] of [
				["guide-transfer-link", "2♦"],
				["guide-stayman-link", "2♣"],
			] as const) {
				const link = guide.element.querySelector<HTMLButtonElement>(
					`[data-testid='${id}']`,
				);
				if (!link) throw new Error(`Missing ${id} for ${system}, ${locale}`);
				link.click();
				expect(
					document.activeElement?.querySelector(".guide-bid")?.textContent,
				).toBe(bid);
			}
			guide.element.close();
			guide.element.remove();
		}
	}
}, 30_000);
