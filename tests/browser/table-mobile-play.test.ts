import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import type { Layout } from "../../src/call/device-class";
import {
	card,
	playView,
	renderMobile,
	renderView,
	sideHandView,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

describe("played card styles", () => {
	it.each<[number, number, "left" | "right"]>([
		[360, 540, "left"],
		[360, 540, "right"],
		[360, 576, "left"],
		[360, 576, "right"],
		[360, 720, "left"],
		[360, 720, "right"],
	])(
		"fits XXXL play without overlap at %i × %i with the dummy on the %s",
		async (width, height, position) => {
			await page.viewport(width, height);
			document.documentElement.dataset.suitFontSize = "XXXL";
			try {
				const base = sideHandView();
				const dummy = base.seats.find((player) => player.position === "left");
				const first = base.trick?.cards[0];
				if (!dummy || !first) throw new Error("missing dummy or trick");
				const makeCard = (suit: "S" | "H" | "D" | "C", rank: string) => ({
					...card(`${suit}${rank}` as Card),
					rank: rank === "T" ? "10" : rank,
				});
				const hand = {
					visible: true as const,
					suits: [
						{
							suit: "S" as const,
							symbol: "♠",
							trump: false,
							cards: ["A", "K", "Q", "T"].map((rank) => makeCard("S", rank)),
						},
						{
							suit: "H" as const,
							symbol: "♥",
							trump: false,
							cards: ["A", "K", "Q", "T"].map((rank) => makeCard("H", rank)),
						},
						{
							suit: "D" as const,
							symbol: "♦",
							trump: true,
							cards: ["A", "K", "Q"].map((rank) => makeCard("D", rank)),
						},
						{
							suit: "C" as const,
							symbol: "♣",
							trump: false,
							cards: ["A", "K"].map((rank) => makeCard("C", rank)),
						},
					],
				};
				const view = {
					...base,
					seats: base.seats.map((seat) =>
						seat.position === "bottom"
							? { ...seat, hand }
							: seat.position === position
								? { ...seat, hand: dummy.hand }
								: seat.position === "left"
									? { ...seat, hand: { visible: false as const, count: 13 } }
									: seat,
					),
					trick: {
						cards: (["top", "left", "right", "bottom"] as const).map(
							(side) => ({ ...first, position: side }),
						),
						finished: false,
					},
				};
				const { root } = renderMobile(view);
				expect(
					Number.parseFloat(
						getComputedStyle(document.documentElement).fontSize,
					),
				).toBeCloseTo(Math.min(width * 0.032, height * 0.02), 1);
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				const dummyColumn = root.querySelector<HTMLElement>(
					`.mobile-board-${position}`,
				);
				const own = root.querySelector<HTMLElement>(".mobile-auction-hand");
				const top = root.querySelector<HTMLElement>(".mobile-board-top");
				if (!board || !dummyColumn || !own || !top)
					throw new Error("missing board hands");
				const bounds = board.getBoundingClientRect();
				expect(bounds.left).toBeGreaterThanOrEqual(-0.5);
				expect(bounds.right).toBeLessThanOrEqual(width + 0.5);
				const cards = [
					...root.querySelectorAll<HTMLElement>(".mobile-board-center .played"),
				].map((element) => element.getBoundingClientRect());
				expect(cards).toHaveLength(4);
				const apart = (a: DOMRect, b: DOMRect) =>
					a.right <= b.left + 0.5 ||
					b.right <= a.left + 0.5 ||
					a.bottom <= b.top + 0.5 ||
					b.bottom <= a.top + 0.5;
				for (const [index, cardBox] of cards.entries()) {
					expect(cardBox.left).toBeGreaterThanOrEqual(bounds.left - 0.5);
					expect(cardBox.right).toBeLessThanOrEqual(bounds.right + 0.5);
					expect(cardBox.top).toBeGreaterThanOrEqual(bounds.top - 0.5);
					expect(cardBox.bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
					expect(apart(cardBox, own.getBoundingClientRect())).toBe(true);
					expect(apart(cardBox, top.getBoundingClientRect())).toBe(true);
					for (const other of cards.slice(index + 1))
						expect(apart(cardBox, other)).toBe(true);
				}
				const markers = [
					...dummyColumn.querySelectorAll<HTMLElement>(
						".suit-row .card:last-child .pip",
					),
				];
				expect(markers).toHaveLength(4);
				for (const marker of markers) {
					const range = document.createRange();
					range.selectNodeContents(marker);
					const markerBox = range.getBoundingClientRect();
					expect(markerBox.left).toBeGreaterThanOrEqual(bounds.left - 0.5);
					expect(markerBox.right).toBeLessThanOrEqual(bounds.right + 0.5);
					expect(markerBox.top).toBeGreaterThanOrEqual(bounds.top - 0.5);
					expect(markerBox.bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
					for (const cardBox of cards)
						expect(apart(markerBox, cardBox)).toBe(true);
				}
				const handCards = [...own.querySelectorAll<HTMLElement>(".card")];
				expect(handCards).toHaveLength(13);
				for (const [index, handCard] of handCards.entries()) {
					const face = handCard.querySelector<HTMLElement>(".face");
					if (!face) throw new Error("missing card face");
					const faceBox = face.getBoundingClientRect();
					expect(faceBox.left).toBeGreaterThanOrEqual(bounds.left - 0.5);
					expect(faceBox.right).toBeLessThanOrEqual(bounds.right + 0.5);
					expect(faceBox.top).toBeGreaterThanOrEqual(bounds.top - 0.5);
					expect(faceBox.bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
					const rank = handCard.querySelector<HTMLElement>(".rank");
					if (!rank) throw new Error("missing rank");
					const range = document.createRange();
					range.selectNodeContents(rank);
					const rankBox = range.getBoundingClientRect();
					const next = handCards[index + 1];
					if (next)
						expect(
							rankBox.right,
							`rank ${rank.textContent} covered by next card`,
						).toBeLessThanOrEqual(next.getBoundingClientRect().left + 1);
					expect(rankBox.right).toBeLessThanOrEqual(bounds.right + 0.5);
				}
				expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
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
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			const hand = root.querySelector<HTMLElement>(
				".mobile-auction-hand .hand",
			);
			const label = root.querySelector<HTMLElement>(
				".mobile-auction-hand .seat-label",
			);
			const points = root.querySelector<HTMLElement>(
				".mobile-auction-hand .hcp-pill",
			);
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
			const nameBox = label.getBoundingClientRect();
			const pointsBox = points.getBoundingClientRect();
			expect((nameBox.left + pointsBox.right) / 2).toBeCloseTo(
				centre(board),
				0,
			);
			expect(Math.min(nameBox.bottom, pointsBox.bottom)).toBeGreaterThan(
				Math.max(nameBox.top, pointsBox.top),
			);
			const result = root.querySelector<HTMLElement>(".scoring");
			if (!result) throw new Error("missing scoring panel");
			expect(centre(result)).toBeCloseTo(centre(board), 0);
			expect(result.getBoundingClientRect().width).toBeLessThan(
				board.getBoundingClientRect().width / 2,
			);
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
	it("moves the host's own switch out of the phone bot list", () => {
		const base = playView();
		const view = {
			...base,
			seats: base.seats.map((player) =>
				player.position === "bottom" ? { ...player, tags: ["Host"] } : player,
			),
		};
		const { root, section, handlers } = renderMobile(view);
		section.setBotControls(true, [], false);
		expect(
			root.querySelector('.mobile-player-control[data-seat="N"]'),
		).toBeNull();
		const own =
			section.autoplayControl.querySelector<HTMLButtonElement>("button");
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
	it.each([2, 13])(
		"keeps %i hidden side cards together in the middle of the phone column",
		async (count) => {
			await page.viewport(390, 844);
			document.documentElement.dataset.suitFontSize = "XXL";
			try {
				const base = playView();
				const { root } = renderMobile({
					...base,
					seats: base.seats.map((player) =>
						player.position === "right"
							? { ...player, hand: { visible: false as const, count } }
							: player,
					),
				});
				const column = root.querySelector<HTMLElement>(".mobile-board-right");
				const name = column?.querySelector<HTMLElement>(".mobile-board-name");
				const hand = column?.querySelector<HTMLElement>(".hand");
				const backs = [
					...(column?.querySelectorAll<HTMLElement>(".back .face") ?? []),
				].map((face) => face.getBoundingClientRect());
				if (!column || !name || !hand || backs.length !== count)
					throw new Error("missing side column, name, hand or cards");
				// Each card covers at least half of the card before it, however tall the column is.
				for (const [index, back] of backs.slice(1).entries())
					expect(back.top - (backs[index]?.top ?? 0)).toBeLessThanOrEqual(
						back.height / 2 + 0.5,
					);
				// The hand is as tall as its cards, so its turn frame stays around them.
				expect(
					hand.getBoundingClientRect().bottom - (backs.at(-1)?.bottom ?? 0),
				).toBeLessThanOrEqual(1);
				// The name and the cards are in the middle of the column.
				const box = column.getBoundingClientRect();
				expect(
					Math.abs(
						name.getBoundingClientRect().top -
							box.top -
							(box.bottom - hand.getBoundingClientRect().bottom),
					),
				).toBeLessThanOrEqual(2);
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
	it("keeps top and bottom hands at the board edges and shows whole side cards in the added phone height", async () => {
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
				// With room in the column, no suit row covers the cards of the row above it.
				covered: rows
					.slice(1)
					.some(
						(row, index) =>
							row.getBoundingClientRect().top + 0.5 <
							(rows[index]?.querySelector(".face")?.getBoundingClientRect()
								.bottom ?? 0),
					),
			});
			const expanded = geometry();
			board.style.height = "auto";
			const natural = geometry();
			expect(expanded.topGap).toBeCloseTo(natural.topGap, 0);
			expect(expanded.bottomGap).toBeCloseTo(natural.bottomGap, 0);
			expect(expanded.covered).toBe(false);
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
			const toggle =
				section.autoplayControl.querySelector<HTMLButtonElement>("button");
			if (!toggle) throw new Error("missing autoplay toggle");
			expect(toggle.textContent).toBe("Autoplay my seat");
			section.setPlayerAutoplay(true, false, true, "Sending autoplay request…");
			expect(toggle.disabled).toBe(true);
			expect(section.autoplayStatus.textContent).not.toContain("Autoplay on");
			section.setPlayerAutoplay(true, false, false, "");
			expect(
				root.querySelector(".seat-label button.player-autoplay-toggle"),
			).toBeNull();
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
			expect(toggle.textContent).toBe("Take back control");
			expect(section.autoplayStatus.textContent).toContain("Autoplay on");
			toggle.click();
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
			section.setBotControls(true, [], false);
			section.render(view);
			const toggle =
				section.autoplayControl.querySelector<HTMLButtonElement>("button");
			if (!toggle) throw new Error("missing host autoplay toggle");
			expect(toggle.textContent).toBe("Autoplay my seat");
			section.setBotControls(true, [], false, true);
			expect(toggle.disabled).toBe(true);
			expect(section.autoplayStatus.textContent).not.toContain("Autoplay on");
			section.setBotControls(true, [], false);
			expect(
				root.querySelector(".seat-label button.host-autoplay-toggle"),
			).toBeNull();
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
			section.setBotControls(true, ["N"], false);
			expect(toggle.textContent).toBe("Take back control");
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

	it.each(["M", "XXL"])(
		"puts the top hand, the trick and the bottom hand on the middle line of the phone board at %s",
		async (size) => {
			await page.viewport(364, 784);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const base = playView();
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
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				if (!board) throw new Error("missing board");
				const middle = (selector: string) => {
					const boxes = [...root.querySelectorAll<HTMLElement>(selector)].map(
						(item) => item.getBoundingClientRect(),
					);
					if (boxes.length === 0) throw new Error(`missing ${selector}`);
					return (
						(Math.min(...boxes.map((box) => box.left)) +
							Math.max(...boxes.map((box) => box.right))) /
						2
					);
				};
				const line = middle(".mobile-auction-board");
				for (const selector of [
					".mobile-board-top :is(.back, .card .face)",
					".mobile-board-center .played",
					".mobile-auction-hand .card .face",
				])
					expect(Math.abs(middle(selector) - line), selector).toBeLessThan(2);
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);
});
