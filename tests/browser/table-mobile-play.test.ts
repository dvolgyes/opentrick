import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import type { PointSystem } from "../../src/bridge/hand-points";
import type { Call } from "../../src/bridge/rules";
import type { Form, Layout } from "../../src/call/device-class";
import { type Locale, type Translate, translator } from "../../src/i18n";
import type { Seat } from "../../src/protocol";
import { parseGuide, renderGuide } from "../../src/ui/bidding-guide";
import { pageReport } from "../../src/ui/page-report";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import {
	type PlayedCardStyle,
	type TableHandlers,
	type TableMarks,
	type TableOptions,
	tableSection,
} from "../../src/ui/table";
import type {
	RoundTripView,
	SeatView,
	TableView,
} from "../../src/ui/table-model";
import { voiceMeters } from "../../src/ui/voice-meter";

const card = (value: Card) => ({
	card: value,
	rank: value.slice(1),
	suit: value[0] as "S" | "H" | "D" | "C",
	text: value,
	playable: true,
});

const visibleHand = {
	visible: true as const,
	suits: [
		{
			suit: "S" as const,
			symbol: "♠",
			cards: [card("SA")],
			trump: true,
		},
	],
};

function seat(
	seatName: "N" | "E" | "S" | "W",
	position: "bottom" | "left" | "top" | "right",
	options: Partial<SeatView> = {},
): SeatView {
	return {
		seat: seatName,
		position,
		bot: false,
		label: `${seatName} - player${seatName}`,
		name: `player${seatName}`,
		tags: seatName === "N" ? ["You", "Declarer"] : [],
		turn: seatName === "N",
		hand:
			seatName === "N" || seatName === "S"
				? visibleHand
				: { visible: false, count: 13 },
		presence: "online",
		connecting: false,
		turnPill: seatName === "N" ? { action: "play", yours: true } : undefined,
		pointCards: undefined,
		roundTrip: undefined,
		...options,
	};
}

/** North-South vulnerable, East-West not. */
const NS_VULNERABLE: TableView["vulnerability"] = [
	{
		side: "ns",
		text: "N-S vulnerable",
		status: "vulnerable",
		vulnerable: true,
	},
	{
		side: "ew",
		text: "E-W not vulnerable",
		status: "not vulnerable",
		vulnerable: false,
	},
];

function playView(): TableView {
	return {
		phase: "play",
		board: 1,
		at: 5,
		heading: "Board 1",
		details: "Dealer: North",
		vulnerability: [
			{
				side: "ns",
				text: "N-S not vulnerable",
				status: "not vulnerable",
				vulnerable: false,
			},
			{
				side: "ew",
				text: "E-W not vulnerable",
				status: "not vulnerable",
				vulnerable: false,
			},
		],
		prompt: "Your turn to play from dummy.",
		waiting: "",
		yourTurn: true,
		seats: [
			seat("N", "bottom"),
			seat("E", "left"),
			seat("S", "top", { tags: ["Dummy"], turn: true }),
			seat("W", "right"),
		],
		auction: {
			seats: ["N", "E", "S", "W"],
			rows: [["1♣", "Pass", "Pass", "Pass"]],
			systems: [],
			bots: [],
			calls: ["1C", "P", "P", "P"],
			meanings: [],
		},
		bids: [],
		contract: "2♣ by North",
		header: {
			level: 2,
			strain: "C",
			symbol: "♣",
			doubling: "",
			declarer: "N",
			direction: "North",
			name: "playerN",
		},
		tricks: "0 tricks",
		trick: {
			cards: [
				{
					seat: "E",
					position: "left",
					card: "SA",
					text: "♠A",
					rank: "A",
					symbol: "♠",
				},
			],
			finished: false,
		},
		need: {
			ours: 2,
			target: 8,
			opponents: 3,
			needed: 6,
			remaining: 8,
			status: "open",
		},
		trickStatus: "",
		scoring: undefined,
		nextBoard: undefined,
		actions: [],
		undo: {
			canRequest: true,
			message: "",
			requestId: undefined,
			canVote: false,
			canCancel: false,
		},
		claim: {
			canRequest: true,
			maxTricks: 12,
			choosable: false,
			requestId: undefined,
			requester: "",
			tricks: 0,
			message: "",
			canVote: false,
		},
		scores: [],
		totals: { ns: 0, ew: 0 },
		statistics: {
			ns: { won: 0, lost: 0, total: 0 },
			ew: { won: 0, lost: 0, total: 0 },
		},
	};
}

/** The play view with a visible left hand: one trump, then a long suit, as dummy late in play. */
function sideHandView(): TableView {
	const suit = (
		name: "S" | "H" | "D" | "C",
		symbol: string,
		ranks: string[],
		trump = false,
	) => ({
		suit: name,
		symbol,
		cards: ranks.map((rank) => ({
			...card(`${name}${rank}` as Card),
			playable: false,
		})),
		trump,
	});
	const hand = {
		visible: true as const,
		suits: [
			suit("D", "♦", ["4"], true),
			suit("C", "♣", ["K", "Q", "9", "6", "5", "3", "2"]),
			suit("H", "♥", ["8", "7", "5"]),
			suit("S", "♠", ["A", "Q"]),
		],
	};
	const base = playView();
	return {
		...base,
		seats: base.seats.map((player) =>
			player.position === "left" ? { ...player, hand } : player,
		),
	};
}

function renderView(
	view: TableView,
	form: Layout,
	style?: PlayedCardStyle,
	t?: Translate,
	options?: TableOptions,
) {
	const handlers: TableHandlers = {
		exit: vi.fn(),
		reload: vi.fn(),
		shareUrl: vi.fn(async () => {}),
		act: vi.fn(),
		undoRequest: vi.fn(),
		undoVote: vi.fn(),
		undoCancel: vi.fn(),
		claimRequest: vi.fn(),
		claimVote: vi.fn(),
		setBotSeat: vi.fn(),
		requestAutoplay: vi.fn(),
		call: {
			join: vi.fn(),
			leave: vi.fn(),
			setSwitch: vi.fn(),
			retry: vi.fn(),
		},
	};
	const section = tableSection(handlers, style, t, options);
	const room = document.createElement("section");
	room.className = "room";
	// A phone held sideways has the desktop table, like the room (src/ui/room-view.ts).
	room.dataset.form = form === "compact" ? "compact" : "desktop";
	room.dataset.layout = form;
	const stage = document.createElement("div");
	stage.className = "stage";
	stage.append(section.element);
	room.append(stage, section.sidebar);
	document.body.replaceChildren(room);
	section.render(view);
	section.setForm(form);
	return { root: section.element, handlers, section };
}

/**
 * The labels form the first row. The contract and the numbers form the second row, one line below the labels, the
 * contract first and each number under its label.
 */
function expectTwoRows(row: HTMLElement): void {
	const boxes = (selector: string) =>
		[...row.querySelectorAll<HTMLElement>(selector)].map((part) =>
			part.getBoundingClientRect(),
		);
	const labels = boxes(".count-label");
	const numbers = boxes(".count strong");
	const [bid] = boxes(".bid");
	if (!bid) throw new Error("the contract is missing");
	expect(labels).toHaveLength(3);
	expect(numbers).toHaveLength(3);
	const values = [bid, ...numbers];
	expect(Math.max(...values.map((box) => box.top))).toBeLessThan(
		Math.min(...values.map((box) => box.bottom)),
	);
	expect(Math.max(...labels.map((box) => box.bottom))).toBeLessThanOrEqual(
		Math.min(...values.map((box) => box.top)),
	);
	expect(bid.right).toBeLessThanOrEqual(
		Math.min(...labels.map((box) => box.left)),
	);
	labels.forEach((label, index) => {
		const number = numbers[index];
		if (!number) throw new Error(`number ${index} is missing`);
		expect(number.left).toBeGreaterThanOrEqual(label.left);
		expect(number.right).toBeLessThanOrEqual(label.right);
	});
}

function renderMobile(view: TableView) {
	return renderView(view, "compact");
}

afterEach(() => document.body.replaceChildren());

describe("played card styles", () => {
	it("applies four paper levels without changing card colours or card backs", async () => {
		try {
			const urls = new Map<string, string>();
			for (const layout of ["desktop", "compact"] as const) {
				for (const theme of ["normal", "solarized", "selenized", "gruvbox"]) {
					for (const scheme of ["light", "dark"]) {
						document.documentElement.dataset.theme = theme;
						document.documentElement.dataset.scheme = scheme;
						const { root } = renderView(playView(), layout);
						const face = root.querySelector<HTMLElement>(
							".card[data-suit] .face",
						);
						const played =
							root.querySelector<HTMLElement>(".played[data-suit]");
						const back = root.querySelector<HTMLElement>(".back .face");
						if (!face || !played || !back)
							throw new Error("missing card surface");
						const faceColor = getComputedStyle(face).backgroundColor;
						const playedColor = getComputedStyle(played).backgroundColor;
						for (const strength of ["off", "mild", "medium", "strong"]) {
							document.documentElement.dataset.paperStrength = strength;
							const faceStyle = getComputedStyle(face);
							const playedStyle = getComputedStyle(played);
							expect(faceStyle.backgroundColor).toBe(faceColor);
							expect(playedStyle.backgroundColor).toBe(playedColor);
							expect(playedStyle.backgroundImage).toBe(
								faceStyle.backgroundImage,
							);
							expect(getComputedStyle(back).backgroundImage).toBe("none");
							if (strength === "off")
								expect(faceStyle.backgroundImage).toBe("none");
							else {
								const earlier = urls.get(strength);
								if (earlier) expect(faceStyle.backgroundImage).toBe(earlier);
								else urls.set(strength, faceStyle.backgroundImage);
							}
						}
					}
				}
			}
			const averageAlpha: number[] = [];
			for (const strength of ["mild", "medium", "strong"]) {
				const url = /^url\("(.*)"\)$/.exec(urls.get(strength) ?? "")?.[1];
				if (!url) throw new Error(`missing ${strength} texture`);
				const image = new Image();
				image.src = url;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("canvas unavailable");
				ctx.drawImage(image, 0, 0);
				const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				let sum = 0;
				for (let i = 3; i < data.length; i += 4) sum += data[i] ?? 0;
				averageAlpha.push(sum / (data.length / 4));
			}
			expect(averageAlpha[0]).toBeGreaterThan(0);
			expect(averageAlpha[1]).toBeGreaterThan(averageAlpha[0] ?? 0);
			expect(averageAlpha[2]).toBeGreaterThan(averageAlpha[1] ?? 0);
			expect((averageAlpha[0] ?? 0) / (averageAlpha[1] ?? 1)).toBeCloseTo(
				0.69,
				1,
			);
			expect((averageAlpha[2] ?? 0) / (averageAlpha[1] ?? 1)).toBeCloseTo(2, 1);
			expect(averageAlpha[2]).toBeLessThan(32);
		} finally {
			delete document.documentElement.dataset.paperStrength;
			delete document.documentElement.dataset.theme;
			delete document.documentElement.dataset.scheme;
		}
	});
	it("uses three progressively stronger baize tiles on desktop and mobile", async () => {
		const variances: number[] = [];
		const urls = new Set<string>();
		try {
			for (const strength of ["mild", "medium", "strong"] as const) {
				document.documentElement.dataset.baizeStrength = strength;
				let reference = "";
				for (const layout of ["desktop", "compact"] as const) {
					const { root } = renderView(playView(), layout);
					const surface = root.querySelector<HTMLElement>(
						layout === "desktop" ? ".felt" : ".mobile-auction-board",
					);
					if (!surface) throw new Error("missing playing surface");
					const background = getComputedStyle(surface).backgroundImage;
					if (reference) expect(background).toBe(reference);
					else reference = background;
				}
				const url = /^url\("(.*)"\)$/.exec(reference)?.[1];
				if (!url) throw new Error("missing texture URL");
				urls.add(url);
				const image = new Image();
				image.src = url;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("canvas is unavailable");
				ctx.drawImage(image, 0, 0);
				const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				let total = 0;
				let squares = 0;
				const count = pixels.length / 4;
				for (let index = 1; index < pixels.length; index += 4) {
					const green = pixels[index] ?? 0;
					total += green;
					squares += green * green;
				}
				variances.push(squares / count - (total / count) ** 2);
			}
			expect(urls.size).toBe(3);
			expect(variances[1]).toBeGreaterThan(variances[0] ?? 0);
			expect(variances[2]).toBeGreaterThan(variances[1] ?? 0);
			document.documentElement.dataset.baizeStrength = "off";
			for (const layout of ["desktop", "compact"] as const) {
				const { root } = renderView(playView(), layout);
				const surface = root.querySelector<HTMLElement>(
					layout === "desktop" ? ".felt" : ".mobile-auction-board",
				);
				if (!surface) throw new Error("missing playing surface");
				expect(getComputedStyle(surface).backgroundImage).toBe("none");
			}
		} finally {
			delete document.documentElement.dataset.baizeStrength;
		}
	});
	it("shows the same repeating baize on desktop and mobile in light and dark themes", async () => {
		let reference = "";
		try {
			for (const layout of ["desktop", "compact"] as const) {
				for (const scheme of ["light", "dark"] as const) {
					document.documentElement.dataset.theme = "selenized";
					document.documentElement.dataset.scheme = scheme;
					const { root } = renderView(playView(), layout);
					const board = root.querySelector<HTMLElement>(
						layout === "desktop" ? ".felt" : ".mobile-auction-board",
					);
					if (!board) throw new Error("missing playing surface");
					const style = getComputedStyle(board);
					expect(style.backgroundImage).not.toBe("none");
					expect(style.backgroundRepeat).toBe("repeat");
					if (reference) expect(style.backgroundImage).toBe(reference);
					else reference = style.backgroundImage;
				}
			}
			const url = /^url\("(.*)"\)$/.exec(reference)?.[1];
			if (!url) throw new Error("missing texture URL");
			const image = new Image();
			image.src = url;
			await image.decode();
			expect(image.naturalWidth).toBeGreaterThan(1);
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("canvas is unavailable");
			ctx.drawImage(image, 0, 0);
			const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			const greens = new Set<number>();
			for (let index = 1; index < pixels.length; index += 4)
				greens.add(pixels[index] ?? 0);
			expect(greens.size).toBeGreaterThan(1);
		} finally {
			delete document.documentElement.dataset.theme;
			delete document.documentElement.dataset.scheme;
		}
	});
	it.each(["L", "XL", "XXL", "XXXL"])(
		"keeps the phone bidding board content-sized at %s",
		async (size) => {
			await page.viewport(390, 844);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const { root } = renderMobile({ ...playView(), phase: "auction" });
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				if (!board) throw new Error("missing bidding board");
				const shown = board.getBoundingClientRect().height;
				board.style.height = "auto";
				expect(shown).toBeCloseTo(board.getBoundingClientRect().height, 0);
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
	it.each<["auction" | "play", string]>([
		...["auction", "play"].flatMap((phase) =>
			["M", "L", "XL", "XXL", "XXXL"].map(
				(size) =>
					[phase as "auction" | "play", size] as ["auction" | "play", string],
			),
		),
	])(
		"keeps the phone card hands near the board edges in %s at %s",
		async (phase, size) => {
			await page.viewport(390, 844);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const base = playView();
				const { root } = renderMobile({ ...base, phase });
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				const top = root.querySelector<HTMLElement>(".mobile-board-top .hand");
				const name = root.querySelector<HTMLElement>(
					".mobile-board-top .mobile-board-name",
				);
				const bottom = root.querySelector<HTMLElement>(
					".mobile-auction-hand .hand",
				);
				if (!board || !top || !bottom || !name)
					throw new Error("missing board hands");
				expect(
					name.getBoundingClientRect().top - board.getBoundingClientRect().top,
				).toBeLessThan(12);
				const gaps = () => ({
					top:
						top.getBoundingClientRect().top - board.getBoundingClientRect().top,
					bottom:
						board.getBoundingClientRect().bottom -
						bottom.getBoundingClientRect().bottom,
				});
				const expanded = gaps();
				board.style.height = "auto";
				const natural = gaps();
				expect(expanded.top).toBeCloseTo(natural.top, 0);
				expect(expanded.bottom).toBeCloseTo(natural.bottom, 0);
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
	it("centres the bottom hand and its pills in the phone result screen", async () => {
		await page.viewport(390, 844);
		try {
			const base = playView();
			const fullHand = {
				visible: true as const,
				suits: [
					{
						suit: "S" as const,
						symbol: "♠",
						trump: false,
						cards: [card("SA"), card("SK"), card("SQ")],
					},
					{
						suit: "H" as const,
						symbol: "♥",
						trump: false,
						cards: [card("HA"), card("HK"), card("HQ"), card("H9")],
					},
					{
						suit: "D" as const,
						symbol: "♦",
						trump: false,
						cards: [card("DA"), card("DK"), card("DQ")],
					},
					{
						suit: "C" as const,
						symbol: "♣",
						trump: false,
						cards: [card("CA"), card("CK"), card("CQ")],
					},
				],
			};
			const { root } = renderMobile({
				...base,
				phase: "complete",
				seats: base.seats.map((player) =>
					player.position === "bottom"
						? {
								...player,
								hand: fullHand,
								tags: ["Host", "Dummy"],
								pointCards: ["SA"],
							}
						: player,
				),
				scoring: {
					contract: { level: 4, strain: "H", doubling: "" },
					compactOutcome: "WON",
					compactDetail: "Made: 4♥ + 1",
					countdown: 1,
				},
			});
			const board = root.querySelector<HTMLElement>(".felt");
			const hand = root.querySelector<HTMLElement>(".place-bottom .hand");
			const label = root.querySelector<HTMLElement>(
				".place-bottom .seat-label",
			);
			const points = root.querySelector<HTMLElement>(".place-bottom .hcp-pill");
			const first = hand?.querySelector<HTMLElement>(".card");
			const cards = hand?.querySelectorAll<HTMLElement>(".card");
			const last = cards?.[cards.length - 1];
			if (!board || !hand || !label || !points || !first || !last)
				throw new Error("missing result hand or pills");
			const centre = (node: HTMLElement) => {
				const rect = node.getBoundingClientRect();
				return (rect.left + rect.right) / 2;
			};
			expect(
				(first.getBoundingClientRect().left +
					last.getBoundingClientRect().right) /
					2,
			).toBeCloseTo(centre(board), 0);
			expect(centre(label)).toBeCloseTo(centre(board), 0);
			expect(centre(points)).toBeCloseTo(centre(board), 0);
			const result = root.querySelector<HTMLElement>(".scoring");
			const parent = result?.parentElement;
			if (!result || !parent) throw new Error("missing scoring panel");
			expect(
				result.getBoundingClientRect().width /
					parent.getBoundingClientRect().width,
			).toBeCloseTo(0.8, 2);
		} finally {
			await page.viewport(414, 896);
		}
	});

	it.each<Layout>(["desktop", "compact"])(
		"shows the made contract and coloured suit in the %s result",
		(layout) => {
			const base = playView();
			const { root } = renderView(
				{
					...base,
					phase: "complete",
					scoring: {
						contract: { level: 4, strain: "H", doubling: "X" },
						compactOutcome: "WON",
						compactDetail: "Made: 4♥X + 1",
						countdown: 1,
					},
				},
				layout,
			);
			const detail = root.querySelector<HTMLElement>(
				layout === "compact" ? ".mobile-scoring-detail" : ".scoring-result",
			);
			const suit = detail?.querySelector<HTMLElement>(".strain-H");
			if (!detail || !suit) throw new Error("missing result contract suit");
			expect(detail.textContent).toContain("Made: 4♥X + 1");
			expect(getComputedStyle(suit).color).toBe("rgb(192, 38, 45)");
		},
	);

	it.each([
		["C", "♣", "rgb(29, 29, 27)"],
		["D", "♦", "rgb(192, 38, 45)"],
		["H", "♥", "rgb(192, 38, 45)"],
		["S", "♠", "rgb(29, 29, 27)"],
		["NT", "NT", "rgb(31, 122, 70)"],
	] as const)("colours the %s result strain", (strain, symbol, color) => {
		const base = playView();
		const { root } = renderMobile({
			...base,
			phase: "complete",
			scoring: {
				contract: { level: 4, strain, doubling: "" },
				compactOutcome: "WON",
				compactDetail: `Made: 4${symbol} + 1`,
				countdown: 1,
			},
		});
		const mark = root.querySelector<HTMLElement>(
			`.mobile-scoring-detail .strain-${strain}`,
		);
		if (!mark) throw new Error(`missing ${strain} result marker`);
		expect(mark.textContent).toBe(symbol);
		expect(getComputedStyle(mark).color).toBe(color);
	});
	it("confirms the host's own switch in the phone bot controls", () => {
		const base = playView();
		const view = {
			...base,
			seats: base.seats.map((player) =>
				player.position === "bottom" ? { ...player, tags: ["Host"] } : player,
			),
		};
		const { root, section, handlers } = renderMobile(view);
		section.setBotControls(true, []);
		const own = root.querySelector<HTMLButtonElement>(
			'.mobile-player-control[data-seat="N"] button',
		);
		if (!own) throw new Error("missing host bot switch");
		own.click();
		const dialog = root.querySelector<HTMLDialogElement>(
			'[data-testid="autoplay-confirm"]',
		);
		expect(dialog?.open).toBe(true);
		expect(handlers.setBotSeat).not.toHaveBeenCalled();
		dialog
			?.querySelector<HTMLButtonElement>(
				'[data-testid="autoplay-confirm-enable"]',
			)
			?.click();
		expect(handlers.setBotSeat).toHaveBeenCalledExactlyOnceWith("N", true);
	});
	it("spreads hidden side cards into the added phone board height", async () => {
		await page.viewport(390, 844);
		document.documentElement.dataset.suitFontSize = "XXL";
		try {
			const { root } = renderMobile(playView());
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			const backs = [
				...root.querySelectorAll<HTMLElement>(
					".mobile-board-right .back .face",
				),
			];
			if (!board || backs.length !== 13)
				throw new Error("missing board or side cards");
			const span = () =>
				(backs.at(-1)?.getBoundingClientRect().top ?? 0) -
				(backs[0]?.getBoundingClientRect().top ?? 0);
			const expanded = span();
			board.style.height = "auto";
			expect(expanded).toBeGreaterThan(span());
		} finally {
			delete document.documentElement.dataset.suitFontSize;
			await page.viewport(414, 896);
		}
	});
	it("keeps top and bottom hands at the board edges and spreads side suits into the added phone height", async () => {
		await page.viewport(390, 844);
		document.documentElement.dataset.suitFontSize = "XXL";
		try {
			const { root } = renderMobile(sideHandView());
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			const top = root.querySelector<HTMLElement>(".mobile-board-top");
			const bottom = root.querySelector<HTMLElement>(".mobile-auction-hand");
			const rows = [
				...root.querySelectorAll<HTMLElement>(".mobile-board-left .suit-row"),
			];
			if (!board || !top || !bottom || rows.length !== 4)
				throw new Error("missing board hands");
			const geometry = () => ({
				topGap:
					top.getBoundingClientRect().top - board.getBoundingClientRect().top,
				bottomGap:
					board.getBoundingClientRect().bottom -
					bottom.getBoundingClientRect().bottom,
				spread:
					(rows.at(-1)?.getBoundingClientRect().top ?? 0) -
					(rows[0]?.getBoundingClientRect().top ?? 0),
			});
			const expanded = geometry();
			board.style.height = "auto";
			const natural = geometry();
			expect(expanded.topGap).toBeCloseTo(natural.topGap, 0);
			expect(expanded.bottomGap).toBeCloseTo(natural.bottomGap, 0);
			expect(expanded.spread).toBeGreaterThan(natural.spread);
		} finally {
			delete document.documentElement.dataset.suitFontSize;
			await page.viewport(414, 896);
		}
	});
	it.each(["desktop", "compact"] as const)(
		"confirms guest autoplay locally and stops it without confirmation (%s)",
		(layout) => {
			const { root, section, handlers } = renderView(playView(), layout);
			section.setPlayerAutoplay(true, false, false, "");
			const selector =
				layout === "compact"
					? '[data-testid="mobile-player-autoplay-toggle"]'
					: '[data-testid="player-autoplay-toggle"]';
			const toggle = root.querySelector<HTMLButtonElement>(selector);
			if (!toggle) throw new Error("missing autoplay toggle");
			toggle.click();
			const dialog = root.querySelector<HTMLDialogElement>(
				'[data-testid="autoplay-confirm"]',
			);
			expect(dialog?.open).toBe(true);
			expect(handlers.requestAutoplay).not.toHaveBeenCalled();
			dialog
				?.querySelector<HTMLButtonElement>(
					'[data-testid="autoplay-confirm-enable"]',
				)
				?.click();
			expect(handlers.requestAutoplay).toHaveBeenCalledExactlyOnceWith(true);
			section.setPlayerAutoplay(true, true, false, "");
			root.querySelector<HTMLButtonElement>(selector)?.click();
			expect(dialog?.open).toBe(false);
			expect(handlers.requestAutoplay).toHaveBeenLastCalledWith(false);
		},
	);
	it.each(["desktop", "compact"] as const)(
		"confirms enabling the host's autoplay, but stops it immediately (%s)",
		(layout) => {
			const base = playView();
			const view = {
				...base,
				seats: base.seats.map((player) =>
					player.position === "bottom" ? { ...player, tags: ["Host"] } : player,
				),
			};
			const { root, section, handlers } = renderView(view, layout);
			section.setBotControls(true, []);
			section.render(view);
			const toggle = root.querySelector<HTMLButtonElement>(
				".host-autoplay-toggle",
			);
			if (!toggle) throw new Error("missing host autoplay toggle");
			toggle.click();
			const dialog = root.querySelector<HTMLDialogElement>(
				'[data-testid="autoplay-confirm"]',
			);
			expect(dialog?.open).toBe(true);
			expect(handlers.setBotSeat).not.toHaveBeenCalled();
			dialog
				?.querySelector<HTMLButtonElement>('[data-testid="autoplay-cancel"]')
				?.click();
			expect(handlers.setBotSeat).not.toHaveBeenCalled();
			toggle.click();
			dialog
				?.querySelector<HTMLButtonElement>(
					'[data-testid="autoplay-confirm-enable"]',
				)
				?.click();
			expect(handlers.setBotSeat).toHaveBeenCalledExactlyOnceWith("N", true);
			section.setBotControls(true, ["N"]);
			toggle.click();
			expect(dialog?.open).toBe(false);
			expect(handlers.setBotSeat).toHaveBeenLastCalledWith("N", false);
		},
	);
	it.each(["M", "L", "XL", "XXL", "XXXL"])(
		"matches hidden side-card long edges to the player's card at %s",
		async (size) => {
			await page.viewport(390, 844);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const { root } = renderMobile(playView());
				const own = root.querySelector<HTMLElement>(
					".mobile-auction-hand .card .face",
				);
				if (!own) throw new Error("missing own card");
				for (const side of ["left", "right"]) {
					const back = root.querySelector<HTMLElement>(
						`.mobile-board-${side} .back .face`,
					);
					const column = root.querySelector<HTMLElement>(
						`.mobile-board-${side}`,
					);
					if (!back) throw new Error(`missing ${side} back`);
					if (!column) throw new Error(`missing ${side} column`);
					expect(back.getBoundingClientRect().width).toBeCloseTo(
						own.getBoundingClientRect().height,
						0,
					);
					expect(back.getBoundingClientRect().left).toBeGreaterThanOrEqual(
						column.getBoundingClientRect().left - 0.5,
					);
					expect(back.getBoundingClientRect().right).toBeLessThanOrEqual(
						column.getBoundingClientRect().right + 0.5,
					);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);

	it("centres the top player label and bottom player and role pills on phones", async () => {
		await page.viewport(390, 844);
		try {
			const base = playView();
			const { root } = renderMobile({
				...base,
				seats: base.seats.map((player) =>
					player.position === "bottom"
						? { ...player, tags: ["Host", "Dummy"] }
						: player,
				),
			});
			for (const selector of [
				".mobile-board-top .mobile-board-name",
				".mobile-auction-hand .seat-label",
			]) {
				const label = root.querySelector<HTMLElement>(selector);
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				if (!label || !board) throw new Error(`missing ${selector}`);
				const box = label.getBoundingClientRect();
				const outer = board.getBoundingClientRect();
				expect((box.left + box.right) / 2).toBeCloseTo(
					(outer.left + outer.right) / 2,
					0,
				);
			}
		} finally {
			await page.viewport(414, 896);
		}
	});
	it.each(["L", "XL", "XXL"])(
		"centres the top and bottom phone hands at %s",
		async (size) => {
			await page.viewport(320, 568);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const { root } = renderMobile(playView());
				for (const selector of [
					".mobile-board-top .hand-row",
					".mobile-auction-hand .hand-row",
				]) {
					const row = root.querySelector<HTMLElement>(selector);
					const card = row?.querySelector<HTMLElement>(".card, .back");
					if (!row || !card) throw new Error(`missing ${selector}`);
					const last = row?.querySelectorAll<HTMLElement>(".card, .back");
					const right = last?.[last.length - 1]?.getBoundingClientRect().right;
					if (right === undefined) throw new Error("missing last card");
					expect((card.getBoundingClientRect().left + right) / 2).toBeCloseTo(
						(row.getBoundingClientRect().left +
							row.getBoundingClientRect().right) /
							2,
						0,
					);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);

	it.each([
		["L", 1.1],
		["XL", 1.2],
		["XXL", 1.2],
		["XXXL", 1.2],
	] as const)("adds %s vertical board space", async (size, multiplier) => {
		await page.viewport(320, 568);
		document.documentElement.dataset.suitFontSize = size;
		try {
			const { root } = renderMobile(sideHandView());
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			if (!board) throw new Error("missing board");
			const actual = board.getBoundingClientRect().height;
			board.style.height = "auto";
			const natural = board.getBoundingClientRect().height;
			expect(actual / natural).toBeCloseTo(multiplier, 2);
		} finally {
			delete document.documentElement.dataset.suitFontSize;
			await page.viewport(414, 896);
		}
	});
	it("brings the side-hand suit closer to the rank by a quarter of the font size", () => {
		renderView(sideHandView(), "compact");
		const face = document.querySelector<HTMLElement>(
			".mobile-board-left .hand-stack .face",
		);
		const suit = face?.querySelector<HTMLElement>(".pip");
		if (!face || !suit) throw new Error("missing side-hand suit");
		const font = Number.parseFloat(getComputedStyle(face).fontSize);
		const top = suit.getBoundingClientRect().top;
		suit.style.marginTop = "0px";
		expect(suit.getBoundingClientRect().top - top).toBeCloseTo(font * 0.25, 1);
	});

	it.each(["L", "XL", "XXL", "XXXL"])(
		"keeps played cards as readable as the own hand on phones at %s",
		async (size) => {
			await page.viewport(320, 568);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const { root } = renderMobile(sideHandView());
				const played = root.querySelector<HTMLElement>(
					".mobile-board-center .played",
				);
				const rank = played?.querySelector<HTMLElement>(".rank-corner");
				const hand = root.querySelector<HTMLElement>(
					".mobile-auction-hand .card .face",
				);
				const ownRank = hand?.querySelector<HTMLElement>(".rank");
				if (!played || !rank || !hand || !ownRank)
					throw new Error("missing played or hand card");
				expect(
					Number.parseFloat(getComputedStyle(rank).fontSize),
				).toBeGreaterThanOrEqual(
					Number.parseFloat(getComputedStyle(ownRank).fontSize) - 0.01,
				);
				expect(played.getBoundingClientRect().width).toBeGreaterThanOrEqual(
					hand.getBoundingClientRect().width - 0.5,
				);
				expect(played.getBoundingClientRect().height).toBeGreaterThanOrEqual(
					hand.getBoundingClientRect().height - 0.5,
				);
				expect(
					played.getBoundingClientRect().width /
						played.getBoundingClientRect().height,
				).toBeCloseTo(5 / 7, 2);
				const center = played.querySelector<HTMLElement>(".played-center-suit");
				if (!center) throw new Error("missing central suit");
				const suit = center.getBoundingClientRect();
				for (const corner of played.querySelectorAll<HTMLElement>(
					".rank-corner",
				)) {
					if (!corner.checkVisibility()) continue;
					const box = corner.getBoundingClientRect();
					expect(
						box.right <= suit.left ||
							box.left >= suit.right ||
							box.bottom <= suit.top + 0.5 ||
							box.top >= suit.bottom - 0.5,
					).toBe(true);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);

	it("keeps a full XXXL trick clear of the side dummy on a narrow phone", async () => {
		await page.viewport(320, 568);
		document.documentElement.dataset.suitFontSize = "XXXL";
		try {
			const base = sideHandView();
			const first = base.trick?.cards[0];
			if (!base.trick || !first) throw new Error("missing trick");
			const { root } = renderMobile({
				...base,
				trick: {
					...base.trick,
					cards: (["top", "left", "right", "bottom"] as const).map(
						(position) => ({ ...first, position }),
					),
				},
			});
			const cards = [
				...root.querySelectorAll<HTMLElement>(".mobile-board-center .played"),
			].map((card) => card.getBoundingClientRect());
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			if (!board) throw new Error("missing board");
			const boardBounds = board.getBoundingClientRect();
			for (const face of root.querySelectorAll<HTMLElement>(
				".mobile-board-top .card .face, .mobile-auction-hand .card .face, .mobile-board-center .played",
			)) {
				const bounds = face.getBoundingClientRect();
				expect(bounds.top).toBeGreaterThanOrEqual(boardBounds.top - 0.5);
				expect(bounds.bottom).toBeLessThanOrEqual(boardBounds.bottom + 0.5);
			}
			const markers = [
				...root.querySelectorAll<HTMLElement>(
					".mobile-board-left .suit-row .card:last-child .pip",
				),
			];
			expect(cards).toHaveLength(4);
			expect(markers).toHaveLength(4);
			for (const [index, card] of cards.entries()) {
				for (const other of cards.slice(index + 1))
					expect(
						card.right <= other.left + 0.5 ||
							card.left >= other.right - 0.5 ||
							card.bottom <= other.top + 0.5 ||
							card.top >= other.bottom - 0.5,
					).toBe(true);
			}
			for (const marker of markers) {
				const range = document.createRange();
				range.selectNodeContents(marker);
				const box = range.getBoundingClientRect();
				for (const card of cards)
					expect(
						box.right <= card.left ||
							box.left >= card.right ||
							box.bottom <= card.top ||
							box.top >= card.bottom,
						marker.textContent ?? "",
					).toBe(true);
			}
		} finally {
			delete document.documentElement.dataset.suitFontSize;
			await page.viewport(414, 896);
		}
	});
	it.each<["left" | "right", number, number]>([
		["left", 320, 568],
		["right", 320, 568],
		["left", 390, 844],
		["right", 390, 844],
	])(
		"shows all four suits of a %s dummy at XXXL on a %i × %i phone",
		async (position, width, height) => {
			await page.viewport(width, height);
			document.documentElement.dataset.suitFontSize = "XXXL";
			try {
				const base = sideHandView();
				const dummy = base.seats.find((player) => player.position === "left");
				if (!dummy) throw new Error("missing dummy");
				const view = {
					...base,
					trick: base.trick && {
						...base.trick,
						cards: base.trick.cards.map((item) => ({ ...item, position })),
					},
					seats: base.seats.map((player) =>
						player.position === position
							? { ...player, hand: dummy.hand, tags: ["Dummy"] }
							: player.position === "left"
								? { ...player, hand: { visible: false as const, count: 13 } }
								: player,
					),
				};
				const { root } = renderMobile(view);
				const column = root.querySelector<HTMLElement>(
					`.mobile-board-${position}`,
				);
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				if (!column || !board) throw new Error("missing mobile board");
				const rows = [...column.querySelectorAll<HTMLElement>(".suit-row")];
				expect(rows).toHaveLength(4);
				for (const row of rows) {
					const marker = row.querySelector<HTMLElement>(
						".card:last-child .pip",
					);
					if (!marker) throw new Error("missing suit marker");
					const range = document.createRange();
					range.selectNodeContents(marker);
					const text = range.getBoundingClientRect();
					const bounds = column.getBoundingClientRect();
					const played = root.querySelector<HTMLElement>(
						".mobile-board-center .played",
					);
					if (!played) throw new Error("missing played card");
					const trick = played.getBoundingClientRect();
					expect(
						text.right <= trick.left ||
							text.left >= trick.right ||
							text.bottom <= trick.top ||
							text.top >= trick.bottom,
						`${position} ${marker.textContent}: ${JSON.stringify({ text: text.toJSON(), trick: trick.toJSON(), bounds: bounds.toJSON(), row: row.getBoundingClientRect().toJSON(), card: marker.closest(".card")?.getBoundingClientRect().toJSON(), width: getComputedStyle(row).getPropertyValue("--card-w") })}`,
					).toBe(true);
					expect(text.left, marker.textContent ?? "").toBeGreaterThanOrEqual(
						bounds.left - 0.5,
					);
					expect(text.right, marker.textContent ?? "").toBeLessThanOrEqual(
						bounds.right + 0.5,
					);
					expect(text.top, marker.textContent ?? "").toBeGreaterThanOrEqual(
						bounds.top - 0.5,
					);
					expect(text.bottom, marker.textContent ?? "").toBeLessThanOrEqual(
						bounds.bottom + 0.5,
					);
					expect(text.bottom, marker.textContent ?? "").toBeLessThanOrEqual(
						board.getBoundingClientRect().bottom + 0.5,
					);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
	it.each<Layout>(["desktop", "sideways"])(
		"keeps both sidebar contracts the same size as the trick labels (%s)",
		(layout) => {
			renderView(playView(), layout);
			const selectors = [
				".table-sidebar .contract-head .bid",
				".table-sidebar .tricks-counts .bid",
				".table-sidebar .tricks-counts .count-label",
			];
			const nodes = selectors.map((selector) => {
				const node = document.querySelector<HTMLElement>(selector);
				if (!node) throw new Error(`missing ${selector}`);
				return node;
			});
			try {
				for (const size of ["S", "M", "L", "XL", "XXL", "XXXL"]) {
					document.documentElement.dataset.suitFontSize = size;
					const values = nodes.map((node) => getComputedStyle(node).fontSize);
					expect(values[0], size).toBe(values[2]);
					expect(values[1], size).toBe(values[2]);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);
	it("halves the extra line spacing between rank and suit in side hands", () => {
		renderView(sideHandView(), "desktop");
		const face = document.querySelector<HTMLElement>(".hand-stack .face");
		const suit = face?.querySelector<HTMLElement>(".pip");
		if (!face || !suit) throw new Error("missing side hand marker");
		const offset = () =>
			suit.getBoundingClientRect().top - face.getBoundingClientRect().top;
		const compactOffset = offset();
		const fontSize = Number.parseFloat(getComputedStyle(face).fontSize);
		face.style.lineHeight = "1.1";
		expect(offset() - compactOffset).toBeCloseTo(fontSize * 0.05, 1);
	});
	it.each<[Layout, "left" | "right"]>([
		["desktop", "left"],
		["desktop", "right"],
		["sideways", "left"],
		["sideways", "right"],
	])("draws full side-hand faces on %s (%s)", (layout, position) => {
		const base = sideHandView();
		const dummy = base.seats.find((player) => player.position === "left");
		if (!dummy) throw new Error("missing dummy");
		const { root } = renderView(
			{
				...base,
				seats: base.seats.map((player) =>
					player.position === position
						? { ...player, hand: dummy.hand }
						: player,
				),
			},
			layout,
		);
		const stack = root.querySelector<HTMLElement>(
			`.place-${position} .hand-stack`,
		);
		if (!stack) throw new Error("missing side hand");
		const rows = [...stack.querySelectorAll<HTMLElement>(".suit-row")];
		expect(rows).toHaveLength(4);
		const lastFace = rows.at(-1)?.querySelector<HTMLElement>(".face");
		if (!lastFace) throw new Error("missing last face");
		for (const row of rows) {
			for (const card of row.querySelectorAll<HTMLElement>(".card")) {
				const face = card.querySelector<HTMLElement>(".face");
				if (!face) throw new Error("missing face");
				expect(getComputedStyle(card).overflow).toBe("visible");
				expect(face.getBoundingClientRect().height).toBeCloseTo(
					lastFace.getBoundingClientRect().height,
					0,
				);
			}
		}
		const top = rows[0]
			?.querySelector<HTMLElement>(".face")
			?.getBoundingClientRect();
		const lower = rows[1]
			?.querySelector<HTMLElement>(".face")
			?.getBoundingClientRect();
		if (!top || !lower) throw new Error("missing overlapping faces");
		expect(lower.top).toBeLessThan(top.bottom);
		const hit = document.elementFromPoint(
			Math.max(top.left, lower.left) + 3,
			lower.top + 3,
		);
		expect(hit?.closest(".suit-row")).toBe(rows[1]);
	});
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"keeps side-hand suit markers visible as font size grows (%s)",
		(layout) => {
			const base = sideHandView();
			const left = base.seats.find((player) => player.position === "left");
			if (!left) throw new Error("missing side hand");
			renderView(
				{
					...base,
					seats: base.seats.map((player) =>
						player.position === "right"
							? { ...player, hand: left.hand }
							: player,
					),
				},
				layout,
			);
			const cards = [
				...document.querySelectorAll<HTMLElement>(
					".hand-stack .suit-row:not(:last-child) .card",
				),
			];
			expect(cards.length).toBeGreaterThan(0);
			try {
				for (const size of ["L", "XL", "XXL", "XXXL"]) {
					document.documentElement.dataset.suitFontSize = size;
					for (const card of cards) {
						const suit = card.querySelector<HTMLElement>(".pip");
						if (!suit) throw new Error("missing suit marker");
						expect(
							suit.getBoundingClientRect().bottom,
							size,
						).toBeLessThanOrEqual(card.getBoundingClientRect().bottom + 0.1);
						const column = card.closest<HTMLElement>(
							".mobile-board-left, .mobile-board-right",
						);
						if (column) {
							expect(
								suit.getBoundingClientRect().top,
								size,
							).toBeGreaterThanOrEqual(
								column.getBoundingClientRect().top - 0.1,
							);
							expect(
								suit.getBoundingClientRect().bottom,
								size,
							).toBeLessThanOrEqual(
								column.getBoundingClientRect().bottom + 0.1,
							);
						}
					}
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);

	it.each<["left" | "right", "M" | "XXXL"]>([
		["left", "M"],
		["right", "M"],
		["left", "XXXL"],
		["right", "XXXL"],
	])(
		"draws complete, correctly stacked side cards on mobile (%s, %s)",
		async (position, size) => {
			await page.viewport(390, 844);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const base = sideHandView();
				const dummy = base.seats.find((player) => player.position === "left");
				if (!dummy || !dummy.hand.visible)
					throw new Error("missing visible dummy");
				const [trump, ...others] = dummy.hand.suits;
				if (!trump) throw new Error("missing trump suit");
				const hand = {
					...dummy.hand,
					suits: [others[0], trump, ...others.slice(1)].filter(
						(row) => row !== undefined,
					),
				};
				const view = {
					...base,
					seats: base.seats.map((player) =>
						player.position === position
							? { ...player, hand }
							: player.position === "left"
								? { ...player, hand: { visible: false as const, count: 13 } }
								: player,
					),
				};
				const { root } = renderMobile(view);
				const column = root.querySelector<HTMLElement>(
					`.mobile-board-${position}`,
				);
				const stack = column?.querySelector<HTMLElement>(".hand-stack");
				const label = stack?.querySelector<HTMLElement>(".trump-label");
				const trumpRow = stack?.querySelector<HTMLElement>(".suit-row.trump");
				const rows = [
					...(stack?.querySelectorAll<HTMLElement>(".suit-row") ?? []),
				];
				if (!column || !stack || !label || !trumpRow || rows.length !== 4)
					throw new Error("missing side-hand rows");
				expect(
					trumpRow.getBoundingClientRect().top -
						label.getBoundingClientRect().bottom,
				).toBeLessThanOrEqual(5);
				for (const row of rows) {
					for (const card of row.querySelectorAll<HTMLElement>(".card")) {
						const face = card.querySelector<HTMLElement>(".face");
						if (!face) throw new Error("missing card face");
						const box = face.getBoundingClientRect();
						expect(box.width / box.height).toBeCloseTo(5 / 7, 1);
						expect(getComputedStyle(card).overflow).toBe("visible");
					}
				}
				// Compress the rows to create a real overlap across the trump row.
				stack.style.flex = "none";
				stack.style.height = `${stack.getBoundingClientRect().height * 0.55}px`;
				const below = rows[2];
				const trumpFace = trumpRow.querySelector<HTMLElement>(".face");
				const belowFace = below?.querySelector<HTMLElement>(".face");
				if (!below || !trumpFace || !belowFace)
					throw new Error("missing overlapping faces");
				const top = trumpFace.getBoundingClientRect();
				const lower = belowFace.getBoundingClientRect();
				expect(lower.top).toBeLessThan(top.bottom);
				const hit = document.elementFromPoint(
					Math.max(top.left, lower.left) + 3,
					lower.top + 3,
				);
				expect(hit?.closest(".suit-row")).toBe(below);
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"shows the NT bid level and strain in the same bright green (%s)",
		(layout) => {
			const base = playView();
			if (!base.auction) throw new Error("missing auction");
			const { root } = renderView(
				{
					...base,
					phase: "auction",
					bids: [
						{ call: "1NT", text: "1NT" },
						{ call: "P", text: "Pass" },
					],
					auction: { ...base.auction, rows: [["1NT", "Pass"]] },
				},
				layout,
			);
			const marks = [
				...document.querySelectorAll<HTMLElement>(
					".auction .bid-mark.strain-NT",
				),
			];
			const control = root.querySelector<HTMLElement>(".bid-calls .strain-NT");
			if (!control || marks.length !== 2) throw new Error("missing NT bid");
			const color = getComputedStyle(control).color;
			for (const mark of marks)
				expect(getComputedStyle(mark).color).toBe(color);
			expect(color).toBe("rgb(57, 131, 0)");
		},
	);
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"keeps a ten visible before the next card at XXL (%s)",
		(layout) => {
			const base = playView();
			const ten = { ...card("ST"), rank: "10" };
			const hand = {
				visible: true as const,
				suits: [
					{
						suit: "S" as const,
						symbol: "♠",
						trump: false,
						cards: [ten, card("S9")],
					},
				],
			};
			renderView(
				{
					...base,
					seats: base.seats.map((player) =>
						player.position === "bottom" || player.position === "left"
							? { ...player, hand }
							: player,
					),
				},
				layout,
			);
			try {
				document.documentElement.dataset.suitFontSize = "XXL";
				const tens = [
					...document.querySelectorAll<HTMLElement>(
						'.hand .card[data-card="ST"]',
					),
				];
				expect(tens.length).toBeGreaterThan(0);
				for (const card of tens) {
					const rank = card.querySelector(".rank");
					if (!rank) throw new Error("missing ten");
					const text = document.createRange();
					text.selectNodeContents(rank);
					expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(
						card.getBoundingClientRect().right,
					);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);
	it("keeps the marker text aligned to the same left inset at every size", () => {
		renderView(playView(), "desktop");
		const markers = [
			...document.querySelectorAll<HTMLElement>(".face .rank, .face .pip"),
		];
		if (markers.length === 0) throw new Error("missing card markers");
		const offsets = () =>
			markers.map((marker) => {
				if (!marker.parentElement) throw new Error("missing card face");
				const range = document.createRange();
				range.selectNodeContents(marker);
				return (
					range.getBoundingClientRect().left -
					marker.parentElement.getBoundingClientRect().left
				);
			});
		const original = offsets();
		try {
			for (const size of ["S", "M", "L", "XL", "XXL", "XXXL"]) {
				document.documentElement.dataset.suitFontSize = size;
				for (const [index, offset] of offsets().entries())
					expect(offset).toBeCloseTo(original[index] ?? 0, 1);
			}
		} finally {
			delete document.documentElement.dataset.suitFontSize;
		}
	});
	it("keeps the played card size when enlarged markers fit", () => {
		renderView(playView(), "desktop", "corners-upright");
		const card = document.querySelector<HTMLElement>(".played");
		if (!card) throw new Error("missing played card");
		const original = card.getBoundingClientRect();
		try {
			document.documentElement.dataset.suitFontSize = "L";
			const enlarged = card.getBoundingClientRect();
			expect(enlarged.width).toBeCloseTo(original.width, 1);
			expect(enlarged.height).toBeCloseTo(original.height, 1);
		} finally {
			delete document.documentElement.dataset.suitFontSize;
		}
	});
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"scales card ranks, suits, bids and contracts exactly once (%s)",
		(layout) => {
			renderView(sideHandView(), layout, "corners-upright");
			const selectors = [
				".face .rank",
				".face .pip",
				".rank-corner",
				".played-center-suit",
				".auction .bid-mark",
				".auction .call-pass",
				".contract-head .bid",
				".contract-head .bid .strain",
				".tricks-counts .bid",
				".tricks-counts .bid .strain",
			];
			const nodes = selectors.map((selector) => {
				const node = document.body.querySelector<HTMLElement>(selector);
				if (!node) throw new Error(`missing ${selector}`);
				return node;
			});
			const sizes = () =>
				nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize));
			document.documentElement.dataset.suitFontSize = "M";
			const medium = sizes();
			try {
				for (const [size, scale] of [
					["S", 0.75],
					["M", 1],
					["L", 1.25],
					["XL", 1.5],
					["XXL", 1.75],
					["XXXL", 2],
				] as const) {
					document.documentElement.dataset.suitFontSize = size;
					for (const [index, actual] of sizes().entries()) {
						// At L and above, phone played cards use the same base font as the own hand.
						const phonePlayed =
							layout === "compact" &&
							scale > 1 &&
							nodes[index]?.closest(".mobile-board-center .played");
						expect(actual, `${selectors[index]} at ${size}`).toBeCloseTo(
							(medium[index] ?? 0) *
								(nodes[index]?.closest(".table-sidebar .bid") ? 1 : scale) *
								(phonePlayed ? 0.95 / 0.85 : 1),
							3,
						);
					}
					for (const marker of document.querySelectorAll<HTMLElement>(
						".face .rank, .face .pip",
					)) {
						if (!marker.checkVisibility()) continue;
						const face = marker.parentElement;
						if (!face) throw new Error("no card face");
						const box = marker.getBoundingClientRect();
						const outer = face.getBoundingClientRect();
						expect(box.right, `${size}: marker right edge`).toBeLessThanOrEqual(
							outer.right + 1,
						);
						expect(
							box.bottom,
							`${size}: marker bottom edge`,
						).toBeLessThanOrEqual(outer.bottom + 1);
					}
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);

	it.each<Layout>(["desktop", "sideways", "compact"])(
		"scales bid selection buttons including Pass (%s)",
		(layout) => {
			const { root } = renderView(
				{
					...playView(),
					phase: "auction",
					bids: [
						{ call: "1C", text: "1♣" },
						{ call: "P", text: "Pass" },
					],
				},
				layout,
			);
			const nodes = [
				".bid-levels .level",
				".bid-calls .strain",
				".bid-calls .pass",
			].map((selector) => {
				const node = root.querySelector<HTMLElement>(selector);
				if (!node) throw new Error(`missing ${selector}`);
				return node;
			});
			const sizes = () =>
				nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize));
			const medium = sizes();
			try {
				document.documentElement.dataset.suitFontSize = "XXXL";
				expect(sizes()).toEqual(medium.map((size) => size * 2));
				const pass = nodes[2];
				if (!pass) throw new Error("missing Pass button");
				const text = document.createRange();
				text.selectNodeContents(pass);
				expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(
					pass.getBoundingClientRect().right,
				);
				expect(text.getBoundingClientRect().left).toBeGreaterThanOrEqual(
					pass.getBoundingClientRect().left,
				);
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);

	it("keeps guide notation the size of the prose and treats HTML as text", () => {
		const text = "Play A♠ or ♣10 after [3NT]; NT, ♥ and <img src=x> stay text.";
		const nodes = renderGuide(parseGuide(text), translator("en"));
		const guide = document.createElement("div");
		guide.className = "guide-content";
		guide.append(...nodes);
		document.body.append(guide);
		const paragraph = guide.querySelector("p");
		if (!paragraph) throw new Error("missing guide paragraph");
		const markers = [
			...paragraph.querySelectorAll<HTMLElement>(".card-notation, .guide-bid"),
		];
		expect(markers.map((node) => node.textContent)).toEqual([
			"A♠",
			"♣10",
			"3NT",
			"NT",
			"♥",
		]);
		expect(paragraph.textContent).toBe(text.replace("[3NT]", "3NT"));
		expect(paragraph.querySelector("img")).toBeNull();
		const base = Number.parseFloat(getComputedStyle(paragraph).fontSize);
		try {
			document.documentElement.dataset.suitFontSize = "XXXL";
			for (const marker of markers)
				expect(Number.parseFloat(getComputedStyle(marker).fontSize)).toBe(base);
			expect(Number.parseFloat(getComputedStyle(paragraph).fontSize)).toBe(
				base,
			);
		} finally {
			delete document.documentElement.dataset.suitFontSize;
		}
	});

	it("uses the seat-oriented corner design by default", () => {
		const { root } = renderView(playView(), "desktop");
		expect(root.dataset.playedCardStyle).toBe("corners-oriented");
	});

	// Each card shows the same diagonal on screen, including the mirrored bottom card.
	it.each<[Layout, Record<"top" | "left" | "bottom" | "right", string[]>]>([
		[
			"desktop",
			{
				top: ["top-left", "bottom-right"],
				left: ["top-left", "bottom-right"],
				bottom: ["top-left", "bottom-right"],
				right: ["top-left", "bottom-right"],
			},
		],
		[
			"sideways",
			{
				top: ["top-left", "bottom-right"],
				left: ["top-left", "bottom-right"],
				bottom: ["top-left", "bottom-right"],
				right: ["top-left", "bottom-right"],
			},
		],
		[
			"compact",
			{
				top: ["top-left", "bottom-right"],
				left: ["top-left", "bottom-right"],
				bottom: ["top-left", "bottom-right"],
				right: ["top-left", "bottom-right"],
			},
		],
	])("shows the rank in the %s corners %j on screen", (form, shown) => {
		const positions = [
			["N", "top"],
			["E", "left"],
			["S", "bottom"],
			["W", "right"],
		] as const;
		const view: TableView = {
			...playView(),
			trick: {
				cards: positions.map(([seat, position]) => ({
					seat,
					position,
					card: "SA",
					text: "♠A",
					rank: "A",
					symbol: "♠",
				})),
				finished: false,
			},
		};
		const { root } = renderView(view, form);
		const played = [...root.querySelectorAll<HTMLElement>(".played")];
		expect(played).toHaveLength(4);
		// The corner where each visible rank is drawn, after the card's own transforms.
		for (const face of played) {
			const box = face.getBoundingClientRect();
			const corners = [...face.querySelectorAll<HTMLElement>(".rank-corner")]
				.filter((corner) => getComputedStyle(corner).display !== "none")
				.map((corner) => {
					const mark = corner.getBoundingClientRect();
					const top = mark.top + mark.height / 2 < box.top + box.height / 2;
					const left = mark.left + mark.width / 2 < box.left + box.width / 2;
					return `${top ? "top" : "bottom"}-${left ? "left" : "right"}`;
				});
			const position = positions.find(([, side]) =>
				face.classList.contains(`pos-${side}`),
			)?.[1];
			if (!position) throw new Error(`no position on ${face.className}`);
			expect(corners.sort(), face.className).toEqual(
				[...shown[position]].sort(),
			);
		}
	});

	it.each<PlayedCardStyle>([
		"classic-large",
		"corners-upright",
		"corners-oriented",
	])("renders the %s variant", (style) => {
		const { root } = renderView(playView(), "desktop", style);
		const played = root.querySelector<HTMLElement>(".played");
		if (!played) throw new Error("played card is missing");
		expect(root.dataset.playedCardStyle).toBe(style);
		expect(played.getAttribute("aria-label")).toBe("♠A");
		expect(played.querySelectorAll(".rank-corner")).toHaveLength(4);
		const corners = played.querySelector<HTMLElement>(".played-corners");
		const centerSuit = played.querySelector<HTMLElement>(".played-center-suit");
		const legacy = played.querySelector<HTMLElement>(".played-legacy");
		const marker = played.querySelector<HTMLElement>(".rank-corner");
		if (!corners || !centerSuit || !legacy)
			throw new Error("played card face elements are missing");
		if (!marker) throw new Error("corner marker is missing");
		const rankSize = Number.parseFloat(getComputedStyle(marker).fontSize);

		if (style === "classic-large") {
			expect(Number.parseFloat(getComputedStyle(played).fontSize)).toBeCloseTo(
				rankSize * 1.5,
				1,
			);
			expect(getComputedStyle(legacy).display).toBe("flex");
			expect(getComputedStyle(corners).display).toBe("none");
		} else {
			expect(getComputedStyle(corners).display).toBe("block");
			expect(getComputedStyle(centerSuit).display).toBe("block");
			expect(
				Number.parseFloat(getComputedStyle(centerSuit).fontSize),
			).toBeCloseTo(rankSize * 1.5, 1);
		}

		expect(getComputedStyle(marker).transform).toBe(
			style === "corners-oriented" ? "matrix(1, 0, 0, 1, 0, 0)" : "none",
		);
	});

	it("orients the marks for each seat in the oriented variant", () => {
		const view = playView();
		if (!view.trick) throw new Error("current trick is missing");
		const firstPlayed = view.trick.cards[0];
		if (!firstPlayed) throw new Error("played card fixture is missing");
		const { root } = renderView(
			{
				...view,
				trick: {
					...view.trick,
					cards: [
						{ ...firstPlayed, seat: "N", position: "top" },
						{ ...firstPlayed, seat: "E", position: "left" },
						{ ...firstPlayed, seat: "W", position: "right" },
						{ ...firstPlayed, seat: "S", position: "bottom" },
					],
				},
			},
			"desktop",
		);
		// The bottom card is mirrored as a whole, and its mirrored marks read upright again; the side marks stay upright.
		const rotations: Record<string, string> = {
			top: "matrix(1, 0, 0, 1, 0, 0)",
			left: "matrix(1, 0, 0, 1, 0, 0)",
			right: "matrix(1, 0, 0, 1, 0, 0)",
			bottom: "matrix(-1, 0, 0, 1, 0, 0)",
		};
		for (const [position, transform] of Object.entries(rotations)) {
			for (const mark of [".rank-corner", ".played-center-suit"]) {
				const marker = [
					...root.querySelectorAll<HTMLElement>(
						`.played.pos-${position} ${mark}`,
					),
				].find((node) => getComputedStyle(node).display !== "none");
				if (!marker) throw new Error(`${position} ${mark} is missing`);
				// The center suit is also moved to the middle of the card, so only the linear part is compared.
				const linear = getComputedStyle(marker).transform.replace(
					/, [-\d.]+, [-\d.]+\)$/,
					", 0, 0)",
				);
				expect(linear, `${position} ${mark}`).toBe(transform);
			}
		}
	});

	it("flips the bottom card left to right, independent of the declarer", () => {
		const view = playView();
		if (!view.trick) throw new Error("current trick is missing");
		const firstPlayed = view.trick.cards[0];
		if (!firstPlayed) throw new Error("played card fixture is missing");
		const { root } = renderView(
			{
				...view,
				header: view.header ? { ...view.header, declarer: "E" } : undefined,
				trick: {
					...view.trick,
					cards: [
						{ ...firstPlayed, seat: "E", position: "left" },
						{ ...firstPlayed, seat: "S", position: "bottom" },
					],
				},
			},
			"desktop",
		);
		const bottomCard = root.querySelector<HTMLElement>(".played.pos-bottom");
		if (!bottomCard) throw new Error("bottom played card is missing");
		expect(getComputedStyle(bottomCard).transform).toBe(
			"matrix(-1, 0, 0, 1, 0, 0)",
		);
		const leftCard = root.querySelector<HTMLElement>(".played.pos-left");
		if (!leftCard) throw new Error("left played card is missing");
		expect(getComputedStyle(leftCard).transform).toBe("none");
	});

	it.each<Form>(["desktop", "compact"])(
		"stands every played card portrait, apart from the others (%s)",
		(form) => {
			const view = playView();
			if (!view.trick) throw new Error("current trick is missing");
			const firstPlayed = view.trick.cards[0];
			if (!firstPlayed) throw new Error("played card fixture is missing");
			const { root } = renderView(
				{
					...view,
					trick: {
						...view.trick,
						cards: [
							{ ...firstPlayed, seat: "N", position: "top" },
							{ ...firstPlayed, seat: "E", position: "left" },
							{ ...firstPlayed, seat: "W", position: "right" },
							{ ...firstPlayed, seat: "S", position: "bottom" },
						],
					},
				},
				form,
			);
			const boxes = [...root.querySelectorAll<HTMLElement>(".played")].map(
				(card) => card.getBoundingClientRect(),
			);
			expect(boxes).toHaveLength(4);
			for (const box of boxes) expect(box.height).toBeGreaterThan(box.width);
			for (const [index, box] of boxes.entries()) {
				for (const other of boxes.slice(index + 1)) {
					const apart =
						box.right <= other.left ||
						other.right <= box.left ||
						box.bottom <= other.top ||
						other.bottom <= box.top;
					expect(apart).toBe(true);
				}
			}
		},
	);
});

describe("turn pill", () => {
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"omits the viewer's turn pill and its empty row (%s)",
		(layout) => {
			const base = playView();
			const view = {
				...base,
				seats: base.seats.map((player) =>
					player.seat === "N"
						? {
								...player,
								hand: {
									...visibleHand,
									suits: visibleHand.suits.map((suit) => ({
										...suit,
										trump: false,
									})),
								},
							}
						: player,
				),
			};
			const { root } = renderView(view, layout);
			const own = root.querySelector<HTMLElement>('[data-testid="hand-N"]');
			if (!own) throw new Error("missing own hand");
			expect(own.querySelector(".turn-pill")).toBeNull();
			const row = own.querySelector<HTMLElement>(".seat-tags");
			if (row) expect(getComputedStyle(row).display).toBe("none");
		},
	);
	it.each<[Locale, string, string]>([
		["en", "YOUR TURN TO BID", "East TO BID"],
		["de", "DU BIST MIT BIETEN DRAN", "Osten IST MIT BIETEN DRAN"],
		["hu", "TE LICITÁLSZ", "Kelet LICITÁL"],
		["no", "DIN TUR TIL Å MELDE", "Øst SKAL MELDE"],
		["es", "TU TURNO PARA SUBASTAR", "TURNO DE Este PARA SUBASTAR"],
		["pt", "A SUA VEZ DE LICITAR", "Este A LICITAR"],
		["fr", "À VOUS D'ENCHÉRIR", "À Est D'ENCHÉRIR"],
		["it", "TOCCA A TE DICHIARARE", "TOCCA A Est DICHIARARE"],
		["nl", "JOUW BEURT OM TE BIEDEN", "BEURT VAN Oost OM TE BIEDEN"],
	])("names the seat to bid in %s", (locale, _own, other) => {
		const base = playView();
		const view: TableView = {
			...base,
			phase: "auction",
			seats: base.seats.map((player) => ({
				...player,
				turnPill:
					player.seat === "N" || player.seat === "E"
						? { action: "bid", yours: player.seat === "N" }
						: undefined,
			})),
		};
		const { root } = renderView(view, "desktop", undefined, translator(locale));
		const pill = (seat: string) =>
			root.querySelector(`[data-testid="hand-${seat}"] .turn-pill`)
				?.textContent;
		expect([pill("N"), pill("E")]).toEqual([undefined, other]);
	});

	it.each<[Locale, string, string]>([
		["en", "YOUR TURN TO PLAY", "East TO PLAY"],
		["de", "DU BIST AM ZUG", "Osten IST AM ZUG"],
		["hu", "TE KÖVETKEZEL", "Kelet KÖVETKEZIK"],
		["no", "DIN TUR TIL Å SPILLE", "Øst SKAL SPILLE"],
		["es", "TU TURNO PARA JUGAR", "TURNO DE Este PARA JUGAR"],
		["pt", "A SUA VEZ DE JOGAR", "Este A JOGAR"],
		["fr", "À VOUS DE JOUER", "À Est DE JOUER"],
		["it", "TOCCA A TE GIOCARE", "TOCCA A Est GIOCARE"],
		["nl", "JOUW BEURT OM TE SPELEN", "BEURT VAN Oost OM TE SPELEN"],
	])("names the seat to play in %s", (locale, _own, other) => {
		const base = playView();
		const view: TableView = {
			...base,
			seats: base.seats.map((player) => ({
				...player,
				turnPill:
					player.seat === "N" || player.seat === "E"
						? { action: "play", yours: player.seat === "N" }
						: undefined,
			})),
		};
		const { root } = renderView(view, "desktop", undefined, translator(locale));
		const pill = (seat: string) =>
			root.querySelector(`[data-testid="hand-${seat}"] .turn-pill`)
				?.textContent;
		expect([pill("N"), pill("E")]).toEqual([undefined, other]);
	});

	it.each<Form>(["desktop", "compact"])(
		"leaves every visible card clickable in play on the %s table",
		(form) => {
			const base = playView();
			const view: TableView = {
				...base,
				seats: base.seats.map((player) => ({
					...player,
					turnPill: { action: "play", yours: player.seat === "N" },
				})),
			};
			renderView(view, form, undefined, translator("de"));
			const cards = pageReport(window, form, null).cards as {
				card: string;
				hit: string;
			}[];
			expect(cards.length).toBeGreaterThan(0);
			for (const card of cards) expect(card.hit, card.card).toBe("self");
		},
	);

	// A long translation widens the call panel; where it reaches the hand, the cards stay on top and take the click.
	it.each(["desktop", "compact"] as const)(
		"keeps every card clickable under the call panel on the %s table",
		(form) => {
			const base = playView();
			const hand = {
				...visibleHand,
				suits: [
					...visibleHand.suits,
					{
						suit: "H" as const,
						symbol: "♥",
						cards: [card("HK"), card("HQ")],
						trump: false,
					},
				],
			};
			const view: TableView = {
				...base,
				seats: base.seats.map((player) =>
					player.seat === "N" ? { ...player, hand } : player,
				),
			};
			const { root } = renderView(view, form);
			const own = root.querySelector<HTMLElement>("[data-testid='hand-N']");
			const slot = root.querySelector<HTMLElement>(".call-slot");
			if (!own || !slot)
				throw new Error("the hand or the call panel is missing");
			const box = own.getBoundingClientRect();
			slot.style.position = "fixed";
			slot.style.inset = `${box.top}px auto auto ${box.left}px`;
			slot.style.width = `${box.width}px`;
			slot.style.height = `${box.height}px`;
			const cards = (
				pageReport(window, form, null).cards as {
					hand: string;
					card: string;
					hit: string;
				}[]
			).filter((item) => item.hand === "N");
			expect(cards.map((item) => item.card)).toEqual(["SA", "HK", "HQ"]);
			for (const item of cards) expect(item.hit, item.card).toBe("self");
		},
	);

	it("puts the pill of a top or bottom seat after its trump label, above the cards", () => {
		const base = playView();
		const view: TableView = {
			...base,
			seats: base.seats.map((player) => ({
				...player,
				turnPill: { action: "play", yours: player.seat === "N" },
			})),
		};
		const { root } = renderView(view, "desktop");
		for (const seatName of ["S"]) {
			const seat = root.querySelector<HTMLElement>(
				`[data-testid="hand-${seatName}"]`,
			);
			const box = (selector: string) => {
				const node = seat?.querySelector<HTMLElement>(selector);
				if (!node) throw new Error(`${seatName} has no ${selector}`);
				return node.getBoundingClientRect();
			};
			const [pill, label, hand] = [
				box(".turn-pill"),
				box(".trump-label"),
				box(".hand"),
			];
			expect(pill.left, seatName).toBeGreaterThanOrEqual(label.right);
			expect(pill.top, seatName).toBeLessThan(label.bottom);
			expect(pill.bottom, seatName).toBeGreaterThan(label.top);
			expect(pill.bottom, seatName).toBeLessThanOrEqual(hand.top);
		}
	});

	it("lays the pill of a side seat flat above the name, and keeps the name and hand in place", () => {
		const base = sideHandView();
		const handTops = (root: HTMLElement) =>
			["E", "W"].map(
				(seatName) =>
					root
						.querySelector(`[data-testid="hand-${seatName}"] .hand`)
						?.getBoundingClientRect().top,
			);
		const before = handTops(renderView(base, "desktop").root);
		const view: TableView = {
			...base,
			seats: base.seats.map((player) => ({
				...player,
				turnPill: { action: "play", yours: player.seat === "N" },
			})),
		};
		const { root } = renderView(view, "desktop");
		for (const seatName of ["E", "W"]) {
			const seat = root.querySelector<HTMLElement>(
				`[data-testid="hand-${seatName}"]`,
			);
			const pill = seat?.querySelector(".turn-pill")?.getBoundingClientRect();
			const name = seat?.querySelector(".seat-label")?.getBoundingClientRect();
			if (!pill || !name) throw new Error(`${seatName} has no pill or name`);
			expect(pill.width, seatName).toBeGreaterThan(pill.height);
			expect(pill.bottom, seatName).toBeLessThanOrEqual(name.top);
		}
		expect(handTops(root)).toEqual(before);
	});

	it("keeps a long pill of a side seat on the table", () => {
		const base = playView();
		const view: TableView = {
			...base,
			phase: "auction",
			seats: base.seats.map((player) => ({
				...player,
				turnPill:
					player.seat === "E" || player.seat === "W"
						? { action: "bid", yours: false }
						: undefined,
			})),
		};
		const { root } = renderView(view, "desktop", undefined, translator("de"));
		const table = root.getBoundingClientRect();
		const pills = [...root.querySelectorAll<HTMLElement>(".turn-pill")];
		expect(pills).toHaveLength(2);
		for (const pill of pills) {
			const box = pill.getBoundingClientRect();
			expect(box.left, pill.textContent ?? "").toBeGreaterThanOrEqual(
				table.left,
			);
			expect(box.right, pill.textContent ?? "").toBeLessThanOrEqual(
				table.right,
			);
		}
	});
});

describe("desktop play", () => {
	it("lets the declarer click dummy's cards in the top seat", () => {
		const { root, handlers } = renderView(playView(), "desktop");
		const dummyCard = root.querySelector<HTMLElement>(
			"[data-testid='hand-S'] [data-card='SA']",
		);
		if (!dummyCard) throw new Error("dummy's card is missing");
		const box = dummyCard.getBoundingClientRect();
		const hit = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		expect(hit?.closest("[data-card]")).toBe(dummyCard);
		(hit as HTMLElement).click();
		expect(handlers.act).toHaveBeenCalledWith({ type: "play", card: "SA" });
	});

	it("shows one Undo in the sidebar while no undo request is open", () => {
		const { section } = renderView(playView(), "desktop");
		const undos = [
			...section.sidebar.querySelectorAll<HTMLElement>("*"),
		].filter(
			(node) =>
				node.childElementCount === 0 &&
				node.textContent === "Undo" &&
				node.checkVisibility(),
		);
		expect(undos.map((node) => node.tagName)).toEqual(["BUTTON"]);
	});
});

describe("desktop auction", () => {
	/** An open undo request in the auction: no call is legal for anybody until it is decided. */
	function undoOpenView(undo: Partial<TableView["undo"]>): TableView {
		const base = playView();
		return {
			...base,
			phase: "auction",
			prompt: "",
			yourTurn: false,
			seats: base.seats.map((player) => ({
				...player,
				tags: [],
				turnPill: undefined,
			})),
			auction: {
				seats: ["N", "E", "S", "W"],
				rows: [["1♣", "Pass"]],
				systems: [],
				bots: [],
				calls: ["1C", "P"],
				meanings: [],
			},
			bids: [],
			contract: "",
			header: undefined,
			trick: undefined,
			need: undefined,
			undo: {
				canRequest: false,
				message: "",
				requestId: "undo-1",
				canVote: false,
				canCancel: false,
				...undo,
			},
		};
	}

	/** Clicks the visible button with this text where a pointer would land on it. */
	function clickAsPointer(root: HTMLElement, text: string): void {
		const target = [...root.querySelectorAll<HTMLElement>("button")].find(
			(button) => button.textContent === text && button.checkVisibility(),
		);
		if (!target) throw new Error(`${text} is missing`);
		const box = target.getBoundingClientRect();
		const hit = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		expect(hit?.closest("button")).toBe(target);
		(hit as HTMLElement).click();
	}

	it.each<Layout>(["desktop", "sideways", "compact"])(
		"marks vulnerable bidding names red without changing green-table names (%s)",
		(layout) => {
			const view = undoOpenView({});
			const { root, section } = renderView(view, layout);
			const tableNameColors = () =>
				[...root.querySelectorAll(".seat-label .name, .mobile-board-name")].map(
					(name) => getComputedStyle(name).color,
				);
			const originalColors = tableNameColors();
			for (const vulnerableSides of [
				[true, false],
				[false, true],
				[true, true],
				[false, false],
			]) {
				section.render({
					...view,
					vulnerability: NS_VULNERABLE.map((line, index) => ({
						...line,
						vulnerable: vulnerableSides[index] ?? false,
					})),
				});
				const names = [
					...root.querySelectorAll<HTMLElement>(".auction-player"),
				];
				expect(names).toHaveLength(4);
				for (const [index, name] of names.entries()) {
					const vulnerable = vulnerableSides[index % 2];
					const probe = document.createElement("span");
					probe.style.color = `var(--${vulnerable ? "sheet-red" : "sheet-fg"})`;
					name.append(probe);
					expect(getComputedStyle(name).color).toBe(
						getComputedStyle(probe).color,
					);
					probe.remove();
				}
				expect(tableNameColors()).toEqual(originalColors);
			}
		},
	);

	it.each<Layout>(["desktop", "sideways"])(
		"shows the vulnerability of each side in two lines right of the heading, together as tall as the heading (%s)",
		(layout) => {
			const { section } = renderView(
				{
					...undoOpenView({}),
					heading: "AUCTION",
					vulnerability: NS_VULNERABLE,
				},
				layout,
			);
			const heading = section.sidebar.querySelector("h3");
			const lines = [
				...section.sidebar.querySelectorAll<HTMLElement>(
					"[data-testid='vulnerability'] > *",
				),
			];
			expect(heading?.textContent).toBe("AUCTION");
			expect(lines.map((line) => line.textContent)).toEqual([
				"N-S vulnerable",
				"E-W not vulnerable",
			]);
			expect(lines.map((line) => line.dataset.vulnerable)).toEqual([
				"true",
				"false",
			]);
			const head = (heading as HTMLElement).getBoundingClientRect();
			const [first, second] = lines.map((line) => {
				expect(line.checkVisibility()).toBe(true);
				return line.getBoundingClientRect();
			});
			if (!first || !second) throw new Error("two lines expected");
			expect(first.left).toBeGreaterThanOrEqual(head.right);
			expect(second.top).toBeGreaterThanOrEqual(first.bottom - 0.5);
			expect(Math.abs(first.top - head.top)).toBeLessThanOrEqual(2);
			expect(Math.abs(second.bottom - head.bottom)).toBeLessThanOrEqual(2);
		},
	);

	it.each<Layout>(["desktop", "sideways"])(
		"keeps the vulnerability of each side in the sidebar during play (%s)",
		(layout) => {
			const { section } = renderView(
				{ ...playView(), vulnerability: NS_VULNERABLE },
				layout,
			);
			const lines = [
				...section.sidebar.querySelectorAll<HTMLElement>(
					"[data-testid='vulnerability'] > *",
				),
			];
			expect(
				lines.map((line) => [line.textContent, line.checkVisibility()]),
			).toEqual([
				["N-S vulnerable", true],
				["E-W not vulnerable", true],
			]);
		},
	);

	it("lets the requester cancel an open undo while no call is legal", () => {
		const { root, handlers } = renderView(
			undoOpenView({
				canCancel: true,
				message: "You ask to undo your last bid.",
			}),
			"desktop",
		);
		clickAsPointer(root, "Cancel undo");
		expect(handlers.undoCancel).toHaveBeenCalledWith("undo-1");
	});

	it("lets another player approve an open undo while no call is legal", () => {
		const { root, handlers } = renderView(
			undoOpenView({
				canVote: true,
				message: "playerW asks to undo their last bid.",
			}),
			"desktop",
		);
		clickAsPointer(root, "Approve undo");
		expect(handlers.undoVote).toHaveBeenCalledWith("undo-1", true);
	});
});

describe("bid box action colours", () => {
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"uses green for Guide and red for Undo in %s",
		(layout) => {
			const base = playView();
			const { root } = renderView(
				{
					...base,
					phase: "auction",
					bids: [{ call: "P", text: "Pass" }],
					undo: { ...base.undo, canRequest: true },
				},
				layout,
			);
			const box = [...root.querySelectorAll<HTMLElement>(".bid-box")].find(
				(element) => element.checkVisibility(),
			);
			if (!box) throw new Error("Visible bid box is missing");
			const guide = box.querySelector<HTMLElement>(".guide-open");
			const confirm = box.querySelector<HTMLElement>(".confirm");
			const undo = box.querySelector<HTMLElement>(".undo-call");
			if (!guide || !confirm || !undo) throw new Error("Bid action is missing");
			const expectedRed = document.createElement("span");
			expectedRed.style.backgroundColor = "var(--reject-bg)";
			box.append(expectedRed);
			expect(getComputedStyle(guide).backgroundColor).toBe(
				getComputedStyle(confirm).backgroundColor,
			);
			expect(getComputedStyle(guide).color).toBe(
				getComputedStyle(confirm).color,
			);
			expect(getComputedStyle(undo).backgroundColor).toBe(
				getComputedStyle(expectedRed).backgroundColor,
			);
			expect(getComputedStyle(undo).color).toBe(
				getComputedStyle(confirm).color,
			);
		},
	);
});

describe("undo request off turn", () => {
	it.each<Form>(["desktop", "compact"])(
		"lets a %s player ask to undo their last bid while another player calls",
		(form) => {
			const base = playView();
			const view: TableView = {
				...base,
				phase: "auction",
				prompt: "",
				yourTurn: false,
				auction: {
					seats: ["N", "E", "S", "W"],
					rows: [["1♣"]],
					systems: [],
					bots: [],
					calls: ["1C"],
					meanings: [],
				},
				bids: [],
				contract: "",
				header: undefined,
				trick: undefined,
				need: undefined,
				undo: {
					canRequest: true,
					message: "",
					requestId: undefined,
					canVote: false,
					canCancel: false,
				},
			};
			const { root, handlers } = renderView(view, form);
			const target = [...root.querySelectorAll<HTMLElement>(".undo-call")].find(
				(button) => button.checkVisibility(),
			);
			if (!target) throw new Error("Undo is missing");
			const box = target.getBoundingClientRect();
			const hit = document.elementFromPoint(
				box.left + box.width / 2,
				box.top + box.height / 2,
			);
			expect(hit?.closest("button")).toBe(target);
			(hit as HTMLElement).click();
			expect(handlers.undoRequest).toHaveBeenCalledWith(view.board);
		},
	);
});

describe("bid box under a held press", () => {
	/** Presses or releases the left mouse button over this element, as the real mouse does. */
	async function mouse(
		type: "mousePressed" | "mouseReleased",
		target: HTMLElement,
	): Promise<void> {
		// The test page is a frame of the tester page; the mouse events use the tester page's coordinates.
		const frame = window.frameElement?.getBoundingClientRect();
		const box = target.getBoundingClientRect();
		await cdp().send("Input.dispatchMouseEvent", {
			type,
			x: (frame?.left ?? 0) + box.left + box.width / 2,
			y: (frame?.top ?? 0) + box.top + box.height / 2,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	}

	const auctionView: TableView = {
		...playView(),
		phase: "auction",
		prompt: "",
		yourTurn: true,
		auction: {
			seats: ["N", "E", "S", "W"],
			rows: [],
			systems: [],
			bots: [],
			calls: [],
			meanings: [],
		},
		bids: [
			{ call: "1C", text: "1♣" },
			{ call: "2C", text: "2♣" },
			{ call: "P", text: "Pass" },
		],
		contract: "",
		header: undefined,
		trick: undefined,
		need: undefined,
	};

	/** Presses level 2, lets the update happen while the button is down, releases, and returns level 2 as drawn. */
	async function pressLevelTwo(
		root: HTMLElement,
		update: () => void,
	): Promise<HTMLElement | undefined> {
		const level = () =>
			[...root.querySelectorAll<HTMLElement>(".bid-levels button")].find(
				(button) => button.textContent === "2",
			);
		const pressed = level();
		if (!pressed) throw new Error("level 2 is missing");
		await mouse("mousePressed", pressed);
		update();
		await mouse("mouseReleased", pressed);
		return level();
	}

	it("selects a level when the room updates the autoplay controls during the press", async () => {
		const { root, section } = renderView(auctionView, "desktop");
		const level = await pressLevelTwo(root, () =>
			section.setPlayerAutoplay(false, false, false, ""),
		);
		expect(level?.getAttribute("aria-pressed")).toBe("true");
	});

	it.each(["desktop", "compact"] as const)(
		"selects a level when the table changes outside the bid box during the press (%s)",
		async (form) => {
			const { root, section } = renderView(auctionView, form);
			const level = await pressLevelTwo(root, () =>
				section.render({ ...auctionView, prompt: "playerE is thinking" }),
			);
			expect(level?.getAttribute("aria-pressed")).toBe("true");
		},
	);
});

describe("finished trick", () => {
	/** North, the viewer, has just played the fourth card of the first trick. */
	function finishedView(at = 8): TableView {
		const base = playView();
		const played = base.trick?.cards[0];
		if (!played) throw new Error("the trick fixture has no card");
		return {
			...base,
			at,
			trick: {
				cards: [
					{ ...played, seat: "E", position: "left" },
					{ ...played, seat: "S", position: "top", card: "S2", text: "♠2" },
					{ ...played, seat: "W", position: "right", card: "S3", text: "♠3" },
					{ ...played, seat: "N", position: "bottom", card: "S4", text: "♠4" },
				],
				finished: true,
			},
		};
	}

	function trickShown(root: HTMLElement): boolean {
		const trick = root.querySelector<HTMLElement>(".trick");
		return (
			trick !== null &&
			!trick.hidden &&
			trick.querySelectorAll(".played").length > 0
		);
	}

	afterEach(() => vi.useRealTimers());

	it.each<Form>(["desktop", "compact"])(
		"hides a finished trick after two seconds on %s",
		(form) => {
			vi.useFakeTimers();
			const { root } = renderView(finishedView(), form);
			expect(trickShown(root)).toBe(true);
			vi.advanceTimersByTime(1900);
			expect(trickShown(root)).toBe(true);
			vi.advanceTimersByTime(100);
			expect(trickShown(root)).toBe(false);
		},
	);

	it("hides a finished trick when the player clicks a place with no control", () => {
		vi.useFakeTimers();
		const { root } = renderView(finishedView(), "desktop");
		document.body.click();
		expect(trickShown(root)).toBe(false);
	});

	it("keeps a hidden trick hidden when the same view comes again, and shows the next finished trick", () => {
		vi.useFakeTimers();
		const { root, section } = renderView(finishedView(), "desktop");
		document.body.click();
		section.render(finishedView());
		expect(trickShown(root)).toBe(false);
		section.render(finishedView(12));
		expect(trickShown(root)).toBe(true);
	});

	it("keeps a trick that is not finished on the table", () => {
		vi.useFakeTimers();
		const { root } = renderView(playView(), "desktop");
		document.body.click();
		vi.advanceTimersByTime(5000);
		expect(trickShown(root)).toBe(true);
	});
});

describe("mobile board names", () => {
	it.each<TableView["phase"]>(["auction", "play"])(
		"shows each opponent's player name above their hand in the %s",
		(phase) => {
			const { root } = renderMobile({ ...playView(), phase });
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			if (!board) throw new Error("the mobile board is missing");
			for (const [area, label] of [
				["top", "S - playerS"],
				["left", "E - playerE"],
				["right", "W - playerW"],
			] as const) {
				const place = board.querySelector<HTMLElement>(`.mobile-board-${area}`);
				const name = [
					...(place?.querySelectorAll<HTMLElement>("*") ?? []),
				].find((part) => part.textContent === label);
				const hand = place?.querySelector<HTMLElement>(".hand");
				if (!name || !hand) throw new Error(`${label} is missing`);
				expect(name.checkVisibility()).toBe(true);
				expect(name.getBoundingClientRect().bottom).toBeLessThanOrEqual(
					hand.getBoundingClientRect().top + 1,
				);
			}
		},
	);
});

describe("mobile turn frame", () => {
	const RED = "rgb(255, 120, 120)";

	it.each<[TableView["phase"], Seat]>([
		["auction", "N"],
		["auction", "E"],
		["play", "S"],
		["play", "W"],
	])(
		"frames only the hand of the player to act in the %s (%s)",
		(phase, active) => {
			const view = playView();
			const { root } = renderMobile({
				...view,
				phase,
				seats: view.seats.map((player) => ({
					...player,
					turn: player.seat === active,
				})),
			});
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			if (!board) throw new Error("the mobile board is missing");
			for (const [seatName, area] of [
				["N", "mobile-auction-hand"],
				["E", "mobile-board-left"],
				["S", "mobile-board-top"],
				["W", "mobile-board-right"],
			] as const) {
				const hand = board.querySelector<HTMLElement>(`.${area} .hand`);
				if (!hand) throw new Error(`the hand of ${seatName} is missing`);
				// A top or bottom hand has an outline; a side hand, in a clipping column, has a border drawn over its cards.
				const style = getComputedStyle(hand);
				const overlay = getComputedStyle(hand, "::after");
				const framed =
					(style.outlineStyle === "solid" && style.outlineColor === RED) ||
					(overlay.content !== "none" &&
						overlay.borderTopStyle === "solid" &&
						overlay.borderTopColor === RED);
				expect(framed, seatName).toBe(seatName === active);
			}
		},
	);
});

describe("board depth and frame colours", () => {
	it.each(["desktop", "sideways", "compact"] as const)(
		"keeps the side dummy's trump frame gold in %s",
		(layout) => {
			const { root } = renderView(sideHandView(), layout);
			const trump = [
				...root.querySelectorAll<HTMLElement>(".suit-row.trump"),
			].find((row) => row.checkVisibility());
			if (!trump) throw new Error("missing side trump suit");
			const frame = getComputedStyle(trump, "::after");
			expect(frame.outlineStyle).toBe("solid");
			expect(frame.outlineColor).toBe("rgb(232, 185, 35)");
		},
	);
	it.each(["desktop", "compact"] as const)(
		"keeps trump gold and adds a played-card shadow in %s",
		(layout) => {
			const { root } = renderView(playView(), layout);
			const board = root.querySelector<HTMLElement>(
				layout === "desktop" ? ".felt" : ".mobile-auction-board",
			);
			const card = board?.querySelector<HTMLElement>(".played");
			const trump = board?.querySelector<HTMLElement>(".suit-group.trump");
			if (!card || !trump) throw new Error("missing played card or trump");
			expect(getComputedStyle(card).boxShadow).not.toBe("none");
			expect(getComputedStyle(trump).outlineColor).toBe("rgb(232, 185, 35)");
			const before = card.getBoundingClientRect();
			card.style.boxShadow = "none";
			expect(card.getBoundingClientRect().toJSON()).toEqual(before.toJSON());
		},
	);

	it("adds shadows to the video and room call boxes on the felt", () => {
		const { root } = renderView(playView(), "desktop");
		const felt = root.querySelector<HTMLElement>(".felt");
		const videos = [
			...(felt?.querySelectorAll<HTMLElement>(".video-row .tile") ?? []),
		];
		const call = felt?.querySelector<HTMLElement>(".call-panel");
		if (!call || !videos.length) throw new Error("missing video or call box");
		for (const box of [...videos, call])
			expect(getComputedStyle(box).boxShadow).not.toBe("none");
	});
});

describe("turn marks and network quality from the settings", () => {
	const RED = "rgb(255, 120, 120)";
	const marks = (changed: Partial<TableMarks>): TableOptions => ({
		marks: () => ({ ...DEFAULT_SETTINGS, ...changed }),
	});
	const acting = (
		phase: TableView["phase"],
		active: Seat,
		action: "bid" | "play",
	): TableView => {
		const base = playView();
		return {
			...base,
			phase,
			seats: base.seats.map((player) => ({
				...player,
				turn: player.seat === active,
				turnPill:
					player.seat === active
						? { action, yours: player.seat === "N" }
						: undefined,
			})),
		};
	};
	const pills = (root: HTMLElement) =>
		[...root.querySelectorAll(".turn-pill")].map((pill) => pill.textContent);

	it("shows the turn text only for the actions whose text setting is on", () => {
		const bid = acting("auction", "E", "bid");
		const play = acting("play", "E", "play");
		const options = marks({ bidTurnText: false });
		expect(
			pills(renderView(bid, "desktop", undefined, undefined, options).root),
		).toEqual([]);
		expect(
			pills(renderView(play, "desktop", undefined, undefined, options).root),
		).toEqual(["East TO PLAY"]);
		const noPlay = marks({ playTurnText: false });
		expect(
			pills(renderView(play, "desktop", undefined, undefined, noPlay).root),
		).toEqual([]);
		expect(
			pills(renderView(bid, "desktop", undefined, undefined, noPlay).root),
		).toEqual(["East TO BID"]);
	});

	it.each<[TableView["phase"], Seat, "bid" | "play", keyof TableMarks]>([
		["auction", "E", "bid", "bidTurnFrame"],
		["play", "E", "play", "playTurnFrame"],
		["play", "S", "play", "playTurnFrame"],
	])(
		"frames the desktop seat to act in the %s (%s) only while its frame setting is on",
		(phase, active, action, setting) => {
			const framed = (options: TableOptions) => {
				const { root } = renderView(
					acting(phase, active, action),
					"desktop",
					undefined,
					undefined,
					options,
				);
				return [...root.querySelectorAll<HTMLElement>(".seat")]
					.filter((seat) => {
						const style = getComputedStyle(seat);
						return style.outlineStyle === "solid" && style.outlineColor === RED;
					})
					.map((seat) => seat.dataset.testid);
			};
			const other =
				setting === "bidTurnFrame" ? "playTurnFrame" : "bidTurnFrame";
			expect(framed(marks({ [other]: false }))).toEqual([`hand-${active}`]);
			expect(framed(marks({ [setting]: false }))).toEqual([]);
		},
	);

	it.each<[TableView["phase"], Seat, "bid" | "play", string, keyof TableMarks]>(
		[
			["auction", "N", "bid", "mobile-auction-hand", "bidTurnFrame"],
			["play", "S", "play", "mobile-board-top", "playTurnFrame"],
			["play", "W", "play", "mobile-board-right", "playTurnFrame"],
		],
	)(
		"frames the phone hand to act in the %s (%s) only while its frame setting is on",
		(phase, active, action, area, setting) => {
			const framed = (options: TableOptions) => {
				const { root } = renderView(
					acting(phase, active, action),
					"compact",
					undefined,
					undefined,
					options,
				);
				const hand = root.querySelector<HTMLElement>(
					`.mobile-auction-board .${area} .hand`,
				);
				if (!hand) throw new Error(`the hand of ${active} is missing`);
				const style = getComputedStyle(hand);
				const overlay = getComputedStyle(hand, "::after");
				return (
					(style.outlineStyle === "solid" && style.outlineColor === RED) ||
					(overlay.content !== "none" && overlay.borderTopColor === RED)
				);
			};
			const other =
				setting === "bidTurnFrame" ? "playTurnFrame" : "bidTurnFrame";
			expect(framed(marks({ [other]: false }))).toBe(true);
			expect(framed(marks({ [setting]: false }))).toBe(false);
		},
	);

	it("shows no network quality on the video tiles while its setting is off", () => {
		const base = playView();
		const view: TableView = {
			...base,
			seats: base.seats.map((player) => ({
				...player,
				roundTrip: { text: "Network: measuring…", quality: "pending" },
			})),
		};
		const shown = (options: TableOptions) =>
			renderView(view, "desktop", undefined, undefined, options)
				.root.querySelector("[data-testid='tile-E'] .network-bars")
				?.checkVisibility() ?? false;
		expect(shown(marks({}))).toBe(true);
		expect(shown(marks({ networkQuality: false }))).toBe(false);
	});
});

describe("compact play controls", () => {
	it("marks bot players by name and overlays their call tiles", () => {
		const view = playView();
		const east = seat("E", "left", {
			bot: true,
			label: "E - playerE 🤖",
		});
		const { root, section } = renderView(
			{
				...view,
				seats: view.seats.map((player) =>
					player.seat === "E" ? east : player,
				),
			},
			"desktop",
		);
		section.setBotControls(false, ["E"]);
		const name = root.querySelector<HTMLElement>(
			"[data-testid='hand-E'] .seat-label .name",
		);
		const overlay = root.querySelector<HTMLElement>(
			"[data-testid='tile-E'] .bot-overlay",
		);
		const artwork = root.querySelector<HTMLImageElement>(
			"[data-testid='tile-E'] .bot-artwork",
		);
		const fallback = root.querySelector<HTMLElement>(
			"[data-testid='tile-E'] .bot-overlay-fallback",
		);
		expect(name?.textContent).toContain("🤖");
		expect(overlay?.hidden).toBe(false);
		expect(artwork?.hidden).toBe(false);
		expect(artwork?.getAttribute("src")).toBeTruthy();
		expect(fallback?.hidden).toBe(true);

		section.setBotControls(false, []);
		expect(artwork?.hidden).toBe(true);
		expect(overlay?.hidden).toBe(true);
	});

	it("shows a camera of a bot seat in place of the bot image", () => {
		const view = playView();
		const { root, section } = renderView(
			{
				...view,
				seats: view.seats.map((player) =>
					player.seat === "E" ? { ...player, bot: true } : player,
				),
			},
			"desktop",
		);
		section.setBotControls(false, ["E"]);
		const canvas = document.createElement("canvas");
		const track = canvas.captureStream().getVideoTracks()[0];
		if (track === undefined) throw new Error("the canvas gives no track");
		const remote = (seat: Seat) => ({
			seat,
			status: "connected" as const,
			audio: undefined,
			video: seat === "E" ? track : undefined,
			peerSendsAudio: false,
			peerSendsVideo: seat === "E",
			fault: undefined,
		});
		const callView = (remotes: ReturnType<typeof remote>[]) => ({
			available: true as const,
			view: {
				status: "subscribed" as const,
				canJoin: false,
				form: "desktop" as const,
				media: {
					send: ["audio", "video"] as const,
					receive: ["audio", "video"] as const,
				},
				requested: {
					inCall: true,
					send: { audio: false, video: false },
					receive: { audio: false, video: true },
				},
				mic: "off" as const,
				camera: "off" as const,
				localVideo: undefined,
				problem: undefined,
				remotes,
			},
		});
		const tile = root.querySelector<HTMLElement>("[data-testid='tile-E']");
		const video = root.querySelector<HTMLVideoElement>(
			"[data-testid='video-E']",
		);
		if (tile === null || video === null) throw new Error("no tile of East");
		const overlay = tile.querySelector<HTMLElement>(".bot-overlay");
		// The overlay lets clicks through, so only its visibility tells what covers the tile.
		const shown = () => [video.checkVisibility(), overlay?.checkVisibility()];
		expect(shown()).toEqual([false, true]);
		section.renderCall(callView((["N", "E"] as const).map(remote)));
		expect(shown()).toEqual([true, false]);
		// Without the camera, the bot image returns.
		section.renderCall(callView([]));
		expect(shown()).toEqual([false, true]);
		track.stop();
	});

	it("shows the viewer's result with context during scoring", () => {
		const view = playView();
		const { root } = renderMobile({
			...view,
			phase: "complete",
			prompt: "",
			scoring: {
				contract: { level: 1, strain: "S", doubling: "" },
				compactOutcome: "WON",
				compactDetail: "Opponents down 6",
				countdown: 10,
			},
			nextBoard: { board: 2, ready: false },
		});
		const scoring = root.querySelector<HTMLElement>("[data-testid='scoring']");
		if (!scoring) throw new Error("mobile scoring panel is missing");
		expect(scoring.textContent).toBe(
			"WONOpponents down 6Next board 2 in 10 seconds",
		);
		expect(scoring.textContent).not.toContain("playerN");
		expect(scoring.querySelector(".mobile-scoring-outcome")?.textContent).toBe(
			"WON",
		);
	});

	it("shows a compact, colored contract and the viewer's result on desktop", () => {
		const view = playView();
		const { root } = renderView(
			{
				...view,
				phase: "complete",
				prompt: "",
				scoring: {
					contract: { level: 4, strain: "H", doubling: "" },
					compactOutcome: "WON",
					compactDetail: "Made: 4♥ + 1",
					countdown: 1,
				},
				nextBoard: { board: 2, ready: false },
			},
			"desktop",
		);
		const scoring = root.querySelector<HTMLElement>("[data-testid='scoring']");
		if (!scoring) throw new Error("desktop scoring panel is missing");
		expect(scoring.textContent).toBe(
			"Contract 4♥WON: Made: 4♥ + 1Next board 2 in 1 second",
		);
		expect(scoring.textContent).not.toContain("Deal Board");
		expect(scoring.textContent).not.toContain("playerN");
		expect(
			getComputedStyle(scoring.querySelector(".strain-H") as HTMLElement).color,
		).toBe("rgb(192, 38, 45)");
		expect(
			getComputedStyle(scoring.querySelector(".scoring-result") as HTMLElement)
				.color,
		).toBe("rgb(31, 122, 70)");

		const diamond = renderView(
			{
				...view,
				phase: "complete",
				prompt: "",
				scoring: {
					contract: { level: 2, strain: "D", doubling: "" },
					compactOutcome: "WON",
					compactDetail: "Made: 2♦ + 1",
					countdown: 1,
				},
				nextBoard: { board: 2, ready: false },
			},
			"desktop",
		).root.querySelector(".strain-D") as HTMLElement;
		expect(getComputedStyle(diamond).color).toBe("rgb(192, 38, 45)");

		const noTrump = renderView(
			{
				...view,
				phase: "complete",
				prompt: "",
				scoring: {
					contract: { level: 3, strain: "NT", doubling: "" },
					compactOutcome: "LOST",
					compactDetail: "Opponents made: 3NT + 1",
					countdown: 1,
				},
				nextBoard: { board: 2, ready: false },
			},
			"desktop",
		).root.querySelector(".strain-NT") as HTMLElement;
		expect(getComputedStyle(noTrump).color).toBe("rgb(31, 122, 70)");
	});

	it("does not show a ready message after the countdown", () => {
		const view = playView();
		const { root } = renderMobile({
			...view,
			phase: "complete",
			prompt: "",
			scoring: {
				contract: { level: 3, strain: "NT", doubling: "" },
				compactOutcome: "WON",
				compactDetail: "Opponents down 1",
				countdown: 0,
			},
			nextBoard: { board: 2, ready: true },
		});
		const scoring = root.querySelector<HTMLElement>("[data-testid='scoring']");
		if (!scoring) throw new Error("mobile scoring panel is missing");
		expect(scoring.textContent).not.toContain("ready");
		expect(scoring.textContent).not.toContain("Next board");
		expect(
			scoring.querySelector<HTMLElement>(".scoring-countdown")?.hidden,
		).toBe(true);
	});

	it("keeps unavailable claim actions visible and disabled during play", () => {
		const view = playView();
		const { root } = renderMobile({
			...view,
			claim: {
				...view.claim,
				canRequest: false,
				maxTricks: 3,
				choosable: true,
			},
		});
		const controls = root.querySelector(".mobile-auction-controls");
		const claim = [
			...(controls?.querySelectorAll<HTMLButtonElement>("button") ?? []),
		].find((button) => button.textContent === "Claim …");
		const claimAll = [
			...(controls?.querySelectorAll<HTMLButtonElement>("button") ?? []),
		].find((button) => button.textContent === "Claim all");
		if (!claim || !claimAll) throw new Error("claim actions are missing");
		for (const action of [claim, claimAll]) {
			expect(action.hidden).toBe(false);
			expect(action.disabled).toBe(true);
			expect(getComputedStyle(action).color).toBe("rgb(154, 154, 154)");
			expect(getComputedStyle(action).backgroundColor).toBe(
				"rgb(239, 239, 234)",
			);
		}
	});

	it("matches desktop trick counts without the contract-needs line", () => {
		const view = playView();
		const { root } = renderMobile(view);
		const row = root.querySelector<HTMLElement>(
			'[data-testid="mobile-tricks"]',
		);
		if (!row) throw new Error("mobile trick count is missing");
		expect(row?.hidden).toBe(false);
		expect(row.textContent).toBe("2♣Our tricks2Target8Opponents'3");
		expectTwoRows(row);
		// The contract is twice the size of the earlier 1.2rem, larger than the trick counts.
		const bid = row.querySelector<HTMLElement>(".bid");
		const ours = row.querySelector<HTMLElement>(".count strong");
		if (!bid || !ours) throw new Error("the contract and a count");
		const rem = Number.parseFloat(
			getComputedStyle(document.documentElement).fontSize,
		);
		expect(Number.parseFloat(getComputedStyle(bid).fontSize)).toBeCloseTo(
			2.4 * rem,
		);
		expect(Number.parseFloat(getComputedStyle(bid).fontSize)).toBeGreaterThan(
			Number.parseFloat(getComputedStyle(ours).fontSize),
		);
		expect(row.querySelector(".tricks-needed")).toBeNull();
		const board = root.querySelector(".mobile-auction-board");
		const controls = root.querySelector(".mobile-auction-controls");
		if (!board || !controls)
			throw new Error("mobile game layout is incomplete");
		expect(board.compareDocumentPosition(row)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(row.compareDocumentPosition(controls)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		const defenderView = {
			...view,
			seats: [
				seat("N", "left"),
				seat("E", "bottom"),
				seat("S", "top", { tags: ["Dummy"], turn: true }),
				seat("W", "right"),
			],
			need: {
				ours: 4,
				target: 6,
				opponents: 3,
				needed: 2,
				remaining: 6,
				status: "open" as const,
			},
		};
		const defender = renderMobile(defenderView).root.querySelector(
			'[data-testid="mobile-tricks"]',
		);
		expect(defender?.textContent).toBe("2♣Our tricks4Target6Opponents'3");
	});

	it("puts the contract and the trick counts in one row on the desktop", () => {
		const view = playView();
		const { section } = renderView(
			{
				...view,
				header: view.header && {
					...view.header,
					strain: "NT",
					symbol: "NT",
					doubling: "XX",
				},
			},
			"desktop",
		);
		const row = section.sidebar.querySelector<HTMLElement>(
			'[data-testid="tricks-panel"] .tricks-counts',
		);
		if (!row) throw new Error("desktop trick count is missing");
		expect(row.textContent).toBe("2NTXXOur tricks2Target8Opponents'3");
		expectTwoRows(row);
	});

	it("lists connected mobile players without a disconnected row", () => {
		const original = playView();
		const view = {
			...original,
			seats: original.seats.map((player) =>
				player.seat === "E"
					? { ...player, presence: "offline" as const }
					: player,
			),
		};
		const { root } = renderMobile(view);
		const players = root.querySelector(".mobile-players-connected");
		expect(players?.textContent).toBe("Connected: playerS (S)  playerW (W)");
		expect(players?.textContent).not.toContain("Disconnected");
		expect(players?.textContent).not.toContain("playerE");
	});

	it("keeps the history and current trick with the board and places the actions below it", () => {
		const { root } = renderMobile(playView());
		const mobile = root.querySelector<HTMLElement>(".mobile-auction");
		const board = root.querySelector(".mobile-auction-board");
		const history = root.querySelector(".mobile-auction-bids .auction");
		const controls = root.querySelector(".mobile-auction-controls");
		expect(mobile?.hidden).toBe(false);
		expect(mobile && getComputedStyle(mobile).display).toBe("flex");
		expect(board && getComputedStyle(board).display).toBe("grid");
		expect(board?.querySelector(".mobile-board-center .trick")).not.toBeNull();
		expect(board?.querySelector(".mobile-auction-hand .hand")).not.toBeNull();
		expect(history).not.toBeNull();
		expect(history && getComputedStyle(history).display).toBe("table");
		expect(
			board?.querySelector(".mobile-board-top .hand:not(.backs)"),
		).not.toBeNull();
		expect(controls?.querySelector(".bid-box")).toBeNull();
		expect(controls?.querySelector(".play-controls")).not.toBeNull();
		expect(controls?.textContent).toContain("Claim …");
		expect(controls?.textContent).toContain("Claim all");
		expect(controls?.textContent).toContain("Undo");
	});

	it("marks trump in the declarer's hand and keeps the dummy's marker visible", () => {
		const { root } = renderMobile(playView());
		const ownTrump = root.querySelector<HTMLElement>(
			'.mobile-auction-hand .suit-group.trump[data-suit="S"]',
		);
		const dummyTrump = root.querySelector<HTMLElement>(
			'.mobile-board-top .suit-group.trump[data-suit="S"]',
		);
		const dummyHand = root.querySelector<HTMLElement>(".mobile-board-top");
		if (!ownTrump || !dummyTrump || !dummyHand)
			throw new Error("mobile trump hands are missing");

		expect(getComputedStyle(ownTrump).outlineStyle).toBe("solid");
		expect(getComputedStyle(dummyTrump).outlineStyle).toBe("solid");
		expect(getComputedStyle(dummyHand).overflow).toBe("visible");
	});

	it("keeps all thirteen declarer cards within the compact hand row", () => {
		const hand = {
			visible: true as const,
			suits: [
				{ suit: "S" as const, symbol: "♠", cards: [card("S4")], trump: true },
				{
					suit: "C" as const,
					symbol: "♣",
					cards: [card("CQ"), card("C4")],
					trump: false,
				},
				{
					suit: "D" as const,
					symbol: "♦",
					cards: [card("DT"), card("D4"), card("D2")],
					trump: false,
				},
				{
					suit: "H" as const,
					symbol: "♥",
					cards: [
						card("HK"),
						card("HT"),
						card("H8"),
						card("H5"),
						card("H4"),
						card("H3"),
						card("H2"),
					],
					trump: false,
				},
			],
		};
		const base = playView();
		const view = {
			...base,
			seats: base.seats.map((player) =>
				player.position === "bottom" ? { ...player, hand } : player,
			),
		};
		const { root } = renderMobile(view);
		const room = root.closest<HTMLElement>(".room");
		const row = root.querySelector<HTMLElement>(
			".mobile-auction-hand .hand-row",
		);
		if (!room || !row) throw new Error("declarer hand row is missing");
		room.style.width = "442px";
		// The root font size outlives the test's DOM, so the later tests get it back.
		document.documentElement.style.fontSize = "17.6px";
		try {
			const cards = [...row.querySelectorAll<HTMLElement>("[data-card]")];
			expect(cards).toHaveLength(13);
			const bounds = cards.map((item) => item.getBoundingClientRect());
			const rowBounds = row.getBoundingClientRect();
			expect(bounds.every((item) => item.width > 0)).toBe(true);
			const first = bounds[0];
			const last = bounds.at(-1);
			if (!first || !last) throw new Error("declarer card bounds are missing");
			expect(first.left).toBeGreaterThanOrEqual(rowBounds.left - 1);
			expect(last.right).toBeLessThanOrEqual(rowBounds.right + 1);
		} finally {
			document.documentElement.style.fontSize = "";
		}
	});

	it("fans each suit of a visible side hand in a row, within its board column", () => {
		const { root } = renderMobile(sideHandView());
		const room = root.closest<HTMLElement>(".room");
		const column = root.querySelector<HTMLElement>(".mobile-board-left");
		if (!room || !column) throw new Error("left board column is missing");
		room.style.width = "360px";

		const bounds = column.getBoundingClientRect();
		const rows = [...column.querySelectorAll<HTMLElement>(".suit-row")];
		expect(
			rows.map((row) => row.querySelectorAll("[data-card]").length),
		).toEqual([1, 7, 3, 2]);
		for (const row of rows) {
			const cards = [...row.querySelectorAll<HTMLElement>("[data-card]")].map(
				(item) => item.getBoundingClientRect(),
			);
			// Every card shows a strip of its own, left of the next card's strip.
			for (const [index, box] of cards.entries()) {
				expect(box.width, `card ${index}`).toBeGreaterThan(5);
				const next = cards[index + 1];
				if (next) expect(next.left).toBeGreaterThanOrEqual(box.right - 0.5);
			}
			const last = cards.at(-1);
			if (!last) throw new Error("suit row is empty");
			expect(cards[0]?.left).toBeGreaterThanOrEqual(bounds.left - 0.5);
			expect(last.right).toBeLessThanOrEqual(bounds.right + 0.5);
		}
	});

	it.each(["auction", "play"] as const)(
		"keeps the %s bid cells and their spacing compact on a phone",
		(phase) => {
			const { root } = renderMobile({ ...playView(), phase });
			// In play the history is folded; it is opened so that its cells have a size.
			const fold = root.querySelector<HTMLDetailsElement>(".mobile-bids-fold");
			if (fold) fold.open = true;
			const cell = root.querySelector<HTMLElement>(
				".mobile-auction-bids .auction td",
			);
			expect(cell?.checkVisibility()).toBe(true);
			const table = cell?.closest("table");
			if (!cell || !table) throw new Error("bid cell is missing");
			const font = Number.parseFloat(getComputedStyle(cell).fontSize);
			const rem = Number.parseFloat(
				getComputedStyle(document.documentElement).fontSize,
			);
			// The cell was 1.695 times its font size high, with 0.25rem between cells: now 30% lower, half the spacing.
			expect(cell.getBoundingClientRect().height / font).toBeLessThanOrEqual(
				0.7 * 1.695,
			);
			// Chrome rounds the spacing down to whole pixels.
			expect(
				Number.parseFloat(getComputedStyle(table).borderSpacing),
			).toBeLessThanOrEqual(0.125 * rem);
		},
	);

	it.each<Form>(["compact", "desktop"])(
		"frames only the trump cards of a %s side hand",
		(form) => {
			const { root } = renderView(sideHandView(), form);
			const trump = [
				...root.querySelectorAll<HTMLElement>(".hand-stack .suit-row.trump"),
			].find((row) => row.getBoundingClientRect().width > 0);
			if (!trump) throw new Error("trump row is missing");
			const frame = trump.getBoundingClientRect();
			const cards = [...trump.querySelectorAll<HTMLElement>("[data-card]")];
			expect(cards).toHaveLength(1);
			const last = cards[0]?.getBoundingClientRect();
			expect(frame.left).toBeCloseTo(last?.left ?? Number.NaN, 0);
			expect(frame.right).toBeCloseTo(last?.right ?? Number.NaN, 0);
		},
	);

	it("hides Claim … while more than five tricks remain, and keeps Claim all", () => {
		const { root } = renderMobile(playView());
		const buttons = [...root.querySelectorAll("button")];
		const claim = buttons.find((button) => button.textContent === "Claim …");
		const claimAll = buttons.find(
			(button) => button.textContent === "Claim all",
		);
		expect(claim?.hidden).toBe(true);
		expect(claimAll?.hidden).toBe(false);
		expect(
			root.querySelector<HTMLButtonElement>('[data-testid="claim-compact"]')
				?.hidden,
		).toBe(true);
	});

	it("asks how many of the remaining tricks the declarer takes, with a button for each count", () => {
		const view = playView();
		const { root, handlers } = renderMobile({
			...view,
			claim: { ...view.claim, maxTricks: 3, choosable: true },
		});
		const controls = root.querySelector<HTMLElement>(
			".mobile-auction-controls",
		);
		if (!controls) throw new Error("mobile controls are missing");

		const claim = [...controls.querySelectorAll("button")].find(
			(button) => button.textContent === "Claim …",
		);
		expect(claim?.hidden).toBe(false);
		claim?.click();
		const confirm = controls.querySelector<HTMLButtonElement>(
			'[data-testid="claim-confirm"]',
		);
		const counts = controls.querySelector<HTMLElement>(
			'[data-testid="claim-count"]',
		);
		if (!confirm || !counts) throw new Error("claim confirmation is missing");
		expect(
			controls.querySelector('[data-testid="claim-message"]')?.textContent,
		).toBe("How many of the remaining 3 tricks will you take?");
		const choices = [...counts.querySelectorAll("button")];
		expect(choices.map((button) => button.textContent)).toEqual([
			"0",
			"1",
			"2",
			"3",
		]);
		// The first tap chooses the count; only Confirm claim sends it.
		expect(confirm.disabled).toBe(true);
		choices[0]?.click();
		expect(handlers.claimRequest).not.toHaveBeenCalled();
		expect(
			[...counts.querySelectorAll("button")].map((button) =>
				button.getAttribute("aria-pressed"),
			),
		).toEqual(["true", "false", "false", "false"]);
		expect(confirm.disabled).toBe(false);
		confirm.click();
		expect(handlers.claimRequest).toHaveBeenCalledWith(1, 0);

		const claimAll = [...controls.querySelectorAll("button")].find(
			(button) => button.textContent === "Claim all",
		);
		claimAll?.click();
		confirm.click();
		expect(handlers.claimRequest).toHaveBeenLastCalledWith(1, 3);
	});

	it("uses the desktop claim confirmation and undo vote handlers", () => {
		const { root, handlers } = renderMobile(playView());
		const controls = root.querySelector<HTMLElement>(
			".mobile-auction-controls",
		);
		if (!controls) throw new Error("mobile controls are missing");
		const confirm = controls.querySelector<HTMLButtonElement>(
			'[data-testid="claim-confirm"]',
		);
		if (!confirm) throw new Error("claim confirmation is missing");

		const claimAll = [...controls.querySelectorAll("button")].find(
			(button) => button.textContent === "Claim all",
		);
		claimAll?.click();
		confirm.click();
		expect(handlers.claimRequest).toHaveBeenLastCalledWith(1, 12);

		const undo = [...controls.querySelectorAll("button")].find(
			(button) => button.textContent === "Undo",
		);
		undo?.click();
		expect(handlers.undoRequest).toHaveBeenCalledWith(1);
	});
});

describe("video tile", () => {
	it("shows an empty avatar and the seat and name in a large caption", () => {
		const { root } = renderView(playView(), "desktop");
		const tile = root.querySelector("[data-testid='tile-E']");
		// The caption already names the seat.
		expect(tile?.querySelector(".avatar")?.textContent).toBe("");
		const caption = tile?.querySelector(".tile-caption");
		if (caption === null || caption === undefined)
			throw new Error("no caption");
		expect(caption.textContent).toContain("E - playerE");
		const rem = Number.parseFloat(
			getComputedStyle(document.documentElement).fontSize,
		);
		// Half again the earlier 0.85rem.
		expect(Number.parseFloat(getComputedStyle(caption).fontSize)).toBeCloseTo(
			1.275 * rem,
			1,
		);
		// The larger text still fits in the caption bar.
		expect(caption.scrollHeight).toBeLessThanOrEqual(caption.clientHeight);
	});
});

describe("voice box", () => {
	/** A sine tone as a received audio track; gain 0 gives silence. */
	async function tone(gain: number) {
		// A page without a user gesture keeps its audio suspended.
		await userEvent.click(document.body);
		const context = new AudioContext();
		const oscillator = context.createOscillator();
		const volume = context.createGain();
		volume.gain.value = gain;
		const output = context.createMediaStreamDestination();
		oscillator.connect(volume).connect(output);
		oscillator.start();
		const track = output.stream.getAudioTracks()[0];
		if (track === undefined) throw new Error("no tone track");
		return { track, close: () => context.close() };
	}

	const remote = (
		seat: Seat,
		audio: MediaStreamTrack | undefined,
		video?: MediaStreamTrack,
	) => ({
		seat,
		status: "connected" as const,
		audio,
		video,
		peerSendsAudio: audio !== undefined,
		peerSendsVideo: video !== undefined,
		fault: undefined,
	});

	const callView = (remotes: ReturnType<typeof remote>[]) => ({
		available: true as const,
		view: {
			status: "subscribed" as const,
			canJoin: false,
			form: "desktop" as const,
			media: {
				send: ["audio", "video"] as const,
				receive: ["audio", "video"] as const,
			},
			requested: {
				inCall: true,
				send: { audio: true, video: false },
				receive: { audio: true, video: true },
			},
			mic: "on" as const,
			camera: "off" as const,
			localVideo: undefined,
			problem: undefined,
			remotes,
		},
	});

	function render(
		view: TableView,
		voicebox = true,
	): { root: HTMLElement; section: ReturnType<typeof tableSection> } {
		const meters = voiceMeters();
		const rendered = renderView(view, "desktop", undefined, undefined, {
			marks: () => ({ ...DEFAULT_SETTINGS, voicebox }),
			voiceMeters: meters,
		});
		return rendered;
	}

	const box = (root: HTMLElement, seat: Seat) => {
		const found = root.querySelector<HTMLElement>(
			`[data-testid='voicebox-${seat}']`,
		);
		if (found === null) throw new Error(`no voice box of ${seat}`);
		return found;
	};
	const lit = (root: HTMLElement, seat: Seat) =>
		box(root, seat).querySelectorAll("[data-lit]").length;
	const segments = (root: HTMLElement, seat: Seat) =>
		box(root, seat).querySelectorAll(".voicebox-segment").length;

	it("lights green bars from the middle on the tile of a voice without video, in place of the avatar", async () => {
		const loud = await tone(1);
		const quiet = await tone(0);
		const { root, section } = render(playView());
		section.renderCall(
			callView([remote("E", loud.track), remote("S", quiet.track)]),
		);
		expect(box(root, "E").checkVisibility()).toBe(true);
		expect(
			root.querySelector("[data-testid='tile-E'] .avatar")?.checkVisibility(),
		).toBe(false);
		// A loud tone lights every segment; silence lights none.
		await expect.poll(() => lit(root, "E")).toBe(segments(root, "E"));
		expect(segments(root, "E")).toBeGreaterThan(20);
		expect(box(root, "S").checkVisibility()).toBe(true);
		expect(lit(root, "S")).toBe(0);
		const segment = box(root, "E").querySelector("[data-lit]");
		if (segment === null) throw new Error("no lit segment");
		expect(getComputedStyle(segment).backgroundColor).toBe("rgb(46, 204, 64)");
		// The voice stops arriving: the avatar returns.
		section.renderCall(callView([remote("E", undefined)]));
		expect(box(root, "E").checkVisibility()).toBe(false);
		expect(
			root.querySelector("[data-testid='tile-E'] .avatar")?.checkVisibility(),
		).toBe(true);
		await loud.close();
		await quiet.close();
	});

	it("shows the video and no voice box while the camera picture arrives", async () => {
		const loud = await tone(1);
		const canvas = document.createElement("canvas");
		const camera = canvas.captureStream().getVideoTracks()[0];
		const { root, section } = render(playView());
		section.renderCall(callView([remote("E", loud.track, camera)]));
		expect(box(root, "E").checkVisibility()).toBe(false);
		camera?.stop();
		await loud.close();
	});

	it("shows no voice box while its setting is off", async () => {
		const loud = await tone(1);
		const { root, section } = render(playView(), false);
		section.renderCall(callView([remote("E", loud.track)]));
		expect(box(root, "E").checkVisibility()).toBe(false);
		await loud.close();
	});

	it("covers the bot image of a player who lets the bot play but speaks", async () => {
		const loud = await tone(1);
		const view = playView();
		const { root, section } = render({
			...view,
			seats: view.seats.map((player) =>
				player.seat === "E" ? { ...player, bot: true } : player,
			),
		});
		const overlay = root.querySelector("[data-testid='tile-E'] .bot-overlay");
		expect(overlay?.checkVisibility()).toBe(true);
		section.renderCall(callView([remote("E", loud.track)]));
		expect(box(root, "E").checkVisibility()).toBe(true);
		expect(overlay?.checkVisibility()).toBe(false);
		await loud.close();
	});
});

describe("call presence on the video tile", () => {
	it("shows a viewer outside the call the microphone and camera of a player in it, large and centred on the tile", () => {
		const { root, section } = renderView(playView(), "desktop");
		section.renderCall(
			{ available: false, reason: "" },
			{
				E: { sendsAudio: true, sendsVideo: false },
			},
		);
		const tile = root
			.querySelector("[data-testid='tile-E']")
			?.getBoundingClientRect();
		const badge = root.querySelector<HTMLElement>(
			"[data-testid='call-presence-E']",
		);
		expect(badge?.checkVisibility()).toBe(true);
		const icons = [...(badge?.querySelectorAll(".icon") ?? [])].map((icon) =>
			icon.getBoundingClientRect(),
		);
		expect(icons).toHaveLength(2);
		const rem = Number.parseFloat(
			getComputedStyle(document.documentElement).fontSize,
		);
		// Three times the earlier 0.9rem.
		for (const icon of icons) {
			expect(icon.width).toBeCloseTo(2.7 * rem, 0);
			expect(icon.height).toBeCloseTo(2.7 * rem, 0);
		}
		const box = badge?.getBoundingClientRect();
		if (tile === undefined || box === undefined) throw new Error("no tile");
		expect(box.left + box.width / 2).toBeCloseTo(tile.left + tile.width / 2, 0);
		expect(box.top + box.height / 2).toBeCloseTo(tile.top + tile.height / 2, 0);
	});
});

describe("round trip on the video tile", () => {
	const withRoundTrips = (
		roundTrips: Partial<Record<Seat, RoundTripView>>,
	): HTMLElement => {
		const view = playView();
		return renderView(
			{
				...view,
				seats: view.seats.map((player) => ({
					...player,
					roundTrip: roundTrips[player.seat],
				})),
			},
			"desktop",
		).root;
	};
	const caption = (root: HTMLElement, seat: Seat) =>
		root.querySelector<HTMLElement>(
			`[data-testid='tile-${seat}'] .tile-caption`,
		);
	const badge = (root: HTMLElement, seat: Seat) =>
		root.querySelector<HTMLElement>(`[data-testid='round-trip-${seat}']`);

	const bars = (root: HTMLElement, seat: Seat) =>
		badge(root, seat)?.querySelectorAll<HTMLElement>(".network-bar") ?? [];
	// The colour of each bar from the bottom; a bar that is not lit is grey.
	const lit = (root: HTMLElement, seat: Seat) =>
		[...bars(root, seat)]
			.map(
				(bar) =>
					[
						bar.getBoundingClientRect().bottom,
						getComputedStyle(bar).backgroundColor,
					] as const,
			)
			.sort((a, b) => b[0] - a[0])
			.map(([, colour]) => colour);
	const GREY = "rgb(124, 140, 130)";
	const GREEN = "rgb(46, 204, 64)";

	it("shows each player's network quality as five bars beside the video tile, with the text as the hint", () => {
		const cases = [
			["excellent", "0.05", [GREEN, GREEN, GREEN, GREEN, GREEN]],
			["good", "0.20", [GREEN, GREEN, GREEN, GREEN, GREY]],
			[
				"average",
				"0.40",
				Array(3).fill("rgb(253, 216, 53)").concat(GREY, GREY),
			],
			[
				"poor",
				"1.50",
				Array(2).fill("rgb(255, 152, 0)").concat(GREY, GREY, GREY),
			],
			["breaking-up", "2.50", ["rgb(229, 57, 53)", GREY, GREY, GREY, GREY]],
		] as const;
		for (const [quality, seconds, colours] of cases) {
			const text = `Network: ${quality.replace("-", " ")}`;
			const root = withRoundTrips({
				E: { text, title: `Roundtrip: ${seconds}sec`, quality },
			});
			expect(lit(root, "E"), quality).toEqual(colours);
			expect(badge(root, "E")?.title).toBe(`${text}\nRoundtrip: ${seconds}sec`);
			expect(badge(root, "E")?.getAttribute("aria-label")).toBe(
				`${text}, Roundtrip: ${seconds}sec`,
			);
			expect(caption(root, "E")?.textContent).toBe("E - playerE");
		}
	});

	it("stands the bars outside the tile's right edge, level with its bottom", () => {
		const root = withRoundTrips({
			E: {
				text: "Network: good",
				title: "Roundtrip: 0.20sec",
				quality: "good",
			},
		});
		const tile = root
			.querySelector("[data-testid='tile-E']")
			?.getBoundingClientRect();
		const bar = badge(root, "E")?.getBoundingClientRect();
		expect(tile).toBeDefined();
		expect(bar).toBeDefined();
		if (tile === undefined || bar === undefined) return;
		expect(bar.width).toBeGreaterThan(0);
		expect(bar.left).toBeGreaterThanOrEqual(tile.right);
		expect(bar.left - tile.right).toBeLessThan(8);
		expect(Math.abs(bar.bottom - tile.bottom)).toBeLessThan(1);
		expect(bar.height).toBeGreaterThan(bar.width);
	});

	it("keeps the bars of both right-hand tiles inside the felt", () => {
		const good = {
			text: "Network: good",
			title: "Roundtrip: 0.20sec",
			quality: "good",
		} as const;
		const root = withRoundTrips({ S: good, W: good });
		const felt = root.querySelector(".felt")?.getBoundingClientRect();
		expect(felt).toBeDefined();
		for (const seat of ["S", "W"] as const) {
			const bar = badge(root, seat)?.getBoundingClientRect();
			expect(bar?.width ?? 0, seat).toBeGreaterThan(0);
			if (felt === undefined || bar === undefined) return;
			// At least half a bar of felt to the right of the bars.
			expect(felt.right - bar.right, seat).toBeGreaterThanOrEqual(
				bar.width / 2,
			);
		}
	});

	it("shows five grey bars while the host has not measured the player yet", () => {
		const root = withRoundTrips({
			E: { text: "Network: measuring…", quality: "pending" },
		});
		expect(lit(root, "E")).toEqual(Array(5).fill(GREY));
		expect(badge(root, "E")?.title).toBe("Network: measuring…");
	});

	it("shows nothing for a seat that the host does not measure", () => {
		const { root } = renderView(playView(), "desktop");
		expect(
			root.querySelector("[data-testid='tile-E'] .tile-caption")?.textContent,
		).toBe("E - playerE");
		expect(badge(root, "E")?.checkVisibility() ?? false).toBe(false);
	});
});

describe("mobile folds", () => {
	const shown = (root: HTMLElement, selector: string) =>
		root.querySelector<HTMLElement>(selector)?.checkVisibility() ?? false;

	it.each<Layout>(["desktop", "sideways", "compact"])(
		"scales the scrollable bidding history height with the suit font (%s)",
		(layout) => {
			const base = playView();
			if (!base.auction) throw new Error("missing auction");
			renderView(
				{
					...base,
					phase: "auction",
					auction: {
						...base.auction,
						rows: Array.from({ length: 12 }, () => [
							"1♣",
							"Pass",
							"2♦",
							"Pass",
						]),
					},
				},
				layout,
			);
			const window = document.querySelector<HTMLElement>(".auction-scroll");
			if (!window) throw new Error("missing bidding history");
			try {
				document.documentElement.dataset.suitFontSize = "M";
				const medium = window.getBoundingClientRect().height;
				expect(window.scrollHeight).toBeGreaterThan(window.clientHeight);
				for (const [size, scale] of [
					["S", 0.75],
					["M", 1],
					["L", 1.25],
					["XL", 1.5],
					["XXL", 1.75],
					["XXXL", 2],
				] as const) {
					document.documentElement.dataset.suitFontSize = size;
					expect(window.getBoundingClientRect().height, size).toBeCloseTo(
						medium * scale,
						0,
					);
					if (layout === "compact" && scale <= 1) continue;
					const rows = [
						...window.querySelectorAll<HTMLTableRowElement>("tbody tr"),
					];
					if (size === "XXXL" && window.scrollWidth > window.clientWidth) {
						window.scrollLeft = window.scrollWidth;
						const lastCell =
							rows[0]?.querySelector<HTMLElement>("td:last-child");
						if (!lastCell) throw new Error("missing last bidding cell");
						expect(lastCell.getBoundingClientRect().right).toBeLessThanOrEqual(
							window.getBoundingClientRect().right + 1,
						);
					}
					for (const [index, row] of rows.entries()) {
						const next = rows[index + 1];
						if (!next) continue;
						for (const mark of row.querySelectorAll<HTMLElement>(
							".bid-mark, .call-pass",
						)) {
							const text = document.createRange();
							text.selectNodeContents(mark);
							expect(
								text.getBoundingClientRect().bottom,
								`${layout} ${size}`,
							).toBeLessThanOrEqual(next.getBoundingClientRect().top + 1);
						}
					}
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);

	it.each<[number, number, string]>([
		[320, 568, "M"],
		[390, 844, "XXXL"],
	])(
		"keeps the bid box on the phone board and the history open during bidding (%i × %i, %s)",
		async (width, height, size) => {
			await page.viewport(width, height);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const base = playView();
				const view = {
					...base,
					phase: "auction" as const,
					bids: [
						{ call: "1C" as const, text: "1♣" },
						{ call: "P" as const, text: "Pass" },
					],
				};
				const { root, section, handlers } = renderMobile(view);
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				const hand = root.querySelector<HTMLElement>(".mobile-auction-hand");
				const box = root.querySelector<HTMLElement>(".bid-box");
				const history =
					root.querySelector<HTMLDetailsElement>(".mobile-bids-fold");
				if (!board || !hand || !box || !history)
					throw new Error("missing mobile bidding elements");
				expect(board.contains(box)).toBe(true);
				const boardRect = board.getBoundingClientRect();
				const boxRect = box.getBoundingClientRect();
				expect((boxRect.left + boxRect.right) / 2).toBeCloseTo(
					(boardRect.left + boardRect.right) / 2,
					0,
				);
				expect(boxRect.top).toBeGreaterThanOrEqual(boardRect.top);
				expect(boxRect.bottom).toBeLessThanOrEqual(
					hand.getBoundingClientRect().top + 0.5,
				);
				for (const button of box.querySelectorAll<HTMLElement>(
					".bid-levels button, .bid-calls button",
				)) {
					const rect = button.getBoundingClientRect();
					expect(rect.left).toBeGreaterThanOrEqual(boxRect.left - 0.5);
					expect(rect.right).toBeLessThanOrEqual(boxRect.right + 0.5);
					const text = document.createRange();
					text.selectNodeContents(button);
					expect(
						text.getBoundingClientRect().left,
						button.textContent ?? "",
					).toBeGreaterThanOrEqual(rect.left - 0.5);
					expect(
						text.getBoundingClientRect().right,
						button.textContent ?? "",
					).toBeLessThanOrEqual(rect.right + 0.5);
				}
				expect(history.open).toBe(true);
				history.querySelector<HTMLElement>("summary")?.click();
				expect(history.open).toBe(true);
				box.querySelector<HTMLButtonElement>(".bid-calls .pass")?.click();
				box.querySelector<HTMLButtonElement>(".confirm")?.click();
				expect(handlers.act).toHaveBeenCalledWith({ type: "call", call: "P" });
				section.render(base);
				expect(history.open).toBe(false);
				expect(board.querySelector(".bid-box")).toBeNull();
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);

	it("does not reserve a screen of empty space below the folded bot controls", () => {
		const { root, section } = renderMobile(playView());
		section.setBotControls(true, []);
		const stage = root.closest<HTMLElement>(".stage");
		const fold = root.querySelector<HTMLDetailsElement>(".mobile-bot-fold");
		if (!stage || !fold)
			throw new Error("missing mobile stage or bot controls");
		expect(fold.open).toBe(false);
		expect(
			stage.getBoundingClientRect().bottom -
				fold.getBoundingClientRect().bottom,
		).toBeLessThan(24);
		fold.open = true;
		expect(shown(root, ".mobile-player-control button")).toBe(true);
		expect(
			stage.getBoundingClientRect().bottom -
				fold.getBoundingClientRect().bottom,
		).toBeLessThan(24);
		fold.open = false;
		expect(
			stage.getBoundingClientRect().bottom -
				fold.getBoundingClientRect().bottom,
		).toBeLessThan(24);
	});

	it("folds the bidding history in play, and a click opens and folds it", () => {
		const { root, section } = renderMobile({
			...playView(),
			phase: "auction",
		});
		const cell = ".mobile-auction-bids .auction td";
		expect(shown(root, cell)).toBe(true);
		section.render(playView());
		expect(shown(root, cell)).toBe(false);
		const title = root.querySelector<HTMLElement>(
			".mobile-auction-bids summary",
		);
		expect(title?.textContent).toBe("Bidding history");
		title?.click();
		expect(shown(root, cell)).toBe(true);
		// A new render in play keeps the player's choice.
		section.render(playView());
		expect(shown(root, cell)).toBe(true);
		title?.click();
		expect(shown(root, cell)).toBe(false);
		section.render({ ...playView(), phase: "auction" });
		expect(shown(root, cell)).toBe(true);
	});

	it("folds the bot switches by default, and a click opens them", () => {
		const { root, section } = renderMobile({
			...playView(),
			phase: "auction",
		});
		section.setBotControls(true, []);
		const toggle = ".mobile-player-control button";
		expect(root.querySelector(toggle)?.textContent).toBe("🤖 Switch to bot");
		expect(shown(root, toggle)).toBe(false);
		const title = root.querySelector<HTMLElement>(
			".mobile-auction-players summary",
		);
		expect(title?.textContent).toBe("🤖 Optional automated players");
		title?.click();
		expect(shown(root, toggle)).toBe(true);
		section.render(playView());
		section.setBotControls(true, ["E"]);
		expect(shown(root, toggle)).toBe(true);
	});
});

describe("mobile top bar and round status", () => {
	const roundView = (): TableView => ({
		...playView(),
		board: 3,
		statistics: {
			ew: { won: 3, lost: 1, total: 1250 },
			ns: { won: 1, lost: 3, total: 1000 },
		},
	});
	const records = (root: HTMLElement) =>
		[...root.querySelectorAll(".mobile-round-record")].map(
			(record) => record.textContent,
		);

	it("shows the points of each side after the won and lost balance", () => {
		const { root } = renderMobile(roundView());
		expect(root.querySelector(".mobile-round-number")?.textContent).toBe(
			"Round 3: 2♣",
		);
		expect(records(root)).toEqual(["E-W: +2 (1250p)", "N-S: -2 (1000p)"]);
	});

	it.each<TableView["phase"]>(["auction", "play"])(
		"shows under the points of each side whether that side is vulnerable (%s)",
		(phase) => {
			const { root } = renderMobile({
				...roundView(),
				phase,
				vulnerability: NS_VULNERABLE,
			});
			const sides = [
				...root.querySelectorAll<HTMLElement>(".mobile-round-side"),
			].map((side) => {
				const record = side.querySelector(".mobile-round-record");
				const status = side.querySelector<HTMLElement>(
					".mobile-round-vulnerability",
				);
				if (!record || !status) throw new Error("a record and a status");
				expect(status.checkVisibility()).toBe(true);
				const above = record.getBoundingClientRect();
				const below = status.getBoundingClientRect();
				expect(below.top).toBeGreaterThanOrEqual(above.bottom - 0.5);
				expect(below.left).toBeLessThan(above.right);
				expect(below.right).toBeGreaterThan(above.left);
				return [
					record.textContent,
					status.textContent,
					status.dataset.vulnerable,
					getComputedStyle(status).color,
				];
			});
			expect(sides).toEqual([
				["E-W: +2 (1250p)", "not vulnerable", "false", expect.any(String)],
				["N-S: -2 (1000p)", "vulnerable", "true", "rgb(192, 38, 45)"],
			]);
		},
	);

	it("translates the points mark", () => {
		const { root } = renderView(
			roundView(),
			"compact",
			undefined,
			translator("de"),
		);
		expect(records(root)).toEqual(["O-W: +2 (1250P)", "N-S: -2 (1000P)"]);
	});

	it("shows the contract after the round number while a contract exists", () => {
		const number = (view: TableView) =>
			renderMobile(view).root.querySelector(".mobile-round-number")
				?.textContent;
		expect(number(roundView())).toBe("Round 3: 2♣");
		const doubled = roundView();
		expect(
			number({
				...doubled,
				header: doubled.header && { ...doubled.header, doubling: "X" },
			}),
		).toBe("Round 3: 2♣X");
		expect(
			number({ ...roundView(), phase: "auction", header: undefined }),
		).toBe("Round 3");
	});

	it("marks the side of the viewer bold and underlined", () => {
		const { root } = renderMobile(roundView());
		const marks = [
			...root.querySelectorAll<HTMLElement>(".mobile-round-label"),
		].map((label) => {
			const style = getComputedStyle(label);
			return [
				label.textContent,
				Number(style.fontWeight) >= 700,
				style.textDecorationLine,
			];
		});
		expect(marks).toEqual([
			["E-W", false, "none"],
			["N-S", true, "underline"],
		]);
	});

	it("folds the previous game statistics under the round line, and a click opens and folds them", () => {
		const { root } = renderMobile(roundView());
		const status = root.querySelector<HTMLDetailsElement>(
			'[data-testid="mobile-round-status"]',
		);
		const table = root.querySelector<HTMLElement>(
			'[data-testid="mobile-scores"]',
		);
		const line = status?.querySelector<HTMLElement>(":scope > summary");
		if (!status || !table || !line)
			throw new Error("the round status, its line and its table");
		expect(line.querySelector(".mobile-round-number")).not.toBeNull();
		expect(table.checkVisibility()).toBe(false);
		line.click();
		expect(table.checkVisibility()).toBe(true);
		expect(table.querySelector("caption")?.textContent).toBe(
			"Previous game statistics",
		);
		expect(
			[...table.querySelectorAll("tr")].map((row) =>
				[...row.children].map((cell) => cell.textContent),
			),
		).toEqual([
			["", "E-W", "N-S"],
			["Deals won", "3", "1"],
			["Deals lost", "1", "3"],
			["Total score", "1250", "1000"],
		]);
		const total = table.querySelector<HTMLElement>("tr:last-child th");
		expect(total && Number(getComputedStyle(total).fontWeight)).toBe(700);
		line.click();
		expect(table.checkVisibility()).toBe(false);
	});

	it("puts Reload beside New table, and each button calls its own handler", () => {
		const { root, handlers } = renderMobile(roundView());
		const topbar = root.querySelector<HTMLElement>(".mobile-auction-topbar");
		const named = (name: string) =>
			[...(topbar?.querySelectorAll("button") ?? [])].find(
				(control) =>
					(control.getAttribute("aria-label") ?? control.textContent) === name,
			);
		named("Reload")?.click();
		expect(handlers.reload).toHaveBeenCalledOnce();
		expect(handlers.exit).not.toHaveBeenCalled();
		named("New table")?.click();
		expect(handlers.exit).toHaveBeenCalledOnce();
		expect(handlers.reload).toHaveBeenCalledOnce();
	});
});

describe("approval of an undo or a claim", () => {
	/** Sets the viewport and waits for the window's resize event. */
	async function resizeTo(width: number, height: number): Promise<void> {
		if (innerWidth === width && innerHeight === height) return;
		const resized = new Promise((resolve) =>
			addEventListener("resize", resolve, { once: true }),
		);
		await page.viewport(width, height);
		await resized;
	}

	const QUESTION = "playerW asks to undo their last bid. Do you approve?";
	const auctionUndo = (undo: Partial<TableView["undo"]> = {}): TableView => ({
		...playView(),
		phase: "auction",
		yourTurn: false,
		trick: undefined,
		undo: {
			canRequest: false,
			message: QUESTION,
			requestId: "undo-1",
			canVote: true,
			canCancel: false,
			...undo,
		},
	});
	const playUndo = (): TableView => ({
		...playView(),
		undo: {
			canRequest: false,
			message: "playerW asks to undo their last played card. Do you approve?",
			requestId: "undo-1",
			canVote: true,
			canCancel: false,
		},
	});
	const playClaim = (): TableView => ({
		...playView(),
		undo: { ...playView().undo, canRequest: false },
		claim: {
			canRequest: false,
			maxTricks: 0,
			choosable: false,
			requestId: "claim-1",
			requester: "playerW",
			tricks: 3,
			message: "playerW claims 3 tricks. Do you accept the claim?",
			canVote: true,
		},
	});
	type Case = [
		string,
		() => TableView,
		string,
		string,
		keyof Pick<TableHandlers, "undoVote" | "claimVote">,
		string,
	];
	const CASES: Case[] = [
		[
			"an undo in the auction",
			auctionUndo,
			"Approve undo",
			"Reject undo",
			"undoVote",
			"undo-1",
		],
		[
			"an undo in play",
			playUndo,
			"Approve undo",
			"Reject undo",
			"undoVote",
			"undo-1",
		],
		[
			"a claim in play",
			playClaim,
			"Accept claim",
			"Reject claim",
			"claimVote",
			"claim-1",
		],
	];

	const approval = (root: HTMLElement) => {
		const found = root.querySelector<HTMLElement>('[data-testid="approval"]');
		if (!found) throw new Error("the approval panel is missing");
		return found;
	};
	const feltBox = (root: HTMLElement) => {
		const felt = root.querySelector<HTMLElement>(".felt");
		if (!felt) throw new Error("the felt is missing");
		return felt.getBoundingClientRect();
	};
	/** The panel is in the middle of the felt, and the felt is not in the middle of the screen. */
	function expectCentredIn(panel: HTMLElement, felt: DOMRect): void {
		const box = panel.getBoundingClientRect();
		const feltX = felt.left + felt.width / 2;
		const feltY = felt.top + felt.height / 2;
		expect(
			Math.hypot(feltX - innerWidth / 2, feltY - innerHeight / 2),
		).toBeGreaterThan(20);
		expect(Math.abs(box.left + box.width / 2 - feltX)).toBeLessThan(2);
		expect(Math.abs(box.top + box.height / 2 - feltY)).toBeLessThan(2);
	}
	const visibleButtons = (text: string) =>
		[...document.querySelectorAll<HTMLButtonElement>("button")].filter(
			(button) => button.textContent === text && button.checkVisibility(),
		);
	/** Clicks the button where a pointer would land on it, so a covering element fails the test. */
	function pointerClick(button: HTMLElement): void {
		const box = button.getBoundingClientRect();
		const hit = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		expect(hit?.closest("button")).toBe(button);
		(hit as HTMLElement).click();
	}
	/** The hue of a computed rgb() color, in degrees. */
	function hue(color: string): number {
		const [r = 0, g = 0, b = 0] = (color.match(/\d+/g) ?? []).map(Number);
		const max = Math.max(r, g, b);
		const range = max - Math.min(r, g, b);
		if (range === 0) return Number.NaN;
		const degrees =
			max === r
				? ((g - b) / range) * 60
				: max === g
					? ((b - r) / range + 2) * 60
					: ((r - g) / range + 4) * 60;
		return (degrees + 360) % 360;
	}
	function expectColors(panel: HTMLElement, accept: string, reject: string) {
		const question = panel.querySelector<HTMLElement>("p");
		if (!question) throw new Error("the question is missing");
		const style = getComputedStyle(question);
		expect(style.fontWeight).toBe("400");
		expect(style.fontStyle).toBe("normal");
		expect(question.textContent).toMatch(/\?$/);
		const [acceptButton] = visibleButtons(accept);
		const [rejectButton] = visibleButtons(reject);
		if (!acceptButton || !rejectButton) throw new Error("a button is missing");
		const green = hue(getComputedStyle(acceptButton).backgroundColor);
		expect(green).toBeGreaterThanOrEqual(90);
		expect(green).toBeLessThanOrEqual(170);
		const red = hue(getComputedStyle(rejectButton).backgroundColor);
		expect(Math.min(red, 360 - red)).toBeLessThanOrEqual(20);
	}

	it.each(CASES)(
		"asks about %s in a large dialog in the middle of a desktop felt",
		async (_, view, accept, reject, vote, id) => {
			// The screen is taller than the felt, so the middle of the felt is not the middle of the screen.
			await resizeTo(1280, 900);
			const { root, handlers } = renderView(view(), "desktop");
			const panel = approval(root);
			expect(panel.checkVisibility()).toBe(true);
			const felt = feltBox(root);
			expectCentredIn(panel, felt);
			expect(panel.getBoundingClientRect().width).toBeGreaterThanOrEqual(480);
			// The felt does not take a click past the dialog; the sidebar beside the felt does.
			const corner = document.elementFromPoint(felt.left + 5, felt.top + 5);
			expect(panel.contains(corner)).toBe(false);
			expect(corner?.closest(".approval-backdrop")).not.toBeNull();
			const sidebar =
				root.parentElement?.parentElement?.querySelector(".table-sidebar");
			if (!(sidebar instanceof HTMLElement))
				throw new Error("the sidebar is missing");
			const side = sidebar.getBoundingClientRect();
			expect(
				document
					.elementFromPoint(side.left + 5, side.top + 5)
					?.closest(".approval-backdrop"),
			).toBeNull();
			// Only the dialog has the buttons.
			expect(visibleButtons(accept)).toHaveLength(1);
			expect(visibleButtons(reject)).toHaveLength(1);
			expect(visibleButtons("Approve")).toHaveLength(0);
			expect(visibleButtons("Reject")).toHaveLength(0);
			expectColors(panel, accept, reject);
			const [acceptButton] = visibleButtons(accept);
			const [rejectButton] = visibleButtons(reject);
			if (!acceptButton || !rejectButton)
				throw new Error("a button is missing");
			pointerClick(acceptButton);
			expect(handlers[vote]).toHaveBeenLastCalledWith(id, true);
			pointerClick(rejectButton);
			expect(handlers[vote]).toHaveBeenLastCalledWith(id, false);
		},
	);

	it.each(CASES)(
		"asks about %s directly below the board on a phone",
		async (_, view, accept, reject, vote, id) => {
			await resizeTo(400, 860);
			const { root, handlers } = renderMobile(view());
			const panel = approval(root);
			expect(panel.checkVisibility()).toBe(true);
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			if (!board) throw new Error("the board is missing");
			expect(board.nextElementSibling).toBe(panel);
			expect(getComputedStyle(panel).position).not.toBe("fixed");
			const gap =
				panel.getBoundingClientRect().top -
				board.getBoundingClientRect().bottom;
			expect(gap).toBeGreaterThanOrEqual(0);
			expect(gap).toBeLessThan(16);
			expect(visibleButtons(accept)).toHaveLength(1);
			expect(visibleButtons(reject)).toHaveLength(1);
			expectColors(panel, accept, reject);
			const [acceptButton] = visibleButtons(accept);
			if (!acceptButton) throw new Error("the accept button is missing");
			pointerClick(acceptButton);
			expect(handlers[vote]).toHaveBeenLastCalledWith(id, true);
		},
	);

	it("shows no dialog on a desktop after the player decided or to the requester", async () => {
		await resizeTo(1280, 800);
		const decided = renderView(
			auctionUndo({ canVote: false, message: "Waiting for playerE." }),
			"desktop",
		);
		expect(approval(decided.root).checkVisibility()).toBe(false);
		const requester = renderView(
			auctionUndo({ canVote: false, canCancel: true }),
			"desktop",
		);
		expect(approval(requester.root).checkVisibility()).toBe(false);
		expect(visibleButtons("Cancel undo")).toHaveLength(1);
	});

	it("lets the requester cancel an undo below the board on a phone", async () => {
		await resizeTo(400, 860);
		const { root, handlers } = renderMobile(
			auctionUndo({
				canVote: false,
				canCancel: true,
				message: "You ask to undo your last bid.",
			}),
		);
		const panel = approval(root);
		expect(panel.checkVisibility()).toBe(true);
		expect(panel.textContent).toContain("You ask to undo your last bid.");
		const [cancel] = visibleButtons("Cancel undo");
		if (!cancel) throw new Error("Cancel undo is missing");
		expect(panel.contains(cancel)).toBe(true);
		pointerClick(cancel);
		expect(handlers.undoCancel).toHaveBeenCalledWith("undo-1");
	});

	it("asks about an undo below the felt on a phone after the play", async () => {
		await resizeTo(400, 860);
		const { root } = renderMobile({ ...auctionUndo(), phase: "complete" });
		const panel = approval(root);
		expect(panel.checkVisibility()).toBe(true);
		expect(root.querySelector(".felt")?.nextElementSibling).toBe(panel);
		expect(getComputedStyle(panel).position).not.toBe("fixed");
		expect(root.querySelector(".approval-backdrop")?.checkVisibility()).toBe(
			false,
		);
	});

	const WAITING = "Waiting for South to come back";
	const waiting = (root: HTMLElement) => {
		const found = root.querySelector<HTMLElement>('[data-testid="waiting"]');
		if (!found) throw new Error("the waiting notice is missing");
		return found;
	};

	it("names absent players in the middle of a desktop felt, and lets clicks through", async () => {
		await resizeTo(1280, 800);
		// The table model writes the notice in the viewer's language.
		const { root } = renderView(
			{ ...playView(), waiting: "Warten auf die Rückkehr von Süden" },
			"desktop",
			undefined,
			translator("de"),
		);
		const notice = waiting(root);
		expect(notice.checkVisibility()).toBe(true);
		expect(notice.getAttribute("role")).toBe("status");
		expect(notice.textContent).toBe("Warten auf die Rückkehr von Süden");
		expectCentredIn(notice, feltBox(root));
		const box = notice.getBoundingClientRect();
		const hit = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		expect(notice.contains(hit)).toBe(false);
	});

	it("names the players and their seats that the host waits for, in the viewer's language", () => {
		renderView(
			{
				...playView(),
				actions: [
					{
						id: "local-1",
						text: "Ansage 1♠",
						state: "pending",
						reason: "Waiting for East and West to come back",
					},
				],
			},
			"desktop",
			undefined,
			translator("de"),
		);
		expect(
			document.querySelector("[data-testid='table-actions'] .status")
				?.textContent,
		).toBe("Warten auf die Rückkehr von playerE (O) und playerW (W)");
	});

	it("shows no waiting notice while nobody is absent", async () => {
		await resizeTo(1280, 800);
		expect(
			waiting(renderView(playView(), "desktop").root).checkVisibility(),
		).toBe(false);
		await resizeTo(400, 860);
		expect(waiting(renderMobile(playView()).root).checkVisibility()).toBe(
			false,
		);
	});

	it("names absent players below the board on a phone, after an approval", async () => {
		await resizeTo(400, 860);
		const { root } = renderMobile({ ...auctionUndo(), waiting: WAITING });
		const board = root.querySelector<HTMLElement>(".mobile-auction-board");
		const notice = waiting(root);
		expect(notice.checkVisibility()).toBe(true);
		expect(notice.textContent).toBe(WAITING);
		expect(board?.nextElementSibling).toBe(approval(root));
		expect(approval(root).nextElementSibling).toBe(notice);
		expect(getComputedStyle(notice).position).not.toBe("fixed");
	});

	// Network messages are white on red, so that nobody misses them.
	const ALERT = ["rgb(179, 38, 30)", "rgb(255, 255, 255)"];
	const colours = (element: Element | null) => {
		if (!element) throw new Error("the message is missing");
		const style = getComputedStyle(element);
		return [style.backgroundColor, style.color];
	};

	it.each(["desktop", "compact"] as const)(
		"shows the waiting notice in white on red (%s)",
		(form) => {
			const { root } = renderView({ ...playView(), waiting: WAITING }, form);
			expect(colours(waiting(root))).toEqual(ALERT);
		},
	);

	it.each(["desktop", "compact"] as const)(
		"shows the connection to the host in white on red (%s)",
		(form) => {
			const base = playView();
			const { root } = renderView(
				{
					...base,
					seats: base.seats.map((player) =>
						player.seat === "E" ? { ...player, connecting: true } : player,
					),
				},
				form,
			);
			expect(colours(root.querySelector(".connecting"))).toEqual(ALERT);
		},
	);

	it("shows the room banner in white on red", () => {
		renderView(playView(), "desktop");
		const banner = document.createElement("div");
		banner.className = "banner";
		banner.textContent = "Waiting for the host (12 s)";
		document.body.append(banner);
		expect(colours(banner)).toEqual(ALERT);
	});
});

describe("hand points", () => {
	// ♠AKQ32 ♥K ♦J432 ♣432: 13 HCP, a good spade suit, a singleton king, and a singleton in a 5431 hand.
	const HAND: readonly Card[] = [
		"SA",
		"SK",
		"SQ",
		"S3",
		"S2",
		"HK",
		"DJ",
		"D4",
		"D3",
		"D2",
		"C4",
		"C3",
		"C2",
	];
	const LINES = [
		"A=4, K=3, Q=2, J=1: 13",
		"+1 good suit ♠AKQ32",
		"-1 singleton honour ♥K",
		"+2 singleton ♥ (5431)",
	];
	const pointsView = (): TableView => {
		const base = playView();
		return {
			...base,
			phase: "auction",
			trick: undefined,
			seats: base.seats.map((player) =>
				player.position === "bottom" ? { ...player, pointCards: HAND } : player,
			),
		};
	};
	const pill = (root: HTMLElement) =>
		root.querySelector<HTMLButtonElement>(".hcp-pill");
	const dialog = (root: HTMLElement) =>
		root.querySelector<HTMLDialogElement>(".points-dialog");

	it.each(["desktop", "compact"] as const)(
		"hints the calculation of the points, one line each, and a click shows the same in a dialog with only OK (%s)",
		(form) => {
			const { root } = renderView(pointsView(), form, undefined, undefined, {
				pointSystem: () => "hcp-corrected",
			});
			const shownPill = pill(root);
			expect(shownPill?.textContent).toBe("corrected HCP: 15 (13 +2)");
			expect(shownPill?.title).toBe(LINES.join("\n"));
			expect(shownPill?.getBoundingClientRect().width).toBeGreaterThan(0);
			if (form === "compact")
				expect(shownPill?.closest(".mobile-auction-hand")).not.toBeNull();
			shownPill?.click();
			const points = dialog(root);
			expect(points?.open).toBe(true);
			expect(points?.querySelector("h3")?.textContent).toBe(
				"corrected HCP: 15 (13 +2)",
			);
			expect(
				[...(points?.querySelectorAll("li") ?? [])].map(
					(line) => line.textContent,
				),
			).toEqual(LINES);
			// Each suit symbol has the colour of its suit: red hearts and diamonds, as on the cards.
			const red = document.createElement("span");
			red.style.color = "var(--red-suit)";
			points?.append(red);
			const marks = [...(points?.querySelectorAll("li") ?? [])].flatMap(
				(line) =>
					[...line.querySelectorAll("span")].map((mark) => ({
						text: mark.textContent,
						red: getComputedStyle(mark).color === getComputedStyle(red).color,
					})),
			);
			red.remove();
			expect(marks).toEqual([
				{ text: "♠", red: false },
				{ text: "♥", red: true },
				{ text: "♥", red: true },
			]);
			const buttons = [...(points?.querySelectorAll("button") ?? [])];
			expect(buttons.map((ok) => ok.textContent)).toEqual(["OK"]);
			buttons[0]?.click();
			expect(points?.open).toBe(false);
		},
	);

	it("on a narrow phone, the points pill is whole and covers no name or role of the own hand", async () => {
		await page.viewport(360, 800);
		try {
			const { root } = renderView(pointsView(), "compact");
			const shownPill = pill(root);
			const area = root.querySelector(".mobile-auction-hand");
			if (!shownPill || !area) throw new Error("the pill is missing");
			const box = shownPill.getBoundingClientRect();
			const inside = area.getBoundingClientRect();
			expect(box.left).toBeGreaterThanOrEqual(inside.left);
			expect(box.right).toBeLessThanOrEqual(inside.right);
			expect(shownPill.scrollWidth).toBeLessThanOrEqual(shownPill.clientWidth);
			const chips = [
				...(area.querySelectorAll<HTMLElement>(".seat-label > *") ?? []),
			];
			expect(chips.length).toBeGreaterThan(1);
			for (const chip of chips) {
				const other = chip.getBoundingClientRect();
				const overlaps =
					box.left < other.right &&
					other.left < box.right &&
					box.top < other.bottom &&
					other.top < box.bottom;
				expect(overlaps, chip.textContent ?? "").toBe(false);
			}
		} finally {
			await page.viewport(414, 896);
		}
	});

	it("counts on the scale of the settings at each render, counts HCP for an other system, and shows no points when the card points are off", () => {
		let scale: PointSystem = "vienna";
		let shown = true;
		const { root, section } = renderView(
			pointsView(),
			"desktop",
			undefined,
			undefined,
			{ pointSystem: () => scale, cardPoints: () => shown },
		);
		expect(pill(root)?.textContent).toBe("Vienna: 21");
		expect(pill(root)?.title).toBe("A=7, K=5, Q=3, J=1: 21");
		scale = "other";
		section.render(pointsView());
		expect(pill(root)?.textContent).toMatch(/^HCP: \d+$/);
		shown = false;
		section.render(pointsView());
		expect(pill(root)).toBeNull();
	});

	it("shows the dialog in the language of the table", () => {
		const { root } = renderView(
			pointsView(),
			"desktop",
			undefined,
			translator("de"),
			{ locale: "de", pointSystem: () => "hcp-corrected" },
		);
		pill(root)?.click();
		expect(dialog(root)?.querySelector("li:last-child")?.textContent).toBe(
			"+2 Single ♥ (5431)",
		);
		expect(dialog(root)?.querySelector("button")?.textContent).toBe("OK");
	});
});

describe("bidding guide", () => {
	const auction = (): TableView => ({
		...playView(),
		phase: "auction",
		trick: undefined,
		bids: [
			{ call: "1C", text: "1♣" },
			{ call: "P", text: "Pass" },
		],
	});
	const guide = (root: HTMLElement) =>
		root.querySelector<HTMLDialogElement>(".guide-dialog");
	const content = (root: HTMLElement) =>
		root.querySelector<HTMLElement>(".guide-content");
	const loaded = (root: HTMLElement) =>
		expect.poll(() => content(root)?.querySelector("h2")?.textContent);

	it.each(["desktop", "compact"] as const)(
		"keeps guide bids the size of their surrounding text in %s",
		async (form) => {
			try {
				document.documentElement.dataset.suitFontSize = "XXXL";
				const { root } = renderView(auction(), form);
				root.querySelector<HTMLButtonElement>(".guide-open")?.click();
				await loaded(root).toBeTruthy();
				const bids = content(root)?.querySelectorAll<HTMLElement>(".guide-bid");
				if (!bids?.length) throw new Error("Guide bids are missing");
				for (const bid of bids) {
					if (!bid.parentElement) throw new Error("Guide bid has no parent");
					expect(getComputedStyle(bid).fontSize).toBe(
						getComputedStyle(bid.parentElement).fontSize,
					);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);

	it.each(["desktop", "compact"] as const)(
		"puts a Guide row above the levels of the bid box (%s)",
		(form) => {
			const { root } = renderView(auction(), form);
			const rows = [...(root.querySelector(".bid-box")?.children ?? [])].map(
				(row) => row.className,
			);
			expect(rows.slice(0, 3)).toEqual([
				"bid-guide",
				"bid-levels",
				"bid-calls",
			]);
			expect(root.querySelector(".bid-guide button")?.textContent).toBe(
				"Guide",
			);
		},
	);

	it("opens the guide of the scale with coloured bids, and Close stays below the scrolling text", async () => {
		const { root } = renderView(auction(), "compact", undefined, undefined, {
			pointSystem: () => "reith",
		});
		root.querySelector<HTMLButtonElement>(".bid-guide button")?.click();
		expect(guide(root)?.open).toBe(true);
		await loaded(root).toBe("Bidding guide: Reith points (6-4-3-2-1)");
		const text = content(root);
		if (!text) throw new Error("the guide has no content");
		const color = (selector: string) => {
			const bid = text.querySelector<HTMLElement>(selector);
			if (!bid) throw new Error(`no ${selector} in the guide`);
			return [bid.textContent, getComputedStyle(bid).color];
		};
		expect(color(".guide-bid.strain-NT")).toEqual(["1NT", "rgb(57, 131, 0)"]);
		expect(color(".guide-bid.strain-H")).toEqual([
			expect.stringMatching(/^[1-7]♥$/),
			"rgb(192, 38, 45)",
		]);
		expect(color(".guide-bid.strain-S")?.[1]).not.toBe("rgb(192, 38, 45)");
		expect(color(".guide-bid.call-double")?.[0]).toBe("double(X)");
		expect(color(".guide-bid.call-redouble")?.[0]).toBe("redouble(XX)");
		expect(text.textContent).not.toContain("[");
		const close = root.querySelector<HTMLButtonElement>(".guide-close");
		if (!close) throw new Error("the guide has no Close button");
		expect(close.textContent).toBe("Close");
		// Close is a plain green button: nothing in the guide is dangerous.
		expect(getComputedStyle(close).backgroundColor).toBe("rgb(31, 111, 80)");
		expect(text.scrollHeight).toBeGreaterThan(text.clientHeight + 100);
		const before = close.getBoundingClientRect();
		text.scrollTop = text.scrollHeight;
		await new Promise(requestAnimationFrame);
		expect(text.scrollTop).toBeGreaterThan(100);
		const after = close.getBoundingClientRect();
		expect(after.top).toBe(before.top);
		expect(after.bottom).toBeLessThanOrEqual(innerHeight);
		expect(after.top).toBeGreaterThanOrEqual(
			text.getBoundingClientRect().bottom,
		);
		close.click();
		expect(guide(root)?.open).toBe(false);
	});

	it("names each player's bidding system below the name, and opens its guide in the viewer's language", async () => {
		const view: TableView = {
			...auction(),
			auction: {
				seats: ["N", "E", "S", "W"],
				rows: [["1♣"]],
				systems: ["hcp-corrected", "vienna", undefined, "other"],
				bots: [],
				calls: ["1C"],
				meanings: [],
			},
		};
		const { root } = renderView(view, "desktop", undefined, translator("de"), {
			locale: "de",
			pointSystem: () => "reith",
		});
		const heads = [
			...root.querySelectorAll("[data-testid='auction'] thead th"),
		];
		expect(
			heads.map((head) => [
				head.querySelector(".auction-player")?.textContent,
				head.querySelector(".auction-system")?.textContent ?? "",
			]),
		).toEqual([
			["playerN (N)", "korr. HCP"],
			["playerE (O)", "Wien"],
			["playerS (S)", ""],
			["playerW (W)", "Andere"],
		]);
		const system = (index: number) =>
			heads[index]?.querySelector<HTMLElement>(".auction-system");
		// The guides do not describe an other system, so it opens nothing.
		expect(system(3)?.tagName).toBe("SPAN");
		const vienna = system(1);
		if (!(vienna instanceof HTMLButtonElement))
			throw new Error("the Vienna system is not a button");
		// One line of text, under the name, not a full-size button.
		expect(vienna.getBoundingClientRect().height).toBeLessThan(24);
		expect(vienna.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			heads[1]?.querySelector(".auction-player")?.getBoundingClientRect()
				.bottom ?? Number.POSITIVE_INFINITY,
		);
		vienna.click();
		expect(guide(root)?.open).toBe(true);
		await loaded(root).toBe("Reizleitfaden: Wiener Punkte (7-5-3-1)");
	});

	it("marks a bot's assumed system with a superscript asterisk, and still opens its guide", async () => {
		const view: TableView = {
			...auction(),
			auction: {
				seats: ["N", "E", "S", "W"],
				rows: [["1♣"]],
				systems: ["hcp-corrected", undefined, undefined, "hcp-corrected"],
				bots: ["W"],
				calls: ["1C"],
				meanings: [],
			},
		};
		const { root } = renderView(view, "desktop", undefined, translator("de"), {
			locale: "de",
			pointSystem: () => "reith",
		});
		const systems = [
			...root.querySelectorAll<HTMLElement>(
				"[data-testid='auction'] thead .auction-system",
			),
		];
		expect(systems.map((system) => system.textContent)).toEqual([
			"korr. HCP",
			"korr. HCP*",
		]);
		const bot = systems[1];
		if (!(bot instanceof HTMLButtonElement))
			throw new Error("the bot's system is not a button");
		expect(bot.querySelector("sup")?.textContent).toBe("*");
		expect(systems[0]?.querySelector("sup")).toBeNull();
		expect(bot.title).toContain(
			"Ein Bot hält sich nicht streng an dieses System.",
		);
		bot.click();
		await loaded(root).toBe("Reizleitfaden: korrigierte Milton HCP");
	});

	it("shows the guide and its calls in the language of the table", async () => {
		const { root } = renderView(
			auction(),
			"desktop",
			undefined,
			translator("de"),
			{ locale: "de", pointSystem: () => "hcp-corrected" },
		);
		root.querySelector<HTMLButtonElement>(".bid-guide button")?.click();
		await loaded(root).toBe("Reizleitfaden: korrigierte Milton HCP");
		expect(
			content(root)?.querySelector(".guide-bid.call-double")?.textContent,
		).toBe("Kontra(X)");
		expect(
			content(root)?.querySelector(".guide-bid.call-redouble")?.textContent,
		).toBe("Rekontra(XX)");
		expect(root.querySelector(".guide-close")?.textContent).toBe("Schließen");
	});

	it.each(["desktop", "compact"] as const)(
		"closes the guide and cannot open it while a player is away (%s)",
		(form) => {
			const view: TableView = {
				...auction(),
				auction: {
					seats: ["N", "E", "S", "W"],
					rows: [["1♣"]],
					systems: ["hcp-corrected", "vienna", undefined, "other"],
					bots: [],
					calls: ["1C"],
					meanings: [],
				},
			};
			const { root, section } = renderView(view, form);
			const open = () =>
				root.querySelector<HTMLButtonElement>(".bid-guide button");
			const systems = () => [
				...root.querySelectorAll<HTMLButtonElement>("button.auction-system"),
			];
			open()?.click();
			expect(guide(root)?.open).toBe(true);
			section.render({
				...view,
				bids: [],
				waiting: "Waiting for South to come back",
			});
			expect(guide(root)?.open).toBe(false);
			expect(open()?.disabled).toBe(true);
			open()?.click();
			for (const system of systems()) {
				expect(system.disabled).toBe(true);
				system.click();
			}
			expect(guide(root)?.open).toBe(false);
			section.render(view);
			expect(open()?.disabled).toBe(false);
			expect(systems().every((system) => !system.disabled)).toBe(true);
		},
	);
});

describe("suit colour schemes", () => {
	const suits = [
		{ suit: "C", symbol: "♣", seat: "N", position: "top" },
		{ suit: "D", symbol: "♦", seat: "E", position: "left" },
		{ suit: "H", symbol: "♥", seat: "S", position: "bottom" },
		{ suit: "S", symbol: "♠", seat: "W", position: "right" },
	] as const;
	const colors = {
		black: "rgb(29, 29, 27)",
		white: "rgb(255, 255, 255)",
		red: "rgb(192, 38, 45)",
		green: "rgb(0, 189, 60)",
		blue: "rgb(22, 137, 239)",
		purple: "rgb(132, 71, 237)",
		yellow: "rgb(219, 163, 0)",
		orange: "rgb(237, 120, 0)",
		pink: "rgb(224, 0, 201)",
		cyan: "rgb(0, 191, 197)",
	} as const;
	const palettes = {
		standard: ["black", "red", "red", "black"],
		"green-blue": ["green", "blue", "red", "black"],
		"black-yellow": ["black", "yellow", "red", "green"],
		"purple-orange": ["purple", "orange", "red", "black"],
		"blue-yellow": ["blue", "yellow", "red", "black"],
		"green-orange": ["green", "orange", "red", "black"],
		"green-yellow-blue": ["green", "yellow", "red", "blue"],
		"pink-orange": ["pink", "orange", "red", "black"],
		"pink-yellow-cyan": ["pink", "yellow", "orange", "cyan"],
	} as const;

	it.each(["desktop", "compact"] as const)(
		"colours real cards, played cards, calls and guide notation in %s",
		async (layout) => {
			const base = playView();
			if (!base.auction) throw new Error("Auction is missing");
			const hand = {
				visible: true as const,
				suits: suits.map(({ suit, symbol }) => ({
					suit,
					symbol,
					trump: false,
					cards: [card(`${suit}A`)],
				})),
			};
			const view: TableView = {
				...base,
				phase: "auction",
				seats: base.seats.map((player) =>
					player.position === "bottom" ? { ...player, hand } : player,
				),
				auction: {
					...base.auction,
					rows: [["1♣", "1♦", "1♥", "1♠"]],
					calls: ["1C", "1D", "1H", "1S"],
				},
				bids: suits.map(({ suit, symbol }) => ({
					call: `1${suit}` as Call,
					text: `1${symbol}`,
				})),
				trick: {
					cards: suits.map(({ suit, symbol, seat, position }) => ({
						seat,
						position,
						card: `${suit}A` as Card,
						text: `${symbol}A`,
						rank: "A",
						symbol,
					})),
					finished: false,
				},
			};
			const { root, section } = renderView(view, layout);
			document.documentElement.dataset.theme = "normal";
			root.querySelector<HTMLButtonElement>(".guide-open")?.click();
			await expect
				.poll(() => root.querySelector(".guide-bid.strain-C"))
				.toBeTruthy();
			const notation = document.createElement("div");
			notation.className = "guide-content";
			notation.append(
				...renderGuide(parseGuide("A♣ A♦ A♥ A♠"), translator("en")),
			);
			root.append(notation);
			try {
				for (const scheme of ["light", "dark"] as const) {
					document.documentElement.dataset.scheme = scheme;
					for (const [palette, names] of Object.entries(palettes)) {
						document.documentElement.dataset.suitColors = palette;
						for (const [index, { suit }] of suits.entries()) {
							const name = names[index];
							if (!name) throw new Error("Missing expected colour");
							const expected =
								colors[name === "black" && scheme === "dark" ? "white" : name];
							for (const selector of [
								`.card[data-suit="${suit}"] .face`,
								`.bid-calls .strain-${suit}`,
								`.auction .bid-mark.strain-${suit}`,
								`.guide-content .card-notation.strain-${suit}`,
								`.guide-content .guide-bid.strain-${suit}`,
							]) {
								const element = root.querySelector<HTMLElement>(selector);
								if (!element) throw new Error(`Missing ${selector}`);
								expect(
									getComputedStyle(element).color,
									`${palette} ${scheme} ${selector}`,
								).toBe(expected);
							}
						}
					}
				}
				section.render({ ...view, phase: "play" });
				for (const scheme of ["light", "dark"] as const) {
					document.documentElement.dataset.scheme = scheme;
					for (const [palette, names] of Object.entries(palettes)) {
						document.documentElement.dataset.suitColors = palette;
						for (const [index, { suit }] of suits.entries()) {
							const name = names[index];
							if (!name) throw new Error("Missing expected colour");
							const expected =
								colors[name === "black" && scheme === "dark" ? "white" : name];
							const played = root.querySelector<HTMLElement>(
								`.played[data-suit="${suit}"]`,
							);
							if (!played) throw new Error(`Missing played ${suit}`);
							expect(getComputedStyle(played).color).toBe(expected);
							expect(
								getComputedStyle(
									played.querySelector(".rank-corner") as Element,
								).color,
							).toBe(expected);
							if (scheme === "dark" && name === "black") {
								expect(getComputedStyle(played).backgroundColor).not.toBe(
									expected,
								);
								const face = root.querySelector<HTMLElement>(
									`.card[data-suit="${suit}"] .face`,
								);
								if (!face) throw new Error(`Missing ${suit} face`);
								expect(getComputedStyle(face).backgroundColor).not.toBe(
									expected,
								);
							}
						}
					}
				}
			} finally {
				delete document.documentElement.dataset.suitColors;
				delete document.documentElement.dataset.scheme;
				delete document.documentElement.dataset.theme;
			}
		},
	);

	it.each(["desktop", "compact"] as const)(
		"colours contract and result suits in %s",
		(layout) => {
			const base = playView();
			if (!base.header) throw new Error("Contract header is missing");
			try {
				document.documentElement.dataset.theme = "normal";
				for (const [index, { suit, symbol }] of suits.entries()) {
					const { root, section } = renderView(
						{ ...base, header: { ...base.header, strain: suit, symbol } },
						layout,
					);
					const contracts = [
						...document.querySelectorAll<HTMLElement>(`.bid .strain-${suit}`),
					];
					if (!contracts.length) throw new Error(`Missing ${suit} contract`);
					for (const scheme of ["light", "dark"] as const) {
						document.documentElement.dataset.scheme = scheme;
						for (const [palette, names] of Object.entries(palettes)) {
							document.documentElement.dataset.suitColors = palette;
							const name = names[index];
							if (!name) throw new Error("Missing expected colour");
							const expected =
								colors[name === "black" && scheme === "dark" ? "white" : name];
							for (const contract of contracts)
								expect(getComputedStyle(contract).color).toBe(expected);
						}
					}
					section.render({
						...base,
						phase: "complete",
						scoring: {
							contract: { level: 4, strain: suit, doubling: "" },
							compactOutcome: "WON",
							compactDetail: `Made: 4${symbol}`,
							countdown: 1,
						},
					});
					const result = root.querySelector<HTMLElement>(
						`.scoring .strain-${suit}`,
					);
					if (!result) throw new Error(`Missing ${suit} result`);
					for (const [palette, names] of Object.entries(palettes)) {
						document.documentElement.dataset.suitColors = palette;
						const name = names[index];
						if (!name) throw new Error("Missing expected colour");
						expect(getComputedStyle(result).color).toBe(
							colors[name === "black" ? "white" : name],
						);
					}
				}
			} finally {
				delete document.documentElement.dataset.suitColors;
				delete document.documentElement.dataset.scheme;
				delete document.documentElement.dataset.theme;
			}
		},
	);

	it.each(["normal", "solarized", "selenized", "gruvbox"] as const)(
		"keeps white suits visible on dark %s card faces",
		(theme) => {
			const { root } = renderView(playView(), "desktop");
			try {
				document.documentElement.dataset.theme = theme;
				document.documentElement.dataset.scheme = "dark";
				document.documentElement.dataset.suitColors = "standard";
				for (const selector of [
					'.card[data-suit="S"] .face',
					'.played[data-suit="S"]',
				]) {
					const card = root.querySelector<HTMLElement>(selector);
					if (!card) throw new Error(`Missing ${selector}`);
					const style = getComputedStyle(card);
					expect(style.color).toBe(colors.white);
					expect(style.backgroundColor).not.toBe(colors.white);
				}
			} finally {
				delete document.documentElement.dataset.suitColors;
				delete document.documentElement.dataset.scheme;
				delete document.documentElement.dataset.theme;
			}
		},
	);
});

describe("call meanings in the auction", () => {
	it("keeps oversized phone history inside the page and scrolls to all four bids", async () => {
		await page.viewport(320, 568);
		document.documentElement.dataset.suitFontSize = "XXXL";
		try {
			const base = playView();
			if (!base.auction) throw new Error("missing auction");
			const { root } = renderMobile({
				...base,
				phase: "auction",
				auction: {
					...base.auction,
					rows: [["1NT", "2♥", "Pass", "Double"]],
					meanings: [["opening", "hearts", "pass", "double"]],
				},
			});
			const history = root.querySelector<HTMLElement>(".auction-scroll");
			if (!history) throw new Error("missing history");
			expect(history.scrollWidth).toBeGreaterThan(history.clientWidth);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
				document.documentElement.clientWidth + 1,
			);
			history.scrollLeft = history.scrollWidth;
			const last = history.querySelector<HTMLElement>(
				"tbody td:last-child .auction-call",
			);
			if (!last) throw new Error("missing final call");
			expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(
				history.getBoundingClientRect().right + 1,
			);
		} finally {
			delete document.documentElement.dataset.suitFontSize;
			await page.viewport(414, 896);
		}
	});
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"places dotted underlines on the scaled suit and NT bid text (%s)",
		(layout) => {
			const base = playView();
			if (!base.auction) throw new Error("missing auction");
			const { root } = renderView(
				{
					...base,
					phase: "auction",
					auction: {
						...base.auction,
						rows: [["1NT", "2♥", "Pass", "Double"]],
						meanings: [["opening", "hearts", "pass", "double"]],
					},
				},
				layout,
			);
			const calls = [...root.querySelectorAll<HTMLElement>(".auction-call")];
			expect(calls).toHaveLength(4);
			try {
				for (const size of ["S", "M", "L", "XL", "XXL", "XXXL"]) {
					document.documentElement.dataset.suitFontSize = size;
					for (const call of calls.slice(0, 2)) {
						expect(getComputedStyle(call).textDecorationLine).toBe("none");
						const marks = [...call.querySelectorAll<HTMLElement>(".bid-mark")];
						expect(marks).toHaveLength(2);
						const cell = call.closest("td");
						if (!cell) throw new Error("missing bid cell");
						const [level, strain] = marks.map((mark) =>
							mark.getBoundingClientRect(),
						);
						if (!level || !strain) throw new Error("missing bid marks");
						const strainText = document.createRange();
						const strainMark = marks[1];
						if (!strainMark) throw new Error("missing strain text");
						strainText.selectNodeContents(strainMark);
						expect(strainText.getClientRects().length, size).toBe(1);
						expect(strain.top, size).toBeCloseTo(level.top, 0);
						expect(strain.right, size).toBeLessThanOrEqual(
							cell.getBoundingClientRect().right + 0.5,
						);
						for (const mark of marks) {
							expect(getComputedStyle(mark).textDecorationLine, size).toBe(
								"underline",
							);
							expect(getComputedStyle(mark).textDecorationStyle, size).toBe(
								"dotted",
							);
						}
					}
					const pass = calls[2];
					const passText = pass?.querySelector<HTMLElement>(".call-pass");
					const double = calls[3];
					if (!pass || !passText || !double)
						throw new Error("missing pass or double");
					expect(getComputedStyle(pass).textDecorationLine).toBe("none");
					expect(getComputedStyle(passText).textDecorationLine).toBe(
						"underline",
					);
					expect(getComputedStyle(passText).textDecorationStyle).toBe("dotted");
					expect(getComputedStyle(double).textDecorationLine).toBe("underline");
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);
	const WEAK_TWO =
		"3½–7½ Four-Aces-Punkte, schwache Zwei, eine gute ♠-Farbe mit 6 Karten";
	const meaningView = (
		meaning = "15–17 HCP, balanced",
		last = "Double",
		at = 1,
	): TableView => ({
		...playView(),
		phase: "auction",
		trick: undefined,
		bids: [{ call: "P", text: "Pass" }],
		auction: {
			seats: ["N", "E", "S", "W"],
			rows: [["—", "1NT", "Pass", last]],
			systems: [undefined, "hcp", undefined, "four-aces"],
			bots: [],
			calls: ["1NT", "P", "X"],
			meanings: [
				[0, 1, 2, 3].map((index) => (index === at ? meaning : undefined)),
			],
		},
	});
	const cell = (root: HTMLElement, index: number) => {
		const found = root.querySelectorAll<HTMLElement>(
			"[data-testid='auction'] tbody td",
		)[index];
		if (!found) throw new Error(`no auction cell ${index}`);
		return found;
	};
	const parts = (root: HTMLElement, index: number) => {
		const call = cell(root, index).querySelector<HTMLButtonElement>(
			"button.auction-call",
		);
		const meaning = call?.popoverTargetElement;
		if (!call || !(meaning instanceof HTMLElement))
			throw new Error(`no meaning in cell ${index}`);
		return { call, meaning, open: () => meaning.matches(":popover-open") };
	};

	it("makes a described call a button with its meaning, and leaves the dash and the other calls plain", () => {
		const { root } = renderView(meaningView(), "desktop");
		const { call, open } = parts(root, 1);
		expect(call.textContent).toBe("1NT");
		expect(cell(root, 1).textContent).toBe("1NT");
		expect(call.title).toBe("15–17 HCP, balanced");
		expect(call.getAttribute("aria-description")).toBe("15–17 HCP, balanced");
		expect(open()).toBe(false);
		for (const index of [0, 2, 3])
			expect(cell(root, index).querySelector("button")).toBeNull();
		expect(cell(root, 3).querySelector(".call-double")?.textContent).toBe(
			"Double",
		);
	});

	it("opens the meaning under the call on a click, and closes it with Escape, a second click, or a click outside", async () => {
		const { root } = renderView(meaningView(), "desktop");
		const { call, meaning, open } = parts(root, 1);
		await userEvent.click(call);
		expect(open()).toBe(true);
		expect(meaning.textContent).toBe("15–17 HCP, balanced");
		expect(meaning.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			call.getBoundingClientRect().bottom,
		);
		await userEvent.keyboard("{Escape}");
		expect(open()).toBe(false);
		await userEvent.click(call);
		expect(open()).toBe(true);
		await userEvent.click(call);
		expect(open()).toBe(false);
		await userEvent.click(call);
		await userEvent.click(cell(root, 0));
		expect(open()).toBe(false);
	});

	it("keeps the meaning open while a render does not change the auction", async () => {
		const { root, section } = renderView(meaningView(), "desktop");
		await userEvent.click(parts(root, 1).call);
		section.render({ ...meaningView(), prompt: "playerS is thinking" });
		expect(parts(root, 1).open()).toBe(true);
	});

	it("writes a German meaning inside the screen of a narrow phone, also for the last column", async () => {
		await page.viewport(360, 800);
		try {
			const view = meaningView(WEAK_TWO, "2♠", 3);
			const { root } = renderView(
				view,
				"compact",
				undefined,
				translator("de"),
				{
					locale: "de",
				},
			);
			const { call, meaning, open } = parts(root, 3);
			await userEvent.click(call);
			expect(open()).toBe(true);
			expect(meaning.textContent).toBe(WEAK_TWO);
			const box = meaning.getBoundingClientRect();
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.right).toBeLessThanOrEqual(innerWidth);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
				innerWidth,
			);
		} finally {
			await page.viewport(414, 896);
		}
	});
});

describe("convention hint", () => {
	// ♠AKQ32 ♥K ♦J432 ♣432: 13 HCP and five spades, so the HCP guide opens 1♠.
	const OPENER: readonly Card[] = [
		"SA",
		"SK",
		"SQ",
		"S3",
		"S2",
		"HK",
		"DJ",
		"D4",
		"D3",
		"D2",
		"C4",
		"C3",
		"C2",
	];
	// ♠86542 ♥K732 ♦A5 ♣Q6: 9 HCP, no good suit and not balanced, so the guide has no answer to 2♣.
	const RESPONDER: readonly Card[] = [
		"S8",
		"S6",
		"S5",
		"S4",
		"S2",
		"HK",
		"H7",
		"H3",
		"H2",
		"DA",
		"D5",
		"CQ",
		"C6",
	];
	const bidView = (
		calls: readonly Call[],
		cards: readonly Card[] = OPENER,
	): TableView => {
		const base = playView();
		return {
			...base,
			phase: "auction",
			trick: undefined,
			auction: {
				seats: ["N", "E", "S", "W"],
				rows: [],
				systems: [],
				bots: [],
				calls,
				meanings: [],
			},
			bids: [
				{ call: "1C", text: "1♣" },
				{ call: "1S", text: "1♠" },
				{ call: "2C", text: "2♣" },
				{ call: "2D", text: "2♦" },
				{ call: "4NT", text: "4NT" },
				{ call: "7NT", text: "7NT" },
				{ call: "P", text: "Pass" },
			],
			seats: base.seats.map((player) =>
				player.position === "bottom"
					? {
							...player,
							turnPill: { action: "bid", yours: true },
							pointCards: cards,
						}
					: player,
			),
		};
	};
	const hcp = { pointSystem: (): PointSystem => "hcp" };
	const pickBid = (root: HTMLElement, level: string, strain: string) => {
		[...root.querySelectorAll<HTMLButtonElement>(".bid-levels button")]
			.find((button) => button.textContent === level)
			?.click();
		root
			.querySelector<HTMLButtonElement>(`.bid-calls .strain-${strain}`)
			?.click();
	};
	const confirm = (root: HTMLElement) =>
		root.querySelector<HTMLButtonElement>(".bid-actions .confirm");
	const hint = (root: HTMLElement) =>
		confirm(root)?.querySelector(".convention-hint")?.textContent;

	it.each(["desktop", "compact"] as const)(
		"explains a doubleton transfer acceptance and the doubled-transfer exception (%s)",
		(form) => {
			const cards: readonly Card[] = [
				"SA",
				"SQ",
				"SJ",
				"S4",
				"HK",
				"H5",
				"DA",
				"D7",
				"D3",
				"CK",
				"C8",
				"C6",
				"C2",
			];
			const normal = renderView(
				bidView(["1NT", "P", "2D", "P"], cards),
				form,
				undefined,
				undefined,
				hcp,
			).root;
			const explanation = normal.querySelector(
				'[data-testid="transfer-explanation"]',
			);
			expect(explanation?.textContent).toContain("2♥");
			expect(explanation?.textContent).toContain(
				"Three-card support is not required.",
			);
			const doubled = renderView(
				bidView(["1NT", "P", "2D", "X"], cards),
				form,
				undefined,
				undefined,
				hcp,
			).root;
			expect(
				doubled.querySelector('[data-testid="transfer-explanation"]')
					?.textContent,
			).toBe("Pass: at most 2 ♥ after the transfer was doubled");
		},
	);

	it.each(["desktop", "compact"] as const)(
		"names the guide call on Confirm when the chosen call differs, and nothing for the guide call (%s)",
		(form) => {
			const { root } = renderView(bidView([]), form, undefined, undefined, hcp);
			pickBid(root, "1", "C");
			expect(hint(root)).toBe("(Convention: 1♠)");
			expect(confirm(root)?.dataset.call).toBe("1C");
			pickBid(root, "1", "S");
			expect(hint(root)).toBeUndefined();
			expect(confirm(root)?.textContent).toBe("Confirm 1♠");
		},
	);

	it("shows Unconventional when the guide describes the position but gives the hand no call", () => {
		const { root } = renderView(
			bidView(["2C", "P"], RESPONDER),
			"desktop",
			undefined,
			undefined,
			hcp,
		);
		pickBid(root, "2", "D");
		expect(hint(root)).toBe("(Unconventional)");
	});

	it("shows no hint where the guide does not describe the call, or with no call chosen", () => {
		// The guide does not describe responder's call after an overcall.
		const { root } = renderView(
			bidView(["1H", "1S"]),
			"desktop",
			undefined,
			undefined,
			hcp,
		);
		expect(hint(root)).toBeUndefined();
		pickBid(root, "2", "C");
		expect(hint(root)).toBeUndefined();
	});

	it.each([
		["compact", 414, 896],
		["desktop", 1280, 800],
	] as const)(
		"gives the slam targets and the answers of the [4NT] ask in full, and no verdict, with any hand (%s, %i×%i)",
		async (form, width, height) => {
			await page.viewport(width, height);
			try {
				// The guide gives this hand [2NT], [3H] or [4H] after partner's weak two, but [4NT] fits any hand.
				const { root } = renderView(
					bidView(["2H", "P"]),
					form,
					undefined,
					undefined,
					hcp,
				);
				pickBid(root, "4", "NT");
				expect(hint(root)).toBe(
					"Blackwood: 33+/37+ HCP\nAces: 5♣:0/4 5♦:1 5♥:2 5♠:3",
				);
				// Confirm grows for the two lines, and no text is cut.
				const box = confirm(root)?.getBoundingClientRect();
				const text =
					confirm(root)?.querySelector<HTMLElement>(".convention-hint");
				const lines = text?.getBoundingClientRect();
				expect(text?.scrollWidth).toBeLessThanOrEqual(text?.clientWidth ?? 0);
				expect(lines?.bottom).toBeLessThanOrEqual(box?.bottom ?? 0);
				expect(lines?.right).toBeLessThanOrEqual(box?.right ?? 0);
			} finally {
				await page.viewport(414, 896);
			}
		},
	);

	// ♠Q2 ♥KJ92 ♦Q874 ♣432: 8 points. [1S] over [1H] shows a good five-card suit, and the guide has no [7NT] there,
	// so the guide gives this hand a pass.
	it.each([
		["1", "S", "(Convention: Pass)"],
		["7", "NT", "(Convention: Pass)"],
		[undefined, "P", undefined],
	])(
		"judges %s%s over [1H] where the guide gives the hand only a pass",
		(level, strain, expected) => {
			const { root } = renderView(
				bidView(
					["1H"],
					[
						"SQ",
						"S2",
						"HK",
						"HJ",
						"H9",
						"H2",
						"DQ",
						"D8",
						"D7",
						"D4",
						"C4",
						"C3",
						"C2",
					],
				),
				"desktop",
				undefined,
				undefined,
				{ pointSystem: (): PointSystem => "hcp-corrected" },
			);
			if (level === undefined)
				root.querySelector<HTMLButtonElement>(".bid-calls .pass")?.click();
			else pickBid(root, level, strain);
			expect(confirm(root)?.dataset.call).toBe(`${level ?? ""}${strain}`);
			expect(hint(root)).toBe(expected);
		},
	);

	it.each(["vienna", "reith", "four-aces"] as const)(
		"gives no hint on the %s scale, which has only its guide",
		(system) => {
			const { root } = renderView(
				// The hand of the test above, where corrected HCP gives "(Convention: Pass)".
				bidView(
					["1H"],
					[
						"SQ",
						"S2",
						"HK",
						"HJ",
						"H9",
						"H2",
						"DQ",
						"D8",
						"D7",
						"D4",
						"C4",
						"C3",
						"C2",
					],
				),
				"desktop",
				undefined,
				undefined,
				{ pointSystem: (): PointSystem => system },
			);
			for (const [level, strain] of [
				["1", "S"],
				["7", "NT"],
			] as const) {
				pickBid(root, level, strain);
				expect(confirm(root)?.dataset.call).toBe(`${level}${strain}`);
				expect(hint(root)).toBeUndefined();
			}
		},
	);

	it("reads the hand with the viewer's point system, in the viewer's language", () => {
		const { root } = renderView(
			bidView([]),
			"desktop",
			undefined,
			translator("de"),
			{ locale: "de", pointSystem: () => "other" },
		);
		pickBid(root, "1", "C");
		expect(hint(root)).toBeUndefined();
		const german = renderView(
			bidView([]),
			"desktop",
			undefined,
			translator("de"),
			{
				locale: "de",
				...hcp,
			},
		).root;
		pickBid(german, "1", "C");
		expect(hint(german)).toBe("(Konvention: 1♠)");
	});

	it.each([
		["compact", 414, 896],
		["desktop", 1280, 800],
	] as const)(
		"keeps the height of Confirm with the hint (%s, %i×%i)",
		async (form, width, height) => {
			await page.viewport(width, height);
			try {
				const { root } = renderView(
					bidView([]),
					form,
					undefined,
					undefined,
					hcp,
				);
				pickBid(root, "1", "S");
				const plain = confirm(root)?.getBoundingClientRect().height ?? 0;
				pickBid(root, "1", "C");
				const hinted = confirm(root)?.getBoundingClientRect();
				expect(hint(root)).toBe("(Convention: 1♠)");
				expect(hinted?.height).toBeCloseTo(plain, 0);
				const text = confirm(root)?.querySelector(".convention-hint");
				expect(text?.getBoundingClientRect().right).toBeLessThanOrEqual(
					hinted?.right ?? 0,
				);
			} finally {
				await page.viewport(414, 896);
			}
		},
	);
});

describe("a phone held sideways", () => {
	const visible = (node: Element | null | undefined): boolean =>
		node?.checkVisibility() ?? false;
	const callNames = (node: Element | null | undefined): string[] =>
		[...(node?.querySelectorAll("button") ?? [])]
			.filter((button) => button.checkVisibility())
			.map((button) => button.getAttribute("aria-label") ?? "");

	it("shows the desktop felt without video tiles, and the call buttons and the bot switches at the top of the sidebar", () => {
		const { root, section } = renderView(
			{ ...playView(), phase: "auction" },
			"sideways",
		);
		section.setBotControls(true, ["E"]);
		const controls = section.sidebar.firstElementChild;
		expect(controls?.className).toBe("sideways-controls");
		expect(callNames(controls?.querySelector(".icon-group"))).toEqual([
			"Join call",
			"Send mic audio",
			"Hear others: receive audio",
			"Send camera video",
		]);
		const fold =
			controls?.querySelector<HTMLDetailsElement>(".mobile-bot-fold");
		fold?.querySelector("summary")?.click();
		expect(
			[...(fold?.querySelectorAll(".mobile-player-control button") ?? [])]
				.filter(visible)
				.map((button) => button.textContent),
		).toContain("👱 Switch to player");
		expect(visible(root.querySelector(".felt"))).toBe(true);
		expect(visible(root.querySelector(".mobile-auction"))).toBe(false);
		expect(
			[...root.querySelectorAll(".video-row .tile, .call-panel")].filter(
				visible,
			),
		).toEqual([]);
	});

	it("moves the call buttons back to the phone top bar when the phone is held upright", () => {
		const { root, section } = renderView(playView(), "sideways");
		const room = root.closest<HTMLElement>(".room");
		if (!room) throw new Error("the room is missing");
		// The room view changes the room's layout together with the table's (src/ui/room-view.ts).
		room.dataset.form = "compact";
		room.dataset.layout = "compact";
		section.setForm("compact");
		const topbar = root.querySelector(".mobile-auction-topbar");
		expect(callNames(topbar?.querySelector(".icon-group"))).toEqual([
			"Join call",
			"Send mic audio",
			"Hear others: receive audio",
			"Send camera video",
		]);
		expect(section.sidebar.querySelector(".sideways-controls")).toBe(null);
		expect(visible(root.querySelector(".mobile-auction"))).toBe(true);
	});
});
