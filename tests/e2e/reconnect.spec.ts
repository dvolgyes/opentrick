import { expect, type Locator, type Page, test } from "@playwright/test";
import { freeze } from "./lifecycle";
import { Player, reportNetwork } from "./player";
import {
	CONNECT_MS,
	createRoom,
	defendersLine,
	expectAllConnected,
	expectBanner,
	expectContract,
	expectSeat,
	hostRows,
	lines,
	makeCall,
	pick,
	pressOffScreen,
	rosterSeat,
	type SeatKey,
	scoringLine,
	texts,
	typeOffScreen,
} from "./room";

/**
 * Connection loss and reconnection in the UI (plan §12 R1 and R4), on one table through the public trackers. Each
 * test builds on the table of the tests before it. Every person has their own browser. A crash closes the tab
 * without unload handlers; a reopen is a new tab of the same browser, so its stored replica and seat come back.
 * Every check of the transcript compares the whole list, so a message that is missing, doubled or out of order
 * fails it (R3).
 */
test.describe.configure({ mode: "serial" });

const SEATS = ["W", "N", "E", "S"] as const satisfies readonly SeatKey[];
/** Board 1: North deals and declares 1♣, so South is dummy. */
const DUMMY = "S";
/** A seat shows offline 20 s after its last beat; a beat comes every 10 s, plus the 1 s roster coalesce. */
const QUIET_MS = 35_000;
/** The become-host button shows at 10 s without a host; the automatic volunteer starts at 30 s. */
const BUTTON_LATEST_MS = 30_000;

const players = {} as Record<SeatKey, Player>;
const tab = {} as Record<SeatKey, Page>;
/** The seats whose tab is open. */
const open = new Set<SeatKey>();
let link = "";
const expected: string[] = [];

const table = (page: Page): Locator => page.getByTestId("table");
const prompt = (page: Page): Locator => page.getByTestId("table-prompt");
const playable = (page: Page): Locator => page.locator("button.card:enabled");

function openSeats(): SeatKey[] {
	return SEATS.filter((seat) => open.has(seat));
}

async function crash(seat: SeatKey): Promise<void> {
	await tab[seat].close({ runBeforeUnload: false });
	open.delete(seat);
}

async function reopen(seat: SeatKey): Promise<void> {
	tab[seat] = await players[seat].page(link);
	await expectSeat(tab[seat], seat, {
		timeout: CONNECT_MS,
	});
	open.add(seat);
}

/** Types the text into the seat's message box and clicks Send. A send clears the box, so each message is typed. */
async function type(seat: SeatKey, text: string): Promise<void> {
	await typeOffScreen(tab[seat], text);
	await pressOffScreen(tab[seat].getByTestId("send"));
}

/** Sends a message and waits until the sender's transcript shows it; the message joins the expected transcript. */
async function say(seat: SeatKey, text: string): Promise<void> {
	const before = await lines(tab[seat]).count();
	await type(seat, text);
	await expect(lines(tab[seat])).toHaveCount(before + 1, {
		timeout: CONNECT_MS,
	});
	expected.push(text);
}

async function expectTranscripts(): Promise<void> {
	for (const seat of openSeats())
		await expect(texts(tab[seat])).toHaveText(expected, {
			timeout: CONNECT_MS,
		});
}

/** Every open tab names the same host. Returns its seat. */
async function commonHost(): Promise<SeatKey> {
	const [first, ...others] = openSeats();
	if (!first) throw new Error("no open tab");
	await expect(hostRows(tab[first])).toHaveCount(1, { timeout: CONNECT_MS });
	const seat = await hostRows(tab[first]).getAttribute("data-seat");
	if (seat !== "W" && seat !== "N" && seat !== "E" && seat !== "S")
		throw new Error(`no host seat: ${seat}`);
	for (const other of others)
		await expect(hostRows(tab[other])).toHaveAttribute("data-seat", seat, {
			timeout: CONNECT_MS,
		});
	return seat;
}

/** Every open tab shows the page at `seat` as the host. */
async function expectHost(seat: SeatKey): Promise<void> {
	for (const open of openSeats())
		await expect(hostRows(tab[open])).toHaveAttribute("data-seat", seat, {
			timeout: CONNECT_MS,
		});
}

/** Every open tab shows the board at the position: the number of calls and cards made. */
async function expectAt(board: number, at: number): Promise<void> {
	for (const seat of openSeats()) {
		await expect(table(tab[seat])).toHaveAttribute(
			"data-board",
			String(board),
			{
				timeout: CONNECT_MS,
			},
		);
		await expect(table(tab[seat])).toHaveAttribute("data-at", String(at), {
			timeout: CONNECT_MS,
		});
	}
}

/**
 * The one open tab that asks its player to act: its title starts with "TURN - " (src/ui/room-view.ts). The
 * table prompt says "Your turn" only in the play; in the auction it names the bidder on every page.
 */
async function actor(): Promise<SeatKey> {
	let asked: SeatKey[] = [];
	await expect
		.poll(
			async () => {
				asked = [];
				for (const seat of openSeats())
					if ((await tab[seat].title()).startsWith("TURN - ")) asked.push(seat);
				return asked.length;
			},
			{ timeout: CONNECT_MS },
		)
		.toBe(1);
	const [seat] = asked;
	if (!seat) throw new Error("nobody is asked to act");
	return seat;
}

/** At the position, the seat asked to act clicks the call. Returns that seat. */
async function call(board: number, at: number, code: string): Promise<SeatKey> {
	await expectAt(board, at);
	const seat = await actor();
	await makeCall(tab[seat], code);
	return seat;
}

/** At the position on board 1, the seat asked to act plays the first card its tab offers. Returns that seat. */
async function playFirst(at: number): Promise<SeatKey> {
	await expectAt(1, at);
	const seat = await actor();
	await playable(tab[seat]).first().click();
	return seat;
}

test.beforeAll(async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	for (const [seat, name] of [
		["W", "west"],
		["N", "north"],
		["E", "east"],
		["S", "south"],
	] as const)
		players[seat] = await Player.open(browser, baseURL, name);
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern as the first parameter.
test.afterEach(async ({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus)
		await reportNetwork(Object.values(players));
});

test.afterAll(async () => {
	for (const player of Object.values(players)) await player.close();
});

test("1: four browsers sit down at one table", async () => {
	tab.W = await players.W.page("./");
	link = await createRoom(tab.W);
	open.add("W");
	for (const seat of ["N", "E"] as const) {
		tab[seat] = await players[seat].page(link);
		await expect(tab[seat].getByTestId(`pick-${seat}`)).toBeVisible({
			timeout: CONNECT_MS,
		});
		await pick(tab[seat], seat);
		open.add(seat);
	}
	// South is the last free seat, so its page takes it without a picker.
	tab.S = await players.S.page(link);
	await expectSeat(tab.S, "S", {
		timeout: CONNECT_MS,
	});
	open.add("S");
	for (const seat of SEATS)
		await expectAllConnected(tab[seat], true, {
			timeout: CONNECT_MS,
		});
	// The host deals board 1 automatically once all four seats are present.
	await expectAt(1, 0);
});

test("2: a follower that crashes, or reloads, gets the messages it missed, each once and in order", async () => {
	await crash("N");
	for (const seat of ["W", "E", "S"] as const)
		await say(seat, `${seat}: North is away`);
	await reopen("N");
	await expectTranscripts();

	const reloading = tab.E.reload();
	await say("S", "S: East reloads");
	await reloading;
	await expectSeat(tab.E, "E", {
		timeout: CONNECT_MS,
	});
	await expectTranscripts();

	await say("N", "N: back");
	await expectTranscripts();
});

test("3: the host crashes mid-auction; a player clicks Make me the host, and the seat next in priority takes over; the auction goes on until West is to bid; the old host reopens, hosts again, and bids", async () => {
	test.setTimeout(180_000);
	expect(await call(1, 0, "1C")).toBe("N");
	await expectAt(1, 1);
	await crash("W");
	await expectBanner(tab.E, "waiting-for-host");
	const become = tab.E.getByTestId("become-host");
	await expect(become).toBeEnabled({ timeout: BUTTON_LATEST_MS });
	await become.click();
	// The link names West as the host seat, so North comes first after West (ADR 0007, election rule 12): it takes
	// over from East at once.
	await expectHost("N");
	// The new host keeps the board, and East and South bid while West is away (R4).
	expect(await call(1, 1, "P")).toBe("E");
	expect(await call(1, 2, "P")).toBe("S");
	// West is to bid, so the auction waits for West, and no open tab asks its player to act.
	await expectAt(1, 3);
	for (const seat of openSeats()) {
		await expect(prompt(tab[seat])).toHaveText(
			"Waiting for West to come back",
			{ timeout: CONNECT_MS },
		);
		expect(await tab[seat].title()).not.toMatch(/^TURN - /);
	}

	await reopen("W");
	// West comes first in the order of priority, so it takes over from North when it comes back (rule 12).
	await expectHost("W");
	await expect(tab.W.getByTestId("banner")).toBeHidden({ timeout: CONNECT_MS });
	expect(await call(1, 3, "P")).toBe("W");
	await expectAt(1, 4);
	for (const seat of SEATS) {
		await expect(table(tab[seat])).toHaveAttribute("data-phase", "play");
		await expectContract(tab[seat], "1♣", "North");
	}
});

test("4: dummy crashes during the play: declarer plays on; the next board is dealt and its auction waits for dummy; dummy returns with everything it missed (R4)", async () => {
	test.setTimeout(300_000);
	await crash(DUMMY);
	for (let at = 4; at < 56; at += 1) {
		const seat = await playFirst(at);
		expect(seat, "dummy is away").not.toBe(DUMMY);
	}
	await expectAt(1, 56);
	// Each page shows the result from its own side; North declares, so North's line is the declarers' line.
	await expect(scoringLine(tab.N)).toBeVisible();
	const declarers = (await scoringLine(tab.N).innerText()).trim();
	expect(declarers).toMatch(/^(?:WON: Made (?:contract|\+\d)|LOST: Down \d+)$/);
	for (const seat of openSeats()) {
		await expect(table(tab[seat])).toHaveAttribute("data-phase", "complete");
		await expectContract(tab[seat], "1♣", "North");
		await expect(scoringLine(tab[seat])).toHaveText(
			seat === "N" ? declarers : defendersLine(declarers),
		);
	}
	const sheet = await tab.W.getByTestId("scores").innerText();
	// After the 10 s countdown, the host deals board 2 without a click while South is away. East deals board 2
	// and opens; South is next, so the auction waits for South.
	expect(await call(2, 0, "1D")).toBe("E");
	await expectAt(2, 1);
	for (const seat of openSeats())
		await expect(prompt(tab[seat])).toHaveText(
			"Waiting for South to come back",
			{ timeout: CONNECT_MS },
		);

	// South comes back to the score sheet and the call that it missed, and bids.
	await reopen(DUMMY);
	await expectAt(2, 1);
	await expect(tab.S.getByTestId("scores")).toHaveText(sheet, {
		useInnerText: true,
	});
	expect(await call(2, 1, "P")).toBe("S");
	await expectAt(2, 2);
	for (const seat of SEATS)
		await expect(table(tab[seat])).toHaveAttribute("data-phase", "auction");
});

test("5: three players crash while one stays; its message waits; after they reopen, all four have the same table", async () => {
	test.setTimeout(180_000);
	await crash("W");
	await crash("E");
	await crash("N");
	await expectBanner(tab.S, "waiting-for-host");
	const alone = "S: the others are away";
	await type("S", alone);
	const waiting = tab.S.getByTestId("pending").locator("li");
	await expect(waiting).toHaveAttribute("data-state", "pending");
	await expect(waiting).toContainText(alone);
	await expect(texts(tab.S)).toHaveText(expected);

	for (const seat of ["W", "N", "E"] as const) await reopen(seat);
	expected.push(alone);
	await expectTranscripts();
	await expect(waiting).toHaveCount(0);
	test.info().annotations.push({
		type: "host after the reopen",
		description: await commonHost(),
	});
	await expectAt(2, 2);
	for (const seat of SEATS)
		await expect(table(tab[seat])).toHaveAttribute("data-phase", "auction");
});

test("6: a frozen player shows offline, and after the thaw it has everything it missed", async () => {
	test.setTimeout(120_000);
	const host = await commonHost();
	const frozen = (["N", "W", "S"] as const).find((seat) => seat !== host);
	if (!frozen) throw new Error("no follower to freeze");
	const thaw = await freeze(tab[frozen]);
	for (const seat of openSeats())
		if (seat !== frozen) await say(seat, `${seat}: ${frozen} is frozen`);
	await expect(rosterSeat(tab[host], frozen)).toHaveAttribute(
		"data-state",
		"offline",
		{ timeout: QUIET_MS },
	);
	await thaw();
	await expectTranscripts();
	for (const seat of SEATS)
		await expect(
			tab[seat].getByTestId("roster").locator('li[data-state="online"]'),
		).toHaveCount(4, { timeout: CONNECT_MS });
	await expect(tab[frozen].getByTestId("banner")).toBeHidden();
	// Board 2: East and South have bid, so West bids next; the thawed tab sees the call.
	expect(await call(2, 2, "P")).toBe("W");
	await expectAt(2, 3);
});

test("no uncaught errors", () => {
	expect(Object.values(players).flatMap((player) => player.errors)).toEqual([]);
});
