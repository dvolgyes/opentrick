import { afterEach, describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import type { Seat } from "../../src/protocol";
import type { TableView } from "../../src/ui/table-model";
import {
	card,
	playView,
	renderView,
	sideHandView,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

describe("board depth and frame colours", () => {
	it.each(["compact", "sideways"] as const)(
		"keeps the active bottom hand transparent and framed in %s",
		(layout) => {
			const { root, section } = renderView(playView(), layout);
			const seat = root.querySelector<HTMLElement>('[data-testid="hand-N"]');
			const hand = seat?.querySelector<HTMLElement>(".hand");
			if (!seat || !hand) throw new Error("missing bottom hand");
			expect(getComputedStyle(hand).backgroundColor).toBe("rgba(0, 0, 0, 0)");
			expect(
				getComputedStyle(layout === "compact" ? hand : seat).outlineStyle,
			).toBe("solid");
			expect(hand.querySelector<HTMLElement>(".card")?.checkVisibility()).toBe(
				true,
			);
			section.dispose();
		},
	);
	it("keeps both card backs available when the asset server is unreachable", async () => {
		const session = cdp();
		await session.send("Network.enable");
		await session.send("Network.setCacheDisabled", { cacheDisabled: true });
		await session.send("Network.setBlockedURLs", {
			urls: ["*bridge-call-card-back*"],
		});
		try {
			const base = playView();
			const { root, section } = renderView(base, "desktop");
			const colour = async () => {
				const back = root.querySelector<HTMLImageElement>(".hand .back-art");
				if (!back) throw new Error("missing card back");
				await back.decode();
				const canvas = document.createElement("canvas");
				canvas.width = 120;
				canvas.height = 168;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("canvas unavailable");
				context.drawImage(back, 0, 0, canvas.width, canvas.height);
				const pixels = context.getImageData(
					0,
					0,
					canvas.width,
					canvas.height,
				).data;
				let red = 0;
				let blue = 0;
				for (let i = 0; i < pixels.length; i += 4) {
					if ((pixels[i] ?? 0) > (pixels[i + 2] ?? 0) * 1.3) red++;
					if ((pixels[i + 2] ?? 0) > (pixels[i] ?? 0) * 1.3) blue++;
				}
				return { red, blue };
			};
			const odd = await colour();
			expect(odd.red).toBeGreaterThan(1000);
			section.render({ ...base, board: 2 });
			const even = await colour();
			expect(even.blue).toBeGreaterThan(1000);
			section.render({ ...base, board: 3 });
			expect((await colour()).red).toBeGreaterThan(1000);
			section.dispose();
		} finally {
			await session.send("Network.setBlockedURLs", { urls: [] });
			await session.send("Network.setCacheDisabled", { cacheDisabled: false });
		}
	});

	it.each(["desktop", "sideways", "compact"] as const)(
		"keeps played cards in place as the hands empty on %s",
		(layout) => {
			const initial = playView();
			const first = initial.trick?.cards[0];
			if (!first) throw new Error("missing initial played card");
			const base = {
				...initial,
				trick: {
					finished: false,
					cards: [
						first,
						{
							...first,
							seat: "S" as const,
							position: "top" as const,
							card: "S2" as const,
							rank: "2",
							text: "♠2",
						},
						{
							...first,
							seat: "N" as const,
							position: "bottom" as const,
							card: "S3" as const,
							rank: "3",
							text: "♠3",
						},
					],
				},
				seats: initial.seats.map((seat) =>
					seat.position !== "bottom"
						? { ...seat, hand: { visible: false as const, count: 13 } }
						: seat,
				),
			};
			const { root, section } = renderView(base, layout);
			const board = root.querySelector<HTMLElement>(
				layout === "compact" ? ".mobile-auction-board" : ".felt",
			);
			if (!board) throw new Error("missing game board");
			if (layout !== "compact") board.style.height = "700px";
			const location = () => {
				const played = [
					...root.querySelectorAll<HTMLElement>(".trick .played"),
				];
				if (played.length !== 3) throw new Error("missing played cards");
				const bounds = board.getBoundingClientRect();
				return played.map((node) => {
					const card = node.getBoundingClientRect();
					return { x: card.left - bounds.left, y: card.top - bounds.top };
				});
			};
			const before = location();
			for (const count of [12, 6, 1, 0]) {
				section.render({
					...base,
					seats: base.seats.map((seat) =>
						seat.position === "bottom"
							? {
									...seat,
									turn: false,
									...(count === 0
										? { hand: { visible: true as const, suits: [] } }
										: {}),
								}
							: {
									...seat,
									turn: seat.position === "left",
									hand: { visible: false as const, count },
								},
					),
				});
				const after = location();
				for (const [index, card] of after.entries()) {
					expect(card.x).toBeCloseTo(before[index]?.x ?? NaN, 0);
					expect(card.y).toBeCloseTo(before[index]?.y ?? NaN, 0);
				}
			}
		},
	);
	it("keeps the phone's trick in place with long side-player names", () => {
		const initial = playView();
		const base = {
			...initial,
			seats: initial.seats.map((seat) =>
				seat.position === "left" || seat.position === "right"
					? {
							...seat,
							label: `${seat.seat} - A particularly long player name`,
							hand: { visible: false as const, count: 13 },
						}
					: seat,
			),
		};
		const { root, section } = renderView(base, "compact");
		const card = () => {
			const node = root.querySelector<HTMLElement>(".trick .played");
			const board = root.querySelector<HTMLElement>(".mobile-auction-board");
			if (!node || !board) throw new Error("missing board or played card");
			return (
				node.getBoundingClientRect().top - board.getBoundingClientRect().top
			);
		};
		const before = card();
		section.render({
			...base,
			seats: base.seats.map((seat) =>
				seat.position === "left" || seat.position === "right"
					? { ...seat, hand: { visible: false as const, count: 0 } }
					: seat,
			),
		});
		expect(card()).toBeCloseTo(before, 0);
	});
	it.each(["desktop", "compact"] as const)(
		"disables and dims the room call when no human can join (%s)",
		(layout) => {
			const { root, section } = renderView(playView(), layout);
			section.renderCall({
				available: false,
				reason: "No other human players are present.",
				botsOnly: true,
			});
			const panel = root.querySelector<HTMLElement>(".call-panel");
			const group = root.querySelector<HTMLElement>(
				'.icon-group[data-bots-only="true"]',
			);
			if (!panel || !group) throw new Error("missing call controls");
			for (const control of [panel, group]) {
				expect(getComputedStyle(control).filter).toBe(
					"grayscale(1) brightness(0.6)",
				);
				for (const button of control.querySelectorAll<HTMLButtonElement>(
					".call-toggle, .call-join",
				))
					expect(button.disabled).toBe(true);
			}
		},
	);
	it("keeps mobile hand cards and board labels free of drop shadows", () => {
		const { root, section } = renderView(sideHandView(), "compact");
		section.setBotControls(true, ["E"], false);
		const board = root.querySelector<HTMLElement>(".mobile-auction-board");
		if (!board) throw new Error("missing board");
		const handFaces = [...board.querySelectorAll<HTMLElement>(".hand .face")];
		const labels = [
			...board.querySelectorAll<HTMLElement>(
				".seat-label .name, .seat-label .tag, .mobile-board-name",
			),
		];
		// The host's switches are in the Host controls, outside the room (src/ui/room-view.ts).
		document.body.append(section.hostPlayers);
		const toggles = [
			...section.hostPlayers.querySelectorAll<HTMLElement>(
				".mobile-player-control button",
			),
		];
		expect(handFaces.length).toBeGreaterThan(0);
		expect(labels.length).toBeGreaterThan(0);
		expect(toggles.length).toBeGreaterThan(0);
		for (const element of [...handFaces, ...labels, ...toggles])
			expect(getComputedStyle(element).boxShadow).not.toMatch(/rgba?\(0, 0, 0/);
		const played = board.querySelector<HTMLElement>(".played");
		if (!played) throw new Error("missing center card");
		expect(getComputedStyle(played).boxShadow).toMatch(/rgba?\(0, 0, 0/);
	});
	it.each<["desktop" | "sideways" | "compact", Seat, string]>([
		["desktop", "N", "bottom"],
		["desktop", "E", "left"],
		["desktop", "S", "top"],
		["desktop", "W", "right"],
		["sideways", "N", "bottom"],
		["sideways", "E", "left"],
		["sideways", "S", "top"],
		["sideways", "W", "right"],
		["compact", "N", "bottom"],
		["compact", "E", "left"],
		["compact", "S", "top"],
		["compact", "W", "right"],
	])(
		"keeps the %s %s turn frame above card shadows",
		async (layout, active, position) => {
			await page.viewport(
				layout === "compact" ? 390 : 1200,
				layout === "compact" ? 844 : 850,
			);
			try {
				const base = sideHandView();
				const view = {
					...base,
					seats: base.seats.map((seat) => ({
						...seat,
						turn: seat.seat === active,
					})),
				};
				const { root } = renderView(view, layout);
				const board = root.querySelector<HTMLElement>(
					layout === "compact" ? ".mobile-auction-board" : ".felt",
				);
				const frame = root.querySelector<HTMLElement>(
					layout !== "compact"
						? `.place-${position} .seat`
						: position === "bottom"
							? ".mobile-auction-hand .hand"
							: `.mobile-board-${position} .hand`,
				);
				const face = frame?.querySelector<HTMLElement>(".face");
				if (!board || !frame || !face)
					throw new Error("missing board frame or card");
				expect(getComputedStyle(frame, "::after").pointerEvents).toBe("none");
				face.style.boxShadow = "0 0 0 300px rgba(0, 0, 0, 0.85)";
				const boardBox = board.getBoundingClientRect();
				const box = frame.getBoundingClientRect();
				const offset =
					layout !== "compact"
						? 6
						: position === "left" || position === "right"
							? -1.5
							: 3.5;
				const points = [
					[box.left + box.width / 2, box.top - offset],
					[box.left + box.width / 2, box.bottom + offset],
					[box.left - offset, box.top + box.height / 2],
					[box.right + offset, box.top + box.height / 2],
				].filter(
					([x, y]) =>
						x !== undefined &&
						y !== undefined &&
						x >= boardBox.left &&
						x < boardBox.right &&
						y >= boardBox.top &&
						y < boardBox.bottom,
				);
				expect(points.length).toBeGreaterThan(0);
				const image = new Image();
				image.src = `data:image/png;base64,${await page.screenshot({ element: board, save: false })}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("canvas unavailable");
				context.drawImage(image, 0, 0);
				for (const [x, y] of points) {
					if (x === undefined || y === undefined)
						throw new Error("missing frame point");
					const pixel = context.getImageData(
						Math.floor(
							((x - boardBox.left) * image.naturalWidth) / boardBox.width,
						),
						Math.floor(
							((y - boardBox.top) * image.naturalHeight) / boardBox.height,
						),
						1,
						1,
					).data;
					expect(pixel[0], `red at ${x},${y}`).toBeGreaterThan(180);
					expect(pixel[1]).toBeLessThan(120);
					expect(pixel[2]).toBeLessThan(120);
				}
			} finally {
				await page.viewport(414, 896);
			}
		},
	);
	it.each(["desktop", "sideways", "compact"] as const)(
		"keeps the top dealt hand upright in %s",
		(layout) => {
			const base = playView();
			const selector =
				layout === "compact" ? ".mobile-board-top .hand" : ".place-top .hand";
			const visible = renderView(base, layout).root.querySelector<HTMLElement>(
				`${selector} .card .face`,
			);
			if (!visible) throw new Error("missing top face-up card");
			expect(getComputedStyle(visible).transform).toBe("none");
			const hiddenView = {
				...base,
				seats: base.seats.map((player) =>
					player.position === "top"
						? { ...player, hand: { visible: false as const, count: 13 } }
						: player,
				),
			};
			const back = renderView(
				hiddenView,
				layout,
			).root.querySelector<HTMLElement>(`${selector} .back .back-art`);
			if (!back) throw new Error("missing top card back");
			expect(getComputedStyle(back).transform).toBe("none");
		},
	);
	it.each(["desktop", "compact"] as const)(
		"scales board shadows and keeps every played-card shadow down and right in %s",
		(layout) => {
			const base = sideHandView();
			const first = base.trick?.cards[0];
			if (!first) throw new Error("missing played card");
			const positions = ["top", "left", "right", "bottom"] as const;
			const { root, section } = renderView(
				{
					...base,
					trick: {
						cards: positions.map((position) => ({ ...first, position })),
						finished: false,
					},
				},
				layout,
				"corners-oriented",
			);
			section.setBotControls(true, ["E"], false);
			const board = root.querySelector<HTMLElement>(
				layout === "desktop" ? ".felt" : ".mobile-auction-board",
			);
			if (!board) throw new Error("missing board");
			for (const played of board.querySelectorAll<HTMLElement>(".played"))
				expect(getComputedStyle(played).transform).toBe("none");
			const elements = [
				...board.querySelectorAll<HTMLElement>(".played"),
				...(layout === "desktop"
					? board.querySelectorAll<HTMLElement>(
							".hand .card .face, .hand .back .face, .seat-label .name, .seat-label .tag, .mobile-board-name, .video-row .tile, .call-panel, .tile-bot-control",
						)
					: []),
			];
			if (elements.length < (layout === "desktop" ? 8 : 4))
				throw new Error("missing board elements");
			const shadow = (element: HTMLElement) => {
				const style = getComputedStyle(element);
				const match =
					/rgba\(0, 0, 0, ([\d.]+)\) (-?[\d.]+)px (-?[\d.]+)px/.exec(
						style.boxShadow,
					);
				if (!match)
					throw new Error(
						`missing shadow on ${element.className}: ${style.boxShadow}`,
					);
				const matrix = new DOMMatrixReadOnly(
					style.transform === "none" ? undefined : style.transform,
				);
				return {
					alpha: Number(match[1]),
					x: matrix.a * Number(match[2]) + matrix.c * Number(match[3]),
					y: matrix.b * Number(match[2]) + matrix.d * Number(match[3]),
				};
			};
			try {
				document.documentElement.dataset.shadowStrength = "4";
				const full = elements.map(shadow);
				for (const item of full) {
					expect(item.alpha).toBeGreaterThan(0);
					expect(item.x).toBeGreaterThan(0);
					expect(item.y).toBeGreaterThan(0);
				}
				for (let level = 0; level <= 4; level++) {
					document.documentElement.dataset.shadowStrength = String(level);
					for (const [index, element] of elements.entries()) {
						const actual = shadow(element);
						const reference = full[index];
						if (!reference) throw new Error("missing full shadow");
						expect(actual.alpha).toBeCloseTo((reference.alpha * level) / 4, 1);
						expect(actual.x).toBeCloseTo((reference.x * level) / 4, 1);
						expect(actual.y).toBeCloseTo((reference.y * level) / 4, 1);
					}
				}
			} finally {
				delete document.documentElement.dataset.shadowStrength;
			}
		},
	);
	it("casts the video tiles' shadow from the desktop bid box, bidding history, network meters and Join call, not on a phone", () => {
		const view: TableView = {
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
			bids: [{ call: "P", text: "Pass" }],
			contract: "",
			header: undefined,
			trick: undefined,
			need: undefined,
		};
		const parts = (root: HTMLElement, selectors: readonly string[]) =>
			selectors.map((selector) => {
				const element = root.querySelector<HTMLElement>(selector);
				if (!element) throw new Error(`missing ${selector}`);
				return element;
			});
		const desktop = renderView(view, "desktop").root;
		const [tile, ...panels] = parts(desktop, [
			".felt .video-row .tile",
			".bid-box",
			".history-panel",
			".felt .network-bars",
			".felt .call-panel .call-join",
		]);
		if (!tile) throw new Error("missing video tile");
		const tileShadow = getComputedStyle(tile).boxShadow;
		expect(tileShadow).toMatch(/rgba?\(0, 0, 0/);
		for (const panel of panels)
			expect(getComputedStyle(panel).boxShadow, panel.className).toBe(
				tileShadow,
			);
		const compact = renderView(view, "compact").root;
		const compactPanels = [
			...parts(compact, [".bid-box", ".history-panel"]),
			...compact.querySelectorAll<HTMLElement>(".network-bars, .call-join"),
		];
		for (const panel of compactPanels)
			expect(getComputedStyle(panel).boxShadow, panel.className).toBe("none");
	});
	const expectShadow = (element: HTMLElement, minimumOffset: number) => {
		const shadow = getComputedStyle(element).boxShadow;
		const match = /^rgba\(0, 0, 0, ([\d.]+)\) ([\d.]+)px ([\d.]+)px /.exec(
			shadow,
		);
		if (!match) throw new Error(`missing dark shadow: ${shadow}`);
		const [, opacity, x, y] = match;
		const rem = Number.parseFloat(
			getComputedStyle(document.documentElement).fontSize,
		);
		expect(Number(opacity)).toBeGreaterThanOrEqual(0.65);
		expect(Number(x)).toBeGreaterThanOrEqual(rem * minimumOffset - 0.1);
		expect(Number(y)).toBeCloseTo(Number(x), 1);
	};

	it.each(["desktop", "compact"] as const)(
		"uses each theme's turn-frame red in %s",
		(layout) => {
			try {
				for (const [theme, expected] of [
					["normal", "rgb(255, 69, 69)"],
					["solarized", "rgb(239, 75, 67)"],
					["selenized", "rgb(242, 62, 56)"],
					["gruvbox", "rgb(255, 120, 120)"],
				] as const) {
					for (const scheme of ["light", "dark"] as const) {
						document.documentElement.dataset.theme = theme;
						document.documentElement.dataset.scheme = scheme;
						const { root } = renderView(playView(), layout);
						const frame = root.querySelector<HTMLElement>(
							layout === "compact"
								? '.mobile-auction-hand .seat[data-turn-frame="true"] .hand'
								: '.seat[data-turn-frame="true"]',
						);
						if (!frame) throw new Error("missing turn frame");
						expect(
							getComputedStyle(frame).outlineColor,
							`${theme} ${scheme}`,
						).toBe(expected);
					}
				}
			} finally {
				delete document.documentElement.dataset.theme;
				delete document.documentElement.dataset.scheme;
			}
		},
	);
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
			expectShadow(card, 0.3);
			expect(getComputedStyle(trump, "::after").outlineColor).toBe(
				"rgb(232, 185, 35)",
			);
			const before = card.getBoundingClientRect();
			card.style.boxShadow = "none";
			expect(card.getBoundingClientRect().toJSON()).toEqual(before.toJSON());
		},
	);
	it("draws the whole trump frame of a desktop hand above its cards' shadows", async () => {
		await page.viewport(1400, 900);
		try {
			const { root } = renderView(playView(), "desktop");
			const group = root.querySelector<HTMLElement>(
				".place-bottom .suit-group.trump",
			);
			const hand = group?.closest<HTMLElement>(".hand");
			if (!group || !hand) throw new Error("missing bottom trump group");
			const handBox = hand.getBoundingClientRect();
			const box = group.getBoundingClientRect();
			const frame = getComputedStyle(group, "::after");
			// The middle of the gold line, outside the group by the offset and half the line width.
			const reach =
				Number.parseFloat(frame.outlineOffset) +
				Number.parseFloat(frame.outlineWidth) / 2;
			const image = new Image();
			image.src = `data:image/png;base64,${await page.screenshot({ element: hand, save: false })}`;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("canvas unavailable");
			context.drawImage(image, 0, 0);
			const pixel = (x: number, y: number) =>
				context.getImageData(
					Math.floor(((x - handBox.left) * image.naturalWidth) / handBox.width),
					Math.floor(
						((y - handBox.top) * image.naturalHeight) / handBox.height,
					),
					1,
					1,
				).data;
			// The card shadows fall to the right and below, across the right and bottom edges of the frame.
			const edges = {
				right: [box.right + reach, box.top + box.height / 2],
				bottom: [box.left + box.width / 2, box.bottom + reach],
			};
			for (const [edge, [x = 0, y = 0]] of Object.entries(edges)) {
				const [red = 0, green = 0, blue = 0] = pixel(x, y);
				expect([red, green, blue], edge).toEqual([232, 185, 35]);
			}
		} finally {
			await page.viewport(414, 896);
		}
	});
	it.each(
		(["desktop", "sideways"] as const).flatMap((layout) =>
			["M", "L", "XL", "XXL", "XXXL"].map((size) => [layout, size] as const),
		),
	)(
		"keeps the %s trump frame around its cards and the cards of a suit touching at %s",
		async (layout, size) => {
			await page.viewport(1568, 886);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const suit = (
					name: "S" | "H" | "D" | "C",
					symbol: string,
					ranks: string,
					trump: boolean,
				) => ({
					suit: name,
					symbol,
					trump,
					cards: [...ranks].map((rank) => card(`${name}${rank}` as Card)),
				});
				const hand = {
					visible: true as const,
					suits: [
						suit("S", "♠", "QT9865", true),
						suit("H", "♥", "Q9", false),
						suit("D", "♦", "T3", false),
						suit("C", "♣", "7", false),
					],
				};
				const base = playView();
				const { root } = renderView(
					{
						...base,
						seats: base.seats.map((shown) =>
							shown.hand.visible ? { ...shown, hand } : shown,
						),
					},
					layout,
				);
				// The room sits in the page's table screen, so the Full HD canvas sizes the cards as in the app.
				const screen = document.createElement("main");
				screen.dataset.screen = "table";
				screen.dataset.form = "desktop";
				screen.append(...document.body.children);
				document.body.replaceChildren(screen);
				const rows = [
					...root.querySelectorAll<HTMLElement>(
						".felt :is(.place-top, .place-bottom) .hand-row:not(.backs)",
					),
				];
				expect(rows).toHaveLength(2);
				for (const row of rows) {
					const group = row.querySelector<HTMLElement>(
						":scope > .suit-group.trump",
					);
					if (!group) throw new Error("missing trump group");
					const style = getComputedStyle(group, "::after");
					const reach =
						Number.parseFloat(style.outlineOffset) +
						Number.parseFloat(style.outlineWidth);
					const frame = group.getBoundingClientRect();
					for (const face of group.querySelectorAll<HTMLElement>(".face")) {
						const shown = face.getBoundingClientRect();
						expect(shown.right, face.textContent ?? "").toBeLessThanOrEqual(
							frame.right + reach,
						);
						expect(shown.left).toBeGreaterThanOrEqual(frame.left - reach);
					}
					// Within a suit, each card starts where the face before it ends; only the suit gap separates suits.
					const cards = [...row.querySelectorAll<HTMLElement>(".card")];
					cards.slice(1).forEach((next, index) => {
						const previous = cards[index]?.querySelector(".face");
						if (!previous) throw new Error("missing card face");
						const suitGroup = next.closest<HTMLElement>(".suit-group");
						const start =
							suitGroup?.firstElementChild === next ? suitGroup : next;
						const gap = start.classList.contains("suit-start")
							? Number.parseFloat(getComputedStyle(start).marginLeft)
							: 0;
						expect(
							next.getBoundingClientRect().left -
								previous.getBoundingClientRect().right,
							next.dataset.card,
						).toBeLessThanOrEqual(gap + 0.5);
					});
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
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
		for (const box of [...videos, call]) expectShadow(box, 0.45);
	});
});

describe("desktop top and bottom hands", () => {
	const suit = (
		name: "S" | "H" | "D" | "C",
		symbol: string,
		ranks: string,
		trump = false,
	) => ({
		suit: name,
		symbol,
		trump,
		cards: [...ranks].map((rank) => card(`${name}${rank}` as Card)),
	});

	/** Shows the hand at the top and the bottom of the play view, in the scaled Full HD canvas of the app. */
	function renderHands(
		suits: ReturnType<typeof suit>[],
		roundTrip?: TableView["seats"][number]["roundTrip"],
	) {
		const hand = { visible: true as const, suits };
		const base = playView();
		const { root } = renderView(
			{
				...base,
				seats: base.seats.map((shown) => ({
					...shown,
					...(shown.hand.visible ? { hand } : {}),
					...(roundTrip ? { roundTrip } : {}),
				})),
			},
			"desktop",
		);
		const screen = document.createElement("main");
		screen.dataset.screen = "table";
		screen.dataset.form = "desktop";
		screen.append(...document.body.children);
		document.body.replaceChildren(screen);
		const box = (selector: string) => {
			const node = root.querySelector<HTMLElement>(selector);
			if (!node) throw new Error(`missing ${selector}`);
			return node.getBoundingClientRect();
		};
		return {
			box,
			played: box(".felt .played").width,
			rows: (["top", "bottom"] as const).map((place) => {
				const cards = [
					...root.querySelectorAll<HTMLElement>(
						`.felt .place-${place} .hand-row:not(.backs) .card`,
					),
				];
				return { place, cards };
			}),
		};
	}

	/** The last card of each suit, whose whole face shows. */
	const suitEnds = (cards: HTMLElement[]) =>
		cards.filter(
			(shown, index) => cards[index + 1]?.dataset.suit !== shown.dataset.suit,
		);

	const face = (shown: HTMLElement) => {
		const node = shown.querySelector<HTMLElement>(".face");
		if (!node) throw new Error("missing card face");
		return node.getBoundingClientRect();
	};

	it("shows each suit of a short hand as wide as a played card, with a clear gap between the suits", async () => {
		await page.viewport(1568, 886);
		try {
			const { played, rows } = renderHands([
				suit("S", "♠", "AK3", true),
				suit("H", "♥", "Q9"),
				suit("D", "♦", "T3"),
				suit("C", "♣", "7"),
			]);
			for (const { place, cards } of rows) {
				expect(cards, place).toHaveLength(8);
				const ends = suitEnds(cards);
				expect(ends, place).toHaveLength(4);
				for (const end of ends)
					expect(face(end).width, `${place} ${end.dataset.card}`).toBeCloseTo(
						played,
						0,
					);
				for (const end of ends.slice(0, -1)) {
					const next = cards[cards.indexOf(end) + 1];
					if (!next) throw new Error("missing next suit");
					expect(
						next.getBoundingClientRect().left - face(end).right,
						`${place} gap after ${end.dataset.card}`,
					).toBeGreaterThanOrEqual(played / 5);
				}
			}
		} finally {
			await page.viewport(414, 896);
		}
	});

	it("keeps the network bars of the corner windows on the felt, clear of the names", async () => {
		await page.viewport(1568, 886);
		try {
			const { box } = renderHands([suit("S", "♠", "AK3", true)], {
				text: "Network: measuring…",
				quality: "pending",
			});
			const felt = box(".felt");
			const tiles = [
				...document.querySelectorAll<HTMLElement>(".felt .video-slot .tile"),
			];
			expect(tiles).toHaveLength(3);
			for (const tile of tiles) {
				const name = tile.dataset.testid;
				const bars = tile.querySelector<HTMLElement>(".network-bars");
				const caption = tile.querySelector<HTMLElement>(".tile-caption");
				if (!bars || !caption) throw new Error(`missing bars of ${name}`);
				expect(bars.checkVisibility(), name).toBe(true);
				const shown = bars.getBoundingClientRect();
				expect(shown.left, name).toBeGreaterThanOrEqual(felt.left);
				expect(shown.right, name).toBeLessThanOrEqual(felt.right);
				const label = caption.getBoundingClientRect();
				const overlaps =
					shown.left < label.right &&
					label.left < shown.right &&
					shown.top < label.bottom &&
					label.top < shown.bottom;
				expect(overlaps, name).toBe(false);
			}
		} finally {
			await page.viewport(414, 896);
		}
	});

	it.each(["S", "M", "L", "XL", "XXL", "XXXL"])(
		"keeps a full hand with four tens between the corner windows at suit font size %s",
		async (size) => {
			await page.viewport(1568, 886);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const { box, rows } = renderHands([
					suit("S", "♠", "AT9", true),
					suit("H", "♥", "KT2"),
					suit("D", "♦", "QT3"),
					suit("C", "♣", "JT54"),
				]);
				const corners = {
					top: [box(".video-left"), box(".video-top")],
					bottom: [box(".call-slot"), box(".video-right")],
				};
				for (const { place, cards } of rows) {
					expect(cards, place).toHaveLength(13);
					const [left, right] = corners[place];
					if (!left || !right) throw new Error("missing corner window");
					const group = cards[0]?.closest<HTMLElement>(".suit-group.trump");
					if (!group) throw new Error("missing trump group");
					const frame = getComputedStyle(group, "::after");
					// The outline is in canvas pixels; the boxes are in scaled screen pixels.
					const scale = group.getBoundingClientRect().width / group.offsetWidth;
					const reach =
						(Number.parseFloat(frame.outlineOffset) +
							Number.parseFloat(frame.outlineWidth)) *
						scale;
					expect(
						group.getBoundingClientRect().left - reach,
						place,
					).toBeGreaterThan(left.right);
					expect(face(cards.at(-1) as HTMLElement).right, place).toBeLessThan(
						right.left,
					);
					// The red frame of the seat to play stands outside the seat box.
					const seatBox = cards[0]?.closest<HTMLElement>(".seat");
					if (!seatBox) throw new Error("missing seat");
					expect(seatBox.dataset.turnFrame, place).toBe("true");
					const turn = getComputedStyle(seatBox, "::after");
					const turnReach =
						(Number.parseFloat(turn.outlineWidth) -
							Number.parseFloat(turn.left)) *
						scale;
					const seatRect = seatBox.getBoundingClientRect();
					expect(seatRect.left - turnReach, place).toBeGreaterThan(left.right);
					expect(seatRect.right + turnReach, place).toBeLessThan(right.left);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);

	it("shows the felt between the suits of the hand whose turn it is", async () => {
		await page.viewport(1568, 886);
		try {
			const { rows } = renderHands([
				suit("S", "♠", "AK3", true),
				suit("H", "♥", "Q9"),
				suit("D", "♦", "T3"),
				suit("C", "♣", "7"),
			]);
			for (const { place, cards } of rows) {
				const hand = cards[0]?.closest<HTMLElement>(".hand");
				if (!hand) throw new Error("missing hand");
				expect(hand.closest<HTMLElement>(".seat")?.dataset.turn, place).toBe(
					"true",
				);
				const handBox = hand.getBoundingClientRect();
				const image = new Image();
				image.src = `data:image/png;base64,${await page.screenshot({ element: hand, save: false })}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("canvas unavailable");
				context.drawImage(image, 0, 0);
				// The middle of the gap after the hearts: the sheet, if any, fills it.
				const hearts = suitEnds(cards).find(
					(shown) => shown.dataset.suit === "H",
				);
				const next = hearts && cards[cards.indexOf(hearts) + 1];
				if (!hearts || !next) throw new Error("missing heart gap");
				const points = {
					gap: [
						(face(hearts).right + next.getBoundingClientRect().left) / 2,
						handBox.top + handBox.height / 2,
					],
				};
				for (const [name, [x = 0, y = 0]] of Object.entries(points)) {
					const [red = 0, green = 0, blue = 0] = context.getImageData(
						Math.floor(
							((x - handBox.left) * image.naturalWidth) / handBox.width,
						),
						Math.floor(
							((y - handBox.top) * image.naturalHeight) / handBox.height,
						),
						1,
						1,
					).data;
					// The light sheet is about (200, 220, 207); the felt is a dark green.
					expect(red + green + blue, `${place} ${name}`).toBeLessThan(400);
				}
			}
		} finally {
			await page.viewport(414, 896);
		}
	});

	it("lifts the side hands by one to one and a half points-pill heights when the deal is complete", async () => {
		await page.viewport(1568, 886);
		try {
			const seatTops = (phase: "play" | "complete") => {
				const base = playView();
				const hand = base.seats.find((shown) => shown.hand.visible)?.hand;
				if (!hand) throw new Error("missing hand");
				const { root } = renderView(
					{
						...base,
						phase,
						...(phase === "complete"
							? {
									trick: undefined,
									scoring: {
										contract: { level: 4, strain: "H", doubling: "" },
										compactOutcome: "WON",
										compactDetail: "Made: 4♥",
										countdown: 1,
									},
								}
							: {}),
						// Every seat shows its points in both phases, so only the phase changes the layout.
						seats: base.seats.map((shown) => ({
							...shown,
							hand,
							pointCards: ["SA"],
						})),
					},
					"desktop",
				);
				const screen = document.createElement("main");
				screen.dataset.screen = "table";
				screen.dataset.form = "desktop";
				screen.append(...document.body.children);
				document.body.replaceChildren(screen);
				const pill = root.querySelector(".place-left .hcp-pill");
				if (!pill) throw new Error("missing points pill");
				return {
					pill: pill.getBoundingClientRect().height,
					tops: (["left", "right"] as const).map((place) => {
						const seat = root.querySelector(`.place-${place} .seat`);
						if (!seat) throw new Error(`missing ${place} seat`);
						return seat.getBoundingClientRect().top;
					}),
				};
			};
			const play = seatTops("play");
			const complete = seatTops("complete");
			complete.tops.forEach((top, index) => {
				const lift = ((play.tops[index] ?? 0) - top) / complete.pill;
				expect(lift, `seat ${index}`).toBeGreaterThanOrEqual(1);
				expect(lift, `seat ${index}`).toBeLessThanOrEqual(1.5);
			});
		} finally {
			await page.viewport(414, 896);
		}
	});
});
