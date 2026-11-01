import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import type { PointSystem } from "../../src/bridge/hand-points";
import type { Layout } from "../../src/call/device-class";
import { type Translate, translator } from "../../src/i18n";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import type { TableHandlers, TableOptions } from "../../src/ui/table";
import type { TableView } from "../../src/ui/table-model";
import {
	playView,
	renderMobile,
	renderView,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

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
			question: "",
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
			question: "",
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
		"links directly to transfers and Stayman in the Hungarian guide (%s)",
		async (form) => {
			const { root } = renderView(
				auction(),
				form,
				undefined,
				translator("hu"),
				{
					locale: "hu",
					pointSystem: () => "hcp",
					marks: () => ({ ...DEFAULT_SETTINGS, guideButton: true }),
				},
			);
			root.querySelector<HTMLButtonElement>(".guide-open")?.click();
			await loaded(root).toBe("Licitálási útmutató: Milton HCP (4-3-2-1)");
			const text = content(root);
			if (!text) throw new Error("Missing guide content");
			for (const [id, fragment] of [
				["guide-transfer-link", "legalább öt kőrt"],
				["guide-stayman-link", "legalább 8 pont négylapos nemes színnel"],
			] as const) {
				const link = text.querySelector<HTMLButtonElement>(
					`[data-testid='${id}']`,
				);
				if (!link) throw new Error(`Missing ${id}`);
				link.click();
				const target = document.activeElement;
				expect(target?.tagName).toBe("LI");
				expect(target?.textContent).toContain(fragment);
				expect(text.scrollTop).toBeGreaterThan(0);
				const top = target?.getBoundingClientRect().top ?? 0;
				const navigation = text.querySelector<HTMLElement>(".guide-jumps");
				if (!navigation) throw new Error("Missing guide navigation");
				expect(
					Math.abs(top - navigation.getBoundingClientRect().bottom),
				).toBeLessThan(5);
			}
		},
	);

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

describe("bot bid in the bid box", () => {
	const auction = (): TableView => ({
		...playView(),
		phase: "auction",
		trick: undefined,
		bids: [
			{ call: "1C", text: "1♣" },
			{ call: "1S", text: "1♠" },
			{ call: "P", text: "Pass" },
		],
	});
	const row = (root: HTMLElement) => [
		...root.querySelectorAll<HTMLButtonElement>(".bid-guide button"),
	];
	const bot = (root: HTMLElement) => {
		const found = root.querySelector<HTMLButtonElement>(
			"[data-testid='bot-bid']",
		);
		if (!found) throw new Error("no bot bid button");
		return found;
	};
	const pressed = (root: HTMLElement) =>
		[
			...root.querySelectorAll<HTMLButtonElement>(
				".bid-box button[aria-pressed='true']",
			),
		].map((node) => node.getAttribute("aria-label"));
	const confirm = (root: HTMLElement) =>
		root.querySelector<HTMLButtonElement>(".bid-actions .confirm");

	it.each(["desktop", "compact"] as const)(
		"splits the first row into Guide and the bot's call (%s)",
		(form) => {
			const { root, section } = renderView(auction(), form);
			expect(row(root).map((node) => node.textContent)).toEqual([
				"Guide",
				"Bot: …",
			]);
			expect(bot(root).disabled).toBe(true);
			section.showBotBid("1S");
			expect(row(root).map((node) => node.textContent)).toEqual([
				"Guide",
				"Bot: 1♠",
			]);
			expect(bot(root).disabled).toBe(false);
			// The call has the colour of its strain, as in the bidding history.
			expect(bot(root).querySelector(".bid-mark.strain-S")).not.toBeNull();
			const [guide, suggestion] = row(root).map((node) =>
				node.getBoundingClientRect(),
			);
			if (!guide || !suggestion) throw new Error("missing row buttons");
			expect(suggestion.top).toBeCloseTo(guide.top, 0);
			expect(suggestion.width).toBeCloseTo(guide.width, 0);
		},
	);

	it("selects the bot's call on a click, and Confirm still sends it", () => {
		const { root, section, handlers } = renderView(auction(), "desktop");
		section.showBotBid("1S");
		bot(root).click();
		expect(pressed(root)).toEqual(["Level 1", "Spades"]);
		expect(confirm(root)?.dataset.call).toBe("1S");
		expect(handlers.act).not.toHaveBeenCalled();
		confirm(root)?.click();
		expect(handlers.act).toHaveBeenCalledWith({ type: "call", call: "1S" });
	});

	it("selects Pass when the bot passes", () => {
		const { root, section } = renderView(auction(), "compact");
		section.showBotBid("P");
		expect(bot(root).textContent).toBe("Bot: Pass");
		bot(root).click();
		expect(pressed(root)).toEqual(["Pass"]);
		expect(confirm(root)?.dataset.call).toBe("P");
	});

	it("does not offer a call that is not legal now, and clears it on request", () => {
		const { root, section } = renderView(auction(), "desktop");
		section.showBotBid("2H");
		expect(bot(root).textContent).toBe("Bot: …");
		expect(bot(root).disabled).toBe(true);
		section.showBotBid("1C");
		expect(bot(root).disabled).toBe(false);
		section.showBotBid(undefined);
		expect(bot(root).textContent).toBe("Bot: …");
		expect(bot(root).disabled).toBe(true);
	});

	it.each(["desktop", "compact"] as const)(
		"keeps the single Guide button when the setting is off (%s)",
		(form) => {
			const { root, section } = renderView(
				auction(),
				form,
				undefined,
				undefined,
				{
					marks: () => ({
						...DEFAULT_SETTINGS,
						guideButton: true,
						botBidHint: false,
					}),
				},
			);
			section.showBotBid("1S");
			expect(row(root).map((node) => node.textContent)).toEqual(["Guide"]);
			expect(root.querySelector("[data-testid='bot-bid']")).toBeNull();
		},
	);

	it("names the bot and the call in the language of the table", () => {
		const { root, section } = renderView(
			auction(),
			"desktop",
			undefined,
			translator("de"),
			{ locale: "de" },
		);
		section.showBotBid("P");
		expect(bot(root).textContent).toBe("Bot: Passe");
		expect(bot(root).title).toBe(
			"Wählt das Gebot des Bots. Bestätigen sendet es.",
		);
	});
});

describe("bidding guide over the side panel", () => {
	const auction = (bids = 1): TableView => ({
		...playView(),
		phase: "auction",
		trick: undefined,
		bids: (
			[
				{ call: "1C", text: "1♣" },
				{ call: "P", text: "Pass" },
				{ call: "1S", text: "1♠" },
			] as const
		).slice(0, bids),
	});
	/** The table on the 1920×1080 room canvas, as the room shows it (src/ui/room-view.ts). */
	function onCanvas(
		view: TableView,
		form: Layout,
		options: TableOptions = {},
		t?: Translate,
	) {
		const shown = renderView(view, form, undefined, t, {
			pointSystem: () => "reith",
			...options,
		});
		const screen = document.createElement("main");
		screen.dataset.screen = "table";
		screen.dataset.form = form === "compact" ? "compact" : "desktop";
		// The room scales its canvas to the window, so the whole sidebar is on the screen.
		screen.style.setProperty(
			"--room-canvas-scale",
			String(Math.min(innerWidth / 1920, innerHeight / 1080)),
		);
		screen.append(...document.body.children);
		document.body.replaceChildren(screen);
		return shown;
	}
	const panel = () =>
		document.querySelector<HTMLElement>("[data-testid='side-guide']");
	const content = () => panel()?.querySelector<HTMLElement>(".guide-content");
	const loaded = () =>
		expect.poll(() => content()?.querySelector("h2")?.textContent);

	it("shows the guide of the viewer's scale below the auction heading, over the side panel", async () => {
		const { section } = onCanvas(auction(), "desktop");
		await loaded().toBe("Bidding guide: Reith points (6-4-3-2-1)");
		const guide = panel();
		if (!guide) throw new Error("no side guide");
		expect(guide.parentElement).toBe(section.sidebar);
		expect(guide.getAttribute("aria-label")).toBe("Bidding guide");
		const status = section.sidebar.querySelector(".table-status");
		if (!status) throw new Error("no status in the sidebar");
		const box = guide.getBoundingClientRect();
		const side = section.sidebar.getBoundingClientRect();
		await expect
			.poll(() => guide.getBoundingClientRect().top)
			.toBeGreaterThanOrEqual(status.getBoundingClientRect().bottom - 1);
		expect(
			guide.getBoundingClientRect().top - status.getBoundingClientRect().bottom,
		).toBeLessThan(30);
		expect(box.left).toBeCloseTo(side.left, 0);
		expect(box.width).toBeCloseTo(side.width, 0);
		expect(box.bottom).toBeCloseTo(side.bottom, 0);
		// The guide does not fit, so it scrolls.
		const text = content();
		if (!text) throw new Error("no guide content");
		expect(text.scrollHeight).toBeGreaterThan(text.clientHeight);
		text.scrollTop = 200;
		expect(text.scrollTop).toBeGreaterThan(0);
		// The guide lies over the other panels.
		const hit = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		);
		expect(guide.contains(hit)).toBe(true);
	});

	it("links to the 1NT transfer in the side guide", async () => {
		onCanvas(auction(), "desktop");
		await loaded().toBeTruthy();
		const text = content();
		const link = text?.querySelector<HTMLButtonElement>(
			"[data-testid='guide-transfer-link']",
		);
		if (!text || !link) throw new Error("Missing transfer link");
		link.click();
		expect(document.activeElement?.textContent).toContain(
			"five or more hearts",
		);
		expect(text.scrollTop).toBeGreaterThan(0);
	});

	it("does not move the other panels of the sidebar", () => {
		const tops = (guidePanel: boolean) => {
			const { section } = onCanvas(auction(), "desktop", {
				marks: () => ({ ...DEFAULT_SETTINGS, guidePanel }),
			});
			return [...section.sidebar.children]
				.filter((node) => node !== panel())
				.map((node) => node.getBoundingClientRect().top);
		};
		expect(tops(true)).toEqual(tops(false));
	});

	it("keeps the scroll position while the auction goes on", async () => {
		const { section } = onCanvas(auction(), "desktop");
		await loaded().toBeTruthy();
		const text = content();
		if (!text) throw new Error("no guide content");
		text.scrollTop = 200;
		const at = text.scrollTop;
		section.render(auction(3));
		expect(content()).toBe(text);
		expect(text.scrollTop).toBe(at);
	});

	it("shows the guide in the viewer's language", async () => {
		onCanvas(auction(), "desktop", { locale: "de" }, translator("de"));
		await loaded().toBe("Reizleitfaden: Reith-Punkte (6-4-3-2-1)");
		expect(panel()?.getAttribute("aria-label")).toBe("Reizleitfaden");
	});

	it.each([
		["the compact layout", "compact", {}],
		["a phone held sideways", "sideways", {}],
		[
			"the setting is off",
			"desktop",
			{ marks: () => ({ ...DEFAULT_SETTINGS, guidePanel: false }) },
		],
		["the scale has no guide", "desktop", { pointSystem: () => "other" }],
	] as const)("is absent in %s", (_, form, options) => {
		onCanvas(auction(), form, options);
		expect(panel()).toBeNull();
	});

	it("goes away when the auction ends", async () => {
		const { section } = onCanvas(auction(), "desktop");
		await loaded().toBeTruthy();
		section.render(playView());
		expect(panel()).toBeNull();
	});
});
