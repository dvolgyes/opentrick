import { expect, test } from "@playwright/test";
import { translator } from "../../src/i18n";

test("help explains the play options, invitations, calls, and recovery", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.getByText("Help", { exact: true }).click();
	const help = page.getByRole("button", { name: "Help", exact: true });
	const dialog = page.getByRole("dialog", { name: "How to play" });
	await expect(dialog).toBeVisible({ timeout: 1000 });
	await expect(dialog).toContainText("No registration or account is required.");
	await expect(dialog).toContainText(
		"invitation link helps friends find the same table",
	);
	await expect(dialog).toContainText("copy the complete invitation link");
	await expect(dialog).toContainText("send it privately");
	await expect(dialog).toContainText("No invitation is needed");
	await expect(dialog).toContainText("automatically");
	await expect(dialog).toContainText("disabled for all community games");
	await expect(dialog).toContainText("This may change");
	await expect(dialog).toContainText("same browser");
	await expect(dialog).toContainText("eight hours");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(help).toBeFocused();
	await help.click();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(dialog).toBeHidden();
});

for (const locale of [
	"de",
	"hu",
	"no",
	"es",
	"pt",
	"fr",
	"it",
	"nl",
] as const) {
	test(`help is translated in ${locale}`, async ({ page }) => {
		await page.addInitScript(
			(value) => localStorage.setItem("opentrick.locale", value),
			locale,
		);
		await page.goto("/");
		const t = translator(locale);
		await page.getByRole("button", { name: t("Help"), exact: true }).click();
		const dialog = page.getByRole("dialog", { name: t("How to play") });
		await expect(dialog).toContainText(
			t(
				"Audio and video calls are optional in private games. They are currently disabled for all community games, even if no community player is present. This may change in the future.",
			),
		);
		await dialog.getByRole("button", { name: t("Close"), exact: true }).click();
		await expect(dialog).toBeHidden();
	});
}
