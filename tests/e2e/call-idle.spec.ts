import { expect, type Page, test } from "@playwright/test";
import {
	counts,
	installCallProbe,
	joinWith,
	leaveButton,
	leaveCall,
	note,
	SEAT_NAMES,
} from "./call-probe";
import { buildRelayHubs, Player } from "./player";
import { CONNECT_MS, createRoom, pick } from "./room";

/** Advances only the idle deadline without aging the live peer connection. */
function controlIdleTimer(): void {
	const timers: Window = window;
	const schedule = timers.setTimeout.bind(window);
	const cancel = timers.clearTimeout.bind(window);
	const pending = new Map<number, () => void>();
	timers.setTimeout = (handler, delay, ...args) => {
		const id = schedule(handler, delay, ...args);
		if (delay === 300_000 && typeof handler === "function")
			pending.set(id, () => handler(...args));
		return id;
	};
	timers.clearTimeout = (id) => {
		if (id !== undefined) pending.delete(id);
		cancel(id);
	};
	window.addEventListener("test-call-deadline", () => {
		for (const [id, callback] of [...pending]) {
			window.clearTimeout(id);
			callback();
		}
	});
}

async function reachIdleDeadline(page: Page): Promise<void> {
	await page.evaluate(() =>
		window.dispatchEvent(new Event("test-call-deadline")),
	);
}

test("only another call participant prevents a five-minute hangup", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	const rig = { relayHubs: buildRelayHubs() };
	const opts = { permissions: ["microphone"] };
	const host = await Player.open(browser, baseURL, "host", opts, rig);
	const guest = await Player.open(browser, baseURL, "guest", opts, rig);
	try {
		await host.addInitScript(installCallProbe);
		await host.addInitScript(controlIdleTimer);
		const page = await host.page("./");
		const link = await createRoom(page, ["E", "S"]);
		const other = await guest.page(link);
		await pick(other, "N");
		const table = page.getByTestId("table");
		await expect(table).toHaveAttribute("data-phase", "auction", {
			timeout: CONNECT_MS,
		});
		await joinWith(page, "Audio only");
		await expect.poll(async () => (await counts(page)).liveTracks).toBe(1);
		await expect(other.getByTestId("call-presence-W")).toBeVisible();
		await reachIdleDeadline(page);
		await expect(leaveButton(page)).toBeHidden();
		await expect.poll(async () => (await counts(page)).liveTracks).toBe(0);
		await expect(other.getByTestId("call-presence-W")).toBeHidden();

		await joinWith(page, "Audio only");
		await joinWith(other, "Listen only");
		await expect(note(page)).toContainText(`Connected to ${SEAT_NAMES.N}.`, {
			timeout: CONNECT_MS,
		});
		await reachIdleDeadline(page);
		await expect(leaveButton(page)).toBeVisible();
		expect((await counts(page)).liveTracks).toBe(1);

		await leaveCall(other);
		await expect(note(page)).not.toContainText(`Connected to ${SEAT_NAMES.N}.`);
		await reachIdleDeadline(page);
		await expect(leaveButton(page)).toBeHidden();
		await expect.poll(async () => (await counts(page)).liveTracks).toBe(0);
		await expect(table).toHaveAttribute("data-phase", "auction");
	} finally {
		await guest.close();
		await host.close();
	}
});
