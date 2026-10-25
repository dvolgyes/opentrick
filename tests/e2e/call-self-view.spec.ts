import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	type CallProbe,
	confirmCamera,
	installCallProbe,
	joinButton,
	leaveButton,
	toggle,
} from "./call-probe";
import { Player } from "./player";
import { CONNECT_MS, createRoom } from "./room";

/**
 * The desktop call box (src/ui/call-panel.ts) on one Full HD page: West hosts, the bots hold the other seats.
 * Outside the call it has three rows: the heading, the four switches as icons, and Join call. In the call it is a
 * tile of West's own camera, as large as the other tiles, with the switches in its caption bar and Leave call and
 * Mirror where the other tiles have Switch to player.
 */

/** The four switches in panel order, with their default state. */
const SWITCHES = [
	["Send mic audio", true],
	["Hear others: receive audio", true],
	["Send camera video", false],
	["See cameras: receive video", true],
] as const;

/** The bots always pass, so the board stays in the auction. */
async function passingBots(page: Page): Promise<void> {
	await page.route("https://openrouter.ai/api/v1/responses", (route) =>
		route.fulfill({
			status: 200,
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "authorization,content-type",
			},
			contentType: "application/json",
			body: JSON.stringify({
				output: [
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: '{"call":"P"}' }],
					},
				],
			}),
		}),
	);
}

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

async function box(locator: Locator): Promise<Box> {
	const found = await locator.boundingBox();
	if (found === null) throw new Error(`${locator} has no box`);
	return found;
}

function expectNear(actual: number, expected: number, what: string): void {
	expect(
		Math.abs(actual - expected),
		`${what}: ${actual} ≠ ${expected}`,
	).toBeLessThanOrEqual(1);
}

/** The tab's camera tracks that are still live. */
function liveCameras(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			(
				window as unknown as { __callProbe: CallProbe }
			).__callProbe.tracks.filter(
				(track) => track.kind === "video" && track.readyState === "live",
			).length,
	);
}

/** The own video element shows a live camera track. */
function showsLiveCamera(page: Page): Promise<boolean> {
	return page.getByTestId("video-self").evaluate((node) => {
		const source = (node as HTMLVideoElement).srcObject;
		return (
			source instanceof MediaStream &&
			source.getVideoTracks().some((track) => track.readyState === "live")
		);
	});
}

test("the desktop call box: three rows outside the call, and in the call a tile of the own camera with Leave call and Mirror", async ({
	browser,
	baseURL,
}) => {
	test.setTimeout(180_000);
	if (!baseURL) throw new Error("baseURL is not configured");
	const host = await Player.open(browser, baseURL, "self-view", {
		permissions: ["microphone", "camera"],
		viewport: { width: 1920, height: 1080 },
	});
	try {
		await host.addInitScript(installCallProbe);
		const page = await host.page("./");
		await passingBots(page);
		for (const seat of ["N", "E", "S"])
			await page.locator(`input[name="bot-${seat}"]`).check();
		await page.locator('input[name="openrouter-key"]').fill("test-key");
		await createRoom(page);
		await expect(page.getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
			{ timeout: CONNECT_MS },
		);
		const panel = page.getByTestId("call-panel");
		const self = page.getByTestId("call-self");
		const mirror = toggle(page, "Mirror my camera");
		// South sits in the bottom-right corner, the mirror place of the call box.
		const southTile = page.getByTestId("tile-S");
		const southControl = southTile.locator(".tile-bot-control");
		const southCaption = southTile.locator(".tile-caption");

		// Outside the call: the heading on one line, then the switches as icons only, then Join call.
		const heading = panel.getByRole("heading");
		await expect(heading).toHaveText("Optional room call");
		const headingLines = await heading.evaluate(
			(node) =>
				node.getBoundingClientRect().height /
				Number.parseFloat(getComputedStyle(node).lineHeight),
		);
		expect(headingLines).toBeLessThan(1.5);
		for (const [name, on] of SWITCHES) {
			await expect(toggle(page, name)).toHaveAttribute(
				"aria-pressed",
				String(on),
			);
			await expect(toggle(page, name)).toHaveText("");
			await expect(toggle(page, name).locator("svg")).toHaveCount(1);
		}
		await expect(joinButton(page)).toHaveText("Join call");
		await expect(self).toBeHidden();
		await expect(mirror).toBeHidden();
		const switchRow = await box(toggle(page, SWITCHES[0][0]));
		expect((await box(heading)).y).toBeLessThan(switchRow.y);
		expect(switchRow.y).toBeLessThan((await box(joinButton(page))).y);
		for (const [name] of SWITCHES)
			expectNear((await box(toggle(page, name))).y, switchRow.y, name);
		// The box has the place and size of a tile, in the mirror place of South's, and Join call is its control row.
		const outside = await box(panel);
		const south = await box(southTile);
		const southRow = await box(southControl);
		expectNear(outside.width, south.width, "box width");
		expectNear(outside.height, south.height, "box height");
		expectNear(outside.y, south.y, "box top");
		const join = await box(joinButton(page));
		expectNear(join.y, southRow.y, "Join call top");
		expectNear(join.height, southRow.height, "Join call height");

		// In the call with the camera: the own tile matches South's tile, and shows the camera mirrored.
		await toggle(page, "Send camera video").click();
		await joinButton(page).click();
		await confirmCamera(page);
		await expect(leaveButton(page)).toBeVisible();
		await expect(self).toBeVisible();
		await expect(heading).toBeHidden();
		const ownTile = await box(self);
		expectNear(ownTile.width, south.width, "tile width");
		expectNear(ownTile.height, south.height, "tile height");
		expectNear(ownTile.y, south.y, "tile top");
		await expect.poll(() => showsLiveCamera(page)).toBe(true);
		await expect(page.getByTestId("video-self")).toBeVisible();
		await expect(page.getByTestId("video-self")).toHaveCSS(
			"transform",
			"matrix(-1, 0, 0, 1, 0, 0)",
		);
		// The switches are the caption bar of the own tile, as tall as the other captions.
		const caption = panel.locator(".tile-caption");
		for (const [name] of SWITCHES) {
			await expect(
				caption.getByRole("button", { name, exact: true }),
			).toBeEnabled();
			await expect(toggle(page, name)).toHaveAttribute("aria-pressed", "true");
		}
		const bar = await box(caption);
		expectNear(bar.height, (await box(southCaption)).height, "caption height");
		expectNear(
			bar.y + bar.height,
			ownTile.y + ownTile.height,
			"caption bottom",
		);
		expectNear(bar.width, ownTile.width, "caption width");
		// Leave call and Mirror sit where South has Switch to player, at the same height.
		await expect(mirror).toHaveAttribute("aria-pressed", "true");
		for (const control of [leaveButton(page), mirror]) {
			const place = await box(control);
			expectNear(place.y, southRow.y, "control row top");
			expectNear(place.height, southRow.height, "control row height");
			expect(place.y).toBeGreaterThanOrEqual(ownTile.y + ownTile.height);
		}
		await expect(leaveButton(page)).toContainText("Leave call");

		// Mirror off: the camera still goes out, but this page shows only the text.
		await mirror.click();
		await expect(mirror).toHaveAttribute("aria-pressed", "false");
		await expect(mirror.locator(".icon-slash")).toHaveCount(1);
		await expect(page.getByTestId("video-self")).toBeHidden();
		await expect(self.getByText("VIDEO IN PROGRESS")).toBeVisible();
		await expect(toggle(page, "Send camera video")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(await liveCameras(page)).toBe(1);
		await mirror.click();
		await expect(page.getByTestId("video-self")).toBeVisible();
		await expect(self.getByText("VIDEO IN PROGRESS")).toBeHidden();

		// Each switch still works in the call, and none of them leaves it.
		for (const [name] of [SWITCHES[0], SWITCHES[1], SWITCHES[3]]) {
			for (const pressed of ["false", "true"]) {
				await toggle(page, name).click();
				await expect(toggle(page, name)).toHaveAttribute(
					"aria-pressed",
					pressed,
				);
				await expect(leaveButton(page)).toBeVisible();
			}
		}
		await toggle(page, "Send camera video").click();
		await expect(toggle(page, "Send camera video")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await expect.poll(() => liveCameras(page)).toBe(0);
		await expect(page.getByTestId("video-self")).toBeHidden();
		await expect(self.getByText("VIDEO IN PROGRESS")).toBeHidden();
		await expect(leaveButton(page)).toBeVisible();
		await toggle(page, "Send camera video").click();
		await confirmCamera(page);
		await expect.poll(() => showsLiveCamera(page)).toBe(true);
		await expect(page.getByTestId("video-self")).toBeVisible();

		// Leave: the three rows come back.
		await leaveButton(page).click();
		await expect(joinButton(page)).toBeVisible();
		await expect(heading).toBeVisible();
		await expect(self).toBeHidden();
		await expect(mirror).toBeHidden();
		await expect.poll(() => liveCameras(page)).toBe(0);
		expect(host.errors).toEqual([]);
	} finally {
		await host.close();
	}
});
