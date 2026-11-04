import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import { createBoard } from "../../src/bridge/engine";
import type { PointSystem } from "../../src/bridge/hand-points";
import type { Call } from "../../src/bridge/rules";
import type { Layout } from "../../src/call/device-class";
import { translator } from "../../src/i18n";
import { parseGuide, renderGuide } from "../../src/ui/bidding-guide";
import type { TableView } from "../../src/ui/table-model";
import { bidding, DEAL } from "../unit/bridge-fixtures";
import { tableState, view } from "../unit/table-model-fixtures";
import {
	card,
	playView,
	renderMobile,
	renderView,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

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
	it("keeps phone history inside the page and makes all four bids accessible", async () => {
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
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
				document.documentElement.clientWidth + 1,
			);
			history.scrollLeft = history.scrollWidth;
			expect(history.querySelectorAll("tbody .auction-call")).toHaveLength(4);
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
		"shows the scaled suit and NT bid text of a described call without an underline (%s)",
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
						for (const mark of marks)
							expect(getComputedStyle(mark).textDecorationLine, size).toBe(
								"none",
							);
					}
					const pass = calls[2];
					const passText = pass?.querySelector<HTMLElement>(".call-pass");
					const double = calls[3];
					if (!pass || !passText || !double)
						throw new Error("missing pass or double");
					expect(getComputedStyle(pass).textDecorationLine).toBe("none");
					expect(getComputedStyle(passText).textDecorationLine).toBe("none");
					expect(getComputedStyle(double).textDecorationLine).toBe("none");
					// The call stays a button with its meaning.
					expect(double.tagName).toBe("BUTTON");
					expect(double.title).toBe("double");
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
		const auctionCall = page
			.getByTestId("auction")
			.getByRole("button", { name: "1NT", exact: true });
		await auctionCall.click();
		expect(open()).toBe(true);
		expect(meaning.textContent).toBe("15–17 HCP, balanced");
		expect(meaning.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			call.getBoundingClientRect().bottom,
		);
		await userEvent.keyboard("{Escape}");
		expect(open()).toBe(false);
		await auctionCall.click();
		expect(open()).toBe(true);
		await auctionCall.click();
		expect(open()).toBe(false);
		await auctionCall.click();
		await userEvent.click(cell(root, 0));
		expect(open()).toBe(false);
	});

	it.each(["desktop", "compact"] as const)(
		"presents an uncertain bid as a labeled guide reference (%s)",
		async (form) => {
			const reference =
				"Guide reference (corrected HCP): 15–17 corrected HCP, balanced. This may not describe the bid.";
			const { root, section } = renderView(meaningView(reference), form);
			const call = root.querySelector<HTMLButtonElement>(".auction-call");
			if (!call) throw new Error("missing auction call");
			expect(call.getAttribute("aria-description")).toBe(reference);
			call.click();
			expect(call.popoverTargetElement?.textContent).toBe(reference);
			expect(call.popoverTargetElement?.matches(":popover-open")).toBe(true);
			section.dispose();
		},
	);

	it.each(["desktop", "compact"] as const)(
		"opens a common fourth-suit explanation from a real auction (%s)",
		(form) => {
			const board = bidding(createBoard(1, DEAL), "1C P 1H P 1S P 2D");
			const state = {
				...tableState(board),
				systems: { N: "hcp", S: "hcp" },
			} as const;
			const model = view("N", null, { state });
			const { root, section } = renderView(model, form);
			const { call, meaning, open } = parts(root, 6);
			const expected =
				"Common treatment: Fourth suit: often artificial and forcing, without promising ♦ length. Agreements can vary.";
			expect(call.getAttribute("aria-description")).toBe(expected);
			call.click();
			expect(open()).toBe(true);
			expect(meaning.textContent).toBe(expected);
			section.dispose();
		},
	);

	it("keeps the meaning open while a render does not change the auction", async () => {
		const { root, section } = renderView(meaningView(), "desktop");
		await page
			.getByTestId("auction")
			.getByRole("button", { name: "1NT", exact: true })
			.click();
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
				{ call: "2S", text: "2♠" },
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
		"uses corrected HCP for both hand points and the bidding guide by default (%s)",
		(form) => {
			// This 4-3-3-3 hand is 15 HCP, but 14 corrected HCP: the guide opens 1♣ instead of 1NT.
			const cards: readonly Card[] = [
				"SA",
				"SQ",
				"S4",
				"HK",
				"HJ",
				"H5",
				"DQ",
				"D8",
				"D6",
				"CK",
				"C7",
				"C3",
				"C2",
			];
			const view = bidView([], cards);
			const { root, section } = renderView(
				{ ...view, bids: [...view.bids, { call: "1NT", text: "1NT" }] },
				form,
			);
			expect(root.querySelector(".hcp-pill")?.textContent).toBe(
				"corrected HCP: 14 (15 -1)",
			);
			pickBid(root, "1", "NT");
			expect(hint(root)).toBe("(Convention: 1♣)");
			section.dispose();
		},
	);

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

	// The cards without ♣2, which each hand also holds.
	it.each([
		[
			"Stayman, not [4NT], with 10 points and four spades (♠KJ84 ♥A73 ♦Q65 ♣642)",
			["SK", "SJ", "S8", "S4", "HA", "H7", "H3", "DQ", "D6", "D5", "C6", "C4"],
			"4",
			"NT",
			"(Convention: 2♣)",
		],
		[
			"a transfer, not a pass, with 3 points and five hearts (♠84 ♥QT973 ♦J52 ♣632)",
			["S8", "S4", "HQ", "HT", "H9", "H7", "H3", "DJ", "D5", "D2", "C6", "C3"],
			undefined,
			"P",
			"(Convention: 2♦)",
		],
		[
			"the minor transfer, not a pass, with 3 points and five diamonds not in 5-3-3-2 (♠8 ♥7432 ♦QT987 ♣J52)",
			["S8", "H7", "H4", "H3", "H2", "DQ", "DT", "D9", "D8", "D7", "CJ", "C5"],
			undefined,
			"P",
			"(Convention: 2♠)",
		],
	] as const)(
		"names the guide response to [1NT] on Confirm: %s",
		(_name, twelve, level, strain, expected) => {
			const { root } = renderView(
				bidView(["1NT", "P"], [...twelve, "C2"]),
				"desktop",
				undefined,
				undefined,
				hcp,
			);
			if (level === undefined)
				root.querySelector<HTMLButtonElement>(".bid-calls .pass")?.click();
			else pickBid(root, level, strain);
			expect(confirm(root)?.dataset.call).toBe(`${level ?? ""}${strain}`);
			expect(hint(root)).toBe(expected);
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
		// After an overcall the guide describes only the negative double and a new suit at the two level, not [2NT].
		const { root } = renderView(
			bidView(["1H", "1S"]),
			"desktop",
			undefined,
			undefined,
			hcp,
		);
		expect(hint(root)).toBeUndefined();
		pickBid(root, "2", "NT");
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
		section.setBotControls(true, ["E"], false);
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
