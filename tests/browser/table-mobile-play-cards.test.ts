import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import type { Form, Layout } from "../../src/call/device-class";
import { translator } from "../../src/i18n";
import { parseGuide, renderGuide } from "../../src/ui/bidding-guide";
import type { PlayedCardStyle } from "../../src/ui/table";
import type { TableView } from "../../src/ui/table-model";
import {
	card,
	playView,
	renderMobile,
	renderView,
	sideHandView,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

describe("played card styles", () => {
	it.each(
		(["left", "right"] as const).flatMap((position) =>
			(["M", "XXL"] as const).flatMap((size) =>
				(
					[
						["four short suits", ["S98", "H8", "D6", "CAT9"]],
						["one suit", ["HQT"]],
					] as const
				).map(([name, rows]) => [position, size, name, rows] as const),
			),
		),
	)(
		"keeps the turn frame of a visible %s phone hand at %s with %s around its cards at the board edge",
		async (position, size, _name, rows) => {
			await page.viewport(593, 630);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const base = playView();
				const symbols = { S: "♠", H: "♥", D: "♦", C: "♣" } as const;
				const hand = {
					visible: true as const,
					suits: rows.map((row, index) => {
						const suit = row[0] as keyof typeof symbols;
						return {
							suit,
							symbol: symbols[suit],
							cards: [...row.slice(1)].map((rank) => ({
								...card(`${suit}${rank}` as Card),
								playable: false,
							})),
							trump: index === 0 && rows.length > 1,
						};
					}),
				};
				const { root } = renderMobile({
					...base,
					seats: base.seats.map((player) =>
						player.position === position
							? { ...player, hand, turn: true }
							: player.position === "left" || player.position === "right"
								? {
										...player,
										hand: { visible: false as const, count: 13 },
										turn: false,
									}
								: { ...player, turn: false },
					),
				});
				const column = root.querySelector<HTMLElement>(
					`.mobile-board-${position}`,
				);
				const frame = column?.querySelector<HTMLElement>(
					'.mobile-board-name[data-turn-frame="true"] + .hand-stack',
				);
				if (!column || !frame) throw new Error("missing framed side hand");
				// The label's text, not its block, is what the frame must hold.
				const label = frame.querySelector(".trump-label");
				const text = document.createRange();
				if (label) text.selectNodeContents(label);
				const parts = [
					...[...frame.querySelectorAll<HTMLElement>(".face")].map((face) =>
						face.getBoundingClientRect(),
					),
					...(label ? [text.getBoundingClientRect()] : []),
				];
				const box = frame.getBoundingClientRect();
				// The frame is drawn inside the hand's box. It lies just outside the cards and the trump label:
				// it covers none of them and leaves no room beside them.
				const width = Number.parseFloat(
					getComputedStyle(frame, "::after").borderTopWidth,
				);
				expect(width).toBeGreaterThan(0);
				const gaps = [
					Math.min(...parts.map((part) => part.left)) - box.left,
					box.right - Math.max(...parts.map((part) => part.right)),
					Math.min(...parts.map((part) => part.top)) - box.top,
					box.bottom - Math.max(...parts.map((part) => part.bottom)),
				];
				for (const gap of gaps) {
					expect(gap).toBeGreaterThanOrEqual(width - 0.5);
					expect(gap).toBeLessThanOrEqual(width + 1);
				}
				// Every suit row starts at the board edge of its column, away from the trick.
				const edge = column.getBoundingClientRect();
				for (const row of frame.querySelectorAll<HTMLElement>(".suit-row")) {
					const bounds = row.getBoundingClientRect();
					expect(
						position === "left"
							? bounds.left - edge.left
							: edge.right - bounds.right,
					).toBeLessThanOrEqual(width + 1);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
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
		"keeps the sidebar header's contract the same size as the trick labels (%s)",
		(layout) => {
			renderView(playView(), layout);
			const selectors = [
				".table-sidebar .contract-head .bid",
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
					expect(values[0], size).toBe(values[1]);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);
	it.each<Layout>(["desktop", "sideways", "compact"])(
		"draws the trick guide's contract at the size of its numbers at each font setting (%s)",
		(layout) => {
			renderView(playView(), layout);
			const rows = [
				...document.querySelectorAll<HTMLElement>(".tricks-counts"),
			].filter((row) => row.checkVisibility());
			expect(rows.length).toBeGreaterThan(0);
			try {
				for (const size of ["S", "M", "L", "XL", "XXL", "XXXL"]) {
					document.documentElement.dataset.suitFontSize = size;
					for (const row of rows) {
						const bid = row.querySelector<HTMLElement>(".bid");
						const numbers = [...row.querySelectorAll<HTMLElement>("strong")];
						if (!bid) throw new Error("the trick guide has no contract");
						expect(numbers).toHaveLength(3);
						for (const number of numbers)
							expect(getComputedStyle(bid).fontSize, size).toBe(
								getComputedStyle(number).fontSize,
							);
					}
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
				if (!dummy?.hand.visible) throw new Error("missing visible dummy");
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
								(nodes[index]?.closest(
									".table-sidebar .bid, .tricks-counts .bid",
								)
									? 1
									: scale) *
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

	// Each card shows the same diagonal on screen, with no mirrored cards.
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

		expect(getComputedStyle(marker).transform).toBe("none");
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
		// The rank and suit stay upright for every seat.
		const rotations: Record<string, string> = {
			top: "matrix(1, 0, 0, 1, 0, 0)",
			left: "matrix(1, 0, 0, 1, 0, 0)",
			right: "matrix(1, 0, 0, 1, 0, 0)",
			bottom: "matrix(1, 0, 0, 1, 0, 0)",
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
				expect(
					linear === "none" ? "matrix(1, 0, 0, 1, 0, 0)" : linear,
					`${position} ${mark}`,
				).toBe(transform);
			}
		}
	});

	it("keeps top and bottom played cards unmirrored, independent of the declarer", () => {
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
						{ ...firstPlayed, seat: "N", position: "top" },
						{ ...firstPlayed, seat: "S", position: "bottom" },
					],
				},
			},
			"desktop",
		);
		const bottomCard = root.querySelector<HTMLElement>(".played.pos-bottom");
		if (!bottomCard) throw new Error("bottom played card is missing");
		expect(getComputedStyle(bottomCard).transform).toBe("none");
		const topCard = root.querySelector<HTMLElement>(".played.pos-top");
		if (!topCard) throw new Error("top played card is missing");
		expect(getComputedStyle(topCard).transform).toBe("none");
		const leftCard = root.querySelector<HTMLElement>(".played.pos-left");
		if (!leftCard) throw new Error("left played card is missing");
		expect(getComputedStyle(leftCard).transform).toBe("none");
	});

	it.each<[Layout, "7" | "Q"]>([
		["desktop", "7"],
		["desktop", "Q"],
		["compact", "7"],
		["compact", "Q"],
	])("draws the %s bottom and left %s identically", (layout, rank) => {
		const base = playView();
		const first = base.trick?.cards[0];
		if (!first) throw new Error("missing played card");
		const card = { ...first, card: `S${rank}` as Card, rank, text: `♠${rank}` };
		const { root } = renderView(
			{
				...base,
				trick: {
					cards: [
						{ ...card, position: "left" },
						{ ...card, position: "bottom" },
					],
					finished: false,
				},
			},
			layout,
		);
		const cards = ["left", "bottom"].map((position) => {
			const face = root.querySelector<HTMLElement>(`.played.pos-${position}`);
			if (!face) throw new Error(`missing ${position} card`);
			expect(getComputedStyle(face).transform).toBe("none");
			const box = face.getBoundingClientRect();
			return [
				".rank-corner.top-left",
				".rank-corner.bottom-right",
				".played-center-suit",
			].map((selector) => {
				const mark = face.querySelector<HTMLElement>(selector);
				if (!mark) throw new Error(`missing ${selector}`);
				expect(mark.textContent).toBe(
					selector === ".played-center-suit" ? "♠" : rank,
				);
				expect(getComputedStyle(mark).display).not.toBe("none");
				const transform = new DOMMatrixReadOnly(
					getComputedStyle(mark).transform === "none"
						? undefined
						: getComputedStyle(mark).transform,
				);
				expect([transform.a, transform.b, transform.c, transform.d]).toEqual([
					1, 0, 0, 1,
				]);
				const bounds = mark.getBoundingClientRect();
				return [
					bounds.left - box.left,
					bounds.top - box.top,
					bounds.width,
					bounds.height,
				];
			});
		});
		const [left, bottom] = cards;
		if (!left || !bottom) throw new Error("missing comparison cards");
		for (const [index, mark] of left.entries())
			for (const [part, value] of mark.entries())
				expect(value).toBeCloseTo(bottom[index]?.[part] ?? Number.NaN, 0);
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
