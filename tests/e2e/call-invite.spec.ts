import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	counts,
	installCallProbe,
	joinButton,
	leaveButton,
	panel,
} from "./call-probe";
import { Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/**
 * The invitation to the host's room call (src/ui/call-panel.ts): West hosts, North (a desktop) is at the table when
 * West joins the call, and South (a phone) comes to the table later. Each guest gets the invitation in the middle
 * of the screen: the call switches of its device, Join call and Don't join.
 */

const invite = (page: Page): Locator => page.getByTestId("call-invite");

/** The invitation is in the middle of the screen. */
async function expectCentered(page: Page): Promise<void> {
	const found = await invite(page).boundingBox();
	const size = page.viewportSize();
	if (found === null || size === null)
		throw new Error("the invitation or the viewport has no size");
	expect(
		Math.abs(found.x + found.width / 2 - size.width / 2),
	).toBeLessThanOrEqual(2);
	expect(
		Math.abs(found.y + found.height / 2 - size.height / 2),
	).toBeLessThanOrEqual(2);
}

const inviteButton = (page: Page, name: string): Locator =>
	invite(page).getByRole("button", { name, exact: true });

test("a guest gets an invitation when the host starts a room call, or when it comes while the host is in one", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(240_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const desktop = { width: 1920, height: 1080 };
	const host = await Player.open(browser, baseURL, "invite-W", {
		permissions: ["microphone"],
		viewport: desktop,
	});
	const north = await Player.open(
		browser,
		baseURL,
		"invite-N",
		{ permissions: ["microphone"], viewport: desktop },
		{ keepCallInvite: true },
	);
	const south = await Player.open(
		browser,
		baseURL,
		"invite-S",
		{
			permissions: ["microphone"],
			viewport: { width: 390, height: 664 },
			isMobile: true,
			hasTouch: true,
		},
		{ keepCallInvite: true },
	);
	const players = [host, north, south];
	try {
		for (const player of players) await player.addInitScript(installCallProbe);
		const w = await host.page("./");
		const link = await createRoom(w);
		const n = await north.page(link);
		await pick(n, "N");
		await expect(panel(n)).toHaveAttribute("data-status", "outside", {
			timeout: CONNECT_MS,
		});
		await expect(joinButton(n)).toBeEnabled();
		await expect(invite(n)).toBeHidden();

		// West joins: North is asked at once; West itself is not.
		await joinButton(w).click();
		await expect(leaveButton(w)).toBeVisible();
		await expect(invite(n)).toBeVisible({ timeout: CONNECT_MS });
		await expect(invite(n)).toHaveRole("dialog");
		await expect(invite(n)).toContainText("Optional room call");
		await expect(invite(n)).toContainText("The host started a room call.");
		await expectCentered(n);
		for (const [name, on] of [
			["Send mic audio", "true"],
			["Hear others: receive audio", "true"],
			["Send camera video", "false"],
			["See cameras: receive video", "true"],
		] as const)
			await expect(inviteButton(n, name)).toHaveAttribute("aria-pressed", on);
		await expect(inviteButton(n, "Join call")).toBeEnabled();
		await expect(invite(w)).toBeHidden();

		// Don't join closes the invitation and starts nothing; the panel can still join later.
		await inviteButton(n, "Don't join").click();
		await expect(invite(n)).toBeHidden();
		await expect(panel(n)).toHaveAttribute("data-status", "outside");
		expect((await counts(n)).captures).toBe(0);
		await joinButton(n).click();
		await expect(leaveButton(n)).toBeVisible();
		await leaveButton(n).click();
		await expect(joinButton(n)).toBeVisible();
		await n.waitForTimeout(2_000);
		await expect(invite(n)).toBeHidden();

		// South comes while West is in the call: the phone gets the invitation too, with its audio switches and Send
		// camera, but no See cameras switch: a phone shows no video.
		const s = await south.page(link);
		await pick(s, "S");
		await expect(invite(s)).toBeVisible({ timeout: CONNECT_MS });
		await expectCentered(s);
		await expect(invite(s).locator(".call-toggle:visible")).toHaveCount(3);
		await expect(inviteButton(s, "See cameras: receive video")).toBeHidden();
		await inviteButton(s, "Send mic audio").click();
		await expect(inviteButton(s, "Send mic audio")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		// With all switches off the invitation stays open, and Join waits for a switch.
		await inviteButton(s, "Hear others: receive audio").click();
		await expect(inviteButton(s, "Join call")).toBeDisabled();
		await s.waitForTimeout(1_000);
		await expect(invite(s)).toBeVisible();
		await inviteButton(s, "Hear others: receive audio").click();
		await expect(inviteButton(s, "Join call")).toBeEnabled();
		// Join call in the invitation joins with the switches that it shows.
		await inviteButton(s, "Join call").click();
		await expect(invite(s)).toBeHidden();
		await expect(panel(s)).toHaveAttribute("data-status", /^(?!outside$)/);
		await expect(
			s.getByTestId("call-row").getByRole("button", { name: "Leave call" }),
		).toBeVisible();
		await expect(
			s.getByTestId("call-row").getByRole("button", { name: "Send mic audio" }),
		).toHaveAttribute("aria-pressed", "false");

		// A new call of West asks North again.
		await leaveButton(w).click();
		await expect(joinButton(w)).toBeVisible();
		await joinButton(w).click();
		await expect(invite(n)).toBeVisible({ timeout: CONNECT_MS });
		await inviteButton(n, "Don't join").click();
		await expect(invite(n)).toBeHidden();
		for (const player of players) expect(player.errors).toEqual([]);
	} finally {
		for (const player of players) await player.close();
	}
});
