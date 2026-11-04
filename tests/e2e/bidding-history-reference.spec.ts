import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { CONNECT_MS, createRoom, makeCall } from "./room";

test("a real auction shows a labeled common reference for a bot's fourth-suit bid", async ({
	page,
}) => {
	await mockBotBidding(page, (position) => {
		const call = ["1C", "P", "1H", "P", "1S", "P", "2D"][position.calls.length];
		return (call ?? "P") as "1C" | "1H" | "1S" | "2D" | "P";
	});
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	await makeCall(page, "P");
	const bid = page
		.getByTestId("auction")
		.getByRole("button", { name: "2♦", exact: true });
	const explanation =
		"Common reference: Fourth suit: often artificial and forcing, without promising ♦ length. It may not describe this bid.";
	await expect(bid).toHaveAttribute("aria-description", explanation, {
		timeout: CONNECT_MS,
	});
	await bid.click();
	await expect(page.getByText(explanation, { exact: true })).toBeVisible();
});
