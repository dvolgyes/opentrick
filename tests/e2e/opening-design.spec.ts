import { expect, test } from "@playwright/test";

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

test("pasted invitations reject an external destination without leaving the page", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByLabel("Have an invitation link?")
		.fill("https://example.com/create/#k=AAAAAAAAAAAAAAAAAAAAAA");
	await page.getByRole("button", { name: "Open invitation" }).click();
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Enter a complete invitation link from this site." }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/$/);
});
