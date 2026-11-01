import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import "../../src/ui/style.css";
import type { Form, Layout } from "../../src/call/device-class";
import { type Locale, translator } from "../../src/i18n";
import type { Seat } from "../../src/protocol";
import { pageReport } from "../../src/ui/page-report";
import type { TableView } from "../../src/ui/table-model";
import {
	card,
	expectSameMiddle,
	NS_VULNERABLE,
	playView,
	renderMobile,
	renderResult,
	renderView,
	sideHandView,
	visibleHand,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

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

	it("starts a visible seat's name right below its turn pill or frame edge, with the points pill after the name's tags", () => {
		const base = sideHandView();
		const { root } = renderView(
			{
				...base,
				seats: base.seats.map((player) =>
					player.position === "left"
						? {
								...player,
								tags: ["Dummy"],
								turn: true,
								turnPill: { action: "play", yours: false },
								pointCards: ["SA"],
							}
						: player.position === "bottom"
							? { ...player, tags: ["Host"], pointCards: ["SA"] }
							: player,
				),
			},
			"desktop",
		);
		const rect = (selector: string) => {
			const node = root.querySelector<HTMLElement>(selector);
			if (!node) throw new Error(`missing ${selector}`);
			return node.getBoundingClientRect();
		};
		// The left dummy: the name row follows the turn pill row.
		expect(
			rect(".place-left .seat-label .name").top -
				rect(".place-left .seat-tags").bottom,
		).toBeLessThan(5);
		// The top dummy: the name is the first row inside the turn frame.
		expect(
			rect(".place-top .seat-label .name").top - rect(".place-top .seat").top,
		).toBeLessThan(2);
		// The points pill stands in the name row, after the name and its tags, so it takes no row of its own.
		for (const place of ["left", "bottom"]) {
			const name = rect(`.place-${place} .seat-label .name`);
			const points = rect(`.place-${place} .hcp-pill`);
			expect(
				(points.top + points.bottom) / 2 - (name.top + name.bottom) / 2,
				place,
			).toBeCloseTo(0, 0);
			expect(points.left, place).toBeGreaterThanOrEqual(
				rect(`.place-${place} .seat-label .tag`).right,
			);
		}
		expect(
			rect(".place-bottom .seat-label .name").top -
				rect(".place-bottom .seat").top,
		).toBeLessThan(2);
	});

	it.each<Layout>(["desktop", "sideways", "compact"])(
		"shows a short auction summary on the middle of the %s board, in the text size of the bid tiles' words",
		(layout) => {
			const base = { ...playView(), phase: "auction" as const };
			const { section } = renderView(base, layout);
			// The words of the bid box ("Guide", "Confirm", "Undo") keep their size; call symbols follow the suit font.
			const tile = [
				...document.querySelectorAll<HTMLElement>(".bid-guide button"),
			].find((button) => button.checkVisibility());
			if (!tile) throw new Error("no bid tile");
			const tileSize = getComputedStyle(tile).fontSize;
			section.render({
				...base,
				auctionEnd: {
					contract: { level: 4, strain: "H", doubling: "X" },
					declarer: "by East",
					vulnerability: "E-W vulnerable",
					vulnerable: true,
				},
			});
			const summary = document.querySelector<HTMLElement>(
				'[data-testid="auction-end"]',
			);
			if (!summary) throw new Error("no auction summary");
			expect(summary.checkVisibility()).toBe(true);
			const lines = [...summary.querySelectorAll("p")];
			expect(lines.map((line) => line.textContent)).toEqual([
				"Contract 4♥X by East",
				"E-W vulnerable",
			]);
			for (const line of lines)
				expect(getComputedStyle(line).fontSize, line.textContent ?? "").toBe(
					tileSize,
				);
			// Assistive technology must not announce the summary as the current trick.
			expect(
				summary.parentElement?.closest('[aria-label="Current trick"]'),
			).toBeNull();
			for (const panel of document.querySelectorAll<HTMLElement>(
				'[data-testid="bid-box"], [data-testid="bid-history"]',
			))
				expect(panel.checkVisibility()).toBe(false);
			const board = document.querySelector<HTMLElement>(
				layout === "compact" ? ".mobile-auction-board" : ".felt",
			);
			if (!board) throw new Error("no board");
			expectSameMiddle(summary, board);
		},
	);

	it.each<Layout>(["desktop", "sideways", "compact"])(
		"shows the game result on the middle of the %s green board",
		(layout) => {
			const result = renderResult(layout);
			const board = document.querySelector<HTMLElement>(".felt");
			if (!board) throw new Error("no board");
			expect(result.checkVisibility()).toBe(true);
			expectSameMiddle(result, board);
		},
	);

	// The vitest page has no full-screen table frame, so the desktop felt is only as tall as its content here; the
	// desktop clearance is checked on the real page (tests/e2e/result-banner.spec.ts).
	it.each([
		[414, 896],
		[390, 844],
		[360, 640],
	])(
		"covers no card or seat name of the shown deal with a phone's result at %sx%s",
		async (width, height) => {
			await page.viewport(width, height);
			try {
				const box = renderResult("compact").getBoundingClientRect();
				const covered = [
					...document.querySelectorAll<HTMLElement>(".hand .card, .seat-label"),
				].filter((part) => {
					const rect = part.getBoundingClientRect();
					return (
						part.checkVisibility() &&
						rect.left < box.right &&
						rect.right > box.left &&
						rect.top < box.bottom &&
						rect.bottom > box.top
					);
				});
				expect(covered.map((part) => part.textContent)).toEqual([]);
			} finally {
				await page.viewport(414, 896);
			}
		},
	);

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
				question: "",
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
					question: "Ask to undo your last bid?",
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
			// The calls are grayed out, but the Undo that still works keeps its colour: no filter on it or around it.
			const filters = (element: Element | null): string[] => {
				const found: string[] = [];
				for (let node = element; node; node = node.parentElement) {
					const { filter } = getComputedStyle(node);
					if (filter !== "none") found.push(filter);
				}
				return found;
			};
			expect(filters(target)).toEqual([]);
			const level = [...root.querySelectorAll(".bid-levels button")].find(
				(button) => button.checkVisibility(),
			);
			expect(filters(level ?? null)).not.toEqual([]);
			(hit as HTMLElement).click();
			// The request goes only after the player confirms it.
			const dialog = root.querySelector<HTMLDialogElement>(
				'[data-testid="undo-confirm"]',
			);
			expect(dialog?.open).toBe(true);
			expect(dialog?.textContent).toContain("Ask to undo your last bid?");
			expect(handlers.undoRequest).not.toHaveBeenCalled();
			dialog
				?.querySelector<HTMLButtonElement>('[data-testid="undo-confirm-send"]')
				?.click();
			expect(dialog?.open).toBe(false);
			expect(handlers.undoRequest).toHaveBeenCalledExactlyOnceWith(view.board);
		},
	);

	it("sends no undo request when the player cancels the question", () => {
		const { root, handlers } = renderView(playView(), "desktop");
		// The desktop play controls are in the sidebar, outside the table section.
		document
			.querySelector<HTMLButtonElement>('[data-testid="undo-request"]')
			?.click();
		const dialog = root.querySelector<HTMLDialogElement>(
			'[data-testid="undo-confirm"]',
		);
		expect(dialog?.open).toBe(true);
		dialog
			?.querySelector<HTMLButtonElement>('[data-testid="undo-confirm-cancel"]')
			?.click();
		expect(dialog?.open).toBe(false);
		expect(handlers.undoRequest).not.toHaveBeenCalled();
	});
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
	const RED = "rgb(255, 69, 69)";

	it("keeps the bidding box above the bidder's frame", () => {
		const view = playView();
		const { root } = renderMobile({
			...view,
			phase: "auction",
			seats: view.seats.map((player) => ({
				...player,
				turn: player.seat === "E",
			})),
		});
		const overlay = root.querySelector<HTMLElement>(".mobile-bid-overlay");
		const frame = root.querySelector<HTMLElement>(
			'.mobile-board-left .mobile-board-name[data-turn-frame="true"] + .hand',
		);
		if (!overlay || !frame) throw new Error("missing bid box or bidder frame");
		const frameBox = frame.getBoundingClientRect();
		const overlayBox = overlay.getBoundingClientRect();
		const x = frameBox.left + 1;
		const y = Math.max(frameBox.top, overlayBox.top) + 4;
		expect(x).toBeGreaterThan(overlayBox.left);
		expect(y).toBeLessThan(Math.min(frameBox.bottom, overlayBox.bottom));
		const painted = document.elementFromPoint(x, y);
		expect(painted && overlay.contains(painted)).toBe(true);
	});

	it("distinguishes an inactive bidding box and unavailable options", () => {
		const base = playView();
		const { root, section } = renderMobile({
			...base,
			phase: "auction",
			bids: [{ call: "P", text: "Pass" }],
		});
		const overlay = root.querySelector<HTMLElement>(".mobile-bid-overlay");
		if (!overlay) throw new Error("missing bid box");
		const disabled = overlay.querySelector<HTMLButtonElement>(
			".bid-levels button:disabled",
		);
		const enabled = overlay.querySelector<HTMLButtonElement>(
			".bid-calls button:enabled",
		);
		if (!disabled || !enabled)
			throw new Error("missing enabled or disabled bid");
		expect(getComputedStyle(disabled).backgroundColor).not.toBe(
			getComputedStyle(enabled).backgroundColor,
		);
		expect(getComputedStyle(disabled).color).not.toBe(
			getComputedStyle(enabled).color,
		);
		expect(getComputedStyle(disabled).filter).toBe(
			"grayscale(1) brightness(0.6)",
		);
		expect(getComputedStyle(disabled).backgroundImage).toContain("47%");
		// The background layer and the calls are darkened, not the overlay itself, so a working Undo keeps its colour.
		expect(getComputedStyle(overlay, "::before").filter).toBe("none");
		section.render({ ...base, phase: "auction", bids: [] });
		expect(getComputedStyle(overlay, "::before").filter).toBe(
			"grayscale(1) brightness(0.6)",
		);
		expect(
			getComputedStyle(overlay.querySelector(".bid-levels") as Element).filter,
		).toBe("grayscale(1) brightness(0.6)");
	});

	it("darkens the inactive desktop bid box and keeps the bidding windows above the table", () => {
		const { root } = renderView(
			{ ...playView(), phase: "auction", bids: [] },
			"desktop",
		);
		const bidBox = root.querySelector<HTMLElement>(".bid-box");
		const center = root.querySelector<HTMLElement>(".center");
		if (!bidBox || !center) throw new Error("missing bidding windows");
		expect(getComputedStyle(bidBox, "::before").filter).toBe(
			"grayscale(1) brightness(0.6)",
		);
		expect(
			getComputedStyle(bidBox.querySelector(".bid-levels") as Element).filter,
		).toBe("grayscale(1) brightness(0.6)");
		expect(Number(getComputedStyle(center).zIndex)).toBeGreaterThan(5);
	});

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
