import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	counts,
	expectAudioArrives,
	installCallProbe,
	joinButton,
	leaveButton,
	panel,
	toggle,
} from "./call-probe";
import { buildRelayHubs, Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/** A non-host can start a real call, and a phone can opt in from its invitation. */

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

test("a non-host starts a room call and a compact touch guest joins it", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(240_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const desktop = { width: 1920, height: 1080 };
	const rig = { keepCallInvite: true, relayHubs: buildRelayHubs() };
	const host = await Player.open(
		browser,
		baseURL,
		"invite-W",
		{ permissions: ["microphone"], viewport: desktop },
		rig,
	);
	const north = await Player.open(
		browser,
		baseURL,
		"invite-N",
		{ permissions: ["microphone"], viewport: desktop },
		rig,
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
		rig,
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

		await joinButton(n).click();
		const confirm = n.getByTestId("call-confirm");
		await expect(confirm.locator(".call-toggle:visible")).toHaveCount(4);
		await expect(confirm).toBeVisible();
		await expect(invite(w)).toBeHidden();
		expect((await counts(n)).captures).toBe(0);
		await confirm
			.getByRole("button", { name: "Don't join", exact: true })
			.click();
		await expect(panel(n)).toHaveAttribute("data-status", "outside");
		await expect(invite(w)).toBeHidden();
		expect((await counts(n)).captures).toBe(0);
		await joinButton(n).click();
		await confirm
			.getByRole("button", { name: "Join call", exact: true })
			.click();
		await expect(confirm).toBeHidden();
		await expect(leaveButton(n)).toBeVisible();
		await expect(invite(w)).toBeVisible({ timeout: CONNECT_MS });
		await expect(invite(w)).toHaveRole("dialog");
		await expectCentered(w);
		await expect(invite(w)).toContainText("A player started a room call.");
		for (const [name, on] of [
			["Send mic audio", "true"],
			["Hear others: receive audio", "true"],
			["Send camera video", "false"],
			["See cameras: receive video", "true"],
		] as const)
			await expect(inviteButton(w, name)).toHaveAttribute("aria-pressed", on);
		await expect(inviteButton(w, "Join call")).toBeEnabled();
		await expect(invite(n)).toBeHidden();

		await inviteButton(w, "Don't join").click();
		await expect(invite(w)).toBeHidden();
		await expect(panel(w)).toHaveAttribute("data-status", "outside");
		expect((await counts(w)).captures).toBe(0);
		const hostConfirm = w.getByTestId("call-confirm");
		await joinButton(w).click();
		await hostConfirm
			.getByRole("button", { name: "Join call", exact: true })
			.click();
		await expect(leaveButton(w)).toBeVisible();
		await Promise.all([expectAudioArrives(w), expectAudioArrives(n)]);

		await leaveButton(w).click();
		await expect(hostConfirm).toBeVisible();
		await hostConfirm.getByRole("button", { name: "Stay in call" }).click();
		await expect(leaveButton(w)).toBeVisible();
		await leaveButton(w).click();
		await hostConfirm
			.getByRole("button", { name: "Leave call", exact: true })
			.click();
		await expect(joinButton(w)).toBeVisible();
		await expect(invite(w)).toBeHidden();

		const s = await south.page(link);
		await pick(s, "S");
		await expect(invite(s)).toBeVisible({ timeout: CONNECT_MS });
		await expectCentered(s);
		await expect(invite(s).locator(".call-toggle:visible")).toHaveCount(4);
		await expect(inviteButton(s, "See cameras: receive video")).toBeVisible();
		for (const name of [
			"Send camera video",
			"Send mic audio",
			"Hear others: receive audio",
			"See cameras: receive video",
		]) {
			const button = inviteButton(s, name);
			if ((await button.getAttribute("aria-pressed")) === "true")
				await button.tap();
		}
		await expect(inviteButton(s, "Join call")).toBeDisabled();
		for (const name of ["Send mic audio", "Hear others: receive audio"])
			await inviteButton(s, name).tap();
		await expect(inviteButton(s, "Join call")).toBeEnabled();
		await inviteButton(s, "Join call").tap();
		await expect(invite(s)).toBeHidden();
		await expect(panel(s)).toHaveAttribute("data-status", /^(?!outside$)/);
		await expect(leaveButton(s)).toBeVisible();
		await expect(toggle(s, "Send mic audio")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await Promise.all([expectAudioArrives(s), expectAudioArrives(n)]);
		await Promise.all([
			expect(s.getByTestId("audio-N")).toHaveAttribute("data-play", "playing"),
			expect(n.getByTestId("audio-S")).toHaveAttribute("data-play", "playing"),
		]);

		await leaveButton(s).tap();
		const phoneConfirm = s.getByTestId("call-confirm");
		await expect(phoneConfirm).toBeVisible();
		expect((await counts(s)).liveTracks).toBe(1);
		await phoneConfirm
			.getByRole("button", { name: "Leave call", exact: true })
			.tap();
		await expect(panel(s)).toHaveAttribute("data-status", "outside");
		await expect.poll(async () => (await counts(s)).liveTracks).toBe(0);

		await joinButton(s).tap();
		await expect(phoneConfirm.locator(".call-toggle:visible")).toHaveCount(4);
		await phoneConfirm
			.getByRole("button", { name: "Don't join", exact: true })
			.tap();
		await expect(panel(s)).toHaveAttribute("data-status", "outside");
		await expect(invite(w)).toBeHidden();
		for (const player of players) expect(player.errors).toEqual([]);
	} finally {
		for (const player of players) await player.close();
	}
});
