import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { makeCall, namePlayers } from "./room";

for (const operation of ["undo", "reset"] as const) {
	test(`bots bid again after ${operation} returns to an earlier auction`, async ({
		page,
	}) => {
		await mockBotBidding(page, () => "P");
		await page.goto("/");
		await namePlayers(page, "N", ["E", "S", "W"]);
		await page.getByTestId("create").click();
		const table = page.getByTestId("table");
		await expect(table).toHaveAttribute("data-at", "0");
		await makeCall(page, "1C");
		await expect(table).toHaveAttribute("data-at", "2");
		if (operation === "undo") {
			await page
				.getByTestId("bid-box")
				.getByRole("button", { name: "Undo", exact: true })
				.click();
		} else {
			await page
				.getByRole("button", { name: "Host controls", exact: true })
				.click();
			await page
				.getByTestId("host-controls-dialog")
				.getByRole("button", { name: "Reset", exact: true })
				.click();
		}
		await expect(table).toHaveAttribute("data-at", "0");
		await expect(table).toHaveAttribute("data-board", "1");
		await makeCall(page, "1C");
		await expect(table).toHaveAttribute("data-at", "2");
	});
}
