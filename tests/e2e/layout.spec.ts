import { expect, type Locator, type Page, test } from "@playwright/test";
import { Player } from "./player";
import {
	CONNECT_MS,
	createRoom,
	makeCall,
	pick,
	type SeatKey,
	seatLabel,
} from "./room";

/**
 * Player-relative layout (call/layout plan C3). Four desktop browsers check the rotation, the tiles and the
 * free space between the table parts. At a second table a phone checks the compact table, and the host's desktop
 * window checks the scaled room canvas. A deal needs all four seats (plan §12 R4), so three of the desktop browsers
 * also sit at the second table.
 * Board 1: North deals; North's tab shows the full bid grid at the start of the auction.
 */
test.describe.configure({ mode: "serial" });

const SEATS = ["N", "E", "S", "W"] as const satisfies readonly SeatKey[];
/** Play goes clockwise, so the next seat sits on the viewer's left. */
const AROUND: Readonly<
	Record<SeatKey, { left: SeatKey; partner: SeatKey; right: SeatKey }>
> = {
	N: { left: "E", partner: "S", right: "W" },
	E: { left: "S", partner: "W", right: "N" },
	S: { left: "W", partner: "N", right: "E" },
	W: { left: "N", partner: "E", right: "S" },
};
/** Portrait phone viewports; a phone held upright gets the compact table at each of them. */
const PHONE_VIEWPORTS = [
	{ width: 320, height: 568 },
	{ width: 360, height: 640 },
	{ width: 390, height: 664 },
] as const;
/** 4:3, Full HD, ultrawide and low desktop viewports used to check the room canvas. */
const CANVAS_VIEWPORTS = [
	{ width: 1440, height: 1080 },
	{ width: 1920, height: 1080 },
	{ width: 2560, height: 1080 },
	{ width: 1910, height: 800 },
] as const;
/** Half a pixel absorbs subpixel rounding of the layout. */
const SUBPIXEL = 0.5;
/** The call controls; each name spells out the way and the medium. */
const DESKTOP_TOGGLES = [
	"Send mic audio",
	"Hear others: receive audio",
	"Send camera video",
	"See cameras: receive video",
] as const;
const COMPACT_TOGGLES = ["Send mic audio", "Hear others: receive audio"];

const players = {} as Record<SeatKey, Player>;
const tab = {} as Record<SeatKey, Page>;
let phone: Player | undefined;
let phoneTab: Page | undefined;

const table = (page: Page): Locator => page.getByTestId("table");
const hand = (page: Page, seat: SeatKey): Locator =>
	page.getByTestId(`hand-${seat}`);
const tile = (page: Page, seat: SeatKey): Locator =>
	page.getByTestId(`tile-${seat}`);
const slot = (page: Page): Locator => page.getByTestId("game-slot");
const byTestId = (id: string): string => `[data-testid="${id}"]`;

interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

const right = (rect: Rect): number => rect.x + rect.width;
const bottom = (rect: Rect): number => rect.y + rect.height;
const middle = (rect: Rect): { x: number; y: number } => ({
	x: rect.x + rect.width / 2,
	y: rect.y + rect.height / 2,
});

/**
 * The boxes, in viewport pixels, of the first element that each CSS selector finds. Each render replaces
 * the table's elements, so all boxes are read in one page call, from one layout; a box read element by
 * element can belong to an element that a render just removed. A missing or undisplayed element has no box.
 */
function measure(
	page: Page,
	selectors: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, Rect>>> {
	return page.evaluate((entries) => {
		const rects: Record<string, Rect> = {};
		for (const [name, selector] of entries) {
			const node = document.querySelector(selector);
			if (!node?.checkVisibility()) continue;
			const { x, y, width, height } = node.getBoundingClientRect();
			rects[name] = { x, y, width, height };
		}
		return rects;
	}, Object.entries(selectors));
}

function shown(rects: Readonly<Record<string, Rect>>, name: string): Rect {
	const rect = rects[name];
	if (!rect) throw new Error(`${name} is not displayed`);
	return rect;
}

/** The area two rectangles share, ignoring a shared edge. */
function overlap(a: Rect, b: Rect): number {
	const width = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
	const height = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
	return width > SUBPIXEL && height > SUBPIXEL ? width * height : 0;
}

/** The displayed parts must not overlap pairwise. */
function expectApart(
	rects: Readonly<Record<string, Rect>>,
	names: readonly string[],
): void {
	const parts = names.filter((name) => rects[name]);
	for (const [index, name] of parts.entries())
		for (const other of parts.slice(index + 1))
			expect(
				overlap(shown(rects, name), shown(rects, other)),
				`${name} overlaps ${other}`,
			).toBe(0);
}

async function expectAt(seats: readonly SeatKey[], at: number): Promise<void> {
	for (const seat of seats)
		await expect(table(tab[seat])).toHaveAttribute("data-at", String(at));
}

/**
 * Desktop parts that must keep apart: hands, tiles, the trick, the call panel and the game-control slot. During the
 * auction the slot holds the bidding history beside the bid box (src/ui/table.ts `bidRow`), so those two are
 * checked against each other instead.
 */
const DESKTOP_PARTS: Readonly<Record<string, string>> = {
	...Object.fromEntries(
		SEATS.map((seat) => [`hand ${seat}`, byTestId(`hand-${seat}`)]),
	),
	...Object.fromEntries(
		SEATS.map((seat) => [`tile ${seat}`, byTestId(`tile-${seat}`)]),
	),
	trick: byTestId("trick"),
	"call panel": byTestId("call-panel"),
	"game slot": byTestId("game-slot"),
};

/**
 * Own hand lowest, partner highest, left opponent leftmost, right opponent rightmost; a tile beside each
 * other hand, as high as a card and 4:3 wide; no two parts of the table overlap.
 */
/**
 * The room canvas takes the scale of a new viewport size at the next `resize` event (src/ui/room-view.ts), which
 * can come after `setViewportSize` returns. Waits until the scale fits the viewport.
 */
async function expectCanvasScaled(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const main = document.querySelector("main");
				if (!main) return false;
				const scale = Number.parseFloat(
					getComputedStyle(main).getPropertyValue("--room-canvas-scale"),
				);
				const fit = Math.min(innerWidth / 1920, innerHeight / 1080);
				return Math.abs(scale - fit) < 1e-6;
			}),
		)
		.toBe(true);
}

async function expectDesktopLayout(viewer: SeatKey): Promise<void> {
	const page = tab[viewer];
	const around = AROUND[viewer];
	const others = SEATS.filter((seat) => seat !== viewer);
	await expect(page.locator(".room")).toHaveAttribute("data-form", "desktop");
	await expectCanvasScaled(page);
	for (const seat of SEATS)
		await expect(hand(page, seat).locator(".seat-label .name")).toHaveText(
			seatLabel(seat),
		);
	for (const seat of others) {
		await expect(tile(page, seat).locator(".avatar")).toHaveText("");
		await expect(tile(page, seat)).toContainText(seatLabel(seat));
	}
	await expect(tile(page, viewer)).toHaveCount(0);

	const rects = await measure(page, {
		...DESKTOP_PARTS,
		auction: byTestId("auction"),
		"bid box": byTestId("bid-box"),
		card: `${byTestId(`hand-${viewer}`)} .face`,
	});
	const handOf = (seat: SeatKey): Rect => shown(rects, `hand ${seat}`);
	const tileOf = (seat: SeatKey): Rect => shown(rects, `tile ${seat}`);
	const at = (seat: SeatKey): { x: number; y: number } => middle(handOf(seat));

	for (const seat of others)
		expect(at(viewer).y, `own hand below ${seat}`).toBeGreaterThan(at(seat).y);
	for (const seat of others.filter((seat) => seat !== around.partner))
		expect(at(around.partner).y, `partner above ${seat}`).toBeLessThan(
			at(seat).y,
		);
	for (const seat of others.filter((seat) => seat !== around.left))
		expect(at(around.left).x, `left opponent left of ${seat}`).toBeLessThan(
			at(seat).x,
		);
	for (const seat of others.filter((seat) => seat !== around.right))
		expect(
			at(around.right).x,
			`right opponent right of ${seat}`,
		).toBeGreaterThan(at(seat).x);

	expect(
		tileOf(around.partner).x,
		"top tile right of the top hand",
	).toBeGreaterThanOrEqual(right(handOf(around.partner)) - SUBPIXEL);
	expect(
		bottom(tileOf(around.left)),
		"left tile above the left hand",
	).toBeLessThanOrEqual(handOf(around.left).y + SUBPIXEL);
	expect(
		tileOf(around.right).y,
		"right tile below the right hand",
	).toBeGreaterThanOrEqual(bottom(handOf(around.right)) - SUBPIXEL);

	const card = shown(rects, "card");
	for (const seat of others) {
		const rect = tileOf(seat);
		// Desktop windows are 40% taller than a card (src/ui/style.css `.video-row .tile`).
		expect(
			Math.abs(rect.height - card.height * 1.4),
			`tile ${seat} height`,
		).toBeLessThanOrEqual(1);
		expect(
			Math.abs(rect.width / rect.height - 4 / 3),
			`tile ${seat} ratio`,
		).toBeLessThanOrEqual(0.02);
	}
	expectApart(rects, Object.keys(DESKTOP_PARTS));
	expectApart(rects, ["auction", "bid box"]);
	expect(await ranksCut(page), "ranks under the next card").toEqual([]);
}

/** The rank labels as the table shows them. */
const RANK_LABELS = [
	"A",
	"K",
	"Q",
	"J",
	"10",
	"9",
	"8",
	"7",
	"6",
	"5",
	"4",
	"3",
	"2",
];

/**
 * The overlapped cards whose visible strip cannot show every rank label in full, with the overflow in pixels.
 * The ink box of the tallest, deepest and widest label is placed at each card's rank baseline and centre line
 * (src/ui/style.css `.face > .rank` centres the label) in its own font, so the result does not depend on the deal
 * or on the device font.
 */
function ranksCut(page: Page): Promise<string[]> {
	return page.evaluate((labels) => {
		const context = document.createElement("canvas").getContext("2d");
		if (!context) throw new Error("no 2D canvas");
		const cut: string[] = [];
		for (const hand of document.querySelectorAll<HTMLElement>(".hand")) {
			const cards = [
				...hand.querySelectorAll<HTMLElement>(":scope > .card"),
			].filter((card) => card.checkVisibility());
			for (const card of cards.slice(0, -1)) {
				const rank = card.querySelector<HTMLElement>(".rank");
				const text = rank?.firstChild;
				if (!rank || !(text instanceof Text)) continue;
				const style = getComputedStyle(rank);
				context.font = style.font;
				context.letterSpacing = style.letterSpacing;
				const ink = labels.map((label) => context.measureText(label));
				const range = document.createRange();
				range.selectNodeContents(text);
				const box = range.getBoundingClientRect();
				const place = rank.getBoundingClientRect();
				// The room canvas is scaled to the window (src/ui/style.css `--room-canvas-scale`): the screen boxes
				// are scaled, the canvas metrics are not.
				const scale = place.width / rank.offsetWidth;
				const baseline = box.top + (ink[0]?.fontBoundingBoxAscent ?? 0) * scale;
				const centre = place.left + place.width / 2;
				const strip = card.getBoundingClientRect();
				const over = Math.max(
					strip.top -
						(baseline -
							Math.max(...ink.map((m) => m.actualBoundingBoxAscent)) * scale),
					baseline +
						Math.max(...ink.map((m) => m.actualBoundingBoxDescent)) * scale -
						strip.bottom,
					Math.max(
						...ink.map(
							(m) => centre + (m.actualBoundingBoxRight - m.width / 2) * scale,
						),
					) - strip.right,
				);
				if (over > 1)
					cut.push(
						`${hand.closest("[data-testid]")?.getAttribute("data-testid")} ${text.data}: ${over.toFixed(1)}px`,
					);
			}
		}
		return cut;
	}, RANK_LABELS);
}

/** The slot shows all of its content: it does not scroll inside itself. */
async function expectSlotWithoutScroll(page: Page): Promise<void> {
	const sizes = await slot(page).evaluate((node) => ({
		scrollHeight: node.scrollHeight,
		clientHeight: node.clientHeight,
	}));
	expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.clientHeight);
}

function pageViewport(page: Page): Promise<{
	innerWidth: number;
	innerHeight: number;
}> {
	return page.evaluate(() => ({
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight,
	}));
}

function expectInside(
	name: string,
	rect: Rect,
	view: { innerWidth: number; innerHeight: number },
): void {
	expect(rect.x, `${name} left edge`).toBeGreaterThanOrEqual(-SUBPIXEL);
	expect(rect.y, `${name} top edge`).toBeGreaterThanOrEqual(-SUBPIXEL);
	expect(right(rect), `${name} right edge`).toBeLessThanOrEqual(
		view.innerWidth + SUBPIXEL,
	);
	expect(bottom(rect), `${name} bottom edge`).toBeLessThanOrEqual(
		view.innerHeight + SUBPIXEL,
	);
}

type DeskPart = "own hand" | "game slot" | "call panel";
const ALL_DESK_PARTS = [
	"own hand",
	"game slot",
	"call panel",
] as const satisfies readonly DeskPart[];

/** The given parts of the viewer's table show in the window without page scroll. */
async function expectDesktopFit(
	viewer: SeatKey,
	parts: readonly DeskPart[],
): Promise<void> {
	const page = tab[viewer];
	await expectCanvasScaled(page);
	await page.evaluate(() => window.scrollTo(0, 0));
	const view = await pageViewport(page);
	const rects = await measure(page, {
		"own hand": byTestId(`hand-${viewer}`),
		"game slot": byTestId("game-slot"),
		"call panel": byTestId("call-panel"),
	});
	for (const name of parts) expectInside(name, shown(rects, name), view);
}

/** A 1366×768 laptop screen less the browser's own bars. */
const LOW_LAPTOP = { width: 1366, height: 650 };

/** The whole room keeps its 1920×1080 layout and fits the viewport without reflow. */
async function expectRoomCanvasFit(page: Page, hosting = false): Promise<void> {
	await expect(page.locator(".room")).toHaveAttribute("data-form", "desktop");
	await expectCanvasScaled(page);
	const geometry = await page.locator(".room").evaluate((node) => {
		const rect = node.getBoundingClientRect();
		const sidebar = node.querySelector(".table-sidebar");
		if (!sidebar) throw new Error("the room sidebar is missing");
		const sidebarRect = sidebar.getBoundingClientRect();
		const videoSlot = node.querySelector(".video-right");
		const felt = videoSlot?.closest(".felt");
		const botControl = videoSlot?.querySelector(".tile-bot-control");
		const main = node.closest("main");
		if (!videoSlot || !felt || !botControl || !main)
			throw new Error("the right player's video slot is missing");
		const scale = Number.parseFloat(
			getComputedStyle(main).getPropertyValue("--room-canvas-scale"),
		);
		return {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			layoutWidth: (node as HTMLElement).offsetWidth,
			layoutHeight: (node as HTMLElement).offsetHeight,
			sidebarLeft: sidebarRect.left,
			sidebarRight: sidebarRect.right,
			sidebarTop: sidebarRect.top,
			sidebarBottom: sidebarRect.bottom,
			rightVideoBottomGap:
				(felt.getBoundingClientRect().bottom -
					videoSlot.getBoundingClientRect().bottom) /
				scale,
			botControlInRightVideo: videoSlot.contains(botControl),
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
		};
	});
	const expectedWidth = Math.min(
		geometry.viewportWidth,
		geometry.viewportHeight * (16 / 9),
	);
	const expectedHeight = expectedWidth * (9 / 16);
	expect(geometry.layoutWidth).toBe(1920);
	expect(geometry.layoutHeight).toBe(1080);
	expect(
		Math.abs(geometry.width - expectedWidth),
		JSON.stringify(geometry),
	).toBeLessThanOrEqual(1);
	expect(Math.abs(geometry.height - expectedHeight)).toBeLessThanOrEqual(1);
	expect(
		Math.abs(geometry.x - (geometry.viewportWidth - expectedWidth) / 2),
	).toBeLessThanOrEqual(1);
	expect(
		Math.abs(geometry.y - (geometry.viewportHeight - expectedHeight) / 2),
	).toBeLessThanOrEqual(1);
	expect(geometry.sidebarLeft).toBeGreaterThanOrEqual(geometry.x - 1);
	expect(geometry.sidebarRight).toBeLessThanOrEqual(
		geometry.x + geometry.width + 1,
	);
	expect(geometry.sidebarTop).toBeGreaterThanOrEqual(geometry.y - 1);
	expect(geometry.sidebarBottom).toBeLessThanOrEqual(
		geometry.y + geometry.height + 1,
	);
	expect(Math.abs(geometry.rightVideoBottomGap - 40)).toBeLessThanOrEqual(1);
	expect(geometry.botControlInRightVideo).toBe(true);
	await expectHeaderRow(page, hosting);
}

/**
 * The build date and the language picker share the sidebar's top row, above its buttons. The host's Debug and Reload
 * players are not in the sidebar: the host opens them with Host controls.
 */
async function expectHeaderRow(page: Page, hosting: boolean): Promise<void> {
	const rects = await measure(page, {
		sidebar: ".table-sidebar",
		version: `.table-sidebar ${byTestId("build-version")}`,
		language: ".table-sidebar select[aria-label=Language]",
		copy: byTestId("copy-board-url"),
		debug: byTestId("debug-export"),
		reload: byTestId("reload-players"),
		hostControls: byTestId("host-controls"),
	});
	const sidebar = shown(rects, "sidebar");
	const version = shown(rects, "version");
	const language = shown(rects, "language");
	const copy = shown(rects, "copy");
	expect(rects.debug, "no Debug in the sidebar").toBeUndefined();
	expect(rects.reload, "no Reload players in the sidebar").toBeUndefined();
	expect(
		rects.hostControls === undefined,
		"Host controls only for the host",
	).toBe(!hosting);
	for (const [name, rect] of [
		["version", version],
		["language", language],
	] as const) {
		expect(rect.x, `${name} left edge`).toBeGreaterThanOrEqual(
			sidebar.x - SUBPIXEL,
		);
		expect(right(rect), `${name} right edge`).toBeLessThanOrEqual(
			right(sidebar) + SUBPIXEL,
		);
		expect(bottom(rect), `${name} above the buttons`).toBeLessThanOrEqual(
			copy.y + SUBPIXEL,
		);
	}
	expect(right(version), "the date before the language").toBeLessThanOrEqual(
		language.x + SUBPIXEL,
	);
	expect(
		Math.min(bottom(version), bottom(language)) -
			Math.max(version.y, language.y),
		"the date and the language in one row",
	).toBeGreaterThan(SUBPIXEL);
}

/**
 * A phone-width window gets the compact table (src/call/device-class.ts): the room is not the scaled Full HD canvas,
 * the page has no horizontal scroll, and each given part lies within the window's width.
 */
async function expectCompactRoom(
	page: Page,
	parts: readonly Locator[] = [],
): Promise<void> {
	await expect(page.locator(".room")).toHaveAttribute("data-form", "compact");
	expect(
		await page.evaluate(() => ({
			overflow:
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
			transform: getComputedStyle(document.querySelector("main") as Element)
				.transform,
		})),
	).toEqual({ overflow: 0, transform: "none" });
	const view = await pageViewport(page);
	for (const part of parts) {
		await expect(part).toBeVisible();
		const box = await part.boundingBox();
		if (!box) throw new Error(`${part} has no box`);
		expect(box.x, `${part} left edge`).toBeGreaterThanOrEqual(-SUBPIXEL);
		expect(box.x + box.width, `${part} right edge`).toBeLessThanOrEqual(
			view.innerWidth + SUBPIXEL,
		);
	}
}

/** Phone viewports held sideways; each gets the desktop table at the size of its screen. */
const SIDEWAYS_VIEWPORTS = [
	{ width: 844, height: 390 },
	{ width: 800, height: 360 },
] as const;

/**
 * A phone held sideways gets the desktop table at the size of its screen (src/call/device-class.ts `layout`): not
 * the scaled Full HD canvas, no page scroll, no video windows, and the call buttons in the sidebar. The viewer's
 * cards span the felt, and no hand overlaps another part of the table.
 */
async function expectSidewaysRoom(page: Page, viewer: SeatKey): Promise<void> {
	const room = page.locator(".room");
	await expect(room).toHaveAttribute("data-form", "desktop");
	await expect(room).toHaveAttribute("data-layout", "sideways");
	expect(
		await page.evaluate(() => ({
			overflow: [
				document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
				document.documentElement.scrollHeight -
					document.documentElement.clientHeight,
			],
			transform: getComputedStyle(document.querySelector("main") as Element)
				.transform,
		})),
	).toEqual({ overflow: [0, 0], transform: "none" });
	await expect(page.locator(".video-row")).toBeHidden();
	const sidebar = page.locator(".table-sidebar");
	for (const name of ["Join call", ...DESKTOP_TOGGLES.slice(0, 3)])
		await expect(
			sidebar.getByRole("button", { name, exact: true }),
		).toBeVisible();
	await expect(
		page.getByRole("button", { name: "See cameras: receive video" }),
	).toBeHidden();

	const rects = await measure(page, {
		...Object.fromEntries(
			SEATS.map((seat) => [`hand ${seat}`, byTestId(`hand-${seat}`)]),
		),
		auction: byTestId("auction"),
		"bid box": byTestId("bid-box"),
		trick: byTestId("trick"),
		felt: ".felt",
		"own cards": `${byTestId(`hand-${viewer}`)} .hand`,
	});
	expectInside(
		"own hand",
		shown(rects, `hand ${viewer}`),
		await pageViewport(page),
	);
	expect(
		shown(rects, "own cards").width / shown(rects, "felt").width,
		"the own cards span the felt",
	).toBeGreaterThan(0.9);
	expectApart(rects, [
		...SEATS.map((seat) => `hand ${seat}`),
		"auction",
		"bid box",
		"trick",
	]);
	expect(await ranksCut(page), "ranks under the next card").toEqual([]);
}

test.beforeAll(async ({ browser, baseURL }) => {
	if (!baseURL) throw new Error("baseURL is not configured");
	for (const [seat, identity] of [
		["W", "identity-9"],
		["N", "identity-6"],
		["S", "identity-7"],
		["E", "identity-8"],
	] as const)
		players[seat] = await Player.open(browser, baseURL, identity);
	phone = await Player.open(browser, baseURL, "identity-4", {
		viewport: { width: 390, height: 664 },
		isMobile: true,
		hasTouch: true,
	});
});

test.afterAll(async () => {
	for (const player of Object.values(players)) await player.close();
	await phone?.close();
});

test("1: desktop, start of the auction: each of the four viewers sits at the bottom, with tiles beside the others", async () => {
	tab.W = await players.W.page("./");
	const link = await createRoom(tab.W);
	for (const seat of ["N", "S", "E"] as const) {
		tab[seat] = await players[seat].page(link);
		await pick(tab[seat], seat);
	}
	// The hosting page deals the first board by itself once all four seats are present.
	await expectAt(SEATS, 0);
	await expect(tab.N.getByTestId("bid-box")).toBeVisible();

	for (const seat of SEATS) {
		await expect(table(tab[seat])).toHaveAttribute("data-phase", "auction");
		await expectDesktopLayout(seat);
	}

	// The window shows the own hand, the full bid grid and the call panel without page scroll; a low laptop window
	// shows at least the hand and the bid grid.
	await expectDesktopFit("N", ALL_DESK_PARTS);
	await tab.N.setViewportSize(LOW_LAPTOP);
	await expectDesktopFit("N", ["own hand", "game slot"]);
	await tab.N.setViewportSize({ width: 1280, height: 720 });
});

test("2: desktop, during play: dummy's cards and the trick keep apart from the rest", async () => {
	for (const [seat, code] of [
		["N", "1C"],
		["E", "P"],
		["S", "P"],
		["W", "P"],
	] as const) {
		await makeCall(tab[seat], code);
		await expectAt(SEATS, SEATS.indexOf(seat) + 1);
	}
	await tab.E.locator("button.card:enabled").first().click();
	await expectAt(SEATS, 5);

	for (const seat of SEATS) {
		const page = tab[seat];
		await expect(table(page)).toHaveAttribute("data-phase", "play");
		await expect(hand(page, "S")).toHaveAttribute("data-visible", "true");
		await expect(page.getByTestId("trick")).toBeVisible();
		await expect(page.getByTestId("bid-box")).toBeHidden();
		// Dummy's turn: declarer North acts; only the declarer may claim, at any turn (tests/unit/table-model.test.ts).
		// Only East has played a card, so only East may ask to undo (src/bridge/engine.ts `undoPosition`). The
		// desktop shows the play controls only to a seat that can use one of them (src/ui/table.ts).
		const claimAll = page.getByRole("button", { name: "Claim all" });
		const undo = page.getByRole("button", { name: "Undo" });
		if (seat === "N") await expect(claimAll).toBeEnabled();
		else if (seat === "E") await expect(claimAll).toBeDisabled();
		else await expect(claimAll).toBeHidden();
		if (seat === "E") await expect(undo).toBeEnabled();
		else await expect(undo).toBeHidden();
		await expectDesktopLayout(seat);
		await expectSlotWithoutScroll(page);
		await expectDesktopFit(seat, ALL_DESK_PARTS);
	}
	await tab.E.setViewportSize(LOW_LAPTOP);
	await expectDesktopFit("E", ["own hand", "game slot"]);

	// The narrowest and lowest desktop window gives the smallest cards; dummy is a column on East's left.
	await tab.E.setViewportSize({ width: 900, height: 600 });
	await expectDesktopLayout("E");
	await tab.E.setViewportSize({ width: 1280, height: 720 });

	// A desktop window narrower than 900 px gets the compact table, with dummy at the top; at 1280 px the room is the
	// scaled Full HD canvas again.
	await tab.E.setViewportSize({ width: 390, height: 664 });
	await expectCompactRoom(tab.E, [
		tab.E.locator(".mobile-board-top"),
		tab.E.locator(".mobile-auction-hand"),
	]);
	expect(await ranksCut(tab.E), "ranks under the next card").toEqual([]);
	await tab.E.setViewportSize({ width: 1280, height: 720 });
	await expectRoomCanvasFit(tab.E);
});

test("3: a phone held upright and a portrait window get the compact table, a phone held sideways gets the desktop table at its size, and a landscape desktop scales the Full HD room canvas", async () => {
	if (!phone) throw new Error("the phone browser is not open");
	const host = await players.W.page("./");
	const link = await createRoom(host);
	phoneTab = await phone.page(link);
	await pick(phoneTab, "N");
	for (const seat of ["S", "E"] as const)
		await pick(await players[seat].page(link), seat);
	await expectCompactRoom(phoneTab);

	// The hosting page deals the first board by itself once all four seats are present.
	await expect(table(phoneTab)).toHaveAttribute("data-phase", "auction", {
		timeout: CONNECT_MS,
	});
	const phoneParts = [
		phoneTab.locator(".mobile-auction-hand"),
		phoneTab.getByTestId("bid-box"),
	];
	for (const size of PHONE_VIEWPORTS) {
		await phoneTab.setViewportSize(size);
		await test.step(`phone ${size.width}×${size.height}`, () =>
			expectCompactRoom(phoneTab as Page, phoneParts));
	}
	// A phone held sideways keeps the phone's call, on the desktop table without videos, unless the settings ask for
	// the desktop view (Settings, Screen orientation).
	for (const size of SIDEWAYS_VIEWPORTS) {
		await phoneTab.setViewportSize(size);
		await test.step(`phone ${size.width}×${size.height}, landscape`, () =>
			expectSidewaysRoom(phoneTab as Page, "N"));
	}
	await phoneTab.setViewportSize({ width: 390, height: 664 });
	await expectCompactRoom(phoneTab);
	for (const size of CANVAS_VIEWPORTS) {
		await host.setViewportSize(size);
		await test.step(`desktop ${size.width}×${size.height}`, () =>
			expectRoomCanvasFit(host, true));
	}
	// A portrait desktop window gets the compact table and an audio-only call, like a phone held upright.
	await host.setViewportSize({ width: 1080, height: 1920 });
	await test.step("desktop 1080×1920, portrait", () => expectCompactRoom(host));
	await host.setViewportSize({ width: 1920, height: 1080 });
});

test("4: the call controls have names that spell out the way and the medium, and their off state has a slash", async () => {
	if (!phoneTab) throw new Error("the phone tab is not open");
	const forms = [
		[tab.W, DESKTOP_TOGGLES],
		[phoneTab, COMPACT_TOGGLES],
	] as const;
	// Outside the call the switches are enabled and show what Join starts with (src/ui/call-model.ts); each one
	// that is off has the slash (src/ui/call-panel.ts).
	for (const [page, toggles] of forms) {
		for (const name of toggles) {
			const toggle = page.getByRole("button", { name, exact: true });
			await expect(toggle).toHaveCount(1);
			await expect(toggle).toBeEnabled();
			const off = (await toggle.getAttribute("aria-pressed")) === "false";
			await expect(toggle.locator(".icon-slash")).toHaveCount(off ? 1 : 0);
		}
		await expect(
			page.getByRole("button", { name: "Join call", exact: true }),
		).toHaveCount(1);
		const mic = page.getByRole("button", {
			name: "Send mic audio",
			exact: true,
		});
		for (const pressed of ["false", "true"]) {
			await mic.click();
			await expect(mic).toHaveAttribute("aria-pressed", pressed);
			await expect(mic.locator(".icon-slash")).toHaveCount(
				pressed === "false" ? 1 : 0,
			);
		}
	}
	// The compact call row can send the camera but shows no video, so it has no See cameras switch
	// (src/call/device-class.ts, src/ui/call-panel.ts).
	await expect(
		phoneTab.getByRole("button", { name: "Send camera video", exact: true }),
	).toHaveCount(1);
	await expect(
		phoneTab.getByRole("button", {
			name: "See cameras: receive video",
			exact: true,
		}),
	).toHaveCount(0);
	// The compact table offers no claim during the auction (src/ui/table.ts enables the claims only in play), and
	// both Undo controls stay disabled before the first call.
	for (const id of ["claim-compact", "claim-all-compact", "undo-compact"])
		await expect(phoneTab.getByTestId(id)).toBeDisabled();
	await expect(
		phoneTab.getByTestId("bid-box").getByRole("button", {
			name: "Undo",
			exact: true,
		}),
	).toBeDisabled();
});

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 1280, height: 720 },
]) {
	test(`the bot picture of a tile stays above the bot's name at ${viewport.width}×${viewport.height}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await page.goto("/");
		await page.getByTestId("create-solo").click();
		for (const seat of ["N", "E", "W"]) {
			const tile = page.getByTestId(`tile-${seat}`);
			const picture = tile
				.locator(".bot-artwork, .bot-overlay-fallback")
				.filter({ visible: true });
			await expect(picture).toBeVisible({ timeout: CONNECT_MS });
			const [art, caption] = await Promise.all([
				picture.boundingBox(),
				tile.locator(".tile-caption").boundingBox(),
			]);
			expect(art?.y ?? 0).toBeGreaterThanOrEqual(
				(await tile.boundingBox())?.y ?? 0,
			);
			// A clear gap, because the artwork glows to the edge of its box.
			expect((art?.y ?? 0) + (art?.height ?? 0)).toBeLessThanOrEqual(
				(caption?.y ?? 0) - 4,
			);
		}
	});
}
