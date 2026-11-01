import {
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import type { CallRecords } from "../../src/call/record";
import type { SubmitResult } from "../../src/p2p/outbox";
import type { TableView } from "../../src/p2p/table";
import type { Seat } from "../../src/protocol";
import {
	caption,
	counts,
	exactCaption,
	installCallProbe,
	joinButton,
	joinWith,
	leaveButton,
	note,
	panel,
	peerAudioGrowth,
	requestsFor,
	SEAT_NAMES,
	SOUND,
} from "./call-probe";
import type { CallReceived, CallView, Harness } from "./harness/main";
import { Player, reportNetwork } from "./player";
import { HARNESS_URL as HARNESS } from "./ports";
import {
	CONNECT_MS,
	createRoom,
	expectSeat,
	pick,
	pressOffScreen,
	rosterSeat,
	type SeatKey,
	seatLabel,
} from "./room";

/**
 * Call lifecycle, adversarial and partial-failure rows (call/layout plan C7), on one P2P table through the public
 * trackers. West, North and East are app players that may use the microphone (a generated tone). South is first a
 * modified client: a harness page (tests/e2e/harness) that holds the seat and sends raw call frames past call
 * signaling. A frame goes to every connected page, so the probe's count of arriving call frames is the positive
 * control: it shows that a frame reached the browser, so "nothing changed" is a real outcome.
 */
test.describe.configure({ mode: "serial" });

const SEATS = ["W", "N", "E", "S"] as const satisfies readonly SeatKey[];
const IN_CALL = ["W", "N", "E"] as const satisfies readonly SeatKey[];

/** A closed page goes offline in the roster (acceptance.spec.ts), and then out of the call (VANISHED_MS 10 s). */
const GONE_MS = 40_000;

interface HarnessPage {
	readonly context: BrowserContext;
	readonly page: Page;
}

const players = {} as Record<"W" | "N" | "E", Player>;
const tab = {} as Record<SeatKey, Page>;
let newcomer: Player;
let south: HarnessPage;
let visitor: HarnessPage | undefined;
let link = "";
let tableKey = "";
/** The console text of every page. It is only matched, never printed: it could name an address. */
const consoleTexts: string[] = [];
const harnessErrors: string[] = [];

async function openPage(player: Player, url: string): Promise<Page> {
	const page = await player.page(url);
	page.on("console", (message) => consoleTexts.push(message.text()));
	return page;
}

/** A harness page in its own context, so with its own holder. */
async function openHarness(browser: Browser): Promise<HarnessPage> {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on("console", (message) => consoleTexts.push(message.text()));
	page.on("pageerror", (error) => harnessErrors.push(error.message));
	await page.goto(HARNESS);
	await page.waitForFunction(() => window.lbHarness !== undefined);
	return { context, page };
}

function harnessView(page: Page): Promise<TableView | null> {
	return page.evaluate(() => (window.lbHarness as Harness).view());
}

function callView(page: Page): Promise<CallView> {
	return page.evaluate(() => (window.lbHarness as Harness).callView());
}

/**
 * The peers that passed the connection check with the harness page. A page without a seat has no replica, so its
 * view binds no peer to a seat.
 */
async function readyPeers(page: Page): Promise<number> {
	const view = await harnessView(page);
	return (view?.peers ?? []).filter((peer) => peer.check?.state === "ready")
		.length;
}

/** The harness page takes `seat` from the lobby and waits until its commands reach the host. */
async function takeSeat(page: Page, seat: Seat): Promise<void> {
	await page.evaluate(
		(key) => (window.lbHarness as Harness).openTable(key),
		tableKey,
	);
	await expect
		.poll(async () => (await harnessView(page))?.lobby !== null, {
			timeout: CONNECT_MS,
		})
		.toBe(true);
	expect(
		await page.evaluate(
			(chosen) => (window.lbHarness as Harness).choose(chosen),
			seat,
		),
	).toEqual({ ok: true });
	await expect
		.poll(
			async () => {
				const view = await harnessView(page);
				return { seat: view?.seat, ready: view?.ready };
			},
			{ timeout: CONNECT_MS },
		)
		.toEqual({ seat, ready: true });
}

/** One raw call frame from the harness page; see `Harness.callRaw`. */
function raw(
	page: Page,
	to: Seat,
	toGen: number,
	fromGen: number,
	msg: unknown,
): Promise<void> {
	return page.evaluate(
		([to, toGen, fromGen, msg]) =>
			(window.lbHarness as Harness).callRaw(to, toGen, fromGen, msg),
		[to, toGen, fromGen, msg] as const,
	);
}

/** Each seat's generation, as South's harness page knows them. */
async function generations(): Promise<Record<SeatKey, number>> {
	const { holders } = await callView(south.page);
	const generation = (seat: SeatKey): number => {
		const value = holders[seat];
		if (value === undefined) throw new Error(`${seat} has no holder`);
		return value;
	};
	return {
		W: generation("W"),
		N: generation("N"),
		E: generation("E"),
		S: generation("S"),
	};
}

/** The call frames that arrived at each tab so far. */
async function receivedBy(
	seats: readonly SeatKey[],
): Promise<Record<string, number>> {
	const received: Record<string, number> = {};
	for (const seat of seats)
		received[seat] = (await counts(tab[seat])).callReceived;
	return received;
}

/** Waits until each tab received at least `sent` more call frames than `before`. */
async function expectArrived(
	before: Record<string, number>,
	sent: number,
): Promise<void> {
	for (const seat of IN_CALL)
		await expect
			.poll(async () => (await counts(tab[seat])).callReceived, {
				message: `${seat} receives every frame`,
			})
			.toBeGreaterThanOrEqual((before[seat] ?? 0) + sent);
}

/** The seats that the call note names as connected, sorted. */
async function connectedTo(page: Page): Promise<string[]> {
	const text = (await note(page).textContent()) ?? "";
	return (/Connected to ([^.]*)\./.exec(text)?.[1]?.split(", ") ?? []).sort();
}

const names = (...seats: SeatKey[]): string[] =>
	seats.map((seat) => SEAT_NAMES[seat]).sort();

async function expectConnected(seats: readonly SeatKey[]): Promise<void> {
	for (const seat of seats)
		await expect
			.poll(() => connectedTo(tab[seat]), { timeout: CONNECT_MS })
			.toEqual(names(...seats.filter((other) => other !== seat)));
}

/** What each in-call tab shows of the call: connections, captions and the note. */
async function callScene(
	seats: readonly SeatKey[],
): Promise<Record<string, unknown>> {
	const scene: Record<string, unknown> = {};
	for (const seat of seats) {
		const page = tab[seat];
		const { peers, openPeers } = await counts(page);
		const captions: string[] = [];
		for (const other of SEATS)
			if (other !== seat)
				captions.push((await caption(page, other).textContent()) ?? "");
		scene[seat] = {
			peers,
			openPeers,
			captions,
			note: await note(page).textContent(),
		};
	}
	return scene;
}

/** A call announcement that would put South in the call with audio, if it were valid. */
const ANNOUNCE = {
	prefs: {
		inCall: true,
		send: { audio: true, video: false },
		receive: { audio: true, video: false },
	},
	prefVersion: 1,
	form: "desktop",
};

const session = (): string => crypto.randomUUID();

const table = (page: Page) => page.getByTestId("table");

// Addresses in the text a person or a report could see: IPv4, IPv6 (full or with "::"), and the mDNS names that
// browsers give as host candidates.
const ADDRESS_PATTERNS = [
	/(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/,
	/(?<![0-9a-z:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?|::[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)(?![0-9a-z:])/i,
	/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local\b/i,
];

const hasAddress = (text: string): boolean =>
	ADDRESS_PATTERNS.some((pattern) => pattern.test(text));

/** The number of texts in the page (the body text, every attribute and field value) that contain an address. */
function addressHits(page: Page): Promise<number> {
	return page.evaluate(
		(patterns) => {
			const expressions = patterns.map(
				({ source, flags }) => new RegExp(source, flags),
			);
			const values = [document.title, document.body.innerText];
			for (const element of document.querySelectorAll("*")) {
				for (const attribute of element.attributes)
					values.push(attribute.value);
				if (element instanceof HTMLInputElement) values.push(element.value);
			}
			return values.filter((value) =>
				expressions.some((expression) => expression.test(value)),
			).length;
		},
		ADDRESS_PATTERNS.map(({ source, flags }) => ({ source, flags })),
	);
}

test.beforeAll(async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	for (const seat of IN_CALL) {
		players[seat] = await Player.open(browser, baseURL, `lifecycle-${seat}`, {
			permissions: ["microphone"],
		});
		await players[seat].addInitScript(installCallProbe);
	}
	newcomer = await Player.open(browser, baseURL, "lifecycle-newcomer", {
		permissions: ["microphone"],
	});
	await newcomer.addInitScript(installCallProbe);
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern as the first parameter.
test.afterEach(async ({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus)
		await reportNetwork([...Object.values(players), newcomer]);
});

test.afterAll(async () => {
	for (const player of [...Object.values(players), newcomer])
		await player?.close();
	await south?.context.close();
	await visitor?.context.close();
});

test("1: West, North and East join with audio; South's seat is held by a modified client outside the call", async ({
	browser,
}) => {
	tab.W = await openPage(players.W, "./");
	link = await createRoom(tab.W);
	for (const seat of ["N", "E"] as const) {
		tab[seat] = await openPage(players[seat], link);
		await pick(tab[seat], seat);
	}
	const key = new URLSearchParams(new URL(link).hash.slice(1)).get("k");
	if (!key) throw new Error("the table link has no key");
	tableKey = key;
	south = await openHarness(browser);
	await takeSeat(south.page, "S");
	// The tiles come with the first board, which the hosting page deals once all four seats are present.
	for (const seat of IN_CALL)
		await expect(table(tab[seat])).toHaveAttribute("data-phase", "auction");
	for (const seat of IN_CALL) await joinWith(tab[seat], "Audio only");
	await expectConnected(IN_CALL);
	for (const seat of IN_CALL)
		await expect(caption(tab[seat], "S")).toHaveText(
			exactCaption(`${seatLabel("S")} · Not in call`),
		);
});

test("2: frames from a page without a seat, or for another generation, or of an unknown type reach the browsers and change nothing", async ({
	browser,
}) => {
	const page = await openHarness(browser);
	visitor = page;
	await page.page.evaluate(
		(key) => (window.lbHarness as Harness).openTable(key),
		tableKey,
	);
	await expect
		.poll(() => readyPeers(page.page), {
			message: "the visitor reaches all four seats",
			timeout: CONNECT_MS,
		})
		.toBe(SEATS.length);

	const gen = await generations();
	const scene = await callScene(IN_CALL);
	const before = await receivedBy(IN_CALL);
	const join = { type: "join", session: session(), ...ANNOUNCE };
	// Each is a frame for each in-call seat. A frame for another table, or one that names its own sender seat,
	// cannot be sent: the mesh stamps its own table and the receiver takes the seat from the sender's binding.
	const refused: {
		readonly what: string;
		readonly from: Page;
		readonly fromGen: number;
		readonly toLater: number;
		readonly message: unknown;
	}[] = [
		{
			what: "a page without a seat",
			from: page.page,
			fromGen: gen.S,
			toLater: 0,
			message: join,
		},
		{
			what: "a later sender generation",
			from: south.page,
			fromGen: gen.S + 1,
			toLater: 0,
			message: join,
		},
		{
			what: "a later receiver generation",
			from: south.page,
			fromGen: gen.S,
			toLater: 1,
			message: join,
		},
		{
			what: "an unknown type",
			from: south.page,
			fromGen: gen.S,
			toLater: 0,
			message: { type: "hello", session: session() },
		},
		{
			// The media is negotiated on the table connection (ADR 0009); the call has no offer of its own.
			what: "a call offer",
			from: south.page,
			fromGen: gen.S,
			toLater: 0,
			message: {
				type: "offer",
				session: session(),
				negotiation: 1,
				sdp: "v=0",
				...ANNOUNCE,
			},
		},
	];
	for (const forged of refused)
		for (const seat of IN_CALL)
			await raw(
				forged.from,
				seat,
				gen[seat] + forged.toLater,
				forged.fromGen,
				forged.message,
			);

	await expectArrived(before, refused.length * IN_CALL.length);
	await tab.W.waitForTimeout(2_000);
	expect(await callScene(IN_CALL)).toEqual(scene);
	await page.context.close();
	visitor = undefined;
});

test("3: malformed frames from South's own seat reach the browsers and change nothing", async () => {
	const gen = await generations();
	const scene = await callScene(IN_CALL);
	const before = await receivedBy(IN_CALL);
	const toAll: [string, unknown][] = [
		["join without a session", { type: "join", ...ANNOUNCE }],
		[
			"prefs that are not switches",
			{
				type: "prefs",
				session: session(),
				...ANNOUNCE,
				prefs: { inCall: "yes" },
			},
		],
		[
			"resync with a session that is not a UUID",
			{ type: "resync", session: "not-a-session", ...ANNOUNCE },
		],
		[
			"join with a negative prefVersion",
			{ type: "join", session: session(), ...ANNOUNCE, prefVersion: -1 },
		],
		[
			"join with an unknown form",
			{ type: "join", session: session(), ...ANNOUNCE, form: "tablet" },
		],
		["leave without a session", { type: "leave" }],
	];
	for (const [, message] of toAll)
		for (const seat of IN_CALL)
			await raw(south.page, seat, gen[seat], gen.S, message);

	await expectArrived(before, toAll.length * IN_CALL.length);
	await tab.W.waitForTimeout(1_500);
	expect(await callScene(IN_CALL)).toEqual(scene);
});

test("4: a valid join from South opens links; after South goes and its seat is released, the new holder stays outside despite the old holder's stored status", async () => {
	test.setTimeout(240_000);
	const peers = {
		N: (await counts(tab.N)).peers,
		E: (await counts(tab.E)).peers,
	};
	// The positive control: South's own join through call signaling reaches each in-call seat. North and East
	// add the media sections to their table connection to South (the earlier seat adds them); West waits for
	// South's sections.
	await south.page.evaluate(() => (window.lbHarness as Harness).callOpen());
	await south.page.evaluate(() => (window.lbHarness as Harness).callSend(null));
	for (const seat of IN_CALL)
		await expect(caption(tab[seat], "S")).not.toHaveText(
			`${seatLabel("S")} · Not in call`,
		);
	for (const seat of ["N", "E"] as const)
		await expect
			.poll(async () => (await counts(tab[seat])).peers)
			.toBe(peers[seat] + 1);
	await expect
		.poll(async () => {
			const received: readonly CallReceived[] = await south.page.evaluate(() =>
				(window.lbHarness as Harness).callReceived(),
			);
			return [...new Set(received.map((message) => message.from))].sort();
		})
		.toEqual(["E", "N", "W"]);

	// The old holder's stored status is in the call, with audio.
	const stored: SubmitResult = await south.page.evaluate(() =>
		(window.lbHarness as Harness).sendMedia(1, false),
	);
	expect(stored).toEqual({ ok: true });
	await expect
		.poll(async () => {
			const records: CallRecords = await south.page.evaluate(() =>
				(window.lbHarness as Harness).media(),
			);
			return records.S?.prefs.inCall;
		})
		.toBe(true);

	await south.context.close();
	for (const seat of IN_CALL)
		await expect(caption(tab[seat], "S")).toHaveText(
			exactCaption(`${seatLabel("S")} · Not in call`),
			{
				timeout: GONE_MS,
			},
		);
	for (const seat of ["N", "E"] as const)
		await expect.poll(async () => (await counts(tab[seat])).openPeers).toBe(2);
	await expect(rosterSeat(tab.W, "S")).toHaveAttribute(
		"data-state",
		"offline",
		{
			timeout: GONE_MS,
		},
	);
	await pressOffScreen(tab.W.getByTestId("release-S"));
	await pressOffScreen(tab.W.getByTestId("confirm-release-S"));
	await expect(rosterSeat(tab.W, "S")).toHaveAttribute("data-state", "free");

	tab.S = await openPage(newcomer, link);
	await pick(tab.S, "S");
	// The stored status belongs to the previous holder: no call, no capture, no call frame.
	await tab.S.waitForTimeout(3_000);
	await expect(panel(tab.S)).toHaveAttribute("data-status", "outside");
	await expect(joinButton(tab.S)).toBeEnabled();
	expect(await counts(tab.S)).toMatchObject({
		peers: 0,
		captures: 0,
		liveTracks: 0,
		callSent: 0,
	});
	expect(await requestsFor(tab.S, "audio")).toBe(0);
	for (const seat of IN_CALL)
		await expect(caption(tab[seat], "S")).toHaveText(
			exactCaption(`${seatLabel("S")} · Not in call`),
		);

	await joinWith(tab.S, "Audio only");
	await expectConnected(SEATS);
});

test("5: when one player leaves, the other three pairs keep their sound", async () => {
	await leaveButton(tab.S).click();
	for (const seat of IN_CALL) {
		await expect.poll(async () => (await counts(tab[seat])).openPeers).toBe(2);
		await expect(caption(tab[seat], "S")).toHaveText(
			exactCaption(`${seatLabel("S")} · Not in call`),
		);
	}
	for (const seat of IN_CALL) {
		const growth = await peerAudioGrowth(tab[seat]);
		expect(growth, `${seat}: audio bytes in 2 s per open link`).toHaveLength(2);
		for (const bytes of growth)
			expect(bytes, `${seat}: audio bytes in 2 s`).toBeGreaterThan(SOUND);
	}
});

test("6: leaving the room during the call ends the tracks and the media; back in the room, the player rejoins with the stored status", async () => {
	await tab.E.evaluate(() => {
		location.hash = "";
	});
	await expect(tab.E.getByTestId("create")).toBeVisible();
	await expect(table(tab.E)).toHaveCount(0);
	await expect(panel(tab.E)).toHaveCount(0);
	await expect
		.poll(async () => {
			const { openPeers, liveTracks } = await counts(tab.E);
			return { openPeers, liveTracks };
		})
		.toEqual({ openPeers: 0, liveTracks: 0 });
	// Trystero can keep a connection open for a while after the room is left; no audio arrives on it.
	await expect
		.poll(async () => Math.max(0, ...(await peerAudioGrowth(tab.E, true))), {
			timeout: 20_000,
		})
		.toBeLessThan(100);
	for (const seat of ["W", "N"] as const) {
		await expect(caption(tab[seat], "E")).toHaveText(
			exactCaption(`${seatLabel("E")} · Not in call`),
			{
				timeout: GONE_MS,
			},
		);
		await expect.poll(async () => (await counts(tab[seat])).openPeers).toBe(1);
	}

	await tab.E.evaluate((hash) => {
		location.hash = hash;
	}, new URL(link).hash);
	await expectSeat(tab.E, "E", {
		timeout: CONNECT_MS,
	});
	// East joined with audio in test 1 and did not leave the call, so its stored status brings it back.
	await expect(leaveButton(tab.E)).toBeVisible({ timeout: CONNECT_MS });
	await expectConnected(IN_CALL);
});

test("7: no page and no console message shows an address", async () => {
	// The detector finds documentation addresses (RFC 5737, RFC 3849) and an mDNS name, and nothing else here.
	for (const sample of [
		"from 192.0.2.1 port 9",
		"2001:db8::1",
		"fe80::1",
		"2001:db8:0:0:0:0:0:1",
		"0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.local",
	])
		expect(hasAddress(sample), "a sample address is found").toBe(true);
	for (const sample of ["12:30:45", "1♣ by North", "v1.2.3", "Note::"])
		expect(hasAddress(sample), "a sample without an address").toBe(false);

	for (const [what, page] of Object.entries(tab))
		expect(await addressHits(page), `texts of ${what}`).toBe(0);
	expect(
		consoleTexts.filter(hasAddress).length,
		"console messages with an address",
	).toBe(0);
});

test("8: no page reported an error", () => {
	for (const player of [...Object.values(players), newcomer]) {
		expect(player.errors).toEqual([]);
	}
	expect(harnessErrors).toEqual([]);
});
