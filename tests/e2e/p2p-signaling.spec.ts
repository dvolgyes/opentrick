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
 * Discovery through each kind of signaling server (ADR 0004): trackers only, Nostr relays only, MQTT brokers only,
 * and all three in one strategy, with fake servers in the test process (tests/e2e/relay-hub.ts). The WebRTC links are real Chrome links
 * without STUN, so the pages of one machine connect by their host addresses. Each player is one browser context.
 */

const TRACKERS = ["wss://tracker.hub.test"];
const NOSTR_RELAYS = ["wss://nostr.hub.test"];
const MQTT_BROKERS = ["wss://mqtt.hub.test/mqtt"];
const CONNECT_MS = 30_000;

interface Player {
	readonly label: string;
	readonly context: BrowserContext;
	readonly page: Page;
}

interface Relays {
	readonly tracker: RelayHub | null;
	readonly nostr: RelayHub | null;
	readonly mqtt: RelayHub | null;
}

const NONE = { tracker: null, nostr: null, mqtt: null } as const;

/** One hub of each kind. */
function allHubs(): { tracker: RelayHub; nostr: RelayHub; mqtt: RelayHub } {
	return {
		tracker: new RelayHub("tracker", TRACKERS),
		nostr: new RelayHub("nostr", NOSTR_RELAYS),
		mqtt: new RelayHub("mqtt", MQTT_BROKERS),
	};
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
 * Counts the page's links to other pages: `lbLinks` the RTCPeerConnections in the "connected" state now,
 * `lbEverConnected` those that reached it at any time, also when they closed later. Trystero reads the global
 * constructor for each connection, so the subclass sees every one of them. Most connections never connect: Trystero
 * makes offers before it knows a peer. The WebRTC check of the page (src/p2p/webrtc-check.ts) connects two
 * connections of the page to each other; a connection whose remote certificate fingerprint is the local one of
 * another connection of the page is not a link.
 */
function countLinks(): void {
	const native = window.RTCPeerConnection;
	const made: RTCPeerConnection[] = [];
	const links = new Set<RTCPeerConnection>();
	const fingerprint = (description: RTCSessionDescription | null) =>
		/^a=fingerprint:(.+)$/m.exec(description?.sdp ?? "")?.[1];
	window.RTCPeerConnection = class extends native {
		constructor(configuration?: RTCConfiguration) {
			super(configuration);
			made.push(this);
			this.addEventListener("connectionstatechange", () => {
				if (this.connectionState !== "connected") return;
				const remote = fingerprint(this.remoteDescription);
				if (
					remote === undefined ||
					!made.some(
						(other) =>
							other !== this && fingerprint(other.localDescription) === remote,
					)
				)
					links.add(this);
			});
		}
	};
	const counters = window as unknown as {
		lbLinks: () => number;
		lbEverConnected: () => number;
	};
	counters.lbLinks = () =>
		[...links].filter((link) => link.connectionState === "connected").length;
	counters.lbEverConnected = () => links.size;
}

/** Servers that do not work, in front of the hub of a kind in its list. */
type BadServers = Readonly<Record<keyof Relays, readonly string[]>>;

const NO_BAD_SERVERS: BadServers = { tracker: [], nostr: [], mqtt: [] };

/**
 * For each kind: a name that does not exist (RFC 6761), an address that does not answer (RFC 5737), a port that
 * refuses the connection, a web server that refuses the WebSocket upgrade, and a socket that opens and sends
 * nothing.
 */
const BAD_SERVERS: BadServers = Object.fromEntries(
	(["tracker", "nostr", "mqtt"] as const).map((kind) => [
		kind,
		[
			`wss://no-such-${kind}.invalid/`,
			`wss://192.0.2.1:8443/${kind}`,
			`wss://127.0.0.1:9/${kind}`,
			`wss://google.com/opentrick-${kind}`,
			`wss://silent-${kind}.hub.test/`,
		],
	]),
) as unknown as BadServers;

/** The bad servers of the kinds that have a hub. */
function badServersOf(relays: Relays): BadServers {
	return {
		tracker: relays.tracker ? BAD_SERVERS.tracker : [],
		nostr: relays.nostr ? BAD_SERVERS.nostr : [],
		mqtt: relays.mqtt ? BAD_SERVERS.mqtt : [],
	};
}

async function newPlayer(
	browser: Browser,
	label: string,
	relays: Relays,
	bad: BadServers = NO_BAD_SERVERS,
): Promise<Player> {
	const context = await browser.newContext();
	contexts.push(context);
	await context.addInitScript(countLinks);
	// The silent sockets: Playwright opens a routed socket for the page and passes nothing to or from it.
	await context.routeWebSocket(/^wss:\/\/silent-[a-z]+\.hub\.test\//, () => {});
	await relays.tracker?.install(context, label);
	await relays.nostr?.install(context, label);
	await relays.mqtt?.install(context, label);
	const page = await context.newPage();
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const list = (kind: keyof Relays): string => {
		const urls = [...bad[kind], ...(relays[kind]?.urls ?? [])];
		return urls.length > 0 ? urls.join(",") : "none";
	};
	const query = new URLSearchParams({
		trackers: list("tracker"),
		nostr: list("nostr"),
		mqtt: list("mqtt"),
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

function everConnected(page: Page): Promise<number> {
	return page.evaluate(() =>
		(window as unknown as { lbEverConnected: () => number }).lbEverConnected(),
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
	bad: BadServers = NO_BAD_SERVERS,
): Promise<{ readonly host: Player; readonly guest: Player }> {
	const host = await newPlayer(browser, "host", relays, bad);
	const guest = await newPlayer(browser, "guest", relays, bad);
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

/**
 * The relay counts that each page shows: [trackers open, trackers, Nostr relays open, Nostr relays, MQTT brokers
 * open, MQTT brokers].
 */
function relayCounts(page: Page): Promise<number[]> {
	return page.evaluate(() => {
		const network = (window.lbHarness as Harness).view()?.network;
		return network
			? [
					network.trackersOpen,
					network.trackers,
					network.nostrOpen,
					network.nostrRelays,
					network.mqttOpen,
					network.mqttBrokers,
				]
			: [];
	});
}

test.describe("signaling through one kind of server", () => {
	test("trackers only: the pages connect, and no Nostr relay is used", async ({
		browser,
	}) => {
		const tracker = new RelayHub("tracker", TRACKERS);
		const { host, guest } = await connectedPair(browser, { ...NONE, tracker });
		for (const player of [host, guest]) {
			expect(tracker.received(player.label)).toBeGreaterThan(0);
			expect(await relayCounts(player.page)).toEqual([1, 1, 0, 0, 0, 0]);
		}
	});

	test("Nostr relays only: the pages connect, and no tracker is used", async ({
		browser,
	}) => {
		const nostr = new RelayHub("nostr", NOSTR_RELAYS);
		const { host, guest } = await connectedPair(browser, { ...NONE, nostr });
		for (const player of [host, guest]) {
			expect(nostr.received(player.label)).toBeGreaterThan(0);
			expect(await relayCounts(player.page)).toEqual([0, 0, 1, 1, 0, 0]);
		}
	});

	test("MQTT brokers only: the pages connect, and no tracker or Nostr relay is used", async ({
		browser,
	}) => {
		const mqtt = new RelayHub("mqtt", MQTT_BROKERS);
		const { host, guest } = await connectedPair(browser, { ...NONE, mqtt });
		for (const player of [host, guest]) {
			expect(mqtt.received(player.label)).toBeGreaterThan(0);
			expect(await relayCounts(player.page)).toEqual([0, 0, 0, 0, 1, 1]);
		}
	});
});

test.describe("signaling through trackers, Nostr relays and MQTT brokers together", () => {
	test("each pair of pages keeps exactly one connection", async ({
		browser,
	}) => {
		const hubs = allHubs();
		const { host, guest } = await connectedPair(browser, hubs);
		for (const player of [host, guest]) {
			for (const hub of Object.values(hubs))
				expect(hub.received(player.label), hub.kind).toBeGreaterThan(0);
			expect(await relayCounts(player.page)).toEqual([1, 1, 1, 1, 1, 1]);
		}
		// All kinds go on announcing: in the first 10 s each relay announces at about 0, 0.2, 0.8, 2 and 7 s. A
		// second link from any of these announces counts, also when the page closed it again.
		await host.page.waitForTimeout(10_000);
		for (const player of [host, guest])
			expect(
				[
					await peers(player.page),
					await links(player.page),
					await everConnected(player.page),
				],
				player.label,
			).toEqual([1, 1, 1]);
	});

	const changes = [
		{
			name: "a network change",
			signal: () => window.dispatchEvent(new Event("online")),
		},
		{
			name: "a resume after a freeze",
			signal: () => document.dispatchEvent(new Event("resume")),
		},
	];
	for (const change of changes)
		test(`after ${change.name}, a page with half-open relay sockets connects again at once`, async ({
			browser,
		}) => {
			const hubs = allHubs();
			const { host, guest } = await connectedPair(browser, hubs);
			// The guest's network changes: its links fail, and its relay sockets look open but pass nothing.
			for (const hub of Object.values(hubs)) hub.silence(guest.label);
			await guest.page.evaluate(() =>
				(window.lbHarness as Harness).dropLinks({ keepRelays: true }),
			);
			// Without the network event, the guest stays alone past its first rejoin (REJOIN_MS): it announces only
			// on the dead sockets.
			await guest.page.waitForTimeout(12_000);
			expect(await peers(guest.page)).toBe(0);
			const changedAt = Date.now();
			await guest.page.evaluate(change.signal);
			await expect
				.poll(async () => [await peers(guest.page), await links(guest.page)], {
					timeout: CONNECT_MS,
				})
				.toEqual([1, 1]);
			// New sockets replaced the dead ones at once, not after the reconnect wait.
			for (const hub of Object.values(hubs)) {
				const opened = hub.lastOpened(guest.label) ?? 0;
				expect(opened, hub.kind).toBeGreaterThanOrEqual(changedAt);
				expect(opened - changedAt, hub.kind).toBeLessThan(1_000);
			}
			expect(await peers(host.page)).toBe(1);
			// The count keeps a link that closed: the dropped link and its replacement, nothing more.
			expect(await everConnected(guest.page)).toBe(2);
		});
});

test.describe("signaling with servers that do not work in each list", () => {
	// Each list has five servers that do not work (BAD_SERVERS) before the one hub. Only the hub and the silent socket
	// are open; the pages connect through the hub as fast as with the hub alone.
	const cases: readonly {
		name: string;
		relays: () => Relays;
		open: number[];
	}[] = [
		{
			name: "trackers only",
			relays: () => ({ ...NONE, tracker: allHubs().tracker }),
			open: [2, 6, 0, 0, 0, 0],
		},
		{
			name: "Nostr relays only",
			relays: () => ({ ...NONE, nostr: allHubs().nostr }),
			open: [0, 0, 2, 6, 0, 0],
		},
		{
			name: "MQTT brokers only",
			relays: () => ({ ...NONE, mqtt: allHubs().mqtt }),
			open: [0, 0, 0, 0, 2, 6],
		},
		{ name: "all three kinds", relays: allHubs, open: [2, 6, 2, 6, 2, 6] },
	];
	for (const item of cases)
		test(`${item.name}: the pages connect through the one working server`, async ({
			browser,
		}) => {
			const relays = item.relays();
			const startedAt = Date.now();
			const { host, guest } = await connectedPair(
				browser,
				relays,
				badServersOf(relays),
			);
			expect(Date.now() - startedAt).toBeLessThan(15_000);
			for (const player of [host, guest]) {
				for (const hub of Object.values(relays))
					if (hub)
						expect(hub.received(player.label), hub.kind).toBeGreaterThan(0);
				expect(await relayCounts(player.page)).toEqual(item.open);
			}
		});

	test("all three kinds: after a minute of failing servers, a latecomer connects and the pair keeps its link", async ({
		browser,
	}) => {
		test.setTimeout(150_000);
		const hubs = allHubs();
		const host = await newPlayer(browser, "host", hubs, BAD_SERVERS);
		const guest = await newPlayer(browser, "guest", hubs, BAD_SERVERS);
		const { key } = await host.page.evaluate(() =>
			(window.lbHarness as Harness).createTable("N"),
		);
		await guest.page.evaluate(
			(link) => (window.lbHarness as Harness).openTable(link),
			key,
		);
		await expect.poll(() => peers(guest.page), { timeout: CONNECT_MS }).toBe(1);
		// Past the connect timeout of mqtt.js (30 s), which closes the silent broker socket, and past several retries
		// of the other servers.
		await host.page.waitForTimeout(50_000);
		const late = await newPlayer(browser, "late", hubs, BAD_SERVERS);
		await late.page.evaluate(
			(link) => (window.lbHarness as Harness).openTable(link),
			key,
		);
		for (const player of [host, guest, late])
			await expect
				.poll(
					async () => [await peers(player.page), await links(player.page)],
					{
						message: `${player.label} sees the other two`,
						timeout: CONNECT_MS,
					},
				)
				.toEqual([2, 2]);
		expect(await everConnected(guest.page)).toBe(2);
	});

	test("control: with only the servers that do not work, the pages do not connect", async ({
		browser,
	}) => {
		const host = await newPlayer(browser, "host", NONE, BAD_SERVERS);
		const guest = await newPlayer(browser, "guest", NONE, BAD_SERVERS);
		const { key } = await host.page.evaluate(() =>
			(window.lbHarness as Harness).createTable("N"),
		);
		await guest.page.evaluate(
			(link) => (window.lbHarness as Harness).openTable(link),
			key,
		);
		await guest.page.waitForTimeout(15_000);
		expect([await peers(host.page), await peers(guest.page)]).toEqual([0, 0]);
	});
});
