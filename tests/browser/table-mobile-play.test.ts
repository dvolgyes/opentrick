import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import type { Form } from "../../src/call/device-class";
import { type Locale, type Translate, translator } from "../../src/i18n";
import { pageReport } from "../../src/ui/page-report";
import {
	type PlayedCardStyle,
	type TableHandlers,
	tableSection,
} from "../../src/ui/table";
import type { SeatView, TableView } from "../../src/ui/table-model";

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
		points: undefined,
		...options,
	};
}

function playView(): TableView {
	return {
		phase: "play",
		board: 1,
		at: 5,
		heading: "Board 1",
		details: "Dealer: North · Vulnerable: None",
		prompt: "Your turn to play from dummy.",
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
	form: Form,
	style?: PlayedCardStyle,
	t?: Translate,
) {
	const handlers: TableHandlers = {
		exit: vi.fn(),
		shareUrl: vi.fn(async () => {}),
		act: vi.fn(),
		undoRequest: vi.fn(),
		undoVote: vi.fn(),
		undoCancel: vi.fn(),
		claimRequest: vi.fn(),
		claimVote: vi.fn(),
		call: {
			join: vi.fn(),
			leave: vi.fn(),
			setSwitch: vi.fn(),
			retry: vi.fn(),
		},
	};
	const section = tableSection(handlers, style, t);
	const room = document.createElement("section");
	room.className = "room";
	room.dataset.form = form;
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
	it("uses the seat-oriented four-corner design by default", () => {
		const { root } = renderView(playView(), "desktop");
		expect(root.dataset.playedCardStyle).toBe("corners-oriented");
	});

	const ALL_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
	// On a phone, each card shows its own top-left and bottom-right corners, as seen by the player who played it: the
	// side cards are turned a quarter, so their ranks are top-right and bottom-left on screen.
	it.each<[Form, Record<"top" | "left" | "bottom" | "right", string[]>]>([
		[
			"desktop",
			{
				top: ALL_CORNERS,
				left: ALL_CORNERS,
				bottom: ALL_CORNERS,
				right: ALL_CORNERS,
			},
		],
		[
			"compact",
			{
				top: ["top-left", "bottom-right"],
				left: ["top-right", "bottom-left"],
				bottom: ["top-left", "bottom-right"],
				right: ["top-right", "bottom-left"],
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
			style === "corners-oriented" ? "matrix(0, 1, -1, 0, 0, 0)" : "none",
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
		const rotations: Record<string, string> = {
			top: "matrix(1, 0, 0, 1, 0, 0)",
			left: "matrix(0, 1, -1, 0, 0, 0)",
			right: "matrix(0, -1, 1, 0, 0, 0)",
			bottom: "matrix(-1, 0, 0, 1, 0, 0)",
		};
		for (const [position, transform] of Object.entries(rotations)) {
			const marker = root.querySelector<HTMLElement>(
				`.played.pos-${position} .rank-corner`,
			);
			if (!marker) throw new Error(`${position} corner marker is missing`);
			expect(getComputedStyle(marker).transform).toBe(transform);
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
});

describe("turn pill", () => {
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
	])("names the seat to bid in %s", (locale, own, other) => {
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
		expect([pill("N"), pill("E")]).toEqual([own, other]);
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
	])("names the seat to play in %s", (locale, own, other) => {
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
		expect([pill("N"), pill("E")]).toEqual([own, other]);
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
		for (const seatName of ["N", "S"]) {
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

	it("stands the pill of a side seat along the inner edge of its cards", () => {
		const base = sideHandView();
		const view: TableView = {
			...base,
			seats: base.seats.map((player) => ({
				...player,
				turnPill: { action: "play", yours: player.seat === "N" },
			})),
		};
		const { root } = renderView(view, "desktop");
		for (const [seatName, inner] of [
			["E", "right"],
			["W", "left"],
		] as const) {
			const seat = root.querySelector<HTMLElement>(
				`[data-testid="hand-${seatName}"]`,
			);
			const pill = seat?.querySelector(".turn-pill")?.getBoundingClientRect();
			const hand = seat?.querySelector(".hand")?.getBoundingClientRect();
			if (!pill || !hand) throw new Error(`${seatName} has no pill or hand`);
			expect(pill.height, seatName).toBeGreaterThan(pill.width);
			if (inner === "right")
				expect(pill.left, seatName).toBeGreaterThanOrEqual(hand.right);
			else expect(pill.right, seatName).toBeLessThanOrEqual(hand.left);
			expect(pill.top, seatName).toBeLessThan(hand.bottom);
			expect(pill.bottom, seatName).toBeGreaterThan(hand.top);
		}
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
		section.setBotControls(false, ["E"], "inception/mercury-3");
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

		section.setBotControls(false, ["E"], "unmapped/model");
		expect(artwork?.hidden).toBe(true);
		expect(fallback?.hidden).toBe(false);
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
					compactDetail: "Made +1",
					countdown: 1,
				},
				nextBoard: { board: 2, ready: false },
			},
			"desktop",
		);
		const scoring = root.querySelector<HTMLElement>("[data-testid='scoring']");
		if (!scoring) throw new Error("desktop scoring panel is missing");
		expect(scoring.textContent).toBe(
			"Contract 4♥WON: Made +1Next board 2 in 1 second",
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
					compactDetail: "Made +1",
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
					compactDetail: "Opponents made +1",
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
			claim: { ...view.claim, canRequest: false },
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
		document.documentElement.style.fontSize = "17.6px";

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
			const cell = root.querySelector<HTMLElement>(
				".mobile-auction-bids .auction td",
			);
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

	it("uses the desktop claim confirmation and undo vote handlers", () => {
		const { root, handlers } = renderMobile(playView());
		const controls = root.querySelector<HTMLElement>(
			".mobile-auction-controls",
		);
		if (!controls) throw new Error("mobile controls are missing");

		const claim = [...controls.querySelectorAll("button")].find(
			(button) => button.textContent === "Claim …",
		);
		claim?.click();
		const confirm = controls.querySelector<HTMLButtonElement>(
			'[data-testid="claim-confirm"]',
		);
		const count = controls.querySelector<HTMLSelectElement>(
			'[data-testid="claim-count"]',
		);
		if (!confirm || !count) throw new Error("claim confirmation is missing");
		count.value = "2";
		count.dispatchEvent(new Event("change"));
		confirm.click();
		expect(handlers.claimRequest).toHaveBeenCalledWith(1, 2);

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

	it("shows a pending undo in the mobile overlay and routes approval", () => {
		const view = playView();
		const { root, handlers } = renderMobile({
			...view,
			undo: {
				canRequest: false,
				message: "playerW asks to undo their last played card.",
				requestId: "undo-1",
				canVote: true,
				canCancel: false,
			},
		});
		const overlay = root.querySelector<HTMLElement>(
			'[data-testid="mobile-undo-overlay"]',
		);
		expect(overlay?.hidden).toBe(false);
		expect(overlay?.textContent).toContain("playerW asks to undo");
		expect(overlay?.textContent).toContain("Approve");
		expect(overlay?.textContent).toContain("Reject");
		const approve = [...(overlay?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Approve",
		);
		approve?.click();
		expect(handlers.undoVote).toHaveBeenCalledWith("undo-1", true);
	});
});
