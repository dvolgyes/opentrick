import {
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import type { Harness } from "./harness/main";
import { HARNESS_URL as HARNESS } from "./ports";
import { RelayHub } from "./relay-hub";

/**
 * Discovery through each kind of signaling server (ADR 0004): trackers only, Nostr relays only, and both in one
 * strategy, with fake servers in the test process (tests/e2e/relay-hub.ts). The WebRTC links are real Chrome links
 * without STUN, so the pages of one machine connect by their host addresses. Each player is one browser context.
 */

const TRACKERS = ["wss://tracker.hub.test"];
const NOSTR_RELAYS = ["wss://nostr.hub.test"];
const CONNECT_MS = 30_000;

interface Player {
	readonly label: string;
	readonly context: BrowserContext;
	readonly page: Page;
}

interface Relays {
	readonly tracker: RelayHub | null;
	readonly nostr: RelayHub | null;
}

const contexts: BrowserContext[] = [];
const pageErrors: string[] = [];

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern as the first parameter.
test.afterEach(async ({}) => {
	for (const context of contexts.splice(0)) await context.close();
	const errors = pageErrors.splice(0);
	expect(errors, "uncaught page errors").toEqual([]);
});

/**
 * Counts the page's RTCPeerConnections in the "connected" state. Trystero reads the global constructor for each
 * connection, so the subclass sees every one of them.
 */
function countLinks(): void {
	const native = window.RTCPeerConnection;
	const made: RTCPeerConnection[] = [];
	window.RTCPeerConnection = class extends native {
		constructor(configuration?: RTCConfiguration) {
			super(configuration);
			made.push(this);
		}
	};
	(window as unknown as { lbLinks: () => number }).lbLinks = () =>
		made.filter((link) => link.connectionState === "connected").length;
}

async function newPlayer(
	browser: Browser,
	label: string,
	relays: Relays,
): Promise<Player> {
	const context = await browser.newContext();
	contexts.push(context);
	await context.addInitScript(countLinks);
	await relays.tracker?.install(context, label);
	await relays.nostr?.install(context, label);
	const page = await context.newPage();
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const query = new URLSearchParams({
		trackers: relays.tracker ? relays.tracker.urls.join(",") : "none",
		nostr: relays.nostr ? relays.nostr.urls.join(",") : "none",
		stun: "none",
	});
	await page.goto(`${HARNESS}?${query}`);
	await page.waitForFunction(() => window.lbHarness !== undefined);
	return { label, context, page };
}

function links(page: Page): Promise<number> {
	return page.evaluate(() =>
		(window as unknown as { lbLinks: () => number }).lbLinks(),
	);
}

function peers(page: Page): Promise<number> {
	return page.evaluate(
		() => (window.lbHarness as Harness).view()?.peers.length ?? 0,
	);
}

/** A host at N and a guest that opens the link; resolves when both see one peer over one connected link. */
async function connectedPair(
	browser: Browser,
	relays: Relays,
): Promise<{ readonly host: Player; readonly guest: Player }> {
	const host = await newPlayer(browser, "host", relays);
	const guest = await newPlayer(browser, "guest", relays);
	const { key } = await host.page.evaluate(() =>
		(window.lbHarness as Harness).createTable("N"),
	);
	await guest.page.evaluate(
		(link) => (window.lbHarness as Harness).openTable(link),
		key,
	);
	for (const player of [host, guest])
		await expect
			.poll(async () => [await peers(player.page), await links(player.page)], {
				message: `${player.label} connects`,
				timeout: CONNECT_MS,
			})
			.toEqual([1, 1]);
	return { host, guest };
}

/** The relay counts that each page shows: [trackers open, trackers, Nostr relays open, Nostr relays]. */
function relayCounts(page: Page): Promise<number[]> {
	return page.evaluate(() => {
		const network = (window.lbHarness as Harness).view()?.network;
		return network
			? [
					network.trackersOpen,
					network.trackers,
					network.nostrOpen,
					network.nostrRelays,
				]
			: [];
	});
}

test.describe("signaling through one kind of server", () => {
	test("trackers only: the pages connect, and no Nostr relay is used", async ({
		browser,
	}) => {
		const tracker = new RelayHub("tracker", TRACKERS);
		const { host, guest } = await connectedPair(browser, {
			tracker,
			nostr: null,
		});
		for (const player of [host, guest]) {
			expect(tracker.received(player.label)).toBeGreaterThan(0);
			expect(await relayCounts(player.page)).toEqual([1, 1, 0, 0]);
		}
	});

	test("Nostr relays only: the pages connect, and no tracker is used", async ({
		browser,
	}) => {
		const nostr = new RelayHub("nostr", NOSTR_RELAYS);
		const { host, guest } = await connectedPair(browser, {
			tracker: null,
			nostr,
		});
		for (const player of [host, guest]) {
			expect(nostr.received(player.label)).toBeGreaterThan(0);
			expect(await relayCounts(player.page)).toEqual([0, 0, 1, 1]);
		}
	});
});

test.describe("signaling through trackers and Nostr relays together", () => {
	test("each pair of pages keeps exactly one connection", async ({
		browser,
	}) => {
		const tracker = new RelayHub("tracker", TRACKERS);
		const nostr = new RelayHub("nostr", NOSTR_RELAYS);
		const { host, guest } = await connectedPair(browser, { tracker, nostr });
		for (const player of [host, guest]) {
			expect(tracker.received(player.label)).toBeGreaterThan(0);
			expect(nostr.received(player.label)).toBeGreaterThan(0);
			expect(await relayCounts(player.page)).toEqual([1, 1, 1, 1]);
		}
		// Both kinds go on announcing; a second link would appear in this time.
		await host.page.waitForTimeout(5_000);
		for (const player of [host, guest])
			expect([await peers(player.page), await links(player.page)]).toEqual([
				1, 1,
			]);
	});

	test("after a network change, a page with half-open relay sockets connects again at once", async ({
		browser,
	}) => {
		const tracker = new RelayHub("tracker", TRACKERS);
		const nostr = new RelayHub("nostr", NOSTR_RELAYS);
		const { host, guest } = await connectedPair(browser, { tracker, nostr });
		// The guest's network changes: its links fail, and its relay sockets look open but pass nothing.
		tracker.silence(guest.label);
		nostr.silence(guest.label);
		await guest.page.evaluate(() =>
			(window.lbHarness as Harness).dropLinks({ keepRelays: true }),
		);
		// Without the network event, the guest stays alone past its first rejoin (REJOIN_MS): it announces only
		// on the dead sockets.
		await guest.page.waitForTimeout(12_000);
		expect(await peers(guest.page)).toBe(0);
		const changedAt = Date.now();
		await guest.page.evaluate(() => window.dispatchEvent(new Event("online")));
		await expect
			.poll(async () => [await peers(guest.page), await links(guest.page)], {
				timeout: CONNECT_MS,
			})
			.toEqual([1, 1]);
		// New sockets replaced the dead ones at once, not after the reconnect wait.
		for (const hub of [tracker, nostr]) {
			const opened = hub.lastOpened(guest.label) ?? 0;
			expect(opened, hub.kind).toBeGreaterThanOrEqual(changedAt);
			expect(opened - changedAt, hub.kind).toBeLessThan(1_000);
		}
		expect(await peers(host.page)).toBe(1);
	});
});
