import { expect, test } from "@playwright/test";
import { Player } from "./player";

/*
 * A phone shows the same scaled table as a desktop (src/ui/room-view.ts "one Full HD presentation"); layout.spec.ts
 * checks that canvas. This test checks the host bot controls on a phone.
 */
test("on a phone the host pauses the bots and changes the API key", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const player = await Player.open(browser, baseURL, "mobile", {
		viewport: { width: 360, height: 800 },
		isMobile: true,
		hasTouch: true,
	});
	try {
		const page = await player.page("./");
		await page.route(
			"https://openrouter.ai/api/v1/responses",
			async (route) => {
				if (route.request().method() === "OPTIONS") {
					await route.fulfill({
						status: 204,
						headers: {
							"access-control-allow-origin": "*",
							"access-control-allow-methods": "POST, OPTIONS",
							"access-control-allow-headers": "authorization,content-type",
						},
					});
					return;
				}
				const body = route.request().postDataJSON();
				const kind = body.text.format.name === "bridge_call" ? "call" : "card";
				const field = kind === "call" ? "call" : "card";
				const values = body.text.format.schema.properties[field]
					.enum as string[];
				const choice =
					kind === "call" && body.input.includes("No calls yet")
						? (values.find((value) => value === "1NT") ?? values[0])
						: kind === "call"
							? (values.find((value) => value === "P") ?? values[0])
							: values[0];
				await new Promise((resolve) => setTimeout(resolve, 100));
				await route.fulfill({
					status: 200,
					headers: { "access-control-allow-origin": "*" },
					contentType: "application/json",
					body: JSON.stringify({
						output: [
							{
								type: "message",
								role: "assistant",
								content: [
									{
										type: "output_text",
										text: JSON.stringify({ [field]: choice }),
									},
								],
							},
						],
					}),
				});
			},
		);
		for (const seat of ["N", "E", "S", "W"])
			await page.locator(`input[name="bot-${seat}"]`).check({ force: true });
		await page
			.locator('input[name="openrouter-key"]')
			.fill("test-key", { force: true });
		await page
			.getByTestId("create")
			.evaluate((button) => (button as HTMLButtonElement).click());
		await expect(
			page.getByRole("button", { name: "Pause bots" }),
		).toBeVisible();
		await expect(page.locator(".bridge-table")).toHaveAttribute(
			"data-phase",
			"auction",
		);
		await page.getByRole("button", { name: "Pause bots" }).click();
		await expect(
			page.getByRole("button", { name: "Resume bots" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Switch to player$/ }).first(),
		).toBeVisible();
		await page.getByRole("button", { name: "Set API key" }).click();
		await expect(page.getByTestId("api-key-dialog")).toBeVisible();
		await page
			.getByTestId("api-key-dialog")
			.getByLabel("OpenRouter API key")
			.fill("updated-test-key");
		await page.getByRole("button", { name: "Save key" }).click();
		expect(
			await page.evaluate(() =>
				localStorage.getItem("opentrick.openrouter-api-key"),
			),
		).toBe("updated-test-key");
	} finally {
		await player.close();
	}
});
