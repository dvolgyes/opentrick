import { expect, vi } from "vitest";
import type { Card } from "../../src/bridge/cards";
import type { Layout } from "../../src/call/device-class";
import type { Translate } from "../../src/i18n";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import {
	type PlayedCardStyle,
	type TableHandlers,
	type TableOptions,
	tableSection,
} from "../../src/ui/table";
import type { SeatView, TableView } from "../../src/ui/table-model";

export const card = (value: Card) => ({
	card: value,
	rank: value.slice(1),
	suit: value[0] as "S" | "H" | "D" | "C",
	text: value,
	playable: true,
});

export const visibleHand = {
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

export function seat(
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
export const NS_VULNERABLE: TableView["vulnerability"] = [
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

export function playView(): TableView {
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
			declaring: true,
			ours: 2,
			target: 8,
			opponents: 3,
			needed: 6,
			remaining: 8,
			status: "open",
		},
		trickStatus: "",
		scoring: undefined,
		auctionEnd: undefined,
		nextBoard: undefined,
		actions: [],
		undo: {
			canRequest: true,
			question: "Ask to undo your last played card?",
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
export function sideHandView(): TableView {
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

export function renderView(
	view: TableView,
	form: Layout,
	style?: PlayedCardStyle,
	t?: Translate,
	options?: TableOptions,
) {
	const handlers: TableHandlers = {
		exit: vi.fn(),
		settings: vi.fn(),
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
	const section = tableSection(handlers, style, t, {
		marks: () => ({ ...DEFAULT_SETTINGS, guideButton: true }),
		trickDisplayMs: () => 0,
		...options,
	});
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
export function expectTwoRows(row: HTMLElement): void {
	const boxes = (selector: string) =>
		[...row.querySelectorAll<HTMLElement>(selector)].map((part) =>
			part.getBoundingClientRect(),
		);
	const labels = boxes(".count-label");
	const numbers = boxes(".count strong");
	const [bid] = boxes(".bid");
	if (!bid) throw new Error("the contract is missing");
	expect(labels).toHaveLength(2);
	expect(numbers).toHaveLength(2);
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

export function renderMobile(view: TableView) {
	return renderView(view, "compact");
}

/**
 * The middle of `panel` is within 4px of the middle of `board`, in both directions. On a phone's result screen the
 * empty call slot below the hands takes one 0.4rem felt gap, so the hands lie about 3px above the felt's middle.
 */
export function expectSameMiddle(panel: HTMLElement, board: HTMLElement): void {
	const middle = (node: HTMLElement): [number, number] => {
		const box = node.getBoundingClientRect();
		return [box.left + box.width / 2, box.top + box.height / 2];
	};
	const [x, y] = middle(panel);
	const [boardX, boardY] = middle(board);
	expect(Math.abs(x - boardX), "horizontal").toBeLessThan(4);
	expect(Math.abs(y - boardY), "vertical").toBeLessThan(4);
}

/** Renders the result of a board as the model shows it: every hand with its 13 cards again, and no trick. */
export function renderResult(layout: Layout): HTMLElement {
	const ranks = "AKQJT98765432";
	const deal = {
		visible: true as const,
		suits: (["S", "H", "D", "C"] as const).map((suit, index) => ({
			suit,
			symbol: { S: "♠", H: "♥", D: "♦", C: "♣" }[suit],
			trump: false,
			cards: [...ranks.slice(index * 3, index === 3 ? 13 : index * 3 + 3)].map(
				(rank) => card(`${suit}${rank}` as Card),
			),
		})),
	};
	const base = playView();
	renderView(
		{
			...base,
			phase: "complete",
			trick: undefined,
			seats: base.seats.map((player) => ({ ...player, hand: deal })),
			scoring: {
				contract: { level: 4, strain: "H", doubling: "X" },
				compactOutcome: "WON",
				compactDetail: "Made: 4♥X + 1",
				countdown: 1,
			},
		},
		layout,
	);
	const result = document.querySelector<HTMLElement>('[data-testid="scoring"]');
	if (!result) throw new Error("no result");
	return result;
}
