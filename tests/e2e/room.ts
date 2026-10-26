import { expect, type Locator, type Page } from "@playwright/test";

/** Page helpers shared by the browser tests. They use only what a person sees and clicks. */

/** The default player name of each seat. */
export const NAME = {
	W: "player4",
	N: "player1",
	E: "player3",
	S: "player2",
} as const;

/** The prefilled test message of each seat. */
export const MESSAGE = {
	W: "Connection test from West",
	N: "Connection test from North",
	E: "Connection test from East",
	S: "Connection test from South",
} as const;

export type SeatKey = keyof typeof NAME;

/** The seat label of the hands and the call tiles, for example "N - player1". */
export const seatLabel = (seat: SeatKey): string => `${seat} - ${NAME[seat]}`;

/**
 * The wait for a link between two pages, as in p2p-mesh.spec.ts. A link whose first WebRTC exchange fails comes
 * back through a two-page room after about 25 s (src/p2p/mesh.ts); the rest is room for a slow tracker.
 */
export const CONNECT_MS = 45_000;

export const lines = (page: Page): Locator =>
	page.getByTestId("transcript").locator("li");

export const texts = (page: Page): Locator => lines(page).locator(".text");

/** The seats that the person can choose. The seat page shows the taken seats too, but disabled. */
export const picks = (page: Page): Locator =>
	page.locator('[data-testid^="pick-"]:enabled');

export const rosterSeat = (page: Page, seat: SeatKey): Locator =>
	page.getByTestId("roster").locator(`li[data-seat="${seat}"]`);

/** The roster rows with the Host tag: one row when the page knows the host. */
export const hostRows = (page: Page): Locator =>
	page
		.getByTestId("roster")
		.locator("li")
		.filter({ has: page.locator(".tag", { hasText: /^Host$/ }) });

const TABLE_LINK =
	/^http:\/\/localhost:\d+\/?\?.*#v=p2p-v1&k=[A-Za-z0-9_-]{43}$/;

/**
 * Creates a table with the default names. The creator sits West and enters the game directly.
 * Returns the unselected room URL that all players share.
 */
export async function createRoom(page: Page): Promise<string> {
	for (const [seat, name] of Object.entries(NAME))
		await page.locator(`input[name="name-${seat}"]`).fill(name);
	await page.locator('input[name="me"][value="W"]').check();
	// Chrome's mobile emulation reports the form below the screenshot viewport; activate its native submit control.
	await page
		.getByTestId("create")
		.evaluate((button) => (button as HTMLButtonElement).click());
	await expect(page).toHaveTitle(/player4 \(W\)$/);
	await expect(page).toHaveURL(/\?.*#v=p2p-v1&k=[A-Za-z0-9_-]{43}$/);
	const linkUrl = new URL(page.url());
	linkUrl.searchParams.delete("selected_player");
	const link = linkUrl.toString();
	expect(link).toMatch(TABLE_LINK);
	expect(linkUrl.searchParams.has("selected_player")).toBe(false);
	return link;
}

export async function pick(
	page: Page,
	seat: SeatKey,
	timeout = CONNECT_MS,
): Promise<void> {
	const title = new RegExp(`${NAME[seat]} \\(${seat}\\)$`);
	const button = page.getByTestId(`pick-${seat}`);
	// The seats wait for the host's lobby, and the page takes the only free seat of the lobby by itself (ADR 0005).
	await expect
		.poll(
			async () =>
				title.test(await page.title()) ||
				(await button.isEnabled({ timeout: 100 }).catch(() => false)),
			{ timeout },
		)
		.toBe(true);
	if (!title.test(await page.title())) await button.click();
	await expect(page).toHaveTitle(title);
}

const STRAIN_NAME: Readonly<Record<string, string>> = {
	C: "Clubs",
	D: "Diamonds",
	H: "Hearts",
	S: "Spades",
	NT: "No trump",
};
const SPECIAL_NAME: Readonly<Record<string, string>> = {
	P: "Pass",
	X: "Double",
	XX: "Redouble",
};

/**
 * Makes the call `code` ("1C", "3NT", "P", "X", "XX") in the bid box as a player does: the level and the
 * strain, or the special call, then Confirm, which carries the chosen call (src/ui/table.ts).
 */
export async function makeCall(page: Page, code: string): Promise<void> {
	const box = page.getByTestId("bid-box");
	const special = SPECIAL_NAME[code];
	const bid = /^([1-7])(C|D|H|S|NT)$/.exec(code);
	if (special !== undefined) {
		await box.getByRole("button", { name: special, exact: true }).click();
	} else if (bid?.[1] !== undefined && bid[2] !== undefined) {
		const strain = STRAIN_NAME[bid[2]] ?? bid[2];
		await box
			.getByRole("button", { name: `Level ${bid[1]}`, exact: true })
			.click();
		await box.getByRole("button", { name: strain, exact: true }).click();
	} else throw new Error(`not a call: ${code}`);
	await box.locator(`button.confirm[data-call="${code}"]`).click();
}

/**
 * Waits until the sidebar header shows the contract `bid` ("1♣") and its declarer's seat name ("North"). The header
 * keeps the bid, "by" and the declarer in separate parts (src/ui/table.ts).
 */
export async function expectContract(
	page: Page,
	bid: string,
	direction: string,
): Promise<void> {
	const head = page.getByTestId("contract-head");
	await expect(head.locator(".bid")).toHaveText(bid);
	await expect(head.locator(".declarer")).toHaveText(
		new RegExp(`^${direction}\\b`),
	);
}

/** The result line of a finished board, from this page's side: "WON: Made +1", "LOST: Opponents down 2". */
export const scoringLine = (page: Page): Locator =>
	page.getByTestId("scoring").locator(".scoring-result");

/**
 * The defenders' result line for the declarer side's line: the outcome flips, and the detail names the
 * opponents ("WON: Made +1" becomes "LOST: Opponents made +1").
 */
export function defendersLine(declarers: string): string {
	const parts = /^(WON|LOST): (Made|Down) (.+)$/.exec(declarers);
	if (!parts) throw new Error(`not a declarer result line: ${declarers}`);
	const outcome = parts[1] === "WON" ? "LOST" : "WON";
	return `${outcome}: Opponents ${parts[2]?.toLowerCase()} ${parts[3]}`;
}

/** One side's column of the "Previous game statistics" table. */
export interface SideStatistics {
	readonly won: number;
	readonly lost: number;
	readonly total: number;
}

/** Reads the "Previous game statistics" table: deals won, deals lost and total score of each side. */
export async function readStatistics(
	page: Page,
): Promise<{ ew: SideStatistics; ns: SideStatistics }> {
	const rows = await page
		.getByTestId("scores")
		.locator("tbody tr")
		.evaluateAll((items) =>
			items.map((row) => [
				row.querySelector("th")?.textContent ?? "",
				...[...row.querySelectorAll("td")].map((cell) =>
					Number(cell.textContent),
				),
			]),
		);
	const row = (label: string): readonly (string | number)[] => {
		const found = rows.find((cells) => cells[0] === label);
		if (!found) throw new Error(`the statistics table has no "${label}" row`);
		return found;
	};
	const side = (column: number): SideStatistics => ({
		won: Number(row("Deals won")[column]),
		lost: Number(row("Deals lost")[column]),
		total: Number(row("Total score")[column]),
	});
	return { ew: side(1), ns: side(2) };
}

/** Waits until this page holds the seat: the title names the player and the seat, and the roster tags the row "You". */
export async function expectSeat(
	page: Page,
	seat: SeatKey,
	options: { timeout?: number } = {},
): Promise<void> {
	await expect(page).toHaveTitle(
		new RegExp(`${NAME[seat]} \\(${seat}\\)$`),
		options,
	);
	await expect(
		rosterSeat(page, seat).locator(".tag", { hasText: /^You$/ }),
	).toBeAttached(options);
}

/**
 * Waits until the seat's replica holds the table: the table leaves its loading phase. The host stores a seat claim
 * before it answers the claimer, so from then on the replica binds the seat to this page. A pick alone does not:
 * the page takes the seat lock at once, and the host's reply comes later.
 */
export async function expectReplica(
	page: Page,
	options: { timeout?: number } = {},
): Promise<void> {
	await expect(page.getByTestId("table")).toHaveAttribute(
		"data-phase",
		/^(waiting|auction|play|complete)$/,
		options,
	);
}

/*
 * The player list, the messages and the links sit in an area that the table layout keeps off screen
 * (src/ui/style.css `.room-extra`), so a person cannot reach them. The tests still use the chat and the seat release
 * as protocol probes, and these helpers operate their controls through the DOM.
 */

/** Waits until the off-screen control is enabled, then clicks it. */
export async function pressOffScreen(control: Locator): Promise<void> {
	await expect(control).toBeEnabled();
	await control.evaluate((node) => (node as HTMLButtonElement).click());
}

/** Types the text into the off-screen message box. */
export async function typeOffScreen(page: Page, text: string): Promise<void> {
	const draft = page.getByTestId("draft");
	await expect(draft).toBeEditable();
	await draft.evaluate((node, value) => {
		(node as HTMLTextAreaElement).value = value;
	}, text);
}

/**
 * Checks the "All players connected" note. It is off screen, so the check reads the `hidden` attribute, which the
 * page sets from the table state.
 */
export async function expectAllConnected(
	page: Page,
	connected: boolean,
	options: { timeout?: number } = {},
): Promise<void> {
	const note = page.getByTestId("all-connected");
	await expect(note).toBeAttached(options);
	if (connected) await expect(note).not.toHaveAttribute("hidden", options);
	else await expect(note).toHaveAttribute("hidden", "", options);
}

/** Sends the prefilled message and waits until this tab shows it in the transcript. */
export async function sendDraft(page: Page): Promise<void> {
	const before = await lines(page).count();
	await pressOffScreen(page.getByTestId("send"));
	await expect(lines(page)).toHaveCount(before + 1);
}

export async function expectBanner(
	page: Page,
	kind: string,
	options: { timeout?: number } = {},
): Promise<void> {
	await expect(page.getByTestId("banner")).toHaveAttribute(
		"data-kind",
		kind,
		options,
	);
}
