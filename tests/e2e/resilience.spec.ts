import { expect, type Page, test } from "@playwright/test";
import { HOST_LOST_MS } from "../../src/p2p/limits";
import { Player, type RigOptions, reportNetwork } from "./player";
import {
	CONNECT_MS,
	createRoom,
	expectAllConnected,
	expectBanner,
	expectSeat,
	MESSAGE,
	makeCall,
	pick,
	picks,
	type SeatKey,
	sendDraft,
	texts,
} from "./room";

/**
 * Failures around the table (plan §9): the relays go down, the browser does not store data, the link is old,
 * of another version or damaged, and the table expires. Each test has its own browsers. The relays and the
 * peers are the real ones.
 */

const all: Player[] = [];
const current: Player[] = [];
let openBrowser: (name: string, rig?: RigOptions) => Promise<Player>;

/** Every table older than this is expired (8 h without activity, plan §4.7). */
const AGED_MS = 9 * 60 * 60 * 1_000;

/**
 * Moves the last activity of every table stored in this browser back by 9 h, as on a device that last played 9 hours
 * ago. The page must be at the app's origin. The records stay valid, so the app reads them as usual.
 */
async function ageStoredTables(page: Page): Promise<number> {
	return page.evaluate(
		(aged) =>
			new Promise<number>((resolve, reject) => {
				const opened = indexedDB.open("opentrick-p2p");
				opened.onerror = () => reject(opened.error);
				opened.onsuccess = () => {
					const db = opened.result;
					const tx = db.transaction("tables", "readwrite");
					const store = tx.objectStore("tables");
					let changed = 0;
					const cursor = store.openCursor();
					cursor.onsuccess = () => {
						const row = cursor.result;
						if (!row) return;
						row.update({ ...row.value, lastActivityAt: Date.now() - aged });
						changed += 1;
						row.continue();
					};
					tx.oncomplete = () => {
						db.close();
						resolve(changed);
					};
					tx.onerror = () => reject(tx.error);
				};
			}),
		AGED_MS,
	);
}

test.beforeAll(({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	openBrowser = async (name, rig = {}) => {
		const player = await Player.open(browser, baseURL, name, {}, rig);
		all.push(player);
		current.push(player);
		return player;
	};
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern as the first parameter.
test.afterEach(async ({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus) await reportNetwork(current);
	for (const player of current.splice(0)) await player.close();
});

test("a relay outage keeps the table: messages, the deal and the auction go on; a newcomer finds the table afterwards", async () => {
	test.setTimeout(180_000);
	const seats = ["W", "N", "E", "S"] as const satisfies readonly SeatKey[];
	const browsers = {} as Record<SeatKey, Player>;
	const tab = {} as Record<SeatKey, Page>;
	for (const seat of seats)
		browsers[seat] = await openBrowser(seat, { relaySwitch: true });
	tab.W = await browsers.W.page("./");
	const link = await createRoom(tab.W);
	for (const seat of ["N", "E"] as const) {
		tab[seat] = await browsers[seat].page(link);
		await expect(tab[seat].getByTestId(`pick-${seat}`)).toBeVisible({
			timeout: CONNECT_MS,
		});
		await pick(tab[seat], seat);
	}
	// South is the only free seat in the host's lobby, so the page takes it by itself.
	tab.S = await browsers.S.page(link);
	await expectSeat(tab.S, "S", { timeout: CONNECT_MS });
	for (const seat of seats)
		await expectAllConnected(tab[seat], true, {
			timeout: CONNECT_MS,
		});

	for (const seat of seats) await browsers[seat].network.block();
	const cutAt = Date.now();
	const expected: string[] = [];
	for (const seat of seats) {
		await sendDraft(tab[seat]);
		expected.push(MESSAGE[seat]);
		for (const other of seats)
			await expect(texts(tab[other])).toHaveText(expected);
	}
	// The hosting page deals the first board by itself, so there is no click here.
	for (const seat of seats)
		await expect(tab[seat].getByTestId("table")).toHaveAttribute(
			"data-phase",
			"auction",
		);
	// Board 1: North deals and calls first.
	await makeCall(tab.N, "1C");
	for (const seat of seats)
		await expect(tab[seat].getByTestId("table")).toHaveAttribute(
			"data-at",
			"1",
		);
	// Longer than a host loss (HOST_LOST_MS) and the roster coalesce: nobody counts as gone without the relays.
	await expect
		.poll(() => Date.now() - cutAt, { timeout: HOST_LOST_MS + 15_000 })
		.toBeGreaterThan(HOST_LOST_MS + 2_000);
	for (const seat of seats) {
		await expect(
			tab[seat].getByTestId("roster").locator('li[data-state="online"]'),
		).toHaveCount(4);
		await expect(tab[seat].getByTestId("banner")).toBeHidden();
	}

	for (const seat of seats) browsers[seat].network.unblock();
	const newcomer = await (await openBrowser("newcomer")).page(link);
	await expect(newcomer.getByText("All seats are taken.")).toBeVisible({
		timeout: 90_000,
	});
});

test("a browser that does not store data cannot create a table, but it can take a seat and play; it cannot become the host", async () => {
	test.setTimeout(120_000);
	const west = await openBrowser("west");
	const creator = await west.page("./");
	const link = await createRoom(creator);
	const blocked = await openBrowser("blocked", { blockSiteData: true });

	const create = await blocked.page("./");
	// The solo form and the multiplayer form each say why they cannot start.
	for (const errors of ["solo-errors", "errors"])
		await expect(
			create
				.getByTestId(errors)
				.getByText(
					"This browser does not allow storing data, so it cannot create a table.",
					{ exact: true },
				),
		).toBeVisible();
	await expect(create.getByTestId("create-solo")).toBeDisabled();
	await expect(create.getByTestId("create")).toBeDisabled();
	await create.close();

	const page = await blocked.page(link);
	await expect(
		page.getByText(/^This browser does not store data \(/),
	).toBeVisible({ timeout: CONNECT_MS });
	await expect(page.getByTestId("pick-N")).toBeVisible({ timeout: CONNECT_MS });
	await pick(page, "N");
	await sendDraft(page);
	await expect(texts(creator)).toHaveText([MESSAGE.N]);
	await sendDraft(creator);
	await expect(texts(page)).toHaveText([MESSAGE.N, MESSAGE.W]);

	await creator.close({ runBeforeUnload: false });
	await expectBanner(page, "waiting-for-host");
	const become = page.getByTestId("become-host");
	await expect(become).toBeVisible({ timeout: 30_000 });
	await expect(become).toBeDisabled();
	await expect(page.getByTestId("banner")).toContainText(
		"This browser cannot store the table",
	);
});

test("a link with the 32-byte key of an earlier version is not valid", async () => {
	const page = await (await openBrowser("visitor")).page(
		`./#v=p2p-v1&k=${"A".repeat(43)}`,
	);
	await expect(
		page.getByText("This link is not valid. Check that you copied all of it."),
	).toBeVisible();
});

test("a damaged key opens an empty table: nobody is there", async () => {
	const west = await openBrowser("west");
	const creator = await west.page("./");
	const link = await createRoom(creator);
	// The same length and alphabet, the first key character changed: another table. The last character holds
	// only 4 key bits, so a change there can make the link not valid instead.
	// The query has "k=" too (bot_fallback=), so the search starts at the fragment.
	const at = link.indexOf("k=", link.indexOf("#")) + 2;
	const first = link[at] === "A" ? "B" : "A";
	const damaged = `${link.slice(0, at)}${first}${link.slice(at + 1)}`;
	expect(new URL(damaged).search).toBe(new URL(link).search);
	expect(new URL(damaged).hash).not.toBe(new URL(link).hash);
	const page = await (await openBrowser("visitor")).page(damaged);
	await expect(page.getByText("Nobody is at this table right now")).toBeVisible(
		{ timeout: CONNECT_MS },
	);
	// The damaged link keeps the room setup, so the page offers the four seats of that setup while no host answers
	// (ADR 0005).
	await expect(picks(page)).toHaveCount(4);
	// The real table is unaffected.
	await expectSeat(creator, "W");
});

test("a table without activity for 8 h expires and stays expired", async () => {
	const west = await openBrowser("west");
	const page = await west.page("./");
	const link = await createRoom(page);
	await sendDraft(page);
	await page.goto("./");
	expect(await ageStoredTables(page)).toBe(1);
	// Only the key: a link with the complete room setup starts the room again (ADR 0005, checked below).
	const parsed = new URL(link);
	await page.goto(`${parsed.origin}${parsed.pathname}${parsed.hash}`);
	await expect(
		page.getByRole("heading", {
			name: "The game has expired or is no longer available",
		}),
	).toBeVisible({ timeout: CONNECT_MS });
	await expect(
		page.getByRole("button", { name: "Create new game" }),
	).toBeVisible();
	// The table is deleted and a tombstone keeps the link expired.
	await page.reload();
	await expect(
		page.getByRole("heading", {
			name: "The game has expired or is no longer available",
		}),
	).toBeVisible({ timeout: CONNECT_MS });
	await page.getByRole("button", { name: "Create new game" }).click();
	await expect(page.getByTestId("create")).toBeVisible();
	// The room link clears the tombstone and offers the four seats of its setup again.
	await page.goto(link);
	await expect(picks(page)).toHaveCount(4, { timeout: CONNECT_MS });
});

test("no uncaught errors", () => {
	expect(all.flatMap((player) => player.errors)).toEqual([]);
});
