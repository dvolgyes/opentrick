import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import "../../src/ui/style.css";
import type { Layout } from "../../src/call/device-class";
import { translator } from "../../src/i18n";
import type { Seat } from "../../src/protocol";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import type { tableSection } from "../../src/ui/table";
import type { RoundTripView, TableView } from "../../src/ui/table-model";
import { voiceMeters } from "../../src/ui/voice-meter";
import {
	NS_VULNERABLE,
	playView,
	renderMobile,
	renderView,
} from "./table-mobile-play-fixtures";

afterEach(() => document.body.replaceChildren());

describe("video tile", () => {
	it("shows an empty avatar and the seat and name in a large caption", () => {
		const { root } = renderView(playView(), "desktop");
		const tile = root.querySelector("[data-testid='tile-E']");
		// The caption already names the seat.
		expect(tile?.querySelector(".avatar")?.textContent).toBe("");
		const caption = tile?.querySelector(".tile-caption");
		if (caption === null || caption === undefined)
			throw new Error("no caption");
		expect(caption.textContent).toContain("E - playerE");
		const rem = Number.parseFloat(
			getComputedStyle(document.documentElement).fontSize,
		);
		// Half again the earlier 0.85rem.
		expect(Number.parseFloat(getComputedStyle(caption).fontSize)).toBeCloseTo(
			1.275 * rem,
			1,
		);
		// The larger text still fits in the caption bar.
		expect(caption.scrollHeight).toBeLessThanOrEqual(caption.clientHeight);
	});
});

describe("voice box", () => {
	/** A sine tone as a received audio track; gain 0 gives silence. */
	async function tone(gain: number) {
		// A page without a user gesture keeps its audio suspended.
		await userEvent.click(document.body);
		const context = new AudioContext();
		const oscillator = context.createOscillator();
		const volume = context.createGain();
		volume.gain.value = gain;
		const output = context.createMediaStreamDestination();
		oscillator.connect(volume).connect(output);
		oscillator.start();
		const track = output.stream.getAudioTracks()[0];
		if (track === undefined) throw new Error("no tone track");
		return { track, close: () => context.close() };
	}

	const remote = (
		seat: Seat,
		audio: MediaStreamTrack | undefined,
		video?: MediaStreamTrack,
	) => ({
		seat,
		status: "connected" as const,
		audio,
		video,
		peerSendsAudio: audio !== undefined,
		peerReceivesAudio: true,
		peerSendsVideo: video !== undefined,
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
				send: { audio: true, video: false },
				receive: { audio: true, video: true },
			},
			mic: "on" as const,
			camera: "off" as const,
			localVideo: undefined,
			problem: undefined,
			remotes,
		},
	});

	function render(
		view: TableView,
		voicebox = true,
	): { root: HTMLElement; section: ReturnType<typeof tableSection> } {
		const meters = voiceMeters();
		const rendered = renderView(view, "desktop", undefined, undefined, {
			marks: () => ({ ...DEFAULT_SETTINGS, voicebox }),
			voiceMeters: meters,
		});
		return rendered;
	}

	const box = (root: HTMLElement, seat: Seat) => {
		const found = root.querySelector<HTMLElement>(
			`[data-testid='voicebox-${seat}']`,
		);
		if (found === null) throw new Error(`no voice box of ${seat}`);
		return found;
	};
	const lit = (root: HTMLElement, seat: Seat) =>
		box(root, seat).querySelectorAll("[data-lit]").length;
	const segments = (root: HTMLElement, seat: Seat) =>
		box(root, seat).querySelectorAll(".voicebox-segment").length;

	it("shows the audio settings of connected human players over their tiles", () => {
		const view = playView();
		const { root, section } = render({
			...view,
			seats: view.seats.map((player) =>
				player.seat === "S" ? { ...player, bot: true } : player,
			),
		});
		const state = callView([
			{ ...remote("E", undefined), peerReceivesAudio: false },
			{ ...remote("S", undefined), peerReceivesAudio: false },
		]);
		section.renderCall(state);
		const mic = root.querySelector<HTMLElement>(
			"[data-testid='audio-muted-E']",
		);
		const speaker = root.querySelector<HTMLElement>(
			"[data-testid='audio-deaf-E']",
		);
		expect(mic?.checkVisibility()).toBe(true);
		expect(mic?.title).toBe("Muted");
		expect(speaker?.checkVisibility()).toBe(true);
		expect(speaker?.title).toBe("Can't hear");
		const camera = document
			.createElement("canvas")
			.captureStream()
			.getVideoTracks()[0];
		if (!camera) throw new Error("Missing camera track");
		section.renderCall({
			...state,
			view: {
				...state.view,
				remotes: [
					{ ...remote("E", undefined, camera), peerReceivesAudio: false },
				],
			},
		});
		expect(mic?.checkVisibility()).toBe(true);
		expect(speaker?.checkVisibility()).toBe(true);
		camera.stop();
		expect(
			root
				.querySelector<HTMLElement>("[data-testid='audio-muted-S']")
				?.checkVisibility(),
		).toBe(false);
		const tile = root
			.querySelector<HTMLElement>("[data-testid='tile-E']")
			?.getBoundingClientRect();
		if (!mic || !speaker || !tile) throw new Error("Missing audio indicators");
		expect(mic.getBoundingClientRect().left - tile.left).toBeLessThan(
			tile.width / 4,
		);
		expect(tile.right - speaker.getBoundingClientRect().right).toBeLessThan(
			tile.width / 4,
		);
		section.renderCall({
			...state,
			view: {
				...state.view,
				mic: "off",
				remotes: [
					{
						...remote("E", undefined),
						peerSendsAudio: true,
						peerReceivesAudio: false,
					},
				],
			},
		});
		expect(mic.checkVisibility()).toBe(false);
		expect(speaker.checkVisibility()).toBe(false);
		expect(
			root.querySelector<HTMLElement>(".call-self-off [data-medium='audio']")
				?.title,
		).toBe("No audio is sent; others can't hear you");
		section.renderCall({
			...state,
			view: {
				...state.view,
				requested: {
					...state.view.requested,
					receive: { ...state.view.requested.receive, audio: false },
				},
			},
		});
		expect(
			root.querySelector<HTMLElement>(
				".call-panel .call-toggle[data-way='receive'][data-medium='audio']",
			)?.title,
		).toBe("Silent; you can't hear anyone");
	});

	it("shows only player and bot names in desktop captions while retaining call status for accessibility", () => {
		const view = playView();
		const { root, section } = render({
			...view,
			seats: view.seats.map((player) =>
				player.seat === "S"
					? { ...player, bot: true, label: "S - bot 🤖" }
					: player,
			),
		});
		section.renderCall(
			callView([
				{ ...remote("E", undefined), peerSendsAudio: true },
				remote("S", undefined),
			]),
		);
		for (const [seat, label, status] of [
			["E", "E - playerE", "Audio only"],
			["S", "S - bot 🤖", "Mic off"],
		] as const) {
			const caption = root.querySelector<HTMLElement>(
				`[data-testid='tile-${seat}'] .tile-caption`,
			);
			if (!caption) throw new Error(`Missing caption for ${seat}`);
			const visibleText = [...caption.childNodes]
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => node.textContent)
				.join("");
			expect(visibleText).toBe(label);
			const detail = caption.querySelector<HTMLElement>(".tile-caption-status");
			if (!detail)
				throw new Error(`Missing accessible call status for ${seat}`);
			expect(detail.textContent).toBe(` · ${status}`);
			expect(detail.getBoundingClientRect().width).toBeLessThanOrEqual(1);
			expect(detail.getBoundingClientRect().height).toBeLessThanOrEqual(1);
		}
	});

	it("lights green bars from the middle on the tile of a voice without video, in place of the avatar", async () => {
		const loud = await tone(1);
		const quiet = await tone(0);
		const { root, section } = render(playView());
		section.renderCall(
			callView([remote("E", loud.track), remote("S", quiet.track)]),
		);
		expect(box(root, "E").checkVisibility()).toBe(true);
		expect(
			root.querySelector("[data-testid='tile-E'] .avatar")?.checkVisibility(),
		).toBe(false);
		// A loud tone lights every segment; silence lights none.
		await expect.poll(() => lit(root, "E")).toBe(segments(root, "E"));
		expect(segments(root, "E")).toBeGreaterThan(20);
		expect(box(root, "S").checkVisibility()).toBe(true);
		expect(lit(root, "S")).toBe(0);
		const segment = box(root, "E").querySelector("[data-lit]");
		if (segment === null) throw new Error("no lit segment");
		expect(getComputedStyle(segment).backgroundColor).toBe("rgb(46, 204, 64)");
		// The voice stops arriving: the avatar returns.
		section.renderCall(callView([remote("E", undefined)]));
		expect(box(root, "E").checkVisibility()).toBe(false);
		expect(
			root.querySelector("[data-testid='tile-E'] .avatar")?.checkVisibility(),
		).toBe(true);
		await loud.close();
		await quiet.close();
	});

	it("shows the video and no voice box while the camera picture arrives", async () => {
		const loud = await tone(1);
		const canvas = document.createElement("canvas");
		const camera = canvas.captureStream().getVideoTracks()[0];
		const { root, section } = render(playView());
		section.renderCall(callView([remote("E", loud.track, camera)]));
		expect(box(root, "E").checkVisibility()).toBe(false);
		camera?.stop();
		await loud.close();
	});

	it("shows no voice box while its setting is off", async () => {
		const loud = await tone(1);
		const { root, section } = render(playView(), false);
		section.renderCall(callView([remote("E", loud.track)]));
		expect(box(root, "E").checkVisibility()).toBe(false);
		await loud.close();
	});

	it("covers the bot image of a player who lets the bot play but speaks", async () => {
		const loud = await tone(1);
		const view = playView();
		const { root, section } = render({
			...view,
			seats: view.seats.map((player) =>
				player.seat === "E" ? { ...player, bot: true } : player,
			),
		});
		const overlay = root.querySelector("[data-testid='tile-E'] .bot-overlay");
		expect(overlay?.checkVisibility()).toBe(true);
		section.renderCall(callView([remote("E", loud.track)]));
		expect(box(root, "E").checkVisibility()).toBe(true);
		expect(overlay?.checkVisibility()).toBe(false);
		await loud.close();
	});
});

describe("call presence on the video tile", () => {
	it("shows a viewer outside the call the microphone and camera of a player in it, large and centred on the tile", () => {
		const { root, section } = renderView(playView(), "desktop");
		section.renderCall(
			{ available: false, reason: "" },
			{
				E: { sendsAudio: true, sendsVideo: false },
			},
		);
		const tile = root
			.querySelector("[data-testid='tile-E']")
			?.getBoundingClientRect();
		const badge = root.querySelector<HTMLElement>(
			"[data-testid='call-presence-E']",
		);
		expect(badge?.checkVisibility()).toBe(true);
		const icons = [...(badge?.querySelectorAll(".icon") ?? [])].map((icon) =>
			icon.getBoundingClientRect(),
		);
		expect(icons).toHaveLength(2);
		const rem = Number.parseFloat(
			getComputedStyle(document.documentElement).fontSize,
		);
		// Three times the earlier 0.9rem.
		for (const icon of icons) {
			expect(icon.width).toBeCloseTo(2.7 * rem, 0);
			expect(icon.height).toBeCloseTo(2.7 * rem, 0);
		}
		const box = badge?.getBoundingClientRect();
		if (tile === undefined || box === undefined) throw new Error("no tile");
		expect(box.left + box.width / 2).toBeCloseTo(tile.left + tile.width / 2, 0);
		expect(box.top + box.height / 2).toBeCloseTo(tile.top + tile.height / 2, 0);
	});
});

describe("round trip on the video tile", () => {
	const withRoundTrips = (
		roundTrips: Partial<Record<Seat, RoundTripView>>,
	): HTMLElement => {
		const view = playView();
		return renderView(
			{
				...view,
				seats: view.seats.map((player) => ({
					...player,
					roundTrip: roundTrips[player.seat],
				})),
			},
			"desktop",
		).root;
	};
	const caption = (root: HTMLElement, seat: Seat) =>
		root.querySelector<HTMLElement>(
			`[data-testid='tile-${seat}'] .tile-caption`,
		);
	const badge = (root: HTMLElement, seat: Seat) =>
		root.querySelector<HTMLElement>(`[data-testid='round-trip-${seat}']`);

	const bars = (root: HTMLElement, seat: Seat) =>
		badge(root, seat)?.querySelectorAll<HTMLElement>(".network-bar") ?? [];
	// The colour of each bar from the bottom; a bar that is not lit is grey.
	const lit = (root: HTMLElement, seat: Seat) =>
		[...bars(root, seat)]
			.map(
				(bar) =>
					[
						bar.getBoundingClientRect().bottom,
						getComputedStyle(bar).backgroundColor,
					] as const,
			)
			.sort((a, b) => b[0] - a[0])
			.map(([, colour]) => colour);
	const GREY = "rgb(124, 140, 130)";
	const GREEN = "rgb(46, 204, 64)";

	it("shows each player's network quality as five bars beside the video tile, with the text as the hint", () => {
		const cases = [
			["excellent", "0.05", [GREEN, GREEN, GREEN, GREEN, GREEN]],
			["good", "0.20", [GREEN, GREEN, GREEN, GREEN, GREY]],
			[
				"average",
				"0.40",
				Array(3).fill("rgb(253, 216, 53)").concat(GREY, GREY),
			],
			[
				"poor",
				"1.50",
				Array(2).fill("rgb(255, 152, 0)").concat(GREY, GREY, GREY),
			],
			["breaking-up", "2.50", ["rgb(229, 57, 53)", GREY, GREY, GREY, GREY]],
		] as const;
		for (const [quality, seconds, colours] of cases) {
			const text = `Network: ${quality.replace("-", " ")}`;
			const root = withRoundTrips({
				E: { text, title: `Roundtrip: ${seconds}sec`, quality },
			});
			expect(lit(root, "E"), quality).toEqual(colours);
			expect(badge(root, "E")?.title).toBe(`${text}\nRoundtrip: ${seconds}sec`);
			expect(badge(root, "E")?.getAttribute("aria-label")).toBe(
				`${text}, Roundtrip: ${seconds}sec`,
			);
			expect(caption(root, "E")?.textContent).toBe("E - playerE");
		}
	});

	it("stands the bars outside the tile's right edge, level with its bottom", () => {
		const root = withRoundTrips({
			E: {
				text: "Network: good",
				title: "Roundtrip: 0.20sec",
				quality: "good",
			},
		});
		const tile = root
			.querySelector("[data-testid='tile-E']")
			?.getBoundingClientRect();
		const bar = badge(root, "E")?.getBoundingClientRect();
		expect(tile).toBeDefined();
		expect(bar).toBeDefined();
		if (tile === undefined || bar === undefined) return;
		expect(bar.width).toBeGreaterThan(0);
		expect(bar.left).toBeGreaterThanOrEqual(tile.right);
		expect(bar.left - tile.right).toBeLessThan(8);
		expect(Math.abs(bar.bottom - tile.bottom)).toBeLessThan(1);
		expect(bar.height).toBeGreaterThan(bar.width);
	});

	it("keeps the bars of both right-hand tiles inside the felt", () => {
		const good = {
			text: "Network: good",
			title: "Roundtrip: 0.20sec",
			quality: "good",
		} as const;
		const root = withRoundTrips({ S: good, W: good });
		const felt = root.querySelector(".felt")?.getBoundingClientRect();
		expect(felt).toBeDefined();
		for (const seat of ["S", "W"] as const) {
			const bar = badge(root, seat)?.getBoundingClientRect();
			expect(bar?.width ?? 0, seat).toBeGreaterThan(0);
			if (felt === undefined || bar === undefined) return;
			// At least half a bar of felt to the right of the bars.
			expect(felt.right - bar.right, seat).toBeGreaterThanOrEqual(
				bar.width / 2,
			);
		}
	});

	it("shows five grey bars while the host has not measured the player yet", () => {
		const root = withRoundTrips({
			E: { text: "Network: measuring…", quality: "pending" },
		});
		expect(lit(root, "E")).toEqual(Array(5).fill(GREY));
		expect(badge(root, "E")?.title).toBe("Network: measuring…");
	});

	it("shows nothing for a seat that the host does not measure", () => {
		const { root } = renderView(playView(), "desktop");
		expect(
			root.querySelector("[data-testid='tile-E'] .tile-caption")?.textContent,
		).toBe("E - playerE");
		expect(badge(root, "E")?.checkVisibility() ?? false).toBe(false);
	});
});

describe("mobile folds", () => {
	const shown = (root: HTMLElement, selector: string) =>
		root.querySelector<HTMLElement>(selector)?.checkVisibility() ?? false;

	it.each<Layout>(["desktop", "sideways", "compact"])(
		"scales the scrollable bidding history height with the suit font (%s)",
		(layout) => {
			const base = playView();
			if (!base.auction) throw new Error("missing auction");
			renderView(
				{
					...base,
					phase: "auction",
					auction: {
						...base.auction,
						rows: Array.from({ length: 12 }, () => [
							"1♣",
							"Pass",
							"2♦",
							"Pass",
						]),
					},
				},
				layout,
			);
			const window = document.querySelector<HTMLElement>(".auction-scroll");
			if (!window) throw new Error("missing bidding history");
			try {
				document.documentElement.dataset.suitFontSize = "M";
				const medium = window.getBoundingClientRect().height;
				expect(window.scrollHeight).toBeGreaterThan(window.clientHeight);
				for (const [size, scale] of [
					["S", 0.75],
					["M", 1],
					["L", 1.25],
					["XL", 1.5],
					["XXL", 1.75],
					["XXXL", 2],
				] as const) {
					document.documentElement.dataset.suitFontSize = size;
					expect(window.getBoundingClientRect().height, size).toBeCloseTo(
						medium * scale,
						0,
					);
					if (layout === "compact" && scale <= 1) continue;
					const rows = [
						...window.querySelectorAll<HTMLTableRowElement>("tbody tr"),
					];
					if (size === "XXXL" && window.scrollWidth > window.clientWidth) {
						window.scrollLeft = window.scrollWidth;
						const lastCell =
							rows[0]?.querySelector<HTMLElement>("td:last-child");
						if (!lastCell) throw new Error("missing last bidding cell");
						expect(lastCell.getBoundingClientRect().right).toBeLessThanOrEqual(
							window.getBoundingClientRect().right + 1,
						);
					}
					for (const [index, row] of rows.entries()) {
						const next = rows[index + 1];
						if (!next) continue;
						for (const mark of row.querySelectorAll<HTMLElement>(
							".bid-mark, .call-pass",
						)) {
							const text = document.createRange();
							text.selectNodeContents(mark);
							expect(
								text.getBoundingClientRect().bottom,
								`${layout} ${size}`,
							).toBeLessThanOrEqual(next.getBoundingClientRect().top + 1);
						}
					}
				}
			} finally {
				delete document.documentElement.dataset.suitFontSize;
			}
		},
	);

	it.each<[number, number, string]>([
		[320, 568, "M"],
		[390, 844, "XXXL"],
	])(
		"keeps the bid box on the phone board and the history open during bidding (%i × %i, %s)",
		async (width, height, size) => {
			await page.viewport(width, height);
			document.documentElement.dataset.suitFontSize = size;
			try {
				const base = playView();
				const view = {
					...base,
					phase: "auction" as const,
					bids: [
						{ call: "1C" as const, text: "1♣" },
						{ call: "P" as const, text: "Pass" },
					],
				};
				const { root, section, handlers } = renderMobile(view);
				const board = root.querySelector<HTMLElement>(".mobile-auction-board");
				const hand = root.querySelector<HTMLElement>(".mobile-auction-hand");
				const box = root.querySelector<HTMLElement>(".bid-box");
				const history =
					root.querySelector<HTMLDetailsElement>(".mobile-bids-fold");
				if (!board || !hand || !box || !history)
					throw new Error("missing mobile bidding elements");
				expect(board.contains(box)).toBe(true);
				const boardRect = board.getBoundingClientRect();
				const boxRect = box.getBoundingClientRect();
				expect((boxRect.left + boxRect.right) / 2).toBeCloseTo(
					(boardRect.left + boardRect.right) / 2,
					0,
				);
				expect(boxRect.top).toBeGreaterThanOrEqual(boardRect.top);
				expect(boxRect.bottom).toBeLessThanOrEqual(
					hand.getBoundingClientRect().top + 0.5,
				);
				for (const button of box.querySelectorAll<HTMLElement>(
					".bid-levels button, .bid-calls button",
				)) {
					const rect = button.getBoundingClientRect();
					expect(rect.left).toBeGreaterThanOrEqual(boxRect.left - 0.5);
					expect(rect.right).toBeLessThanOrEqual(boxRect.right + 0.5);
					const text = document.createRange();
					text.selectNodeContents(button);
					expect(
						text.getBoundingClientRect().left,
						button.textContent ?? "",
					).toBeGreaterThanOrEqual(rect.left - 0.5);
					expect(
						text.getBoundingClientRect().right,
						button.textContent ?? "",
					).toBeLessThanOrEqual(rect.right + 0.5);
				}
				expect(history.open).toBe(true);
				history.querySelector<HTMLElement>("summary")?.click();
				expect(history.open).toBe(true);
				box.querySelector<HTMLButtonElement>(".bid-calls .pass")?.click();
				box.querySelector<HTMLButtonElement>(".confirm")?.click();
				expect(handlers.act).toHaveBeenCalledWith({ type: "call", call: "P" });
				section.render(base);
				expect(history.open).toBe(false);
				expect(board.querySelector(".bid-box")).toBeNull();
			} finally {
				delete document.documentElement.dataset.suitFontSize;
				await page.viewport(414, 896);
			}
		},
	);

	it("moves the host's players and bot switches from below the phone board to the Host controls", () => {
		const { root, section } = renderMobile(playView());
		const players = ".mobile-auction-players";
		// A guest keeps the list of connected players below the board.
		expect(root.querySelector(`.mobile-auction > ${players}`)).not.toBeNull();
		expect(section.hostPlayers.children).toHaveLength(0);
		section.setBotControls(true, [], false);
		expect(root.querySelector(players)).toBeNull();
		expect(
			section.hostPlayers.querySelector(`${players} .mobile-players-connected`)
				?.textContent,
		).toMatch(/^Connected: /);
		expect(
			section.hostPlayers.querySelectorAll(".mobile-player-control button"),
		).toHaveLength(3);
		// The desktop has the bot switches on the video tiles, so its Host controls have none.
		section.setForm("desktop");
		expect(section.hostPlayers.children).toHaveLength(0);
		section.setForm("compact");
		section.setBotControls(false, [], false);
		expect(root.querySelector(`.mobile-auction > ${players}`)).not.toBeNull();
		expect(section.hostPlayers.children).toHaveLength(0);
	});

	it("folds the bidding history in play, and a click opens and folds it", () => {
		const { root, section } = renderMobile({
			...playView(),
			phase: "auction",
		});
		const cell = ".mobile-auction-bids .auction td";
		expect(shown(root, cell)).toBe(true);
		section.render(playView());
		expect(shown(root, cell)).toBe(false);
		const title = root.querySelector<HTMLElement>(
			".mobile-auction-bids summary",
		);
		expect(title?.textContent).toBe("Bidding history");
		title?.click();
		expect(shown(root, cell)).toBe(true);
		// A new render in play keeps the player's choice.
		section.render(playView());
		expect(shown(root, cell)).toBe(true);
		title?.click();
		expect(shown(root, cell)).toBe(false);
		section.render({ ...playView(), phase: "auction" });
		expect(shown(root, cell)).toBe(true);
	});

	it("folds the bot switches by default, and a click opens them", () => {
		const { section } = renderMobile({
			...playView(),
			phase: "auction",
		});
		section.setBotControls(true, [], false);
		// The room shows these in its Host controls (src/ui/room-view.ts).
		const controls = section.hostPlayers;
		document.body.append(controls);
		const toggle = ".mobile-player-control button";
		expect(controls.querySelector(toggle)?.textContent).toBe(
			"🤖 Switch to bot",
		);
		expect(shown(controls, toggle)).toBe(false);
		const title = controls.querySelector<HTMLElement>(
			".mobile-auction-players summary",
		);
		expect(title?.textContent).toBe("🤖 Optional automated players");
		title?.click();
		expect(shown(controls, toggle)).toBe(true);
		section.render(playView());
		section.setBotControls(true, ["E"], false);
		expect(shown(controls, toggle)).toBe(true);
	});
});

describe("mobile top bar and round status", () => {
	const roundView = (): TableView => ({
		...playView(),
		board: 3,
		statistics: {
			ew: { won: 3, lost: 1, total: 1250 },
			ns: { won: 1, lost: 3, total: 1000 },
		},
	});
	const records = (root: HTMLElement) =>
		[...root.querySelectorAll(".mobile-round-record")].map(
			(record) => record.textContent,
		);

	it("shows the points of each side after the won and lost balance", () => {
		const { root } = renderMobile(roundView());
		expect(root.querySelector(".mobile-round-number")?.textContent).toBe(
			"Round 3: 2♣",
		);
		expect(records(root)).toEqual(["E-W: +2 (1250p)", "N-S: -2 (1000p)"]);
	});

	it.each<TableView["phase"]>(["auction", "play"])(
		"shows under the points of each side whether that side is vulnerable (%s)",
		(phase) => {
			const { root } = renderMobile({
				...roundView(),
				phase,
				vulnerability: NS_VULNERABLE,
			});
			const sides = [
				...root.querySelectorAll<HTMLElement>(".mobile-round-side"),
			].map((side) => {
				const record = side.querySelector(".mobile-round-record");
				const status = side.querySelector<HTMLElement>(
					".mobile-round-vulnerability",
				);
				if (!record || !status) throw new Error("a record and a status");
				expect(status.checkVisibility()).toBe(true);
				const above = record.getBoundingClientRect();
				const below = status.getBoundingClientRect();
				expect(below.top).toBeGreaterThanOrEqual(above.bottom - 0.5);
				expect(below.left).toBeLessThan(above.right);
				expect(below.right).toBeGreaterThan(above.left);
				return [
					record.textContent,
					status.textContent,
					status.dataset.vulnerable,
					getComputedStyle(status).color,
				];
			});
			expect(sides).toEqual([
				["E-W: +2 (1250p)", "not vulnerable", "false", expect.any(String)],
				["N-S: -2 (1000p)", "vulnerable", "true", "rgb(192, 38, 45)"],
			]);
		},
	);

	it("translates the points mark", () => {
		const { root } = renderView(
			roundView(),
			"compact",
			undefined,
			translator("de"),
		);
		expect(records(root)).toEqual(["O-W: +2 (1250P)", "N-S: -2 (1000P)"]);
	});

	it("shows the contract after the round number while a contract exists", () => {
		const number = (view: TableView) =>
			renderMobile(view).root.querySelector(".mobile-round-number")
				?.textContent;
		expect(number(roundView())).toBe("Round 3: 2♣");
		const doubled = roundView();
		expect(
			number({
				...doubled,
				header: doubled.header && { ...doubled.header, doubling: "X" },
			}),
		).toBe("Round 3: 2♣X");
		expect(
			number({ ...roundView(), phase: "auction", header: undefined }),
		).toBe("Round 3");
	});

	it("marks the side of the viewer bold and underlined", () => {
		const { root } = renderMobile(roundView());
		const marks = [
			...root.querySelectorAll<HTMLElement>(".mobile-round-label"),
		].map((label) => {
			const style = getComputedStyle(label);
			return [
				label.textContent,
				Number(style.fontWeight) >= 700,
				style.textDecorationLine,
			];
		});
		expect(marks).toEqual([
			["E-W", false, "none"],
			["N-S", true, "underline"],
		]);
	});

	it("folds the previous game statistics under the round line, and a click opens and folds them", () => {
		const { root } = renderMobile(roundView());
		const status = root.querySelector<HTMLDetailsElement>(
			'[data-testid="mobile-round-status"]',
		);
		const table = root.querySelector<HTMLElement>(
			'[data-testid="mobile-scores"]',
		);
		const line = status?.querySelector<HTMLElement>(":scope > summary");
		if (!status || !table || !line)
			throw new Error("the round status, its line and its table");
		expect(line.querySelector(".mobile-round-number")).not.toBeNull();
		expect(table.checkVisibility()).toBe(false);
		line.click();
		expect(table.checkVisibility()).toBe(true);
		expect(table.querySelector("caption")?.textContent).toBe(
			"Previous game statistics",
		);
		expect(
			[...table.querySelectorAll("tr")].map((row) =>
				[...row.children].map((cell) => cell.textContent),
			),
		).toEqual([
			["", "E-W", "N-S"],
			["Deals won", "3", "1"],
			["Deals lost", "1", "3"],
			["Total score", "1250", "1000"],
		]);
		const total = table.querySelector<HTMLElement>("tr:last-child th");
		expect(total && Number(getComputedStyle(total).fontWeight)).toBe(700);
		line.click();
		expect(table.checkVisibility()).toBe(false);
	});

	it("puts Reload beside New table, and each button calls its own handler", () => {
		const { root, handlers } = renderMobile(roundView());
		const topbar = root.querySelector<HTMLElement>(".mobile-auction-topbar");
		const named = (name: string) =>
			[...(topbar?.querySelectorAll("button") ?? [])].find(
				(control) =>
					(control.getAttribute("aria-label") ?? control.textContent) === name,
			);
		named("Reload")?.click();
		expect(handlers.reload).toHaveBeenCalledOnce();
		expect(handlers.exit).not.toHaveBeenCalled();
		named("New table")?.click();
		expect(handlers.exit).toHaveBeenCalledOnce();
		expect(handlers.reload).toHaveBeenCalledOnce();
	});
});
