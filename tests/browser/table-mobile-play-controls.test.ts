import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { cdp, page } from "vitest/browser";
import "../../src/ui/style.css";
import type { Card } from "../../src/bridge/cards";
import type { Form } from "../../src/call/device-class";
import type { Seat } from "../../src/protocol";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import type { TableMarks, TableOptions } from "../../src/ui/table";
import type { TableView } from "../../src/ui/table-model";
import {
	card,
	expectTwoRows,
	playView,
	renderMobile,
	renderView,
	seat,
	sideHandView,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

describe("turn marks and network quality from the settings", () => {
	const RED = "rgb(255, 69, 69)";
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

	describe("the bot animation", () => {
		// East is a bot; the host gives the turn to the seat in `turn`.
		const botView = (turn: Seat): TableView => {
			const base = playView();
			return {
				...base,
				seats: base.seats.map((player) => ({
					...player,
					bot: player.seat === "E",
					turn: player.seat === turn,
				})),
			};
		};
		const cardPositions = (tile: HTMLElement) =>
			[...tile.querySelectorAll<HTMLElement>(".bridge-rain-card")]
				.map((card) => card.style.transform)
				.join(";");
		const frames = () =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			);
		// The cards inside the picture, and whether the canvas has any symbol of the rain.
		const cardsInSight = (tile: HTMLElement) => {
			const frame = tile
				.querySelector<HTMLElement>("[data-testid='bot-animation']")
				?.getBoundingClientRect();
			if (frame === undefined) return 0;
			return [...tile.querySelectorAll<HTMLElement>(".bridge-rain-card")]
				.map((card) => card.getBoundingClientRect())
				.filter(
					(card) =>
						card.bottom > frame.top &&
						card.top < frame.bottom &&
						card.right > frame.left &&
						card.left < frame.right,
				).length;
		};
		const rainDrawn = (tile: HTMLElement) => {
			const canvas = tile.querySelector<HTMLCanvasElement>(
				".bridge-rain-canvas",
			);
			const pixels = canvas
				?.getContext("2d")
				?.getImageData(0, 0, canvas.width, canvas.height).data;
			return pixels?.some((value, index) => index % 4 === 3 && value > 0);
		};

		it("moves in place of the bot image on the bot's turn and freezes after it", async () => {
			const { root, section } = renderView(
				botView("S"),
				"desktop",
				undefined,
				undefined,
				marks({}),
			);
			section.setBotControls(false, ["E"], false);
			const tile = root.querySelector<HTMLElement>("[data-testid='tile-E']");
			if (tile === null) throw new Error("no tile of East");
			const animation = tile.querySelector<HTMLElement>(
				"[data-testid='bot-animation']",
			);
			expect(tile.querySelector<HTMLElement>(".bot-artwork")?.hidden).toBe(
				true,
			);
			expect(animation?.checkVisibility()).toBe(true);
			// Before its first turn the scene is blank green and still.
			await expect.poll(() => animation?.dataset.state).toBe("still");
			const still = cardPositions(tile);
			expect(still).not.toBe("");
			expect(cardsInSight(tile)).toBe(0);
			expect(rainDrawn(tile)).toBe(false);
			await frames();
			expect(cardPositions(tile)).toBe(still);

			// On its turn the rain and the cards enter from the top.
			section.render(botView("E"));
			expect(animation?.dataset.state).toBe("moving");
			await expect.poll(() => cardPositions(tile)).not.toBe(still);
			await expect.poll(() => rainDrawn(tile)).toBe(true);
			await expect
				.poll(() => cardsInSight(tile), { timeout: 10_000 })
				.toBeGreaterThan(0);

			section.render(botView("W"));
			expect(animation?.dataset.state).toBe("still");
			const frozen = cardPositions(tile);
			await frames();
			expect(cardPositions(tile)).toBe(frozen);
		});

		it("gives each bot its own cards and symbol rain", async () => {
			// With reduced motion both scenes start filled at the same time, so only the seeds differ.
			await cdp().send("Emulation.setEmulatedMedia", {
				features: [{ name: "prefers-reduced-motion", value: "reduce" }],
			});
			onTestFinished(async () => {
				await cdp().send("Emulation.setEmulatedMedia", { features: [] });
			});
			const base = botView("S");
			const view: TableView = {
				...base,
				seats: base.seats.map((player) => ({
					...player,
					bot: player.seat === "E" || player.seat === "W",
				})),
			};
			const { root, section } = renderView(
				view,
				"desktop",
				undefined,
				undefined,
				marks({}),
			);
			section.setBotControls(false, ["E", "W"], false);
			const scene = (seat: Seat) => {
				const tile = root.querySelector<HTMLElement>(
					`[data-testid='tile-${seat}']`,
				);
				if (tile === null) throw new Error(`no tile of ${seat}`);
				return tile;
			};
			await expect
				.poll(() =>
					[scene("E"), scene("W")].map(
						(tile) =>
							tile.querySelector<HTMLElement>("[data-testid='bot-animation']")
								?.dataset.state,
					),
				)
				.toEqual(["still", "still"]);
			expect(rainDrawn(scene("E"))).toBe(true);
			const rain = (seat: Seat) =>
				scene(seat)
					.querySelector<HTMLCanvasElement>(".bridge-rain-canvas")
					?.toDataURL();
			expect(cardPositions(scene("E"))).not.toBe(cardPositions(scene("W")));
			expect(rain("E")).not.toBe(rain("W"));
		});

		it("leaves the bot image while its setting is off", () => {
			const { root, section } = renderView(
				botView("E"),
				"desktop",
				undefined,
				undefined,
				marks({ botAnimation: false }),
			);
			section.setBotControls(false, ["E"], false);
			const tile = root.querySelector<HTMLElement>("[data-testid='tile-E']");
			expect(
				tile?.querySelector<HTMLElement>(".bot-artwork")?.checkVisibility(),
			).toBe(true);
			expect(
				tile
					?.querySelector<HTMLElement>("[data-testid='bot-animation']")
					?.checkVisibility(),
			).toBe(false);
			expect(tile?.querySelector(".bridge-rain")).toBeNull();
		});

		it("freezes a paused bot on its turn and shows Paused over its picture", async () => {
			const { root, section } = renderView(
				botView("E"),
				"desktop",
				undefined,
				undefined,
				marks({}),
			);
			section.setBotControls(true, ["E"], true);
			const tile = root.querySelector<HTMLElement>("[data-testid='tile-E']");
			if (tile === null) throw new Error("no tile of East");
			const animation = tile.querySelector<HTMLElement>(
				"[data-testid='bot-animation']",
			);
			const paused = tile.querySelector<HTMLElement>(
				"[data-testid='bot-paused']",
			);
			expect(animation?.checkVisibility()).toBe(true);
			// The scene starts when its font is ready, and stays still on the bot's turn.
			await expect.poll(() => animation?.dataset.state).toBe("still");
			expect(paused?.checkVisibility()).toBe(true);
			expect(paused?.textContent).toBe("Paused");
			// The label lies over the picture, inside its frame.
			const frame = animation?.getBoundingClientRect();
			const label = paused?.getBoundingClientRect();
			if (frame === undefined || label === undefined)
				throw new Error("no frame or label");
			expect(label.left).toBeGreaterThanOrEqual(frame.left);
			expect(label.right).toBeLessThanOrEqual(frame.right);
			expect(label.top).toBeGreaterThanOrEqual(frame.top);
			expect(label.bottom).toBeLessThanOrEqual(frame.bottom);
			const still = cardPositions(tile);
			await frames();
			expect(cardPositions(tile)).toBe(still);
			// A player's tile has no label.
			expect(
				root
					.querySelector<HTMLElement>(
						"[data-testid='tile-W'] [data-testid='bot-paused']",
					)
					?.checkVisibility() ?? false,
			).toBe(false);

			// Resumed, the same scene moves on from where it stopped.
			section.setBotControls(true, ["E"], false);
			expect(animation?.dataset.state).toBe("moving");
			expect(paused?.checkVisibility()).toBe(false);
			await expect.poll(() => cardPositions(tile)).not.toBe(still);
		});

		it("shows Paused over the bot image while the animation is off", () => {
			const { root, section } = renderView(
				botView("E"),
				"desktop",
				undefined,
				undefined,
				marks({ botAnimation: false }),
			);
			section.setBotControls(true, ["E"], true);
			const tile = root.querySelector<HTMLElement>("[data-testid='tile-E']");
			expect(
				tile?.querySelector<HTMLElement>(".bot-artwork")?.checkVisibility(),
			).toBe(true);
			expect(
				tile
					?.querySelector<HTMLElement>("[data-testid='bot-paused']")
					?.checkVisibility(),
			).toBe(true);
		});
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
			undefined,
			undefined,
			// The image shows only without the bot animation.
			{ marks: () => ({ ...DEFAULT_SETTINGS, botAnimation: false }) },
		);
		section.setBotControls(false, ["E"], false);
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

		section.setBotControls(false, [], false);
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
		section.setBotControls(false, ["E"], false);
		const canvas = document.createElement("canvas");
		const track = canvas.captureStream().getVideoTracks()[0];
		if (track === undefined) throw new Error("the canvas gives no track");
		const remote = (seat: Seat) => ({
			seat,
			status: "connected" as const,
			audio: undefined,
			video: seat === "E" ? track : undefined,
			peerSendsAudio: false,
			peerReceivesAudio: true,
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
		).root.querySelector('[data-testid="scoring"] .strain-D') as HTMLElement;
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
		).root.querySelector('[data-testid="scoring"] .strain-NT') as HTMLElement;
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

	it("shows the partnership goal and remaining tricks on mobile", () => {
		const view = playView();
		const { root } = renderMobile(view);
		const row = root.querySelector<HTMLElement>(
			'[data-testid="mobile-tricks"]',
		);
		if (!row) throw new Error("mobile trick count is missing");
		expect(row?.hidden).toBe(false);
		expect(row.textContent).toContain("2♣Our tricks2 / 8Opponents'3");
		expect(row.textContent).toContain("8 tricks to make 2♣");
		expect(row.textContent).toContain("6 more needed · 8 tricks remaining");
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
				declaring: false,
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
		expect(defender?.textContent).toContain("6 defensive tricks to defeat 2♣");
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
		expect(row.textContent).toBe("2NTXXOur tricks2 / 8Opponents'3");
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

		expect(getComputedStyle(ownTrump, "::after").outlineStyle).toBe("solid");
		expect(getComputedStyle(dummyTrump, "::after").outlineStyle).toBe("solid");
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

	it.each<Form>(["compact", "desktop"])(
		"draws a %s side hand's trump frame above the next row, around the shown part of the trump row",
		(form) => {
			const { root } = renderView(sideHandView(), form);
			const trump = [
				...root.querySelectorAll<HTMLElement>(".hand-stack .suit-row.trump"),
			].find((row) => row.getBoundingClientRect().width > 0);
			const next = trump?.nextElementSibling;
			if (!trump || !(next instanceof HTMLElement))
				throw new Error("trump row or the row after it is missing");
			const frame = getComputedStyle(trump, "::after");
			// The frame ends where the next row starts, so its edge does not cross the next row's cards.
			expect(
				trump.getBoundingClientRect().top + Number.parseFloat(frame.height),
			).toBeCloseTo(next.getBoundingClientRect().top, 0);
			// The next row covers the trump cards, but not their frame.
			expect(getComputedStyle(next).zIndex).toBe("auto");
			expect(Number(frame.zIndex)).toBeGreaterThan(0);
		},
	);

	it("draws a desktop side hand's trump label and frame above the cards of the row before them", async () => {
		await page.viewport(1400, 900);
		try {
			const base = sideHandView();
			const view: TableView = {
				...base,
				seats: base.seats.map((player) => {
					if (player.position !== "left" || !player.hand.visible) return player;
					const cards = (suit: string, ranks: string[]) =>
						ranks.map((rank) => ({
							...card(`${suit}${rank}` as Card),
							playable: false,
						}));
					return {
						...player,
						hand: {
							visible: true as const,
							suits: [
								{
									suit: "S",
									symbol: "♠",
									cards: cards("S", ["A", "Q", "8", "7", "5"]),
									trump: false,
								},
								{
									suit: "H",
									symbol: "♥",
									cards: cards("H", ["8", "7", "5", "4"]),
									trump: true,
								},
								{
									suit: "C",
									symbol: "♣",
									cards: cards("C", ["K", "Q", "9"]),
									trump: false,
								},
							],
						},
					};
				}),
			};
			const { root } = renderView(view, "desktop");
			const label = root.querySelector<HTMLElement>(".pos-left .trump-label");
			const trump = root.querySelector<HTMLElement>(
				".pos-left .suit-row.trump",
			);
			const before = label?.previousElementSibling;
			if (!label || !trump || !(before instanceof HTMLElement))
				throw new Error(
					"trump label, trump row or the row before them is missing",
				);
			const labelBox = label.getBoundingClientRect();
			const trumpBox = trump.getBoundingClientRect();
			// The faces of the row before the label reach down behind the label and the top of the frame.
			const faces = [...before.querySelectorAll<HTMLElement>(".face")].map(
				(face) => face.getBoundingClientRect(),
			);
			expect(Math.max(...faces.map((face) => face.bottom))).toBeGreaterThan(
				trumpBox.top,
			);
			const hand = trump.closest<HTMLElement>(".hand");
			if (!hand) throw new Error("side hand is missing");
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
			const pixel = (x: number, y: number) =>
				context.getImageData(
					Math.floor(((x - handBox.left) * image.naturalWidth) / handBox.width),
					Math.floor(
						((y - handBox.top) * image.naturalHeight) / handBox.height,
					),
					1,
					1,
				).data;
			// The label is drawn over the faces of the row before it, and those faces show around its letters: the
			// label has no felt backing. A dark edge around the gold letters keeps them readable on the white faces.
			expect(
				document.elementFromPoint(
					(labelBox.left + labelBox.right) / 2,
					(labelBox.top + labelBox.bottom) / 2,
				),
			).toBe(label);
			let white = 0;
			let dark = 0;
			for (let x = labelBox.left + 1; x < labelBox.right - 1; x += 1)
				for (let y = labelBox.top + 1; y < labelBox.bottom - 1; y += 1) {
					const [red = 0, green = 0, blue = 0] = pixel(x, y);
					if (Math.min(red, green, blue) > 225) white += 1;
					if (Math.max(red, green, blue) < 90) dark += 1;
				}
			expect(white).toBeGreaterThan(0);
			expect(dark).toBeGreaterThan(0);
			// The gold top edge of the frame crosses the faces of the row before it.
			const frame = getComputedStyle(trump, "::after");
			const edge =
				trumpBox.top -
				Number.parseFloat(frame.outlineOffset) -
				Number.parseFloat(frame.outlineWidth) / 2;
			for (const face of faces.filter((face) => face.left < trumpBox.right)) {
				const [red = 0, green = 0, blue = 0] = pixel(
					Math.max(face.left, trumpBox.left) + 4,
					edge,
				);
				expect(red).toBeGreaterThan(180);
				expect(green).toBeGreaterThan(140);
				expect(blue).toBeLessThan(90);
			}
		} finally {
			await page.viewport(414, 896);
		}
	});

	it.each(["M", "XXL"])(
		"draws the trump frame against the trump cards on a phone at %s",
		(size) => {
			document.documentElement.dataset.suitFontSize = size;
			try {
				renderView(sideHandView(), "compact");
				const frames = [
					...document.querySelectorAll<HTMLElement>(
						":is(.mobile-auction-hand, .mobile-board-top) .suit-group.trump, :is(.mobile-board-left, .mobile-board-right) .suit-row.trump",
					),
				].filter((frame) => frame.checkVisibility());
				expect(frames).toHaveLength(3);
				for (const frame of frames) {
					const side = frame.classList.contains("suit-row");
					const style = getComputedStyle(frame, side ? "::after" : null);
					const offset = Number.parseFloat(style.outlineOffset);
					const box = frame.getBoundingClientRect();
					const faces = [...frame.querySelectorAll<HTMLElement>(".face")].map(
						(face) => face.getBoundingClientRect(),
					);
					// The inside edge of the frame is within a pixel of the outer cards, neither apart nor across them.
					const gaps = [
						Math.min(...faces.map((face) => face.left)) - (box.left - offset),
						box.right + offset - Math.max(...faces.map((face) => face.right)),
						Math.min(...faces.map((face) => face.top)) - (box.top - offset),
						// A side row shows only a strip of its cards; a top or bottom frame ends at the bottom of the faces.
						...(side
							? []
							: [
									box.bottom +
										offset -
										Math.max(...faces.map((face) => face.bottom)),
								]),
					];
					for (const gap of gaps) expect(Math.abs(gap)).toBeLessThanOrEqual(1);
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
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
		expect(handlers.undoRequest).not.toHaveBeenCalled();
		root
			.querySelector<HTMLButtonElement>('[data-testid="undo-confirm-send"]')
			?.click();
		expect(handlers.undoRequest).toHaveBeenCalledWith(1);
	});
});
