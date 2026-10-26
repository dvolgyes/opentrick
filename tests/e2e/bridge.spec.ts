import { expect, type Locator, type Page, test } from "@playwright/test";
import { type Card, isCard } from "../../src/bridge/cards";
import { Player, reportNetwork } from "./player";
import {
	CONNECT_MS,
	createRoom,
	defendersLine,
	expectContract,
	expectSeat,
	makeCall,
	pick,
	readStatistics,
	type SeatKey,
	scoringLine,
} from "./room";

/**
 * Bridge acceptance on the peer-to-peer table (plan §9). Four browsers play board 1 to the end, each tab taking
 * the first action it offers, then pass out board 2. Each test builds on the table of the tests before it.
 * Board 1: North deals and opens 1♣, the others pass, so North declares, South is dummy and East leads.
 * A modified client is a real page whose disabled card button is enabled and clicked: the page's own handler
 * sends the play, and the host must refuse it.
 */
test.describe.configure({ mode: "serial" });

const SEATS = ["N", "E", "S", "W"] as const satisfies readonly SeatKey[];
const DUMMY = "S";
const players = {} as Record<SeatKey, Player>;
const tab = {} as Record<SeatKey, Page>;
/** True after the host refused a card that does not follow suit. */
let revokeRefused = false;
let sheetAfterBoard1 = "";

const table = (page: Page): Locator => page.getByTestId("table");
const prompt = (page: Page): Locator => page.getByTestId("table-prompt");
const hand = (page: Page, seat: SeatKey): Locator =>
	page.getByTestId(`hand-${seat}`);
const cards = (scope: Locator): Locator => scope.locator("button.card");
const playable = (scope: Page | Locator): Locator =>
	scope.locator("button.card:enabled");
const refusals = (page: Page): Locator =>
	page.getByTestId("table-actions").locator('li[data-state="not-accepted"]');

/**
 * The rendered table without this tab's action notes. A refused command is not stored (plan §4.5), so its note
 * lives only in the page and a reload clears it; everything else comes from the replicated table.
 */
const tableText = (page: Page): Promise<string> =>
	table(page).evaluate((node) =>
		Array.from(
			node.querySelectorAll<HTMLElement>(
				":scope > .table-status > *, :scope > :not(.table-status)",
			),
		)
			.filter((part) => part.dataset.testid !== "table-actions")
			.map((part) => part.innerText)
			.join("\n"),
	);

async function cardOf(button: Locator): Promise<Card> {
	const card = await button.getAttribute("data-card");
	if (!isCard(card)) throw new Error(`not a card: ${card}`);
	return card;
}

/** Plays a card that the tab shows disabled, as a modified client could. One task, so no render comes between. */
async function forcePlay(button: Locator): Promise<void> {
	await button.evaluate((node) => {
		if (!(node instanceof HTMLButtonElement)) throw new Error("not a button");
		node.disabled = false;
		node.click();
	});
}

/** Waits until every tab shows the board at the position: the number of calls and cards made. */
async function expectAt(board: number, at: number): Promise<void> {
	for (const seat of SEATS) {
		await expect(table(tab[seat])).toHaveAttribute("data-board", String(board));
		await expect(table(tab[seat])).toHaveAttribute("data-at", String(at));
	}
}

/**
 * The one seat whose tab asks its player to act: its title starts with "TURN - " (src/ui/room-view.ts). The
 * table prompt says "Your turn" only in the play; in the auction it names the bidder on every page. After a
 * reload, no tab asks until the seat is back.
 */
async function actor(): Promise<SeatKey> {
	let asked: SeatKey[] = [];
	await expect
		.poll(
			async () => {
				asked = [];
				for (const seat of SEATS)
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

/**
 * When the seat must follow suit from its own hand and holds other suits, plays one of the other cards as a
 * modified client could. The host must refuse it, and the table must not move.
 */
async function forceRevoke(seat: SeatKey, at: number): Promise<void> {
	const own = hand(tab[seat], seat);
	if ((await playable(own).count()) === 0) return;
	const blocked = own.locator("button.card:disabled");
	if ((await blocked.count()) === 0) return;
	const button = blocked.first();
	const card = await cardOf(button);
	const before = await refusals(tab[seat]).count();
	await forcePlay(button);
	await expect(refusals(tab[seat])).toHaveCount(before + 1);
	await expect(refusals(tab[seat]).last()).toContainText(
		`Not accepted: ${card} does not follow suit`,
	);
	revokeRefused = true;
	await expectAt(1, at);
}

/** At the position on board 1, the seat asked to act plays the first card its tab offers. */
async function playFirst(at: number): Promise<SeatKey> {
	await expectAt(1, at);
	const seat = await actor();
	expect(seat, "dummy's own tab is never asked to play").not.toBe(DUMMY);
	if (!revokeRefused) await forceRevoke(seat, at);
	await playable(tab[seat]).first().click();
	return seat;
}

/** Reloads each tab and checks that it shows the same table as before, once it is connected again. */
async function reloadKeepsTable(
	seats: readonly SeatKey[],
	board: number,
	at: number,
): Promise<void> {
	for (const seat of seats) {
		const page = tab[seat];
		// Just after the previous seat's reload, this page can still wait for that seat ("Waiting for player2 (S) to
		// come back"); compare the steady table, which needs all four seats online.
		await expect(
			page.getByTestId("roster").locator('li[data-state="online"]'),
		).toHaveCount(4, { timeout: CONNECT_MS });
		const before = await tableText(page);
		await page.reload();
		await expectSeat(page, seat, {
			timeout: CONNECT_MS,
		});
		await expect(table(page)).toHaveAttribute("data-at", String(at));
		await expect
			.poll(() => tableText(page), { timeout: CONNECT_MS })
			.toBe(before);
	}
	await expectAt(board, at);
}

test.beforeAll(async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	for (const [seat, name] of [
		["W", "west"],
		["N", "north"],
		["S", "south"],
		["E", "east"],
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

test("1: four browsers sit down; North deals board 1 and each sees only their own hand", async () => {
	tab.W = await players.W.page("./");
	const link = await createRoom(tab.W);
	for (const seat of ["N", "S"] as const) {
		tab[seat] = await players[seat].page(link);
		await expect(tab[seat].getByTestId(`pick-${seat}`)).toBeVisible({
			timeout: CONNECT_MS,
		});
		await pick(tab[seat], seat);
	}
	// East is the last free seat, so its page takes it without a picker.
	tab.E = await players.E.page(link);
	await expectSeat(tab.E, "E", {
		timeout: CONNECT_MS,
	});
	// The host deals board 1 automatically once all four seats are present.
	for (const seat of SEATS)
		await expect(tab[seat].getByTestId("deal")).toBeHidden();
	await expectAt(1, 0);
	const dealt: Card[] = [];
	for (const seat of SEATS) {
		const page = tab[seat];
		await expect(table(page)).toHaveAttribute("data-phase", "auction");
		// The desktop auction shows the board status in the sidebar beside the table (src/ui/table.ts placeStatus).
		await expect(
			page.getByText("Dealer: North", { exact: true }),
		).toBeVisible();
		await expect(page.getByTestId("vulnerability")).toHaveText(
			"N-S not vulnerableE-W not vulnerable",
		);
		await expect(page.getByTestId("deal")).toBeHidden();
		for (const other of SEATS)
			await expect(hand(page, other)).toHaveAttribute(
				"data-visible",
				String(other === seat),
			);
		const own = cards(hand(page, seat));
		await expect(own).toHaveCount(13);
		for (const button of await own.all()) dealt.push(await cardOf(button));
	}
	expect(new Set(dealt).size).toBe(52);
	// The host (West) measures the round trip to each guest and reports it to every page. A guest sees its own round
	// trip beside the host's tile.
	for (const seat of SEATS) {
		for (const other of SEATS.filter((item) => item !== seat)) {
			const quality = tab[seat].getByTestId(`round-trip-${other}`);
			await expect(quality).toBeVisible();
			await expect(quality).toHaveAttribute(
				"title",
				/^Network: (?:excellent|good|average|poor|breaking up)\nRoundtrip: >?\d+\.\d\dsec$/,
			);
		}
	}
});

test("2:the auction 1♣ and three passes; a guest and the host reload mid-auction", async () => {
	expect(await call(1, 0, "1C")).toBe("N");
	expect(await call(1, 1, "P")).toBe("E");
	await expectAt(1, 2);
	await reloadKeepsTable(["S", "W"], 1, 2);
	expect(await call(1, 2, "P")).toBe("S");
	expect(await call(1, 3, "P")).toBe("W");

	await expectAt(1, 4);
	for (const seat of SEATS) {
		const page = tab[seat];
		await expect(table(page)).toHaveAttribute("data-phase", "play");
		// The vulnerability stays in view during play.
		await expect(page.getByTestId("vulnerability")).toBeVisible();
		await expect(page.getByTestId("vulnerability")).toHaveText(
			"N-S not vulnerableE-W not vulnerable",
		);
		await expect(page.getByTestId("auction").locator("tbody td")).toHaveText([
			"1♣",
			"Pass",
			"Pass",
			"Pass",
		]);
		await expectContract(page, "1♣", "North");
		await expect(page.getByTestId("bid-box")).toBeHidden();
	}
});

test("3: East leads; then dummy is shown to everyone and only declarer plays it, even when dummy's tab is modified", async () => {
	await expectAt(1, 4);
	await expect(hand(tab.E, DUMMY)).toHaveAttribute("data-visible", "false");
	expect(await playFirst(4)).toBe("E");

	await expectAt(1, 5);
	for (const seat of SEATS)
		await expect(hand(tab[seat], DUMMY)).toHaveAttribute(
			"data-visible",
			"true",
		);
	// Dummy also sees declarer's hand; the defenders do not.
	for (const seat of SEATS)
		await expect(hand(tab[seat], "N")).toHaveAttribute(
			"data-visible",
			String(seat === "N" || seat === DUMMY),
		);
	await expect(prompt(tab.N)).toHaveText("Your turn: play a card from dummy.");
	await expect(prompt(tab.S)).toHaveText(
		"Waiting for North to play from dummy.",
	);
	// The room always shows the desktop form (src/ui/room-view.ts): a dialog asks about the undo, and the claim uses
	// the sidebar.
	await tab.E.getByTestId("undo-request").click();
	const approval = tab.N.getByRole("dialog", { name: "Undo request" });
	await expect(approval).toBeVisible();
	await expect(approval).toContainText("Do you approve?");
	await approval.getByTestId("approval-accept").click();
	await expectAt(1, 4);
	expect(await playFirst(4)).toBe("E");
	await expectAt(1, 5);
	await expect(approval).toBeHidden();
	const controls = tab.N.locator(".play-controls");
	const claims = tab.N.getByTestId("claim-panel");
	// "Claim …" waits until five tricks or fewer remain (src/ui/table-model.ts); "Claim all" is always there.
	await expect(controls.getByRole("button", { name: "Claim …" })).toBeHidden();
	await controls.getByRole("button", { name: "Claim all" }).click();
	await expect(tab.N.getByTestId("claim-confirm")).toBeVisible();
	await expect(claims).toContainText(
		"Confirm that you claim all 13 remaining tricks.",
	);
	await claims.getByRole("button", { name: "Go back" }).click();
	await expect(tab.N.getByTestId("claim-confirm")).toBeHidden();
	await expect(playable(tab.S)).toHaveCount(0);
	await expect(playable(hand(tab.N, "N"))).toHaveCount(0);
	const fromDummy = playable(hand(tab.N, DUMMY)).first();
	await expect(fromDummy).toBeVisible();
	const card = await cardOf(fromDummy);

	await forcePlay(hand(tab.S, DUMMY).locator(`[data-card="${card}"]`));
	await expect(refusals(tab.S)).toContainText(
		"Not accepted: dummy's cards are played by declarer",
	);
	await expectAt(1, 5);

	expect(await playFirst(5)).toBe("N");
	await expectAt(1, 6);
	await expect(cards(hand(tab.W, DUMMY))).toHaveCount(12);
	await expect(hand(tab.W, DUMMY).locator(`[data-card="${card}"]`)).toHaveCount(
		0,
	);
});

test("4: play to the end of trick 4; the host and declarer reload mid-play", async () => {
	test.setTimeout(240_000);
	for (let at = 6; at < 20; at += 1) await playFirst(at);
	await expectAt(1, 20);
	// In every tab the finished trick 4 leaves the table after a short look, and the tab counts four tricks won: ours
	// and the opponents' together.
	for (const seat of SEATS) {
		await expect(tab[seat].getByTestId("trick").locator(".played")).toHaveCount(
			0,
		);
		const counts = tab[seat]
			.getByTestId("tricks-panel")
			.locator(".tricks-counts strong");
		await expect(counts).toHaveCount(3);
		const [ours, , theirs] = (await counts.allInnerTexts()).map(Number);
		expect(Number(ours) + Number(theirs), seat).toBe(4);
	}
	await reloadKeepsTable(["W", "N"], 1, 20);
});

test("5: the board is played out; the result and the duplicate score agree in every tab", async () => {
	test.setTimeout(300_000);
	for (let at = 20; at < 56; at += 1) await playFirst(at);
	await expectAt(1, 56);

	// Each page shows the result from its own side; North declares, so North's line is the declarers' line.
	await expect(scoringLine(tab.N)).toBeVisible();
	const declarers = (await scoringLine(tab.N).innerText()).trim();
	const scored = /^(?:WON: Made (?:contract|\+(\d))|LOST: Down (\d+))$/.exec(
		declarers,
	);
	expect(scored, declarers).not.toBeNull();
	const [, over, under] = scored ?? [];
	// Board 1 is not vulnerable: 1♣ scores 70 and 20 for each overtrick; each undertrick gives the defenders 50.
	const made = under === undefined;
	const points = made ? 70 + 20 * Number(over ?? 0) : 50 * Number(under);
	const winner = { won: 1, lost: 0, total: points };
	const loser = { won: 0, lost: 1, total: 0 };
	const statistics = made
		? { ns: winner, ew: loser }
		: { ns: loser, ew: winner };
	const sheet = await tab.W.getByTestId("scores").innerText();
	for (const seat of SEATS) {
		const page = tab[seat];
		await expect(table(page)).toHaveAttribute("data-phase", "complete");
		await expectContract(page, "1♣", "North");
		await expect(scoringLine(page)).toHaveText(
			seat === "N" || seat === "S" ? declarers : defendersLine(declarers),
		);
		expect(await readStatistics(page)).toEqual(statistics);
		expect(await page.getByTestId("scores").innerText()).toBe(sheet);
		// The finished board shows the whole deal, and nothing can be played.
		for (const other of SEATS)
			await expect(cards(hand(page, other))).toHaveCount(13);
		// Every hand shows its corrected HCP, "corrected HCP: 15 (13 +2)"; the HCP before the correction add up to 40.
		const pills = await page.locator(".hcp-pill").allInnerTexts();
		expect(pills).toHaveLength(4);
		const hcp = pills.map((pill) => {
			const match = /^corrected HCP: (\d+)(?: \((\d+) [+-]\d+\))?$/.exec(pill);
			if (!match) throw new Error(`not a points pill: ${pill}`);
			return Number(match[2] ?? match[1]);
		});
		expect(hcp.reduce((sum, points) => sum + points, 0)).toBe(40);
		await expect(playable(page)).toHaveCount(0);
		await expect(page.getByTestId("scoring-countdown")).toContainText(
			"Next board 2 in",
		);
	}
	sheetAfterBoard1 = sheet;
	expect(
		revokeRefused,
		"no seat had to follow suit while it held another suit",
	).toBe(true);
});

test("6: board 2 is dealt automatically, East deals, and all four pass: passed out, no score", async () => {
	await expectAt(2, 0);
	for (const seat of SEATS) {
		await expect(
			tab[seat].getByText("Dealer: East", { exact: true }),
		).toBeVisible();
		await expect(tab[seat].getByTestId("vulnerability")).toHaveText(
			"N-S vulnerableE-W not vulnerable",
		);
	}
	expect(await call(2, 0, "P")).toBe("E");
	await expectAt(2, 1);
	// North sits before the dealer and could not call, so a dash; the calls still to come stay empty.
	for (const seat of SEATS)
		await expect(
			tab[seat].getByTestId("auction").locator("tbody td"),
		).toHaveText(["—", "Pass", "", ""]);
	for (const [at, seat] of [
		[1, "S"],
		[2, "W"],
		[3, "N"],
	] as const)
		expect(await call(2, at, "P")).toBe(seat);

	await expectAt(2, 4);
	for (const seat of SEATS) {
		const page = tab[seat];
		await expect(table(page)).toHaveAttribute("data-phase", "complete");
		await expect(scoringLine(page)).toHaveText("PASSED OUT:");
		// A passed-out board scores nothing and counts as won or lost for no side.
		await expect(page.getByTestId("scores")).toHaveText(sheetAfterBoard1, {
			useInnerText: true,
		});
		await expect(page.getByTestId("scoring-countdown")).toContainText(
			"Next board 3 in",
		);
	}
});

test("no uncaught errors", () => {
	const all = Object.values(players);
	expect(all.flatMap((player) => player.errors)).toEqual([]);
});
