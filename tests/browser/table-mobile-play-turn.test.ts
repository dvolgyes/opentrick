import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import "../../src/ui/style.css";
import type { Form, Layout } from "../../src/call/device-class";
import { type Locale, translator } from "../../src/i18n";
import type { Seat } from "../../src/protocol";
import { pageReport } from "../../src/ui/page-report";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import type { TableView } from "../../src/ui/table-model";
import { positionOf } from "../../src/ui/table-model";
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

describe("auction summary visibility", () => {
	it.each<Layout>(["desktop", "compact", "sideways"])(
		"keeps an empty summary hidden on a mid-game load (%s)",
		(layout) => {
			const view = playView();
			const { root, section } = renderView(view, layout);
			const summary = root.querySelector<HTMLElement>(".auction-end");
			if (!summary) throw new Error("missing auction summary");
			expect(getComputedStyle(summary).display).toBe("none");
			section.render({
				...view,
				auctionEnd: {
					contract: { level: 1, strain: "C", doubling: "" },
					declarer: "by North",
					vulnerability: "N-S not vulnerable",
					vulnerable: false,
				},
			});
			expect(getComputedStyle(summary).display).not.toBe("none");
			section.render(view);
			expect(getComputedStyle(summary).display).toBe("none");
			section.dispose();
		},
	);
});

describe("card flight", () => {
	afterEach(() => vi.useRealTimers());

	it.each([
		["N", "bottom", true],
		["S", "top", true],
		["E", "left", false],
		["W", "right", false],
		["S", "top", false],
		["E", "left", true],
		["W", "right", true],
	] as const)(
		"keeps a card-sized turn frame when %s plays their last card",
		(seatName, position, visible) => {
			vi.useFakeTimers();
			const base = playView();
			const one = visible
				? {
						...visibleHand,
						suits: visibleHand.suits.map((suit) => ({ ...suit, trump: false })),
					}
				: { visible: false as const, count: 1 };
			const empty = visible
				? { ...visibleHand, suits: [] }
				: { visible: false as const, count: 0 };
			const nextSeat = base.seats.find((seat) => seat.seat !== seatName);
			if (!nextSeat) throw new Error("missing next seat");
			const before = {
				...base,
				trick: undefined,
				seats: base.seats.map((seat) => ({
					...seat,
					turn: seat.seat === seatName,
					hand: seat.seat === seatName ? one : seat.hand,
				})),
			};
			const { root, section } = renderView(before, "desktop");
			const oldFace = root.querySelector<HTMLElement>(
				`[data-testid="hand-${seatName}"] .hand .face`,
			);
			if (!oldFace) throw new Error("missing last card");
			const { height, width } = oldFace.getBoundingClientRect();
			section.render({
				...before,
				at: before.at + 1,
				yourTurn: false,
				seats: before.seats.map((seat) => ({
					...seat,
					bot: seat.seat === nextSeat.seat,
					turn: seat.seat === nextSeat.seat,
					hand: seat.seat === seatName ? empty : seat.hand,
				})),
				trick: {
					finished: false,
					cards: [
						{
							seat: seatName,
							position,
							card: "SA",
							text: "♠A",
							rank: "A",
							symbol: "♠",
						},
					],
				},
			});
			const seat = root.querySelector<HTMLElement>(
				`[data-testid="hand-${seatName}"]`,
			);
			const hand = seat?.querySelector<HTMLElement>(".hand");
			expect(seat?.dataset.turnFrame).toBe("true");
			expect(hand?.querySelectorAll(".back, .card")).toHaveLength(0);
			expect(hand?.getBoundingClientRect().height).toBeGreaterThanOrEqual(
				height - 1,
			);
			expect(hand?.getBoundingClientRect().width).toBeGreaterThanOrEqual(
				width - 1,
			);
			section.dispose();
		},
	);

	it("keeps an empty turn frame large enough for the largest card lettering", () => {
		vi.useFakeTimers();
		const original = document.documentElement.getAttribute(
			"data-suit-font-size",
		);
		document.documentElement.dataset.suitFontSize = "XXXL";
		try {
			const base = playView();
			const before = {
				...base,
				trick: undefined,
				seats: base.seats.map((seat) =>
					seat.seat === "N"
						? {
								...seat,
								turn: true,
								hand: {
									...visibleHand,
									suits: visibleHand.suits.map((suit) => ({
										...suit,
										trump: false,
									})),
								},
							}
						: { ...seat, turn: false },
				),
			};
			const { root, section } = renderView(before, "desktop");
			const face = root.querySelector<HTMLElement>(
				'[data-testid="hand-N"] .face',
			);
			if (!face) throw new Error("missing card face");
			const size = face.getBoundingClientRect();
			section.render({
				...before,
				at: before.at + 1,
				yourTurn: false,
				seats: before.seats.map((seat) =>
					seat.seat === "N"
						? { ...seat, turn: false, hand: { ...visibleHand, suits: [] } }
						: { ...seat, turn: seat.seat === "E", bot: seat.seat === "E" },
				),
				trick: {
					finished: false,
					cards: [
						{
							seat: "N",
							position: "bottom",
							card: "SA",
							text: "♠A",
							rank: "A",
							symbol: "♠",
						},
					],
				},
			});
			const hand = root
				.querySelector<HTMLElement>('[data-testid="hand-N"] .hand')
				?.getBoundingClientRect();
			expect(hand?.height).toBeGreaterThanOrEqual(size.height - 1);
			expect(hand?.width).toBeGreaterThanOrEqual(size.width - 1);
			section.dispose();
		} finally {
			if (original === null)
				document.documentElement.removeAttribute("data-suit-font-size");
			else
				document.documentElement.setAttribute("data-suit-font-size", original);
		}
	});

	it.each([
		["N", "bottom", true],
		["S", "top", true],
		["S", "top", false],
		["E", "left", false],
		["W", "right", false],
		["E", "left", true],
		["W", "right", true],
	] as const)(
		"keeps a card-sized empty frame for %s in compact view",
		(seatName, position, visible) => {
			const base = playView();
			const one = visible
				? {
						...visibleHand,
						suits: visibleHand.suits.map((suit) => ({ ...suit, trump: false })),
					}
				: { visible: false as const, count: 1 };
			const empty = visible
				? { ...visibleHand, suits: [] }
				: { visible: false as const, count: 0 };
			const before = {
				...base,
				seats: base.seats.map((seat) => ({
					...seat,
					turn: seat.seat === seatName,
					hand: seat.seat === seatName ? one : seat.hand,
				})),
			};
			const { root, section } = renderView(before, "compact");
			const selector =
				position === "bottom"
					? `[data-testid="hand-${seatName}"] .hand`
					: `.mobile-board-${position} .hand`;
			const oldFace = root.querySelector<HTMLElement>(`${selector} .face`);
			if (!oldFace) throw new Error("missing compact card");
			const { height, width } = oldFace.getBoundingClientRect();
			section.render({
				...before,
				at: before.at + 1,
				seats: before.seats.map((seat) =>
					seat.seat === seatName ? { ...seat, hand: empty } : seat,
				),
			});
			const hand = root.querySelector<HTMLElement>(selector);
			expect(hand?.querySelectorAll(".back, .card")).toHaveLength(0);
			expect(hand?.getBoundingClientRect().height).toBeGreaterThanOrEqual(
				height - 1,
			);
			expect(hand?.getBoundingClientRect().width).toBeGreaterThanOrEqual(
				width - 1,
			);
			section.dispose();
		},
	);

	it.each([
		["N", "bottom", true],
		["S", "top", true],
		["E", "left", false],
		["W", "right", false],
		["S", "top", false],
		["E", "left", true],
		["W", "right", true],
	] as const)(
		"removes %s's last card from the retained final-trick hand",
		(seatName, position, visible) => {
			vi.useFakeTimers();
			const base = playView();
			const beforeSeats = base.seats.map((seat) => ({
				...seat,
				turn: seat.seat === seatName,
				hand:
					seat.seat === seatName
						? visible
							? {
									...visibleHand,
									suits: visibleHand.suits.map((suit) => ({
										...suit,
										trump: false,
									})),
								}
							: { visible: false as const, count: 1 }
						: seat.hand.visible
							? { ...visibleHand, suits: [] }
							: { visible: false as const, count: 0 },
			}));
			const others = beforeSeats
				.filter((seat) => seat.seat !== seatName)
				.map((seat, index) => ({
					seat: seat.seat,
					position: seat.position,
					card: (["S2", "S3", "S4"] as const)[index] ?? "S2",
					text: "♠2",
					rank: "2",
					symbol: "♠",
				}));
			const prior = {
				cards: [
					...others,
					{
						seat: seatName,
						position,
						card: "SA" as const,
						text: "♠A",
						rank: "A",
						symbol: "♠",
					},
				],
				finished: true,
				index: 12,
				winner: seatName,
				winnerPosition: position,
				winnerName: "",
			};
			const before = {
				...base,
				seats: beforeSeats,
				trick: { finished: false, cards: others },
				completedTrick: prior,
			};
			const { root, section } = renderView(before, "desktop");
			const completed = { ...prior, index: 13 };
			section.render({
				...before,
				at: before.at + 1,
				phase: "complete",
				trick: undefined,
				completedTrick: completed,
			});
			expect(document.querySelector(".card-flight")).not.toBeNull();
			for (const seat of beforeSeats)
				expect(
					root.querySelectorAll(
						`[data-testid="hand-${seat.seat}"] .hand .back, [data-testid="hand-${seat.seat}"] .hand .card`,
					),
				).toHaveLength(0);
			vi.advanceTimersByTime(2000);
			for (const seat of beforeSeats)
				expect(
					root.querySelectorAll(
						`[data-testid="hand-${seat.seat}"] .hand .back, [data-testid="hand-${seat.seat}"] .hand .card`,
					),
				).toHaveLength(0);
			section.dispose();
		},
	);

	it("removes every newly committed final-trick card when intermediate snapshots were skipped", () => {
		vi.useFakeTimers();
		const base = playView();
		const cards = [
			{
				seat: "E" as const,
				position: "left" as const,
				card: "S2" as const,
				text: "♠2",
				rank: "2",
				symbol: "♠",
			},
			{
				seat: "N" as const,
				position: "bottom" as const,
				card: "SA" as const,
				text: "♠A",
				rank: "A",
				symbol: "♠",
			},
			{
				seat: "S" as const,
				position: "top" as const,
				card: "S3" as const,
				text: "♠3",
				rank: "3",
				symbol: "♠",
			},
			{
				seat: "W" as const,
				position: "right" as const,
				card: "S4" as const,
				text: "♠4",
				rank: "4",
				symbol: "♠",
			},
		];
		const prior = {
			cards,
			finished: true,
			index: 12,
			winner: "N" as const,
			winnerPosition: "bottom" as const,
			winnerName: "",
		};
		const before = {
			...base,
			seats: base.seats.map((seat) =>
				seat.seat === "E"
					? { ...seat, hand: { visible: false as const, count: 0 } }
					: seat.seat === "W"
						? { ...seat, hand: { visible: false as const, count: 1 } }
						: seat.seat === "S"
							? {
									...seat,
									hand: {
										...visibleHand,
										suits: visibleHand.suits.map((suit) => ({
											...suit,
											cards: [card("S3")],
										})),
									},
								}
							: seat,
			),
			trick: { finished: false, cards: cards.slice(0, 1) },
			completedTrick: prior,
		};
		const { root, section } = renderView(before, "desktop");
		section.render({
			...before,
			at: before.at + 3,
			phase: "complete",
			trick: undefined,
			completedTrick: { ...prior, index: 13 },
		});
		expect(section.collecting()).toBe(true);
		expect(root.querySelectorAll(".hand .back, .hand .card")).toHaveLength(0);
		expect(
			root
				.querySelector('[data-testid="hand-W"]')
				?.getAttribute("data-visible"),
		).toBe("false");
		section.dispose();
	});

	it("restores the original static card layout when played-card animation is disabled", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const played = {
			seat: "N" as const,
			position: "bottom" as const,
			card: "SA" as const,
			text: "♠A",
			rank: "A",
			symbol: "♠",
		};
		const next = {
			...base,
			at: base.at + 1,
			trick: { finished: false, cards: [played] },
		};
		const initial = renderView(next, "desktop");
		const before = initial.root
			.querySelector<HTMLElement>(".trick .played")
			?.getBoundingClientRect();
		initial.section.dispose();
		const { root, section } = renderView(
			base,
			"desktop",
			undefined,
			undefined,
			{ cardPlayAnimation: () => false },
		);
		section.render(next);
		const target = root.querySelector<HTMLElement>(".trick .played");
		const after = target?.getBoundingClientRect();
		expect(document.querySelector(".card-flight")).toBeNull();
		expect(target?.style.transform).toBe("");
		expect(after?.left).toBeCloseTo(before?.left ?? 0, 1);
		expect(after?.top).toBeCloseTo(before?.top ?? 0, 1);
		section.dispose();
	});

	it("stops an active flight and restores the card layout when the setting is turned off", () => {
		vi.useFakeTimers();
		let enabled = true;
		const base = { ...playView(), trick: undefined };
		const { root, section } = renderView(
			base,
			"desktop",
			undefined,
			undefined,
			{ cardPlayAnimation: () => enabled },
		);
		const next = {
			...base,
			at: base.at + 1,
			trick: {
				finished: false,
				cards: [
					{
						seat: "N" as const,
						position: "bottom" as const,
						card: "SA" as const,
						text: "♠A",
						rank: "A",
						symbol: "♠",
					},
				],
			},
		};
		section.render(next);
		expect(document.querySelector(".card-flight")).not.toBeNull();
		enabled = false;
		section.render(next);
		const target = root.querySelector<HTMLElement>(".trick .played");
		expect(document.querySelector(".card-flight")).toBeNull();
		expect(target?.style.transform).toBe("");
		expect(target?.style.visibility).not.toBe("hidden");
		section.dispose();
	});

	it("reports when the card presentation starts and stops", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const changed = vi.fn();
		const { section } = renderView(base, "desktop", undefined, undefined, {
			playPresentationChanged: changed,
		});
		section.render({
			...base,
			at: base.at + 1,
			trick: {
				finished: false,
				cards: [
					{
						seat: "N",
						position: "bottom",
						card: "SA",
						text: "♠A",
						rank: "A",
						symbol: "♠",
					},
				],
			},
		});
		expect(changed).toHaveBeenCalled();
		expect(section.playPresentationActive()).toBe(true);
		changed.mockClear();
		vi.advanceTimersByTime(2000);
		expect(changed).toHaveBeenCalled();
		expect(section.playPresentationActive()).toBe(false);
		section.dispose();
	});

	it("releases the presentation gate when a resize cancels a flight", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const changed = vi.fn();
		const { section } = renderView(base, "desktop", undefined, undefined, {
			playPresentationChanged: changed,
		});
		section.render({
			...base,
			at: base.at + 1,
			trick: {
				finished: false,
				cards: [
					{
						seat: "N",
						position: "bottom",
						card: "SA",
						text: "♠A",
						rank: "A",
						symbol: "♠",
					},
				],
			},
		});
		expect(section.playPresentationActive()).toBe(true);
		changed.mockClear();
		window.dispatchEvent(new Event("resize"));
		expect(section.playPresentationActive()).toBe(false);
		expect(changed).toHaveBeenCalled();
		section.dispose();
	});

	it("uses the configured flight duration, rotation deviation and center shift", () => {
		vi.useFakeTimers();
		const random = vi.spyOn(Math, "random").mockReturnValue(0);
		try {
			const base = { ...playView(), trick: undefined };
			const played = {
				seat: "N" as const,
				position: "bottom" as const,
				card: "SA" as const,
				text: "♠A",
				rank: "A",
				symbol: "♠",
			};
			const next = {
				...base,
				at: base.at + 1,
				trick: { finished: false, cards: [played] },
			};
			const initial = renderView(next, "desktop");
			const before = initial.root
				.querySelector<HTMLElement>(".trick .played")
				?.getBoundingClientRect();
			initial.section.dispose();
			const { root, section } = renderView(
				base,
				"desktop",
				undefined,
				undefined,
				{
					cardPlayDurationMs: () => 3500,
					cardPlayRotationDegrees: () => 0,
					cardPlayCenterPercent: () => 40,
				},
			);
			section.render(next);
			const target = root.querySelector<HTMLElement>(".trick .played");
			const after = target?.getBoundingClientRect();
			const flight = document.querySelector<HTMLElement>(".card-flight");
			const motion = flight?.getAnimations()[0]?.effect;
			if (!(motion instanceof KeyframeEffect) || !target || !after || !before)
				throw new Error("missing card flight");
			expect(motion.getTiming().duration).toBe(3500);
			expect(motion.getKeyframes().at(-1)?.transform).toContain(
				"rotate(360deg)",
			);
			expect(
				after.top + after.height / 2 - before.top - before.height / 2,
			).toBeCloseTo(-target.offsetHeight * 0.4, 0);
			vi.advanceTimersByTime(3499);
			expect(document.querySelector(".card-flight")).not.toBeNull();
			vi.advanceTimersByTime(1);
			expect(document.querySelector(".card-flight")).toBeNull();
			section.dispose();
		} finally {
			random.mockRestore();
		}
	});

	it("keeps the current seat marked until its flight ends when the next actor is a bot", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const { root, section } = renderView(base, "desktop");
		section.render({
			...base,
			at: base.at + 1,
			yourTurn: false,
			seats: base.seats.map((seat) => ({
				...seat,
				bot: seat.seat === "E",
				turn: seat.seat === "E",
			})),
			trick: {
				finished: false,
				cards: [
					{
						seat: "N",
						position: "bottom",
						card: "SA",
						text: "♠A",
						rank: "A",
						symbol: "♠",
					},
				],
			},
		});
		expect(
			root.querySelector('[data-testid="hand-N"]')?.getAttribute("data-turn"),
		).toBe("true");
		expect(
			root.querySelector('[data-testid="hand-E"]')?.getAttribute("data-turn"),
		).toBe("false");
		vi.advanceTimersByTime(2000);
		expect(
			root.querySelector('[data-testid="hand-N"]')?.getAttribute("data-turn"),
		).toBe("false");
		expect(
			root.querySelector('[data-testid="hand-E"]')?.getAttribute("data-turn"),
		).toBe("true");
		section.dispose();
	});

	it("allows the human to play as soon as a bot's flight begins", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const { root, section, handlers } = renderView(base, "desktop");
		section.render({
			...base,
			at: base.at + 1,
			yourTurn: true,
			seats: base.seats.map((seat) => ({
				...seat,
				bot: seat.seat === "E",
				turn: seat.seat === "N",
			})),
			trick: {
				finished: false,
				cards: [
					{
						seat: "E",
						position: "left",
						card: "S2",
						text: "♠2",
						rank: "2",
						symbol: "♠",
					},
				],
			},
		});
		expect(document.querySelector(".card-flight")).not.toBeNull();
		root
			.querySelector<HTMLButtonElement>(
				'[data-testid="hand-N"] .card[data-card="SA"]',
			)
			?.click();
		expect(handlers.act).toHaveBeenCalledWith({ type: "play", card: "SA" });
		section.dispose();
	});

	it("allows a human to lead the next trick while the bot's fourth card is flying", () => {
		vi.useFakeTimers();
		const base = playView();
		const first = base.trick?.cards[0];
		if (!first) throw new Error("missing card");
		const cards = [
			first,
			{
				...first,
				seat: "S" as const,
				position: "top" as const,
				card: "S2" as const,
			},
			{
				...first,
				seat: "N" as const,
				position: "bottom" as const,
				card: "S3" as const,
			},
			{
				...first,
				seat: "W" as const,
				position: "right" as const,
				card: "S4" as const,
			},
		];
		const before = {
			...base,
			trick: { finished: false, cards: cards.slice(0, 3) },
			seats: base.seats.map((seat) =>
				seat.seat === "W" ? { ...seat, bot: true } : seat,
			),
		};
		const { root, section, handlers } = renderView(before, "desktop");
		const completed = {
			cards,
			finished: true,
			index: 1,
			winner: "N" as const,
			winnerPosition: "bottom" as const,
			winnerName: "",
		};
		section.render({
			...before,
			at: before.at + 1,
			yourTurn: true,
			trick: completed,
			completedTrick: completed,
		});
		expect(section.collecting()).toBe(true);
		expect(
			document.querySelector(".card-flight .played")?.getAttribute("data-seat"),
		).toBe("W");
		root
			.querySelector<HTMLButtonElement>(
				'[data-testid="hand-N"] .card[data-card="SA"]',
			)
			?.click();
		expect(handlers.act).toHaveBeenCalledWith({ type: "play", card: "SA" });
		section.dispose();
	});

	it.each<Layout>(["desktop", "compact", "sideways"])(
		"animates a newly played visible card only on desktop (%s)",
		(layout) => {
			vi.useFakeTimers();
			const base = { ...playView(), trick: undefined };
			const { root, section } = renderView(base, layout);
			const played = {
				seat: "N" as const,
				position: "bottom" as const,
				card: "SA" as const,
				text: "♠A",
				rank: "A",
				symbol: "♠",
			};
			const next = {
				...base,
				at: base.at + 1,
				trick: { cards: [played], finished: false },
			};
			section.render(next);
			const flight = document.querySelector<HTMLElement>(".card-flight");
			if (layout !== "desktop") {
				expect(flight).toBeNull();
				return;
			}
			expect(flight).not.toBeNull();
			expect(flight?.getAnimations()[0]?.effect?.getTiming().duration).toBe(
				2000,
			);
			const motion = flight?.getAnimations()[0]?.effect;
			if (!(motion instanceof KeyframeEffect))
				throw new Error("missing flight animation");
			const frames = motion.getKeyframes();
			const rotation = /rotate\(([-\d.]+)deg\)/.exec(
				String(frames.at(-1)?.transform),
			);
			expect(Number(rotation?.[1])).toBeGreaterThanOrEqual(350);
			expect(Number(rotation?.[1])).toBeLessThanOrEqual(370);
			expect(
				root.querySelector<HTMLElement>(".trick .played")?.style.visibility,
			).toBe("hidden");
			section.render(next);
			expect(document.querySelectorAll(".card-flight")).toHaveLength(1);
			vi.advanceTimersByTime(2000);
			expect(document.querySelector(".card-flight")).toBeNull();
			expect(
				root.querySelector<HTMLElement>(".trick .played")?.style.visibility,
			).not.toBe("hidden");
		},
	);

	it("animates the opening lead from the auction view", () => {
		vi.useFakeTimers();
		const base = { ...playView(), phase: "auction" as const, trick: undefined };
		const { section } = renderView(base, "desktop");
		section.render({
			...base,
			phase: "play",
			at: base.at + 1,
			trick: {
				finished: false,
				cards: [
					{
						seat: "N",
						position: "bottom",
						card: "SA",
						text: "♠A",
						rank: "A",
						symbol: "♠",
					},
				],
			},
		});
		expect(document.querySelector(".card-flight")).not.toBeNull();
		section.dispose();
	});

	it.each([
		["N", "bottom", 0, -1],
		["S", "top", 0, 1],
		["E", "left", 1, 0],
		["W", "right", -1, 0],
	] as const)(
		"moves the %s card a quarter card height toward the center",
		(seat, position, dx, dy) => {
			vi.useFakeTimers();
			const random = vi.spyOn(Math, "random").mockReturnValue(0);
			try {
				const base = { ...playView(), trick: undefined };
				const played = {
					seat,
					position,
					card: "SA" as const,
					text: "♠A",
					rank: "A",
					symbol: "♠",
				};
				const next = {
					...base,
					at: base.at + 1,
					trick: { finished: false, cards: [played] },
				};
				const initial = renderView(next, "desktop");
				const before = initial.root
					.querySelector<HTMLElement>(".trick .played")
					?.getBoundingClientRect();
				initial.section.dispose();
				const current = renderView(base, "desktop");
				current.section.render(next);
				const target =
					current.root.querySelector<HTMLElement>(".trick .played");
				const after = target?.getBoundingClientRect();
				if (!before || !after || !target)
					throw new Error("missing played card");
				const shift = target.offsetHeight / 4;
				expect(
					after.left + after.width / 2 - before.left - before.width / 2,
				).toBeCloseTo(dx * shift, 0);
				expect(
					after.top + after.height / 2 - before.top - before.height / 2,
				).toBeCloseTo(dy * shift, 0);
				current.section.dispose();
			} finally {
				random.mockRestore();
			}
		},
	);

	it.each(["top", "left", "right"] as const)(
		"uses the visible dummy card from the %s hand",
		(position) => {
			vi.useFakeTimers();
			const base = playView();
			const current = {
				...base,
				trick: undefined,
				seats: base.seats.map((seat) =>
					seat.position === position
						? { ...seat, tags: ["Dummy"], hand: visibleHand }
						: seat,
				),
			};
			const seat = current.seats.find((entry) => entry.position === position);
			if (!seat) throw new Error("missing dummy");
			const { section } = renderView(current, "desktop");
			section.render({
				...current,
				at: current.at + 1,
				trick: {
					finished: false,
					cards: [
						{
							seat: seat.seat,
							position,
							card: "SA",
							text: "♠A",
							rank: "A",
							symbol: "♠",
						},
					],
				},
			});
			const flight = document.querySelector<HTMLElement>(".card-flight");
			expect(flight).not.toBeNull();
			expect(flight?.querySelector(".card-flight-back")).toBeNull();
			const motion = flight?.getAnimations()[0]?.effect;
			if (!(motion instanceof KeyframeEffect))
				throw new Error("missing dummy flight");
			const rotation = /rotate\(([-\d.]+)deg\)/.exec(
				String(motion.getKeyframes().at(-1)?.transform),
			);
			expect(Number(rotation?.[1])).toBeGreaterThanOrEqual(350);
			expect(Number(rotation?.[1])).toBeLessThanOrEqual(370);
			section.dispose();
		},
	);

	it("turns the top hidden card over in flight, then cancels on undo", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const { root, section } = renderView(base, "desktop");
		const source = root.querySelector<HTMLElement>(
			'[data-testid="hand-E"] .back:last-child .face',
		);
		if (!source) throw new Error("missing top card back");
		const sourceRect = source.getBoundingClientRect();
		section.render({
			...base,
			at: base.at + 1,
			trick: {
				finished: false,
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
		});
		const flight = document.querySelector<HTMLElement>(".card-flight");
		const rotor = flight?.querySelector<HTMLElement>(".card-flight-rotor");
		expect(flight?.querySelector(".card-flight-back")).not.toBeNull();
		if (!flight) throw new Error("missing flight");
		const flip = rotor?.getAnimations()[0]?.effect;
		const motion = flight.getAnimations()[0]?.effect;
		if (
			!(flip instanceof KeyframeEffect) ||
			!(motion instanceof KeyframeEffect)
		)
			throw new Error("missing card animations");
		expect(flip.getKeyframes()[0]?.transform).toContain("rotateY(180deg)");
		const keyframe = motion.getKeyframes()[0];
		const coordinates = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			String(keyframe?.transform),
		);
		expect(Number(coordinates?.[1])).toBeCloseTo(
			sourceRect.left +
				sourceRect.width / 2 -
				parseFloat(flight.style.left) -
				parseFloat(flight.style.width) / 2,
		);
		expect(Number(coordinates?.[2])).toBeCloseTo(
			sourceRect.top +
				sourceRect.height / 2 -
				parseFloat(flight.style.top) -
				parseFloat(flight.style.height) / 2,
		);
		section.render(base);
		expect(document.querySelector(".card-flight")).toBeNull();
	});

	it("does not show the hidden card's rank or suit through the back during the flip", async () => {
		vi.useFakeTimers();
		const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			const capture = async (value: "SA" | "H2", at: number) => {
				const base = { ...playView(), trick: undefined };
				const { section } = renderView(base, "desktop");
				section.render({
					...base,
					at: base.at + 1,
					trick: {
						finished: false,
						cards: [
							{
								seat: "E",
								position: "left",
								card: value,
								text: value,
								rank: value[1] ?? "",
								symbol: value === "SA" ? "♠" : "♥",
							},
						],
					},
				});
				const flight = document.querySelector<HTMLElement>(".card-flight");
				if (!flight) throw new Error("missing hidden-card flight");
				for (const animation of flight.getAnimations({ subtree: true })) {
					animation.pause();
					animation.currentTime = at;
				}
				const image = await page.screenshot({ element: flight, save: false });
				section.dispose();
				return image;
			};
			for (const time of [0, 300, 500, 575])
				expect(await capture("SA", time)).toBe(await capture("H2", time));
			expect(await capture("SA", 1400)).not.toBe(await capture("H2", 1400));
		} finally {
			random.mockRestore();
		}
	});

	it("keeps the face fully hidden until a concealed card turns edge-on", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const { section } = renderView(base, "desktop");
		section.render({
			...base,
			at: base.at + 1,
			trick: {
				finished: false,
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
		});
		const flight = document.querySelector<HTMLElement>(".card-flight");
		const face = flight?.querySelector<HTMLElement>(".played");
		const back = flight?.querySelector<HTMLElement>(".card-flight-back");
		if (!flight || !face || !back) throw new Error("missing card sides");
		const animations = flight.getAnimations({ subtree: true });
		for (const animation of animations) {
			animation.pause();
			animation.currentTime = 500;
		}
		expect(getComputedStyle(face).opacity).toBe("0");
		expect(getComputedStyle(back).opacity).toBe("1");
		for (const animation of animations) animation.currentTime = 700;
		expect(getComputedStyle(face).opacity).toBe("1");
		expect(getComputedStyle(back).opacity).toBe("0");
		section.dispose();
	});

	it("skips flight for reduced motion and does not replay a loaded trick", () => {
		const nativeMatch = window.matchMedia.bind(window);
		const media = vi
			.spyOn(window, "matchMedia")
			.mockImplementation((query) =>
				query === "(prefers-reduced-motion: reduce)"
					? ({ matches: true } as MediaQueryList)
					: nativeMatch(query),
			);
		try {
			const base = { ...playView(), trick: undefined };
			const { section } = renderView(base, "desktop");
			const next = {
				...base,
				at: base.at + 1,
				trick: {
					finished: false,
					cards: [
						{
							seat: "N" as const,
							position: "bottom" as const,
							card: "SA" as const,
							text: "♠A",
							rank: "A",
							symbol: "♠",
						},
					],
				},
			};
			section.render(next);
			expect(document.querySelector(".card-flight")).toBeNull();
			media.mockRestore();
			section.render(next);
			expect(document.querySelector(".card-flight")).toBeNull();
			section.dispose();
		} finally {
			media.mockRestore();
		}
	});

	it("clears in-flight cards on a new board", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const { section } = renderView(base, "desktop");
		section.render({
			...base,
			at: base.at + 1,
			trick: {
				finished: false,
				cards: [
					{
						seat: "N",
						position: "bottom",
						card: "SA",
						text: "♠A",
						rank: "A",
						symbol: "♠",
					},
				],
			},
		});
		expect(document.querySelector(".card-flight")).not.toBeNull();
		section.render({ ...base, board: 2 });
		expect(document.querySelector(".card-flight")).toBeNull();
		section.dispose();
	});

	it("starts the next card only when the previous card has landed", () => {
		vi.useFakeTimers();
		const base = { ...playView(), trick: undefined };
		const { root, section } = renderView(base, "desktop");
		const first = {
			seat: "N" as const,
			position: "bottom" as const,
			card: "SA" as const,
			text: "♠A",
			rank: "A",
			symbol: "♠",
		};
		const second = {
			seat: "E" as const,
			position: "left" as const,
			card: "S2" as const,
			text: "♠2",
			rank: "2",
			symbol: "♠",
		};
		section.render({
			...base,
			at: base.at + 1,
			trick: { finished: false, cards: [first] },
		});
		vi.advanceTimersByTime(500);
		section.render({
			...base,
			at: base.at + 2,
			trick: { finished: false, cards: [first, second] },
		});
		expect(document.querySelectorAll(".card-flight")).toHaveLength(1);
		expect(
			document.querySelector(".card-flight .played")?.getAttribute("data-seat"),
		).toBe("N");
		const displayed = [...root.querySelectorAll<HTMLElement>(".trick .played")];
		expect(
			Number(getComputedStyle(displayed[0] as HTMLElement).zIndex),
		).toBeLessThan(
			Number(getComputedStyle(displayed[1] as HTMLElement).zIndex),
		);
		vi.advanceTimersByTime(1500);
		expect(document.querySelectorAll(".card-flight")).toHaveLength(1);
		expect(
			document.querySelector(".card-flight .played")?.getAttribute("data-seat"),
		).toBe("E");
		expect(
			root.querySelector<HTMLElement>('.trick .played[data-seat="N"]')?.style
				.visibility,
		).not.toBe("hidden");
		expect(
			root.querySelector<HTMLElement>('.trick .played[data-seat="E"]')?.style
				.visibility,
		).toBe("hidden");
		vi.advanceTimersByTime(1999);
		expect(document.querySelectorAll(".card-flight")).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(document.querySelector(".card-flight")).toBeNull();
		section.dispose();
	});

	it("finishes all four flights in play order before the winner highlight", () => {
		vi.useFakeTimers();
		const base = {
			...playView(),
			trick: undefined,
			seats: playView().seats.map((seat) =>
				seat.seat === "S"
					? {
							...seat,
							hand: {
								...visibleHand,
								suits: visibleHand.suits.map((suit) => ({
									...suit,
									cards: [card("S3")],
								})),
							},
						}
					: seat,
			),
		};
		const cards = [
			{
				seat: "N" as const,
				position: "bottom" as const,
				card: "SA" as const,
				text: "♠A",
				rank: "A",
				symbol: "♠",
			},
			{
				seat: "E" as const,
				position: "left" as const,
				card: "S2" as const,
				text: "♠2",
				rank: "2",
				symbol: "♠",
			},
			{
				seat: "S" as const,
				position: "top" as const,
				card: "S3" as const,
				text: "♠3",
				rank: "3",
				symbol: "♠",
			},
			{
				seat: "W" as const,
				position: "right" as const,
				card: "S4" as const,
				text: "♠4",
				rank: "4",
				symbol: "♠",
			},
		];
		const { section } = renderView(base, "desktop");
		for (let count = 1; count < 4; count++)
			section.render({
				...base,
				at: base.at + count,
				trick: { finished: false, cards: cards.slice(0, count) },
			});
		const completed = {
			cards,
			finished: true,
			index: 1,
			winner: "N" as const,
			winnerPosition: "bottom" as const,
			winnerName: "",
		};
		section.render({
			...base,
			at: base.at + 4,
			trick: completed,
			completedTrick: completed,
		});
		for (const played of cards) {
			expect(document.querySelectorAll(".card-flight")).toHaveLength(1);
			expect(
				document
					.querySelector(".card-flight .played")
					?.getAttribute("data-seat"),
			).toBe(played.seat);
			expect(document.querySelector(".trick-collection-overlay")).toBeNull();
			vi.advanceTimersByTime(2000);
		}
		expect(document.querySelector(".card-flight")).toBeNull();
		expect(
			document.querySelector(".trick-collection-overlay .trick-winner"),
		).not.toBeNull();
		section.dispose();
	});

	it("sequences the next trick's cards after an ongoing collection", () => {
		vi.useFakeTimers();
		const base = playView();
		const first = base.trick?.cards[0];
		if (!first) throw new Error("missing played card");
		const cards = [
			first,
			{
				...first,
				seat: "S" as const,
				position: "top" as const,
				card: "S2" as const,
			},
			{
				...first,
				seat: "W" as const,
				position: "right" as const,
				card: "S3" as const,
			},
			{
				...first,
				seat: "N" as const,
				position: "bottom" as const,
				card: "S4" as const,
			},
		];
		const completed = {
			cards,
			finished: true,
			index: 1,
			winner: "N" as const,
			winnerPosition: "bottom" as const,
			winnerName: "",
		};
		const { root, section } = renderView(base, "desktop");
		section.render({
			...base,
			at: base.at + 1,
			trick: completed,
			completedTrick: completed,
		});
		expect(section.collecting()).toBe(true);
		const source = root
			.querySelector<HTMLElement>(
				'[data-testid="hand-N"] .card[data-card="SA"] .face',
			)
			?.getBoundingClientRect();
		const lead = {
			seat: "N" as const,
			position: "bottom" as const,
			card: "SA" as const,
			text: "♠A",
			rank: "A",
			symbol: "♠",
		};
		section.render({
			...base,
			at: base.at + 2,
			seats: base.seats.map((seat) =>
				seat.seat === "N"
					? { ...seat, hand: { ...visibleHand, suits: [] } }
					: seat,
			),
			trick: { finished: false, cards: [lead] },
			completedTrick: completed,
		});
		const second = {
			seat: "E" as const,
			position: "left" as const,
			card: "S2" as const,
			text: "♠2",
			rank: "2",
			symbol: "♠",
		};
		section.render({
			...base,
			at: base.at + 3,
			trick: { finished: false, cards: [lead, second] },
			completedTrick: completed,
		});
		expect(document.querySelector(".card-flight")).toBeNull();
		vi.advanceTimersByTime(1200);
		const flight = document.querySelector<HTMLElement>(".card-flight");
		expect(flight).not.toBeNull();
		const motion = flight?.getAnimations()[0]?.effect;
		if (!(motion instanceof KeyframeEffect) || !source || !flight)
			throw new Error("missing captured lead");
		const start = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			String(motion.getKeyframes()[0]?.transform),
		);
		expect(Number(start?.[1])).toBeCloseTo(
			source.left +
				source.width / 2 -
				parseFloat(flight.style.left) -
				parseFloat(flight.style.width) / 2,
		);
		expect(flight.querySelector(".played")?.getAttribute("data-seat")).toBe(
			"N",
		);
		vi.advanceTimersByTime(2000);
		expect(
			document.querySelector(".card-flight .played")?.getAttribute("data-seat"),
		).toBe("E");
		section.dispose();
	});

	it("waits for the fourth card to land before highlighting the winner", () => {
		vi.useFakeTimers();
		const base = playView();
		const first = base.trick?.cards[0];
		if (!first) throw new Error("missing played card");
		const cards = [
			first,
			{
				...first,
				seat: "S" as const,
				position: "top" as const,
				card: "S2" as const,
			},
			{
				...first,
				seat: "W" as const,
				position: "right" as const,
				card: "S3" as const,
			},
		];
		const before = { ...base, trick: { cards, finished: false } };
		const { section } = renderView(before, "desktop");
		const completed = {
			cards: [
				...cards,
				{
					...first,
					seat: "N" as const,
					position: "bottom" as const,
					card: "SA" as const,
				},
			],
			finished: true,
			index: 1,
			winner: "N" as const,
			winnerPosition: "bottom" as const,
			winnerName: "",
		};
		section.render({
			...before,
			at: before.at + 1,
			trick: completed,
			completedTrick: completed,
		});
		expect(document.querySelector(".card-flight")).not.toBeNull();
		expect(document.querySelector(".trick-collection-overlay")).toBeNull();
		const landing = document
			.querySelector<HTMLElement>('.trick .played[data-seat="N"]')
			?.getBoundingClientRect();
		vi.advanceTimersByTime(2000);
		expect(document.querySelector(".card-flight")).toBeNull();
		const winner = document
			.querySelector<HTMLElement>(".trick-collection-overlay .trick-winner")
			?.getBoundingClientRect();
		expect(winner).toBeDefined();
		expect(winner?.left).toBeCloseTo(landing?.left ?? 0, 0);
		expect(winner?.top).toBeCloseTo(landing?.top ?? 0, 0);
		section.dispose();
	});

	it("does not leave the final played card in the retained hand during collection", () => {
		vi.useFakeTimers();
		const base = playView();
		const first = base.trick?.cards[0];
		if (!first) throw new Error("missing played card");
		const cards = [
			first,
			{
				...first,
				seat: "S" as const,
				position: "top" as const,
				card: "S2" as const,
			},
			{
				...first,
				seat: "W" as const,
				position: "right" as const,
				card: "S3" as const,
			},
		];
		const before = { ...base, trick: { cards, finished: false } };
		const { root, section } = renderView(before, "desktop");
		const completed = {
			cards: [
				...cards,
				{
					...first,
					seat: "N" as const,
					position: "bottom" as const,
					card: "SA" as const,
				},
			],
			finished: true,
			index: 1,
			winner: "N" as const,
			winnerPosition: "bottom" as const,
			winnerName: "",
		};
		section.render({
			...before,
			phase: "complete",
			at: before.at + 1,
			trick: undefined,
			completedTrick: completed,
		});
		expect(
			root.querySelector('[data-testid="hand-N"] .card[data-card="SA"]'),
		).toBeNull();
		vi.advanceTimersByTime(2000);
		expect(
			root.querySelector('[data-testid="hand-N"] .card[data-card="SA"]'),
		).toBeNull();
		section.dispose();
	});
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

	it.each<Layout>(["desktop", "compact"])(
		"keeps the auction remark attached across rerenders on %s",
		(layout) => {
			const base = {
				...playView(),
				phase: "auction" as const,
				auctionEnd: {
					contract: {
						level: 1 as const,
						strain: "C" as const,
						doubling: "" as const,
					},
					declarer: "by North",
					vulnerability: "N-S not vulnerable",
					vulnerable: false,
					bothHands: "You will play both hands: North and South.",
				},
			};
			const { root, section } = renderView(base, layout);
			const summary = root.querySelector('[data-testid="auction-end"]');
			const remark = summary?.querySelector(".auction-end-both-hands");
			expect(remark?.textContent).toBe(base.auctionEnd.bothHands);
			section.render({ ...base, prompt: "Play starts in 2 seconds." });
			expect(summary?.querySelector(".auction-end-both-hands")).toBe(remark);
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
			const board = document.querySelector<HTMLElement>(
				layout === "compact" ? ".mobile-auction-board" : ".felt",
			);
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
			const undo = root.querySelector<HTMLElement>(".undo-call");
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
			// The calls are grayed out, but the separate Undo keeps its colour.
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
		const trick = {
			cards: [
				{ ...played, seat: "E", position: "left" },
				{ ...played, seat: "S", position: "top", card: "S2", text: "♠2" },
				{ ...played, seat: "W", position: "right", card: "S3", text: "♠3" },
				{ ...played, seat: "N", position: "bottom", card: "S4", text: "♠4" },
			],
			finished: true,
		} as const;
		return {
			...base,
			at,
			trick,
			completedTrick: {
				...trick,
				index: 1,
				winner: "N",
				winnerPosition: "bottom",
				winnerName: "Anna",
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

	it("keeps play order during the winner pause and collection", () => {
		vi.useFakeTimers();
		const { section } = renderView(playView(), "desktop");
		const completed = finishedView();
		const winnerFirst = completed.completedTrick;
		if (!winnerFirst) throw new Error("missing completed trick");
		const updated = {
			...completed,
			completedTrick: {
				...winnerFirst,
				winner: "E" as const,
				winnerPosition: "left" as const,
			},
		};
		section.render(updated);
		const cards = [
			...document.querySelectorAll<HTMLElement>(
				".trick-collection-overlay .played",
			),
		];
		expect(cards.map((card) => Number(card.style.zIndex))).toEqual([
			1, 2, 3, 4,
		]);
		vi.advanceTimersByTime(200);
		expect(cards.map((card) => Number(card.style.zIndex))).toEqual([
			1, 2, 3, 4,
		]);
		section.dispose();
	});

	it("does not replay deferred cards after a skipped state update", () => {
		vi.useFakeTimers();
		const base = playView();
		const { root, section } = renderView(base, "desktop");
		const completed = finishedView();
		section.render(completed);
		const lead = {
			seat: "N" as const,
			position: "bottom" as const,
			card: "SA" as const,
			text: "♠A",
			rank: "A",
			symbol: "♠",
		};
		const second = {
			seat: "E" as const,
			position: "left" as const,
			card: "S2" as const,
			text: "♠2",
			rank: "2",
			symbol: "♠",
		};
		const third = {
			seat: "W" as const,
			position: "right" as const,
			card: "S3" as const,
			text: "♠3",
			rank: "3",
			symbol: "♠",
		};
		section.render({
			...base,
			at: completed.at + 1,
			completedTrick: completed.completedTrick,
			trick: { finished: false, cards: [lead] },
		});
		section.render({
			...base,
			at: completed.at + 3,
			completedTrick: completed.completedTrick,
			trick: { finished: false, cards: [lead, second, third] },
		});
		vi.advanceTimersByTime(1200);
		expect(document.querySelector(".card-flight")).toBeNull();
		expect(root.querySelectorAll(".trick .played")).toHaveLength(3);
		section.dispose();
	});

	it.each<Form>(["desktop", "compact"])(
		"collects a newly finished trick once on %s",
		(form) => {
			vi.useFakeTimers();
			const { root, section } = renderView(playView(), form);
			section.render(finishedView());
			const overlay = document.querySelector(".trick-collection-overlay");
			expect(overlay?.querySelectorAll(".played")).toHaveLength(4);
			expect(
				overlay?.querySelector(".trick-winner")?.getAttribute("data-seat"),
			).toBe("N");
			expect(root.querySelector(".trick-announcement")?.textContent).toBe(
				"North · Anna won the trick",
			);
			document.body.click();
			section.render(finishedView());
			expect(document.querySelector(".trick-collection-overlay")).toBe(overlay);
			vi.advanceTimersByTime(1199);
			expect(document.querySelector(".trick-collection-overlay")).toBe(overlay);
			vi.advanceTimersByTime(1);
			expect(document.querySelector(".trick-collection-overlay")).toBeNull();
			expect(trickShown(root)).toBe(false);
		},
	);

	it("does not replay a completed trick when loading it", () => {
		vi.useFakeTimers();
		const { root } = renderView(finishedView(), "desktop");
		expect(trickShown(root)).toBe(false);
		expect(document.querySelector(".trick-collection-overlay")).toBeNull();
	});

	it("cancels the collection on rollback and permits a later recompletion", () => {
		vi.useFakeTimers();
		const { section } = renderView(playView(), "desktop");
		section.render(finishedView());
		expect(section.collecting()).toBe(true);
		section.render(playView());
		expect(document.querySelector(".trick-collection-overlay")).toBeNull();
		section.render(finishedView());
		expect(section.collecting()).toBe(true);
		section.dispose();
	});

	it.each<Form>(["desktop", "compact"])(
		"uses the viewer-relative board edge for every winner and viewer on %s",
		(form) => {
			vi.useFakeTimers();
			const seats = ["N", "E", "S", "W"] as const;
			for (const viewer of seats)
				for (const winner of seats) {
					const { section, root } = renderView(playView(), form);
					const board = root.querySelector<HTMLElement>(
						form === "compact" ? ".mobile-auction-board" : ".felt",
					);
					if (!board) throw new Error("missing game board");
					const boardRect = board.getBoundingClientRect();
					const original = finishedView();
					if (!original.completedTrick)
						throw new Error("missing completed trick");
					const completedTrick = {
						...original.completedTrick,
						winner,
						winnerPosition: positionOf(viewer, winner),
						cards: original.completedTrick.cards.map((card) => ({
							...card,
							position: positionOf(viewer, card.seat),
						})),
					};
					section.render({ ...original, completedTrick });
					const overlay = document.querySelector<HTMLElement>(
						".trick-collection-overlay",
					);
					if (!overlay) throw new Error("missing collection overlay");
					const overlayRect = overlay.getBoundingClientRect();
					expect(overlayRect.left).toBeCloseTo(boardRect.left, 0);
					expect(overlayRect.top).toBeCloseTo(boardRect.top, 0);
					expect(overlayRect.width).toBeCloseTo(boardRect.width, 0);
					expect(overlayRect.height).toBeCloseTo(boardRect.height, 0);
					expect(getComputedStyle(overlay).overflow).toBe("hidden");
					const cards = [
						...(overlay?.querySelectorAll<HTMLElement>(".played") ?? []),
					];
					expect(cards).toHaveLength(4);
					const endpoints = cards.map((card) => {
						const animation = card
							.getAnimations()
							.find(
								(item) =>
									item.effect instanceof KeyframeEffect &&
									item.effect
										.getKeyframes()
										.some((frame) =>
											String(frame.transform ?? "").includes("translate("),
										),
							);
						const frame = (animation?.effect as KeyframeEffect | undefined)
							?.getKeyframes()
							.at(-1);
						const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
							String(frame?.transform ?? ""),
						);
						if (!match) throw new Error("missing collection transform");
						return [
							parseFloat(card.style.left) +
								card.offsetWidth / 2 +
								Number(match[1]),
							parseFloat(card.style.top) +
								card.offsetHeight / 2 +
								Number(match[2]),
						];
					});
					for (const point of endpoints) {
						expect(point[0]).toBeCloseTo(endpoints[0]?.[0] ?? 0, 0);
						expect(point[1]).toBeCloseTo(endpoints[0]?.[1] ?? 0, 0);
					}
					const [x, y] = endpoints[0] ?? [0, 0];
					const width = boardRect.width;
					const height = boardRect.height;
					switch (completedTrick.winnerPosition) {
						case "top":
							expect(x).toBeCloseTo(width / 2, 0);
							expect(y).toBeLessThan(0);
							break;
						case "bottom":
							expect(x).toBeCloseTo(width / 2, 0);
							expect(y).toBeGreaterThan(height);
							break;
						case "left":
							expect(y).toBeCloseTo(height / 2, 0);
							expect(x).toBeLessThan(0);
							break;
						case "right":
							expect(y).toBeCloseTo(height / 2, 0);
							expect(x).toBeGreaterThan(width);
							break;
					}
					section.dispose();
				}
		},
	);

	it("respects the setting that disables collection motion", () => {
		const { section, root } = renderView(
			playView(),
			"desktop",
			undefined,
			undefined,
			{ trickAnimation: () => false },
		);
		section.render(finishedView());
		expect(section.collecting()).toBe(false);
		expect(document.querySelector(".trick-collection-overlay")).toBeNull();
		expect(root.querySelector(".trick-announcement")?.textContent).toBe(
			"North · Anna won the trick",
		);
	});

	it.each<Form>(["desktop", "compact"])(
		"highlights the winner immediately on %s, without adding the static display delay",
		(form) => {
			vi.useFakeTimers();
			const { section } = renderView(playView(), form, undefined, undefined, {
				trickDisplayMs: () => 2000,
				trickWinnerPauseMs: () => 1000,
			});
			section.render(finishedView());
			expect(
				document.querySelectorAll(".trick-collection-overlay .played"),
			).toHaveLength(4);
			expect(
				document.querySelector(".trick-winner")?.getAttribute("data-seat"),
			).toBe("N");
			const winner = document.querySelector<HTMLElement>(".trick-winner");
			const animation = winner
				?.getAnimations()
				.find(
					(item) =>
						item.effect instanceof KeyframeEffect &&
						item.effect
							.getKeyframes()
							.some((frame) =>
								String(frame.transform ?? "").includes("translate("),
							),
				);
			expect(animation?.effect?.getTiming().delay).toBe(1000);
			vi.advanceTimersByTime(1999);
			expect(section.collecting()).toBe(true);
			vi.advanceTimersByTime(1);
			expect(section.collecting()).toBe(false);
		},
	);

	it.each([0, 1000, 5000])(
		"waits %i ms after highlighting before sweeping",
		(pause) => {
			vi.useFakeTimers();
			const { root, section } = renderView(
				playView(),
				"desktop",
				undefined,
				undefined,
				{ trickWinnerPauseMs: () => pause },
			);
			section.render(finishedView());
			const winner = document.querySelector<HTMLElement>(
				".trick-collection-overlay .trick-winner",
			);
			if (!winner) throw new Error("missing winner highlight");
			const animation = winner
				.getAnimations()
				.find(
					(item) =>
						item.effect instanceof KeyframeEffect &&
						item.effect
							.getKeyframes()
							.some((frame) =>
								String(frame.transform ?? "").includes("translate("),
							),
				);
			expect(animation?.effect?.getTiming().delay).toBe(pause);
			const announcement = root.querySelector<HTMLElement>(
				".trick-announcement",
			);
			if (!announcement) throw new Error("missing accessible announcement");
			expect(announcement.getAttribute("role")).toBe("status");
			expect(announcement.textContent).toBe("North · Anna won the trick");
			expect(getComputedStyle(announcement).clip).toBe(
				"rect(0px, 0px, 0px, 0px)",
			);
			vi.advanceTimersByTime(pause + 999);
			expect(section.collecting()).toBe(true);
			vi.advanceTimersByTime(1);
			expect(section.collecting()).toBe(false);
		},
	);

	it("keeps the finished trick visible for the configured time even with animation off", () => {
		vi.useFakeTimers();
		const { section } = renderView(
			playView(),
			"desktop",
			undefined,
			undefined,
			{ trickDisplayMs: () => 2000, trickAnimation: () => false },
		);
		section.render(finishedView());
		expect(section.collecting()).toBe(true);
		expect(
			document.querySelectorAll(".trick-collection-overlay .played"),
		).toHaveLength(4);
		expect(document.querySelector(".trick-winner")).toBeNull();
		vi.advanceTimersByTime(1999);
		expect(section.collecting()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(section.collecting()).toBe(false);
	});

	it("keeps card text proportional when the desktop table is scaled", () => {
		vi.useFakeTimers();
		const { root, section } = renderView(playView(), "desktop");
		const stage = root.parentElement;
		if (!stage) throw new Error("missing stage");
		stage.style.transformOrigin = "top left";
		stage.style.transform = "scale(0.5)";
		const original = root.querySelector<HTMLElement>(".played .rank-corner");
		if (!original) throw new Error("missing card rank");
		const expected = parseFloat(getComputedStyle(original).fontSize) / 2;
		section.render(finishedView());
		const animated = document.querySelector<HTMLElement>(
			".trick-collection-overlay .rank-corner",
		);
		if (!animated) throw new Error("missing animated rank");
		expect(parseFloat(getComputedStyle(animated).fontSize)).toBeCloseTo(
			expected,
			0,
		);
		section.dispose();
	});

	it.each<Form>(["desktop", "compact"])(
		"keeps the final result and new plays behind collection on %s",
		(form) => {
			vi.useFakeTimers();
			const { root, section, handlers } = renderView(playView(), form);
			const complete = finishedView();
			section.render({
				...complete,
				phase: "complete",
				scoring: {
					contract: { level: 2, strain: "C", doubling: "" },
					compactOutcome: "WON",
					compactDetail: "Made: 2♣",
					countdown: 10,
				},
			});
			expect(section.collecting()).toBe(true);
			expect(root.dataset.phase).toBe("play");
			root.querySelector<HTMLButtonElement>('[data-card="SA"]')?.click();
			expect(handlers.act).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1200);
			expect(root.dataset.phase).toBe("complete");
			expect(
				root.querySelector<HTMLElement>('[data-testid="scoring"]')?.hidden,
			).toBe(false);
		},
	);

	it.each(["resize", "scroll"] as const)(
		"clears the overlay when the board moves after %s",
		(event) => {
			vi.useFakeTimers();
			const { section } = renderView(playView(), "desktop");
			section.render(finishedView());
			expect(section.collecting()).toBe(true);
			(event === "resize" ? window : document.body).dispatchEvent(
				new Event(event),
			);
			expect(section.collecting()).toBe(false);
			expect(document.querySelector(".trick-collection-overlay")).toBeNull();
		},
	);

	it("keeps the next trick out of the collection and rejects clicks until it finishes", () => {
		vi.useFakeTimers();
		const { root, section, handlers } = renderView(playView(), "desktop");
		const finished = finishedView();
		section.render(finished);
		const next = playView();
		section.render({ ...next, at: 9, completedTrick: finished.completedTrick });
		expect(
			document.querySelectorAll(".trick-collection-overlay .played"),
		).toHaveLength(4);
		expect(root.querySelectorAll(".trick .played")).toHaveLength(0);
		root.querySelector<HTMLButtonElement>('.card[data-card="SA"]')?.click();
		expect(handlers.act).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1200);
		expect(root.querySelectorAll(".trick .played")).toHaveLength(1);
	});

	it("shows a static winner frame then fades with reduced motion", () => {
		vi.useFakeTimers();
		const nativeMatch = window.matchMedia.bind(window);
		const media = vi
			.spyOn(window, "matchMedia")
			.mockImplementation((query) =>
				query === "(prefers-reduced-motion: reduce)"
					? ({ matches: true } as MediaQueryList)
					: nativeMatch(query),
			);
		try {
			const { root, section } = renderView(playView(), "desktop");
			section.render(finishedView());
			const winner = document.querySelector<HTMLElement>(
				".trick-collection-overlay .trick-winner",
			);
			expect(winner).not.toBeNull();
			const frames = (
				winner?.getAnimations()[0]?.effect as KeyframeEffect | undefined
			)?.getKeyframes();
			expect(frames?.at(-1)?.opacity).toBe("0");
			expect(frames?.at(-1)?.transform).toBeUndefined();
			expect(root.querySelector(".trick-announcement")?.textContent).toContain(
				"won the trick",
			);
			vi.advanceTimersByTime(350);
			expect(document.querySelector(".trick-collection-overlay")).toBeNull();
		} finally {
			media.mockRestore();
		}
	});

	it("clears obsolete motion on a new board and on disposal", () => {
		vi.useFakeTimers();
		const { section } = renderView(playView(), "desktop");
		section.render(finishedView());
		expect(section.collecting()).toBe(true);
		section.render({ ...playView(), board: 2 });
		expect(section.collecting()).toBe(false);
		expect(document.querySelector(".trick-collection-overlay")).toBeNull();
		section.render({ ...finishedView(), board: 2 });
		expect(section.collecting()).toBe(true);
		section.dispose();
		expect(document.querySelector(".trick-collection-overlay")).toBeNull();
	});

	it("clears motion in a background tab without replaying it on return", () => {
		vi.useFakeTimers();
		const { section } = renderView(playView(), "desktop");
		section.render(finishedView());
		expect(section.collecting()).toBe(true);
		Object.defineProperty(document, "hidden", {
			configurable: true,
			value: true,
		});
		try {
			document.dispatchEvent(new Event("visibilitychange"));
			expect(section.collecting()).toBe(false);
			section.render(finishedView());
			expect(document.querySelector(".trick-collection-overlay")).toBeNull();
		} finally {
			Reflect.deleteProperty(document, "hidden");
		}
		section.render(finishedView());
		expect(document.querySelector(".trick-collection-overlay")).toBeNull();
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
		const { root } = renderView(
			{
				...view,
				phase: "auction",
				seats: view.seats.map((player) => ({
					...player,
					turn: player.seat === "E",
				})),
			},
			"compact",
			undefined,
			undefined,
			{ marks: () => ({ ...DEFAULT_SETTINGS, hideBidBoxWhenWaiting: false }) },
		);
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
		const { root, section } = renderView(
			{ ...base, phase: "auction", bids: [{ call: "P", text: "Pass" }] },
			"compact",
			undefined,
			undefined,
			{ marks: () => ({ ...DEFAULT_SETTINGS, hideBidBoxWhenWaiting: false }) },
		);
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
		// The background layer and the calls are darkened, not the overlay itself.
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
			undefined,
			undefined,
			{ marks: () => ({ ...DEFAULT_SETTINGS, hideBidBoxWhenWaiting: false }) },
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
