import { expect, test } from "@playwright/test";
import { mockBotBidding } from "./bot-mock";
import { Player } from "./player";
import { createRoom, pick } from "./room";

for (const layout of ["desktop", "compact"] as const) {
	test(`disables the call when the other seats are bots (${layout})`, async ({
		page,
	}) => {
		await page.setViewportSize(
			layout === "compact"
				? { width: 360, height: 800 }
				: { width: 1280, height: 720 },
		);
		await page.addInitScript(() => {
			let requests = 0;
			const original = navigator.mediaDevices.getUserMedia.bind(
				navigator.mediaDevices,
			);
			navigator.mediaDevices.getUserMedia = (constraints) => {
				requests++;
				return original(constraints);
			};
			Object.defineProperty(window, "callMediaRequests", {
				get: () => requests,
			});
		});
		await mockBotBidding(page, () => "P");
		await page.goto("/");
		await createRoom(page, ["N", "E", "S"]);
		const controls =
			layout === "compact"
				? page.locator('.icon-group[aria-label="Room call"]')
				: page.getByTestId("call-panel");
		const join = controls.getByRole("button", { name: "Join call" });
		await expect(controls).toHaveAttribute("data-bots-only", "true");
		await expect(join).toBeDisabled();
		await expect(controls).toHaveCSS("filter", "grayscale(1) brightness(0.6)");
		await join.evaluate((button) => (button as HTMLButtonElement).click());
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { callMediaRequests: number })
						.callMediaRequests,
			),
		).toBe(0);
		await page.getByTestId("host-autoplay-toggle").click();
		await page.getByTestId("autoplay-confirm-enable").click();
		await expect(controls).toHaveAttribute("data-bots-only", "true");
		await expect(join).toBeDisabled();
		await expect(controls).toHaveCSS("filter", "grayscale(1) brightness(0.6)");
		if (layout === "desktop") {
			await page.reload();
			await expect(controls).toHaveAttribute("data-bots-only", "true");
			await expect(join).toBeDisabled();
			await expect(
				controls.getByRole("button", { name: "Leave call" }),
			).toHaveCount(0);
		}
		await page.getByTestId("host-autoplay-toggle").click();
		await expect(controls).toHaveAttribute("data-bots-only", "true");
		await expect(join).toBeDisabled();
	});
}

for (const layout of ["desktop", "compact"] as const) {
	test(`enables the call when another human joins and disables it when they are replaced (${layout})`, async ({
		browser,
		baseURL,
	}) => {
		if (!baseURL) throw new Error("missing base URL");
		const host = await Player.open(browser, baseURL, `call-host-${layout}`, {
			viewport:
				layout === "compact"
					? { width: 360, height: 800 }
					: { width: 1280, height: 720 },
		});
		const guest = await Player.open(browser, baseURL, `call-guest-${layout}`);
		try {
			const page = await host.page("./");
			await mockBotBidding(page, () => "P");
			const link = await createRoom(page, ["E", "S"]);
			const controls =
				layout === "compact"
					? page.locator('.icon-group[aria-label="Room call"]')
					: page.getByTestId("call-panel");
			await expect(controls).toHaveAttribute("data-bots-only", "true");
			await pick(await guest.page(link), "N");
			await expect(controls).toHaveAttribute("data-bots-only", "false");
			const join = controls.getByRole("button", { name: "Join call" });
			await expect(join).toBeEnabled();
			if (layout === "desktop") {
				await host.grantPermissions(["microphone"]);
				await join.click();
				await expect(
					controls.getByRole("button", { name: "Leave call" }),
				).toBeEnabled();
				await page
					.getByTestId("tile-N")
					.getByRole("button", { name: "Switch to bot" })
					.click();
				await expect(
					controls.getByRole("button", { name: "Leave call" }),
				).toBeEnabled();
				await expect(controls).toHaveAttribute("data-bots-only", "false");
			} else {
				// On a phone the seat switches are in the Host controls.
				await page
					.getByRole("button", { name: "Host controls", exact: true })
					.click();
				const hostControls = page.getByTestId("host-controls-dialog");
				await hostControls.getByText("Optional automated players").click();
				await hostControls
					.locator('.mobile-player-control[data-seat="N"] button')
					.click();
			}
			await expect(controls).toHaveAttribute("data-bots-only", "true", {
				timeout: 20_000,
			});
			await expect(join).toBeDisabled();
		} finally {
			await guest.close();
			await host.close();
		}
	});
}

test("desktop bidding windows stay above an overlapping video tile and turn frame", async ({
	page,
}) => {
	await mockBotBidding(page, () => "P");
	await page.goto("/");
	await createRoom(page, ["N", "E", "S"]);
	await expect(page.getByTestId("table")).toHaveAttribute(
		"data-phase",
		"auction",
	);
	const hits = await page.evaluate(() => {
		const felt = document.querySelector<HTMLElement>(".felt");
		const tileSlot = document.querySelector<HTMLElement>(".video-left");
		const tile = tileSlot?.querySelector<HTMLElement>(".tile");
		if (!felt || !tileSlot || !tile) throw new Error("missing video tile");
		Object.assign(tileSlot.style, {
			top: "0",
			left: "0",
			width: "100%",
			height: "100%",
		});
		Object.assign(tile.style, { width: "100%", height: "100%" });
		const frame = document.createElement("div");
		frame.className = "seat";
		frame.dataset.turnFrame = "true";
		Object.assign(frame.style, {
			position: "absolute",
			inset: "0",
			zIndex: "5",
		});
		felt.append(frame);
		return [".bid-row .history-panel", ".bid-row .bid-box"].map((selector) => {
			const target = document.querySelector<HTMLElement>(selector);
			if (!target) throw new Error(`missing ${selector}`);
			const box = target.getBoundingClientRect();
			const hit = document.elementFromPoint(
				(box.left + box.right) / 2,
				(box.top + box.bottom) / 2,
			);
			return hit !== null && target.contains(hit);
		});
	});
	expect(hits).toEqual([true, true]);
});
