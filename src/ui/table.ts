import { type Card, SUIT_SYMBOLS, suitOf } from "../bridge/cards";
import { callMeaning, conventionCalls, fitsCall } from "../bridge/conventions";
import type { Action } from "../bridge/engine";
import {
	countHandPoints,
	explainHandPoints,
	formatHandPoints,
	type PointSystem,
} from "../bridge/hand-points";
import type { Call } from "../bridge/rules";
import type { RemoteView } from "../call/call";
import type { Form, Layout } from "../call/device-class";
import { englishTranslator, type Locale, type Translate } from "../i18n";
import { SEAT_NAMES, SEATS, type Seat } from "../protocol";
import cardBackBlue from "./assets/bridge-call-card-back-blue.svg?inline";
import cardBackRed from "./assets/bridge-call-card-back-red.svg?inline";
import { guideDialog, guidePanel } from "./bidding-guide";
import { type BotAnimation, botAnimation } from "./bot-animation";
import {
	type CallDisplay,
	type RemoteCallPresence,
	remoteCallStatus,
} from "./call-model";
import { type CallHandlers, callControls, retryButton } from "./call-panel";
import { cardNotation } from "./card-notation";
import { button, el, placeChildren } from "./dom";
import { icon } from "./icons";
import { play } from "./remote-audio";
import { robotArtwork } from "./robot-artwork";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import type {
	AuctionEndView,
	CardView,
	CompletedTrickView,
	ContractHeader,
	HandDisplay,
	Position,
	RoundTripView,
	SeatView,
	TableActionLine,
	TableView,
	TrickView,
	TurnPill,
} from "./table-model";
import {
	blackwoodHint,
	callText,
	comeBackText,
	meaningText,
} from "./table-model";
import {
	litSegments,
	nextShownLevel,
	type VoiceMeters,
	voiceMeters,
} from "./voice-meter";

export interface TableHandlers {
	exit(): void;
	settings(): void;
	shareUrl(): Promise<void>;
	act(action: Action): void;
	undoRequest(board: number): void;
	undoVote(requestId: string, approve: boolean): void;
	undoCancel(requestId: string): void;
	claimRequest(board: number, tricks: number): void;
	claimVote(requestId: string, approve: boolean): void;
	nextBoard?(): void;
	reviewResult?(): void;
	setBotSeat?(seat: Seat, enabled: boolean): void;
	requestAutoplay?(enabled: boolean): void;
	/** Opens the host's player name editor. */
	editPlayerNames?(): void;
	readonly call: CallHandlers;
}

export interface TableSection {
	readonly element: HTMLElement;
	/** The viewer's bot control, placed with the room's bot controls. */
	readonly autoplayControl: HTMLElement;
	/** The status of a guest's bot request, placed below the room controls. */
	readonly autoplayStatus: HTMLElement;
	/** The room's action row moves here while the upright phone board is visible. */
	readonly mobileActions: HTMLElement;
	/**
	 * The room places this in its Host controls. On an upright phone the host's list of connected players and bot
	 * switches moves here, so the board has the room.
	 */
	readonly hostPlayers: HTMLElement;
	/** The score sheet. The room page places it after the table, so the table can fill the screen. */
	/** The right column: bidding history, Tricks, and the previous-game statistics. */
	readonly sidebar: HTMLElement;
	/** The last part of the sidebar. The room page puts the host's debug controls and the bot status here, so their messages push nothing down. */
	readonly sidebarEnd: HTMLElement;
	render(view: TableView): void;
	collecting(): boolean;
	/** Whether bot card play must wait for a card flight or trick collection. */
	playPresentationActive(): boolean;
	dispose(): void;
	setCountdown(seconds: number | undefined): void;
	/**
	 * The call changed: updates only the call controls and the call status of each remote seat. `hostInCall`: this
	 * guest's page sees the host in the room call.
	 */
	renderCall(
		display: CallDisplay,
		presence?: Readonly<Partial<Record<Seat, RemoteCallPresence>>>,
		hostInCall?: boolean,
	): void;
	/** `paused`: this page hosts the bots and they are paused or stopped, so their pictures freeze and show Paused. */
	setBotControls(
		hosting: boolean,
		bots: readonly Seat[],
		paused: boolean,
		pending?: boolean,
	): void;
	setPlayerAutoplay(
		available: boolean,
		enabled: boolean,
		pending: boolean,
		status: string,
	): void;
	/**
	 * The layout changed: the desktop moves the band beside the statistics in the sidebar, and a phone held sideways
	 * also moves the call buttons and the bot switches to the top of the sidebar.
	 */
	setForm(layout: Layout): void;
	/**
	 * The call that the bot would make for the viewer now, or undefined while there is none. The bid box shows it
	 * only while it is legal and the botBidHint setting is on.
	 */
	showBotBid(call: Call | undefined): void;
}

export interface TableOptions {
	readonly cardPlayAnimation?: () => boolean;
	readonly cardPlayDurationMs?: () => number;
	readonly cardPlayRotationDegrees?: () => number;
	readonly cardPlayCenterPercent?: () => number;
	readonly playPresentationChanged?: () => void;
	readonly trickAnimation?: () => boolean;
	readonly trickDisplayMs?: () => number;
	readonly trickWinnerPauseMs?: () => number;
	readonly presentationDone?: () => void;
	/** The scale of the points pill and the bidding guide; the table reads it at each render. */
	readonly pointSystem?: () => PointSystem;
	/** The points pill shows only while this is true; the table reads it at each render. */
	readonly cardPoints?: () => boolean;
	/** The language of the bidding guide. */
	readonly locale?: Locale;
	/**
	 * The turn frames, the turn texts, the network quality, the voice box and the bot animation to show; the table reads
	 * it at each render.
	 */
	readonly marks?: () => TableMarks;
	/** Measures the voices for the voice box; the owner stops it. A table without one makes its own. */
	readonly voiceMeters?: VoiceMeters;
}

export type TableMarks = Pick<
	Settings,
	| "bidTurnFrame"
	| "playTurnFrame"
	| "bidTurnText"
	| "playTurnText"
	| "networkQuality"
	| "voicebox"
	| "botAnimation"
	| "guidePanel"
	| "guideButton"
	| "botBidHint"
	| "bidConfirmation"
	| "hideBidBoxWhenWaiting"
>;

export type PlayedCardStyle =
	| "classic-large"
	| "corners-upright"
	| "corners-oriented";

// Change this one value to switch the played-card design.
const PLAYED_CARD_STYLE: PlayedCardStyle = "corners-oriented";

const TRICK_SWEEP_MS = 1000;
// A phone's compact trick grid has less space between cards than the desktop grid.
const PHONE_LANDING_OUTWARD = 0.25;

/**
 * The call nodes of one remote seat. They outlive the table's re-rendering and only move with their place, so
 * a picture never restarts because the game changed.
 */
interface CallSpot {
	readonly tile: HTMLElement;
	readonly caption: HTMLElement;
	/** Muted: the seat's sound plays only through its audio element. */
	readonly video: HTMLVideoElement;
	readonly botOverlay: HTMLElement;
	readonly botArtwork: HTMLImageElement;
	readonly botFallback: HTMLElement;
	/** In place of the bot image while its setting is on. */
	readonly botAnimation: BotAnimation;
	/** "Paused" over the bot picture while the host's bots are stopped. */
	readonly botPaused: HTMLElement;
	/** The host gives this seat the turn, as the turn frame shows: the bot animation moves. */
	turn: boolean;
	readonly callPresence: HTMLElement;
	readonly audioMuted: HTMLElement;
	readonly audioDeaf: HTMLElement;
	/** The network quality: five bars beside the tile, lit from the bottom. */
	readonly networkBars: HTMLElement;
	/** The voice box: shown in place of the avatar while the seat's voice arrives without video. */
	readonly voicebox: HTMLElement;
	/** The segments of each voice box column, from top to bottom. */
	readonly voiceColumns: readonly (readonly HTMLElement[])[];
	/** The level that the voice box shows now, from 0 to 1. */
	voiceLevel: number;
	readonly botControl: HTMLButtonElement;
	/** Compact: the status beside the seat's name. */
	readonly state: HTMLElement;
	/** The status last shown, so an unchanged status keeps its nodes (and the focus on Retry). */
	shown: string | undefined;
	/** The remote camera track on the video element. */
	track: MediaStreamTrack | undefined;
}

const ACTION_STATUS: Readonly<Record<TableActionLine["state"], string>> = {
	sending: "Sending",
	pending: "Waiting for the host",
	"not-accepted": "Not accepted",
	undone: "Undone after a host change",
};

/** The short name of each bidding system, below the player's name in the auction. */
const SYSTEM_LABELS: Readonly<Record<PointSystem, string>> = {
	hcp: "HCP",
	"hcp-corrected": "corr. HCP",
	vienna: "Vienna",
	reith: "Reith",
	"four-aces": "Four Aces",
	other: "Other",
};

/** The strain that each suit mark or NT label stands for, as the bid box names it. */
const MARK_STRAIN: ReadonlyMap<string, string> = new Map([
	[SUIT_SYMBOLS.C, "C"],
	[SUIT_SYMBOLS.D, "D"],
	[SUIT_SYMBOLS.H, "H"],
	[SUIT_SYMBOLS.S, "S"],
	["NT", "NT"],
]);

/**
 * One cell of the bidding history. A bid such as "1♠" becomes a level and a suit mark, each large and in the strain's
 * colour; Double and Redouble get their own colours, and Pass follows the bid font size.
 */
function auctionCell(text: string, t: Translate): (string | HTMLElement)[] {
	if (text === "Pass") return [el("span", { className: "call-pass" }, t(text))];
	if (text === "Double")
		return [el("span", { className: "call-double" }, t(text))];
	if (text === "Redouble") {
		return [el("span", { className: "call-redouble" }, t(text))];
	}
	const strain = MARK_STRAIN.get(text.slice(1));
	if (!/^[1-7]$/.test(text.slice(0, 1)) || strain === undefined)
		return [t(text)];
	const className = `bid-mark strain strain-${strain}`;
	return [
		el("span", { className }, text.slice(0, 1)),
		el("span", { className }, text.slice(1)),
	];
}

/**
 * Places a call's meaning under the call, inside the screen: from the call's left edge on the left half of the
 * screen, and back from its right edge on the right half. It runs before the meaning shows, so it reads only the call.
 */
function placeMeaning(call: HTMLElement, meaning: HTMLElement): void {
	const box = call.getBoundingClientRect();
	const screen = document.documentElement.clientWidth;
	const margin = 8;
	const left = box.left + box.width / 2 < screen / 2;
	meaning.style.top = `${box.bottom + 4}px`;
	meaning.style.left = left ? `${Math.max(margin, box.left)}px` : "auto";
	meaning.style.right = left
		? "auto"
		: `${Math.max(margin, screen - box.right)}px`;
	const room = left
		? screen - Math.max(margin, box.left) - margin
		: Math.min(screen - margin, box.right) - margin;
	meaning.style.maxWidth = `min(18rem, ${room}px)`;
}

/** The contract's bid, such as "3♠" or "3NTXX", with the suit in the selected colour. */
function contractBid(header: ContractHeader): HTMLElement {
	return el(
		"span",
		{ className: "bid" },
		String(header.level),
		el("span", { className: `strain strain-${header.strain}` }, header.symbol),
		header.doubling,
	);
}

/** A text such as "+2 singleton ♦ (5431)", with each suit symbol in its own mark in the suit's colour. */
function suitMarked(text: string): (string | HTMLElement)[] {
	return text
		.split(/([♠♥♦♣])/u)
		.filter((part) => part !== "")
		.map((part) => {
			const strain = part.length === 1 ? MARK_STRAIN.get(part) : undefined;
			return strain === undefined
				? part
				: el("span", { className: `suit-mark strain-${strain}` }, part);
		});
}

const WAITING_TEXT = "WAITING";
const CONNECTING_TEXT = "CONNECTING TO HOST";

const SEAT_OF_NAME = new Map(
	SEATS.map((seat) => [SEAT_NAMES[seat], seat] as const),
);

/**
 * A reason from the host, in the viewer's language. The host names the seats it waits for by direction, in English
 * (`waitingText`), so the table names them again with their players' `names`.
 */
function translateHostReason(
	text: string,
	names: Readonly<Partial<Record<Seat, string>>>,
	t: Translate,
): string {
	const waiting = /^Waiting for (.+) to come back$/.exec(text);
	if (!waiting) return t(text);
	const seats = (waiting[1] as string)
		.split(/, | and /)
		.map((name) => SEAT_OF_NAME.get(name));
	if (seats.some((seat) => seat === undefined)) return t(text);
	return comeBackText(seats as Seat[], names, t) ?? t(text);
}

function turnPillText(pill: TurnPill, seat: Seat, t: Translate): string {
	const name = t(SEAT_NAMES[seat]);
	if (pill.action === "bid") return t("{seat} TO BID", { seat: name });
	return t("{seat} TO PLAY", { seat: name });
}

/** The card back of a board: red on odd boards and before the first deal, blue on even boards. */
function cardBackFor(board: number): string {
	return board >= 2 && board % 2 === 0 ? cardBackBlue : cardBackRed;
}

/** The segments of the voice box columns: a taller middle column between two shorter ones, as on KITT. */
const VOICE_COLUMNS = [7, 11, 7] as const;

/** One bot animation seed per seat, so two bots at the table never show the same scene. */
const BOT_ANIMATION_SEEDS: Readonly<Record<Seat, number>> = {
	N: 87431,
	E: 52021,
	S: 31337,
	W: 74093,
};

/** The lit bars of each network quality; none is lit before this page measured the player. */
const NETWORK_BARS: Readonly<Record<RoundTripView["quality"], number>> = {
	excellent: 5,
	good: 4,
	average: 3,
	poor: 2,
	"breaking-up": 1,
	pending: 0,
};

/** Lights the bars of `roundTrip` from the bottom, with its text and round trip as the hint; hidden without one. */
function showNetworkBars(
	bars: HTMLElement,
	roundTrip: RoundTripView | undefined,
): void {
	bars.hidden = roundTrip === undefined;
	if (roundTrip === undefined) return;
	const lines =
		roundTrip.title === undefined
			? [roundTrip.text]
			: [roundTrip.text, roundTrip.title];
	bars.dataset.quality = roundTrip.quality;
	bars.title = lines.join("\n");
	bars.setAttribute("aria-label", lines.join(", "));
	for (const [index, bar] of [...bars.children].entries())
		bar.toggleAttribute("data-lit", index < NETWORK_BARS[roundTrip.quality]);
}

/** Left and right hands are vertical stacks; the top and bottom hands are horizontal fans. */
function handDirection(position: Position): "row" | "column" {
	return position === "left" || position === "right" ? "column" : "row";
}

/** The guide calls are listed up to this many in the hint, so that Confirm stays one short line. */
const HINT_CALLS = 3;

/**
 * The hint on Confirm when the chosen call is not one that the guide of `system` gives the viewer's hand: the guide
 * calls, or "Unconventional" when the guide gives none. Where the guide gives the hand no call, "Unconventional" when
 * the hand does not fit the meaning of the chosen call or the guide has no such call there. The [4NT] ask fits any
 * hand, so its hint is its meaning and not a verdict, on two lines.
 */
function conventionHint(
	system: PointSystem,
	view: TableView,
	chosen: Call | undefined,
	t: Translate,
): string | undefined {
	const cards = view.seats.find((seat) => seat.turnPill?.yours)?.pointCards;
	if (chosen === undefined || cards === undefined || view.auction === undefined)
		return undefined;
	const before = view.auction.calls;
	const meaning = callMeaning(system, [...before, chosen], before.length);
	if (meaning?.shape.kind === "blackwood")
		return blackwoodHint(meaning.shape, system, t);
	const guide = conventionCalls(system, cards, before);
	// The guide gives this hand no call here, but the chosen call can still show what the hand lacks.
	if (guide === undefined)
		return fitsCall(system, cards, before, chosen) === false
			? t("(Unconventional)")
			: undefined;
	if (guide.some(({ call }) => call === chosen)) return undefined;
	if (guide.length === 0) return t("(Unconventional)");
	const calls = guide
		.slice(0, HINT_CALLS)
		.map(({ call }) => view.bids.find((bid) => bid.call === call)?.text ?? call)
		.join(", ");
	return t("(Convention: {calls})", { calls });
}

/**
 * The bridge table as the viewer sees it: the own hand at the bottom, the partner at the top, the opponents
 * left and right, each remote seat with its video tile; the auction and the trick in the center; and a dock
 * with the call controls and the game controls.
 */
export function tableSection(
	handlers: TableHandlers,
	playedCardStyle: PlayedCardStyle = PLAYED_CARD_STYLE,
	t: Translate = englishTranslator,
	options: TableOptions = {},
): TableSection {
	const pointSystem =
		options.pointSystem ?? (() => DEFAULT_SETTINGS.pointSystem);
	const cardPoints = options.cardPoints ?? (() => DEFAULT_SETTINGS.cardPoints);
	let shownPointSystem = pointSystem();
	// While the table waits for an absent player, the guide stays closed.
	let guideBlocked = false;
	let shownCardPoints = cardPoints();
	const guide = guideDialog(t, options.locale ?? "en");
	const sideGuide = guidePanel(t, options.locale ?? "en");
	const marks = options.marks ?? (() => DEFAULT_SETTINGS);
	let shownMarks = marks();
	const meters = options.voiceMeters ?? voiceMeters();
	let voiceFrame: number | undefined;
	let voiceFrameAt = 0;
	// The points pill opens this dialog with the calculation, for a screen where no hint shows.
	const pointsTitle = el("h3", {
		className: "points-title",
		attrs: { id: "points-title" },
	});
	const pointsLines = el("ul", { className: "points-lines" });
	const pointsDialog: HTMLDialogElement = el(
		"dialog",
		{
			className: "points-dialog",
			attrs: {
				"aria-labelledby": "points-title",
				"data-testid": "points-dialog",
			},
		},
		pointsTitle,
		pointsLines,
		button(t("OK"), () => pointsDialog.close(), { className: "points-ok" }),
	);
	let autoplayAction: (() => void) | undefined;
	const autoplayDialog: HTMLDialogElement = el(
		"dialog",
		{
			className: "autoplay-dialog",
			attrs: {
				"aria-labelledby": "autoplay-confirm-title",
				"data-testid": "autoplay-confirm",
			},
		},
		el(
			"h3",
			{ attrs: { id: "autoplay-confirm-title" } },
			t("Autoplay my seat?"),
		),
		el(
			"div",
			{ className: "approval-actions" },
			button(
				t("Cancel"),
				() => {
					autoplayAction = undefined;
					autoplayDialog.close();
				},
				{
					className: "approval-accept",
					attrs: { "data-testid": "autoplay-cancel" },
				},
			),
			button(
				t("Autoplay my seat"),
				() => {
					const action = autoplayAction;
					autoplayAction = undefined;
					autoplayDialog.close();
					action?.();
				},
				{
					className: "approval-reject",
					attrs: { "data-testid": "autoplay-confirm-enable" },
				},
			),
		),
	);
	autoplayDialog.addEventListener("cancel", () => {
		autoplayAction = undefined;
	});
	function confirmAutoplay(action: () => void): void {
		if (autoplayDialog.open) return;
		autoplayAction = action;
		autoplayDialog.showModal();
	}
	// An undo request goes to the other players at once, so the player confirms it first.
	let undoConfirmBoard: number | undefined;
	const undoConfirmTitle = el("h2", { attrs: { id: "undo-confirm-title" } });
	const undoConfirmDialog: HTMLDialogElement = el(
		"dialog",
		{
			className: "approval undo-confirm-dialog",
			attrs: {
				"aria-labelledby": "undo-confirm-title",
				"data-testid": "undo-confirm",
			},
		},
		undoConfirmTitle,
		el(
			"div",
			{ className: "approval-actions" },
			button(t("Cancel"), () => undoConfirmDialog.close(), {
				className: "approval-accept",
				attrs: { "data-testid": "undo-confirm-cancel", autofocus: "" },
			}),
			button(
				t("Ask to undo"),
				() => {
					const board = undoConfirmBoard;
					undoConfirmDialog.close();
					// The table can change while the question is open; a request goes only for the same board.
					if (latestView?.undo.canRequest && latestView.board === board)
						handlers.undoRequest(board);
				},
				{
					className: "approval-reject",
					attrs: { "data-testid": "undo-confirm-send" },
				},
			),
		),
	);
	function confirmUndo(view: TableView): void {
		if (undoConfirmDialog.open || !view.undo.canRequest) return;
		undoConfirmBoard = view.board;
		undoConfirmTitle.textContent = view.undo.question;
		undoConfirmDialog.showModal();
	}
	const heading = el("h3", {});
	// The vulnerability of each side, one line each, right of the heading.
	const vulnerability = el("div", {
		className: "table-vulnerability",
		attrs: { "data-testid": "vulnerability" },
	});
	const statusHead = el(
		"div",
		{ className: "table-status-head" },
		heading,
		vulnerability,
	);
	const details = el("p", { className: "note" });
	const prompt = el("p", {
		className: "table-prompt",
		attrs: { role: "status", "data-testid": "table-prompt" },
	});
	const contract = el("p", { className: "contract" });
	const actions = el("ul", {
		className: "table-actions",
		attrs: { "data-testid": "table-actions" },
	});
	const auction = el("table", {
		className: "auction",
		attrs: { "data-testid": "auction" },
	});
	const trick = el("div", {
		className: "trick",
		attrs: { "data-testid": "trick" },
	});
	const trickAnnouncement = el("p", {
		className: "trick-announcement visually-hidden",
		attrs: { role: "status", "aria-live": "polite" },
	});
	const scoringCountdown = el("p", {
		className: "scoring-countdown",
		attrs: { "data-testid": "scoring-countdown", "aria-live": "off" },
	});
	const scoring = el("section", {
		className: "scoring",
		attrs: { "data-testid": "scoring" },
	});
	// The end of the auction: the contract, its declarer and the declaring side's vulnerability, until play starts.
	const auctionEnd = el("section", {
		className: "scoring auction-end",
		attrs: { "data-testid": "auction-end", role: "status" },
	});
	const center = el("div", { className: "center" }, trick);
	// The history is the auction table beside the bid box while bidding, and a sidebar panel afterwards.
	const historyTitle = el(
		"h3",
		{ className: "panel-title" },
		t("Bidding history"),
	);
	// The meanings of the calls stay out of the table, so a cell's text is only its call.
	const callMeanings = el("div", { className: "call-meanings" });
	const auctionScroll = el(
		"div",
		{ className: "auction-scroll" },
		auction,
		callMeanings,
	);
	const bidUndoControls = el("div", { className: "bid-undo" });
	const bidHistory = el(
		"section",
		{ className: "history-panel", attrs: { "data-testid": "bid-history" } },
		historyTitle,
		auctionScroll,
		bidUndoControls,
	);
	const places: Readonly<Record<Position, HTMLElement>> = {
		top: el("div", { className: "place place-top" }),
		left: el("div", { className: "place place-left" }),
		right: el("div", { className: "place place-right" }),
		bottom: el("div", { className: "place place-bottom" }),
	};
	/** The opponents' video tiles sit in the top row, above their columns. */
	const videoSlots: Readonly<Record<Exclude<Position, "bottom">, HTMLElement>> =
		{
			top: el("div", { className: "video-slot video-top" }),
			left: el("div", { className: "video-slot video-left" }),
			right: el("div", { className: "video-slot video-right" }),
		};
	const bidBox = el("div", {
		className: "bid-box",
		attrs: { "data-testid": "bid-box", "aria-label": t("Your call") },
	});
	let latestView: TableView | undefined;
	const bidUndo = button(
		t("Undo"),
		() => {
			if (latestView) confirmUndo(latestView);
		},
		{ className: "undo-call", attrs: { "data-testid": "auction-undo" } },
	);
	const bidUndoCancel = button(t("Cancel undo"), () => {
		const requestId = latestView?.undo.requestId;
		if (requestId !== undefined) handlers.undoCancel(requestId);
	});
	const bidUndoStatus = el("span", { className: "undo-message" });
	bidUndoControls.append(
		el("div", { className: "bid-undo-status" }, bidUndoStatus),
		bidUndo,
		bidUndoCancel,
	);
	let presentationBoard = 0;
	let presentationIndex = 0;
	let presentationAt = 0;
	let presentationSignature = "";
	let lastPlayView: TableView | undefined;
	let incomingView: TableView | undefined;
	let collectingTrick: CompletedTrickView | undefined;
	let collectionOverlay: HTMLElement | undefined;
	let collectionTimer: ReturnType<typeof setTimeout> | undefined;
	const landingOffsets = new Map<
		Seat,
		{ x: number; y: number; rotation: number; centerPercent: number }
	>();
	const flights = new Map<
		Seat,
		{ node: HTMLElement; timer: ReturnType<typeof setTimeout> }
	>();
	type FlightSnapshot =
		| {
				seat: Seat;
				card: string;
				source: DOMRect;
				back: HTMLImageElement | undefined;
				startRotation: number;
				durationMs: number;
				landing: {
					x: number;
					y: number;
					rotation: number;
					centerPercent: number;
				};
		  }
		| undefined;
	let pendingFlight: FlightSnapshot;
	const deferredFlights: NonNullable<FlightSnapshot>[] = [];
	const queuedFlights: NonNullable<FlightSnapshot>[] = [];
	let claimMode: "choose" | "all" | null = null;
	let claimBoard: number | undefined;
	let claimRemaining: number | undefined;
	/** The count that the declarer tapped; "Confirm claim" stays disabled until there is one. */
	let claimCount: number | null = null;
	const claim = button(t("Claim …"), () => {
		if (latestView) openClaimDialog(latestView, "choose");
	});
	const claimAll = button(t("Claim all"), () => {
		if (latestView) openClaimDialog(latestView, "all");
	});
	let undoRequestId: string | undefined;
	let claimRequestId: string | undefined;
	const playUndo = button(
		t("Undo"),
		() => {
			if (latestView) confirmUndo(latestView);
		},
		{ className: "claim-undo", attrs: { "data-testid": "undo-request" } },
	);
	const playControls = el(
		"div",
		{ className: "play-controls" },
		claim,
		claimAll,
		playUndo,
	);
	const undoMessage = el("p", {
		className: "undo-message",
		attrs: { role: "status", "data-testid": "undo-message" },
	});
	const cancelUndo = button(
		t("Cancel undo"),
		() => {
			if (undoRequestId !== undefined) handlers.undoCancel(undoRequestId);
		},
		{ attrs: { "data-testid": "undo-cancel" } },
	);
	const undoPanel = el(
		"section",
		{
			className: "side-panel undo-panel",
			attrs: { "data-testid": "undo-panel" },
		},
		el("h3", { className: "panel-title" }, t("Undo")),
		undoMessage,
		cancelUndo,
	);
	/** The request that the approval panel shows: an undo request, or a claim. */
	let approvalKind: "undo" | "claim" | undefined;
	const approvalVote = (accept: boolean) => {
		if (approvalKind === "undo" && undoRequestId !== undefined)
			handlers.undoVote(undoRequestId, accept);
		if (approvalKind === "claim" && claimRequestId !== undefined)
			handlers.claimVote(claimRequestId, accept);
	};
	const approvalTitle = el("h2", { attrs: { id: "approval-title" } });
	const approvalQuestion = el("p", {
		className: "approval-question",
		attrs: { "aria-live": "polite" },
	});
	const approvalAccept = button("", () => approvalVote(true), {
		className: "approval-accept",
		attrs: { "data-testid": "approval-accept" },
	});
	const approvalReject = button("", () => approvalVote(false), {
		className: "approval-reject",
		attrs: { "data-testid": "approval-reject" },
	});
	const approvalCancel = button(
		t("Cancel undo"),
		() => {
			if (undoRequestId !== undefined) handlers.undoCancel(undoRequestId);
		},
		{ attrs: { "data-testid": "approval-cancel" } },
	);
	// A desktop asks in a dialog in the middle of the screen; a phone game asks directly below the board.
	const approval = el(
		"section",
		{
			className: "approval",
			attrs: {
				"aria-labelledby": "approval-title",
				"data-testid": "approval",
				tabindex: "-1",
			},
		},
		approvalTitle,
		approvalQuestion,
		el(
			"div",
			{ className: "approval-actions" },
			approvalAccept,
			approvalReject,
			approvalCancel,
		),
	);
	const approvalBackdrop = el(
		"div",
		{ className: "approval-backdrop" },
		approval,
	);
	// Absent players: a notice in the middle of a desktop felt, or below a phone's board.
	const waitingText = el("p", { className: "waiting-notice-text" });
	const waitingNotice = el(
		"section",
		{
			className: "waiting-notice",
			attrs: { role: "status", "data-testid": "waiting" },
		},
		waitingText,
	);
	const waitingOverlay = el(
		"div",
		{ className: "waiting-overlay" },
		waitingNotice,
	);
	const claimMessage = el("p", {
		className: "undo-message",
		attrs: { role: "status", "data-testid": "claim-message" },
	});
	const claimCounts = el("div", {
		className: "claim-counts",
		attrs: {
			role: "group",
			"aria-label": t("Number of tricks to claim"),
			"data-testid": "claim-count",
		},
	});
	const confirmClaim = button(
		t("Confirm claim"),
		() => {
			const view = latestView;
			if (
				!claimDialog.open ||
				!view?.claim.canRequest ||
				view.board !== claimBoard ||
				view.claim.maxTricks !== claimRemaining
			)
				return;
			const tricks = claimMode === "all" ? view.claim.maxTricks : claimCount;
			if (tricks === null) return;
			claimMode = null;
			claimDialog.close();
			handlers.claimRequest(view.board, tricks);
		},
		{ className: "approval-reject", attrs: { "data-testid": "claim-confirm" } },
	);
	const claimQuestion = el("h2", { attrs: { id: "claim-confirm-title" } });
	const claimDialog: HTMLDialogElement = el(
		"dialog",
		{
			className: "approval claim-confirm-dialog",
			attrs: {
				"aria-labelledby": "claim-confirm-title",
				"data-testid": "claim-confirm-dialog",
			},
		},
		claimQuestion,
		claimCounts,
		el(
			"div",
			{ className: "approval-actions" },
			button(
				t("Cancel"),
				() => {
					claimMode = null;
					claimDialog.close();
				},
				{
					className: "approval-accept",
					attrs: { "data-testid": "claim-cancel", autofocus: "" },
				},
			),
			confirmClaim,
		),
	);
	claimDialog.addEventListener("cancel", () => {
		claimMode = null;
	});
	function openClaimDialog(view: TableView, mode: "choose" | "all"): void {
		if (claimDialog.open || !view.claim.canRequest) return;
		claimMode = mode;
		claimCount = null;
		claimBoard = view.board;
		claimRemaining = view.claim.maxTricks;
		renderClaimPanel(view);
		claimDialog.showModal();
	}
	const claimPanel = el(
		"section",
		{
			className: "side-panel claim-panel",
			attrs: { "data-testid": "claim-panel" },
		},
		el("h3", { className: "panel-title" }, t("Claim tricks")),
		claimMessage,
	);
	const compactUndo = button(
		"",
		() => {
			if (latestView) confirmUndo(latestView);
		},
		{
			className: "icon-button",
			attrs: {
				"aria-label": t("Undo"),
				title: t("Undo"),
				"data-testid": "undo-compact",
			},
		},
	);
	compactUndo.append(icon("undo"));
	compactUndo.disabled = true;
	const compactClaim = button(
		"",
		() => {
			if (latestView) openClaimDialog(latestView, "choose");
		},
		{
			className: "icon-button",
			attrs: {
				"aria-label": t("Claim tricks"),
				title: t("Claim tricks"),
				"data-testid": "claim-compact",
			},
		},
	);
	compactClaim.append(icon("flag"));
	compactClaim.disabled = true;
	const compactClaimAll = button(
		"",
		() => {
			if (latestView) openClaimDialog(latestView, "all");
		},
		{
			className: "icon-button",
			attrs: {
				"aria-label": t("Claim all remaining tricks"),
				title: t("Claim all remaining tricks"),
				"data-testid": "claim-all-compact",
			},
		},
	);
	compactClaimAll.append(icon("flag"));
	compactClaimAll.disabled = true;
	// During the auction the bidding history sits beside the bid box in this row; render() moves it.
	const bidRow = el("div", { className: "bid-row" }, bidBox);
	const gameSlot = el(
		"div",
		{ className: "game-slot", attrs: { "data-testid": "game-slot" } },
		bidRow,
	);
	const call = callControls(
		handlers.call,
		[compactClaim, compactClaimAll, compactUndo],
		t,
	);
	const audioGroup = (() => {
		const controls = call.row.querySelector<HTMLElement>(".icon-group");
		if (!controls) throw new Error("room call controls are missing");
		return controls;
	})();
	// Icons keep the top bar within a 360 px phone in every language; the names stay for assistive technology.
	const mobileSettings = button("", handlers.settings, {
		className: "icon-button mobile-auction-settings",
		attrs: { "aria-label": t("Settings"), title: t("Settings") },
	});
	mobileSettings.append(icon("settings"));
	const mobileExit = button("", handlers.exit, {
		className: "icon-button mobile-auction-exit",
		attrs: { "aria-label": t("Exit"), title: t("Exit") },
	});
	mobileExit.append(icon("exit"));
	const mobileShareStatus = el("span", {
		className: "visually-hidden",
		attrs: { role: "status", "aria-live": "polite" },
	});
	const mobileShare = button(
		"",
		() => {
			void handlers.shareUrl().then(
				() => {
					mobileShareStatus.textContent = t("Share action completed.");
				},
				(error: unknown) => {
					if (error instanceof DOMException && error.name === "AbortError")
						return;
					mobileShareStatus.textContent = t("Could not share the board URL.");
				},
			);
		},
		{
			className: "icon-button mobile-auction-share",
			attrs: {
				"aria-label": t("Send link to players"),
				title: t("Send link to players"),
			},
		},
	);
	mobileShare.append(icon("share"));
	const mobileTopbar = el(
		"div",
		{ className: "mobile-auction-topbar" },
		audioGroup,
		mobileShare,
		mobileSettings,
		mobileExit,
		mobileShareStatus,
	);
	const mobileActions = el("div", { className: "mobile-room-controls" });
	// The round line opens the previous game statistics, as the desktop sidebar shows them.
	const mobileRoundLine = el("summary", { attrs: { "aria-live": "polite" } });
	const mobileScores = el("table", {
		className: "scores",
		attrs: { "data-testid": "mobile-scores" },
	});
	const mobileRoundStatus = el(
		"details",
		{
			className: "mobile-round-status",
			attrs: { "data-testid": "mobile-round-status" },
		},
		mobileRoundLine,
		mobileScores,
	);
	// On a phone the history folds away when play starts; its title opens and folds it again.
	const mobileBidsTitle = el("summary", {}, t("Bidding history"));
	const mobileBidsFold = el(
		"details",
		{ className: "mobile-bids-fold" },
		mobileBidsTitle,
		bidHistory,
	);
	const mobileBids = el(
		"section",
		{ className: "mobile-auction-bids" },
		mobileBidsFold,
	);
	const mobileBidControls = el("section", {
		className: "mobile-auction-controls",
	});
	const mobileBidOverlay = el("section", { className: "mobile-bid-overlay" });
	const mobileHand = el("section", {
		className: "mobile-auction-hand",
		attrs: { "aria-label": t("Your hand") },
	});
	const mobileOpponentTop = el("div", {
		className: "mobile-board-top",
		attrs: { "aria-hidden": "true" },
	});
	const mobileOpponentLeft = el("div", {
		className: "mobile-board-left",
		attrs: { "aria-hidden": "true" },
	});
	const mobileOpponentRight = el("div", {
		className: "mobile-board-right",
		attrs: { "aria-hidden": "true" },
	});
	// render() sets the role and the label: they depend on what the middle holds.
	const mobileBoardCenter = el("div", { className: "mobile-board-center" });
	const mobileBoard = el(
		"section",
		{
			className: "mobile-auction-board",
			attrs: { "aria-label": t("Game board") },
		},
		mobileOpponentTop,
		mobileOpponentLeft,
		mobileBoardCenter,
		mobileOpponentRight,
		mobileBidOverlay,
		mobileHand,
	);
	const mobileTricks = el("section", {
		className: "mobile-tricks",
		attrs: {
			"aria-label": t("Trick count"),
			"data-testid": "mobile-tricks",
		},
	});
	const connectedPlayers = el("p", { className: "mobile-players-connected" });
	const mobileBotControls = el("div", { className: "mobile-bot-controls" });
	// The bot switches stay folded until their title opens them.
	const mobileBotFold = el(
		"details",
		{ className: "mobile-bot-fold" },
		el("summary", {}, `🤖 ${t("Optional automated players")}`),
		mobileBotControls,
	);
	const mobilePlayers = el(
		"section",
		{
			className: "mobile-auction-players",
			attrs: { "aria-label": t("Other players") },
		},
		connectedPlayers,
		mobileBotFold,
	);
	const hostPlayers = el("div", { className: "host-players" });
	const mobileAuction = el(
		"section",
		{
			className: "mobile-auction",
			attrs: { "data-testid": "mobile-auction" },
		},
		mobileTopbar,
		mobileActions,
		mobileRoundStatus,
		mobileBids,
		mobileBidControls,
		mobileBoard,
		mobileTricks,
		mobilePlayers,
	);
	let compact = false;
	let sideways = false;
	const mobileSideNameObserver = new ResizeObserver(updateMobileSideNameHeight);
	function updateMobileSideNameHeight(): void {
		if (!compact) return;
		const height = Math.max(
			mobileOpponentLeft.querySelector<HTMLElement>(".mobile-board-name")
				?.offsetHeight ?? 0,
			mobileOpponentRight.querySelector<HTMLElement>(".mobile-board-name")
				?.offsetHeight ?? 0,
		);
		const value = `${height}px`;
		if (
			height > 0 &&
			mobileBoard.style.getPropertyValue("--mobile-side-name-height") !== value
		) {
			mobileBoard.style.setProperty("--mobile-side-name-height", value);
		}
	}
	const sidewaysControls = el("div", { className: "sideways-controls" });
	let approvalWasVisible = false;
	let mobileBidsPhase: TableView["phase"] | undefined;
	// The bid picker sits in the felt centre under the bids; the call panel sits in the felt corner (reference layout).
	center.append(gameSlot);
	const felt = el(
		"div",
		{ className: "felt" },
		el(
			"div",
			{ className: "video-row" },
			videoSlots.left,
			videoSlots.top,
			videoSlots.right,
			el("div", { className: "call-slot" }, call.panel),
		),
		el(
			"div",
			{ className: "body" },
			el("div", { className: "col col-left" }, places.left),
			el(
				"div",
				{ className: "col col-centre" },
				places.top,
				center,
				places.bottom,
			),
			el("div", { className: "col col-right" }, places.right),
		),
		// The summaries of the auction and of the game lie on the middle of the green board.
		scoring,
		auctionEnd,
		trickAnnouncement,
		waitingOverlay,
		approvalBackdrop,
	);
	const dock = el("div", { className: "dock" }, call.alert, call.row);
	let callDisplay: CallDisplay | undefined;
	const callSpots = new Map<Seat, CallSpot>();
	const seatNodes = new Map<
		Position,
		{ key: string; handKey: string; node: HTMLElement }
	>();
	let botControlHost = false;
	let botControlSeats: readonly Seat[] = [];
	let botControlPaused = false;
	let playerAutoplayAvailable = false;
	let playerAutoplayEnabled = false;
	let playerAutoplayPending = false;
	let hostAutoplayPending = false;
	let playerAutoplayStatus = "";
	let remoteCallPresence: Readonly<Partial<Record<Seat, RemoteCallPresence>>> =
		{};
	const autoplayButton = button(
		"",
		() => {
			const own = latestView?.seats.find(
				(player) => player.position === "bottom",
			);
			if (botControlHost && own) {
				if (botControlSeats.includes(own.seat))
					handlers.setBotSeat?.(own.seat, false);
				else
					confirmAutoplay(() => {
						if (botControlHost && !botControlSeats.includes(own.seat))
							handlers.setBotSeat?.(own.seat, true);
					});
			} else if (playerAutoplayAvailable && !playerAutoplayPending) {
				if (playerAutoplayEnabled) handlers.requestAutoplay?.(false);
				else
					confirmAutoplay(() => {
						if (
							playerAutoplayAvailable &&
							!playerAutoplayEnabled &&
							!playerAutoplayPending
						)
							handlers.requestAutoplay?.(true);
					});
			}
		},
		{},
	);
	const autoplayStatus = el("span", {
		className: "player-autoplay-status visually-hidden",
		attrs: { role: "status" },
	});
	const autoplayControl = el(
		"div",
		{ className: "autoplay-control" },
		autoplayButton,
	);
	function updateAutoplayControl(): void {
		const own = latestView?.seats.find(
			(player) => player.position === "bottom",
		);
		const enabled =
			botControlHost && own
				? botControlSeats.includes(own.seat)
				: playerAutoplayEnabled;
		autoplayControl.hidden =
			!(botControlHost && own) && !playerAutoplayAvailable;
		const pending = botControlHost
			? hostAutoplayPending
			: playerAutoplayPending;
		autoplayButton.disabled = pending;
		autoplayButton.dataset.testid = botControlHost
			? "host-autoplay-toggle"
			: "player-autoplay-toggle";
		autoplayButton.textContent = t(
			pending
				? "Sending autoplay request…"
				: enabled
					? "Take back control"
					: "Autoplay my seat",
		);
		autoplayStatus.textContent = [
			enabled ? t("Autoplay on") : "",
			botControlHost
				? hostAutoplayPending
					? t("Sending autoplay request…")
					: ""
				: playerAutoplayStatus,
		]
			.filter(Boolean)
			.join(" · ");
	}
	/** The tag and player name of each seat, as the last table view gave them ("E - David"). */
	let seatLabels = new Map<Seat, string>();
	/** The host's last round trip to each seat, as the last table view gave it. */
	let seatRoundTrips = new Map<Seat, RoundTripView | undefined>();

	const scores = el("table", {
		className: "scores",
		attrs: { "data-testid": "scores" },
	});
	const contractHead = el("p", {
		className: "contract-head",
		attrs: { "data-testid": "contract-head" },
	});
	const contractPanel = el(
		"section",
		{ className: "side-panel", attrs: { "data-testid": "contract-panel" } },
		contractHead,
	);
	const tricksPanel = el("section", {
		className: "side-panel tricks-panel",
		attrs: { "data-testid": "tricks-panel" },
	});
	// render() fills the sidebar in order: contract, bidding history, tricks, undo, claim controls, statistics, end.
	// The controls come before the statistics and the debug messages, so these do not push them off the canvas.
	const sidebarEnd = el("div", { className: "sidebar-end" });
	const sidebar = el("div", { className: "table-sidebar" }, sidebarEnd);
	const status = el(
		"div",
		{ className: "table-status" },
		statusHead,
		details,
		prompt,
		contract,
		actions,
	);
	const element = el(
		"section",
		{
			className: "bridge-table",
			attrs: {
				"data-testid": "table",
				"data-played-card-style": playedCardStyle,
			},
		},
		status,
		mobileAuction,
		felt,
		dock,
		pointsDialog,
		autoplayDialog,
		undoConfirmDialog,
		claimDialog,
		call.invite,
		guide.element,
	);
	let desktop = false;
	let phase: TableView["phase"] = "waiting";
	mobileBidsTitle.addEventListener("click", (event) => {
		if (phase === "auction") event.preventDefault();
	});
	/** The desktop keeps board status in the sidebar; the lobby and compact layout show it above the felt. */
	function placeStatus(): void {
		const beside = desktop && phase !== "waiting";
		const hideDetails = beside && phase !== "auction";
		heading.hidden = hideDetails;
		details.hidden = hideDetails;
		prompt.hidden = hideDetails;
		if (beside) {
			const controls = sidebar.querySelector(".room-controls");
			if (controls) {
				if (controls.nextElementSibling !== status) controls.after(status);
			} else if (
				sidebar.firstElementChild !== status &&
				!(sideways && sidewaysControls.nextElementSibling === status)
			) {
				sidebar.prepend(status);
			}
		} else {
			if (element.firstElementChild !== status) element.prepend(status);
		}
	}

	// The guide starts below the board status, which changes height with its prompt and moves with the controls above.
	const sideGuideWatch = new ResizeObserver(alignSideGuide);
	function alignSideGuide(): void {
		sideGuide.element.style.top = `${status.offsetTop + status.offsetHeight}px`;
	}
	/** On the desktop, the bidding guide covers the side panel below the board status during the auction. */
	function placeSideGuide(view: TableView): void {
		sideGuideWatch.disconnect();
		if (
			!desktop ||
			sideways ||
			view.phase !== "auction" ||
			!shownMarks.guidePanel ||
			shownPointSystem === "other"
		) {
			sideGuide.element.remove();
			return;
		}
		sideGuide.show(shownPointSystem);
		// A moved node loses its scroll position, so the guide stays where it is; it lies above the panels anyway.
		if (sideGuide.element.parentElement !== sidebar)
			sidebar.append(sideGuide.element);
		for (
			let node: Element | null = status;
			node !== null;
			node = node.previousElementSibling
		)
			sideGuideWatch.observe(node);
		alignSideGuide();
	}

	function cardButton(card: CardView, suitStart: boolean): HTMLButtonElement {
		const node = button(
			"",
			() => {
				if (
					collectingTrick &&
					(incomingView?.phase !== "play" || !incomingView.yourTurn)
				)
					return;
				if (collectingTrick || flights.size > 0 || queuedFlights.length > 0) {
					clearFlights();
					deferredFlights.length = 0;
					if (collectingTrick) finishCollection();
					else if (incomingView) render(incomingView);
				}
				handlers.act({ type: "play", card: card.card });
			},
			{
				className: suitStart ? "card suit-start" : "card",
				attrs: {
					"data-card": card.card,
					"data-suit": card.suit,
					"aria-label": card.text,
				},
			},
		);
		node.append(
			el(
				"span",
				{ className: "face" },
				el("span", { className: "rank" }, card.rank),
				el("span", { className: "pip" }, SUIT_SYMBOLS[card.suit]),
			),
		);
		node.disabled = !card.playable;
		return node;
	}

	/** Cards overlap: each card shows a strip, and the last card shows its whole face. */
	function handElement(
		hand: HandDisplay,
		position: Position,
		back: string,
	): HTMLElement {
		const side = handDirection(position) === "column";
		// Visible side hands stack their suits, each suit a row of cards; hidden hands keep the back column.
		const node = el("div", {
			className:
				side && hand.visible
					? "hand hand-stack"
					: `hand hand-${handDirection(position)}`,
		});
		if (!hand.visible) {
			node.classList.add("backs");
			node.setAttribute("aria-hidden", "true");
			for (let index = 0; index < hand.count; index++)
				node.append(
					el(
						"span",
						{ className: "back" },
						el(
							"span",
							{ className: "face" },
							el("img", {
								className: "back-art",
								attrs: { src: back, alt: "" },
							}),
						),
					),
				);
			return node;
		}
		if (!side) {
			const visibleSuits = hand.suits.filter((row) => row.cards.length > 0);
			const trumpIsLast = visibleSuits.at(-1)?.trump === true;
			node.dataset.mobileCardLayout = `${visibleSuits.length}-${trumpIsLast ? 1 : 2}`;
			const last = visibleSuits.at(-1)?.cards.at(-1)?.card;
			const trump = visibleSuits.find((row) => row.trump);
			const trumpEnd = trumpIsLast ? undefined : trump?.cards.at(-1)?.card;
			const tenStrips = visibleSuits
				.flatMap((row) => row.cards)
				.filter(
					(item) =>
						item.card.endsWith("T") &&
						item.card !== last &&
						item.card !== trumpEnd,
				).length;
			node.style.setProperty(
				"--phone-gap-count",
				String(Math.max(0, visibleSuits.length - 1)),
			);
			node.style.setProperty(
				"--phone-fixed-ends",
				String(trumpEnd === undefined ? 1 : 2),
			);
			node.style.setProperty("--phone-ten-strips", String(tenStrips));
			// The desktop sizes the shown face of each suit from these counts (src/ui/style.css).
			const strips = visibleSuits.flatMap((row) => row.cards.slice(0, -1));
			node.style.setProperty("--hand-suits", String(visibleSuits.length));
			node.style.setProperty("--hand-strips", String(strips.length));
			node.style.setProperty(
				"--hand-ten-strips",
				String(strips.filter((item) => item.card.endsWith("T")).length),
			);
		}
		if (side) {
			// The phone divides its side column by the longest suit, so that suit's row fits the column.
			node.style.setProperty(
				"--longest-suit",
				String(Math.max(...hand.suits.map((row) => row.cards.length))),
			);
			for (const row of hand.suits) {
				if (row.cards.length === 0) continue;
				// The trump label sits in the flow above its row, so the seat name above the hand is not covered.
				if (row.trump)
					node.append(
						el("span", { className: "trump-label" }, t("Trump suit")),
					);
				node.append(
					el(
						"span",
						{
							className: row.trump
								? "suit-row hand-row suit-group trump"
								: "suit-row hand-row",
							attrs: { "data-suit": row.suit },
						},
						...row.cards.map((card) => cardButton(card, false)),
					),
				);
			}
			return node;
		}
		let first = true;
		for (const row of hand.suits) {
			// The trump group is framed in its own wrapper, with its label above the frame; the wrapper takes the suit gap.
			if (row.trump && row.cards.length > 0) {
				const group = el(
					"span",
					{
						className: first
							? "suit-group trump"
							: "suit-group trump suit-start",
						attrs: { "data-suit": row.suit },
					},
					...row.cards.map((card) => cardButton(card, false)),
				);
				node.append(group);
			} else {
				node.append(
					...row.cards.map((card, index) =>
						cardButton(card, index === 0 && !first),
					),
				);
			}
			if (row.cards.length > 0) first = false;
		}
		return node;
	}

	/** The hand area of a free seat in the lobby: a label, rotated for the side seats. */
	function waitingLabel(position: Position): HTMLElement {
		return el(
			"div",
			{ className: `hand hand-${handDirection(position)} waiting` },
			el("span", { className: "waiting-text" }, t(WAITING_TEXT)),
		);
	}

	/** The points of a hand on the chosen scale; its hint and its dialog give the calculation, one line each. */
	function pointsPill(cards: readonly Card[] | undefined): HTMLElement[] {
		const system = shownPointSystem;
		if (cards === undefined || !shownCardPoints) return [];
		const points = countHandPoints(system, cards);
		const text = formatHandPoints(system, points, t);
		const lines = explainHandPoints(system, cards, t);
		return [
			button(
				text,
				() => {
					pointsTitle.textContent = text;
					pointsLines.replaceChildren(
						...lines.map((line) => el("li", {}, ...suitMarked(line))),
					);
					if (!pointsDialog.open) pointsDialog.showModal();
				},
				{
					className: "hcp-pill",
					attrs: { title: lines.join("\n"), "aria-haspopup": "dialog" },
				},
			),
		];
	}

	/** The red frame marks the seat to act, while the settings frame the turns of this phase. */
	function turnFramed(seat: SeatView): boolean {
		return (
			seat.turn &&
			(latestView?.phase === "auction"
				? shownMarks.bidTurnFrame
				: shownMarks.playTurnFrame)
		);
	}

	function seatElement(
		seat: SeatView,
		callState: HTMLElement | undefined,
		lobby: boolean,
		back: string,
	): HTMLElement {
		const label = el(
			"div",
			{ className: "seat-label" },
			nameShortcut(
				el(
					"span",
					{ className: "name", attrs: { "data-bot": String(seat.bot) } },
					seat.label,
				),
			),
			...seat.tags.map((tag) => el("span", { className: "tag" }, t(tag))),
		);
		if (callState !== undefined) label.append(callState);
		const banner = seat.connecting
			? [
					el(
						"p",
						{ className: "connecting", attrs: { role: "status" } },
						t(CONNECTING_TEXT),
					),
				]
			: [];
		const hand =
			lobby && seat.presence === "free"
				? waitingLabel(seat.position)
				: handElement(seat.hand, seat.position, back);
		// A top or bottom hand shows its trump label in the seat, between the name and the hand, so it is never covered.
		const trumpLabel =
			seat.hand.visible &&
			(seat.position === "top" || seat.position === "bottom") &&
			seat.hand.suits.some((row) => row.trump && row.cards.length > 0)
				? [el("span", { className: "trump-label" }, t("Trump suit"))]
				: [];
		// The points pill shows on the viewer's own hand in the auction and on every hand once the board is over.
		const pills = pointsPill(seat.pointCards);
		// The turn pill marks the seat to call or play. A top or bottom seat shows it next to the trump label; a side
		// seat shows it flat above the name. The settings can turn it off for the auction or for the play.
		const turnPill =
			seat.turnPill &&
			!seat.turnPill.yours &&
			(seat.turnPill.action === "bid"
				? shownMarks.bidTurnText
				: shownMarks.playTurnText)
				? [
						el(
							"span",
							{ className: "turn-pill", attrs: { "data-testid": "turn-pill" } },
							turnPillText(seat.turnPill, seat.seat, t),
						),
					]
				: [];
		const side = seat.position === "left" || seat.position === "right";
		const tags = el(
			"div",
			{ className: "seat-tags" },
			...trumpLabel,
			...turnPill,
		);
		return el(
			"div",
			{
				className: `seat pos-${seat.position}`,
				attrs: {
					"data-testid": `hand-${seat.seat}`,
					"data-visible": String(seat.hand.visible),
					"data-turn": String(seat.turn),
					"data-local-turn": String(seat.turnPill?.yours === true),
					"data-turn-frame": String(turnFramed(seat)),
					"data-presence": seat.presence,
				},
			},
			...pills,
			...(side ? [tags] : []),
			label,
			...banner,
			...(side ? [] : [tags]),
			hand,
		);
	}

	/** The video tile of a remote seat, reserved while video is off, and the compact call status. */
	function callSpot(seat: Seat): CallSpot {
		const known = callSpots.get(seat);
		if (known !== undefined) return known;
		const caption = nameShortcut(
			el("span", { className: "tile-caption" }, t(SEAT_NAMES[seat])),
		);
		const video = el("video", {
			attrs: { "aria-hidden": "true", "data-testid": `video-${seat}` },
		});
		const botArtworkImage = el("img", {
			className: "bot-artwork",
			attrs: { alt: "", "aria-hidden": "true" },
		});
		botArtworkImage.hidden = true;
		const botFallback = el("span", { className: "bot-overlay-fallback" }, "🤖");
		// Each seat has its own scene, and without its font the animation gives way to the image.
		const animation = botAnimation(BOT_ANIMATION_SEEDS[seat], () => {
			const known = callSpots.get(seat);
			if (known !== undefined)
				showBotPicture(known, botControlSeats.includes(seat));
		});
		const botPaused = el(
			"span",
			{ className: "bot-paused", attrs: { "data-testid": "bot-paused" } },
			t("Paused"),
		);
		const botOverlay = el(
			"span",
			{ className: "bot-overlay", attrs: { "aria-hidden": "true" } },
			botArtworkImage,
			botFallback,
			animation.element,
			botPaused,
		);
		botOverlay.hidden = true;
		video.muted = true;
		video.playsInline = true;
		video.autoplay = true;
		video.hidden = true;
		video.dataset.play = "off";
		const botControl = button(`🤖 ${t("Switch to bot")}`, () => {
			handlers.setBotSeat?.(seat, !botControlSeats.includes(seat));
		});
		botControl.className = "tile-bot-control";
		botControl.hidden = !botControlHost;
		const isBot = botControlSeats.includes(seat);
		botControl.textContent = isBot
			? `👱 ${t("Switch to player")}`
			: `🤖 ${t("Switch to bot")}`;
		botControl.dataset.bot = String(isBot);
		const callPresence = el("span", {
			className: "tile-call-presence",
			attrs: { role: "img", "data-testid": `call-presence-${seat}` },
		});
		callPresence.hidden = true;
		const audioMuted = el(
			"span",
			{
				className: "tile-audio-indicator tile-audio-muted",
				attrs: {
					role: "img",
					"aria-label": t("Muted"),
					title: t("Muted"),
					"data-testid": `audio-muted-${seat}`,
				},
			},
			icon("mic", true),
		);
		const audioDeaf = el(
			"span",
			{
				className: "tile-audio-indicator tile-audio-deaf",
				attrs: {
					role: "img",
					"aria-label": t("Can't hear"),
					title: t("Can't hear"),
					"data-testid": `audio-deaf-${seat}`,
				},
			},
			icon("speaker", true),
		);
		audioMuted.hidden = true;
		audioDeaf.hidden = true;
		const networkBars = el(
			"span",
			{
				className: "network-bars",
				attrs: { role: "img", "data-testid": `round-trip-${seat}` },
			},
			...Array.from({ length: NETWORK_BARS.excellent }, () =>
				el("span", { className: "network-bar" }),
			),
		);
		networkBars.hidden = true;
		const voiceColumns = VOICE_COLUMNS.map((count) =>
			Array.from({ length: count }, () =>
				el("span", { className: "voicebox-segment" }),
			),
		);
		const voicebox = el(
			"span",
			{
				className: "voicebox",
				attrs: { "aria-hidden": "true", "data-testid": `voicebox-${seat}` },
			},
			el(
				"span",
				{ className: "voicebox-panel" },
				...voiceColumns.map((segments) =>
					el("span", { className: "voicebox-column" }, ...segments),
				),
			),
		);
		voicebox.hidden = true;
		const tile = el(
			"div",
			{
				className: "tile",
				attrs: {
					"data-seat": seat,
					"data-testid": `tile-${seat}`,
					"data-video": "off",
					"data-voice": "off",
				},
			},
			el("span", { className: "avatar", attrs: { "aria-hidden": "true" } }),
			video,
			voicebox,
			botOverlay,
			callPresence,
			audioMuted,
			audioDeaf,
			caption,
			networkBars,
			botControl,
		);
		const state = el("span", {
			className: "call-state",
			attrs: { "data-testid": `call-state-${seat}` },
		});
		state.hidden = true;
		const spot = {
			tile,
			caption,
			video,
			botOverlay,
			botArtwork: botArtworkImage,
			botFallback,
			botAnimation: animation,
			botPaused,
			turn: false,
			callPresence,
			audioMuted,
			audioDeaf,
			networkBars,
			voicebox,
			voiceColumns,
			voiceLevel: 0,
			botControl,
			state,
			shown: undefined,
			track: undefined,
		};
		callSpots.set(seat, spot);
		showBotPicture(spot, isBot);
		return spot;
	}

	/**
	 * The picture of a bot seat. With its setting on, the bot animation stands in place of the image; it moves only
	 * while the seat has the turn and the bots are not paused, and is frozen otherwise.
	 */
	function showBotPicture(spot: CallSpot, isBot: boolean): void {
		const artworkUrl = robotArtwork();
		const animated = shownMarks.botAnimation && !spot.botAnimation.failed();
		if (artworkUrl !== undefined) spot.botArtwork.src = artworkUrl;
		spot.botArtwork.hidden = !isBot || artworkUrl === undefined || animated;
		spot.botFallback.hidden = artworkUrl !== undefined || animated;
		spot.botPaused.hidden = !isBot || !botControlPaused;
		spot.botAnimation.element.hidden = !isBot || !animated;
		spot.botAnimation.show(
			!isBot || !animated || spot.botOverlay.hidden
				? "off"
				: spot.turn && !botControlPaused
					? "moving"
					: "still",
		);
	}

	/** Each opponent is one column: the video tile above the hand, both on the same centre line. */
	function renderPlace(seat: SeatView, lobby: boolean, back: string): void {
		const place = places[seat.position];
		const { roundTrip: _roundTrip, ...drawnSeat } = seat;
		const key = JSON.stringify([
			drawnSeat,
			lobby,
			back,
			shownPointSystem,
			shownCardPoints,
			shownMarks.bidTurnFrame,
			shownMarks.playTurnFrame,
			shownMarks.bidTurnText,
			shownMarks.playTurnText,
			phase,
			compact,
		]);
		const handKey = JSON.stringify([
			seat.seat,
			seat.hand,
			seat.position,
			lobby && seat.presence === "free",
			back,
			compact,
		]);
		let cached = seatNodes.get(seat.position);
		const unchanged = cached?.key === key;
		if (!unchanged) {
			const state =
				seat.position === "bottom" ? undefined : callSpot(seat.seat).state;
			if (cached?.handKey === handKey) {
				// Update the seat's labels and turn marks without detaching an unchanged, playable hand.
				const fresh = seatElement(seat, undefined, lobby, back);
				const oldHand =
					cached.node.querySelector<HTMLElement>(":scope > .hand");
				const oldState = cached.node.querySelector<HTMLElement>(".call-state");
				fresh.querySelector(":scope > .hand")?.remove();
				if (oldState) fresh.querySelector(".seat-label")?.append(oldState);
				for (const attr of fresh.attributes)
					cached.node.setAttribute(attr.name, attr.value);
				for (const child of [...cached.node.children])
					if (child !== oldHand) child.remove();
				for (const child of [...fresh.children])
					cached.node.insertBefore(child, oldHand);
				cached = { key, handKey, node: cached.node };
			} else {
				cached = { key, handKey, node: seatElement(seat, state, lobby, back) };
			}
			seatNodes.set(seat.position, cached);
		}
		if (!cached) throw new Error("Missing seat node");
		if (seat.position === "bottom") {
			if (cached.node.parentElement !== mobileHand)
				placeChildren(place, cached.node);
			else if (!unchanged) placeChildren(mobileHand, cached.node);
			return;
		}
		const spot = callSpot(seat.seat);
		spot.botOverlay.hidden = !seat.bot;
		spot.tile.dataset.bot = String(seat.bot);
		spot.turn = seat.turn;
		showBotPicture(spot, botControlSeats.includes(seat.seat));
		placeChildren(videoSlots[seat.position], spot.tile);
		placeChildren(place, cached.node);
	}

	/**
	 * A picture only while the call view gives the seat a camera track (handover §7): Receive off, the peer's Send
	 * off, Leave and the compact form all clear it at once, so no last frame stays. The avatar shows otherwise.
	 */
	function renderVideo(
		spot: CallSpot,
		track: MediaStreamTrack | undefined,
	): void {
		if (spot.track !== track) {
			spot.track = track;
			spot.video.srcObject =
				track === undefined ? null : new MediaStream([track]);
			spot.video.hidden = track === undefined;
			spot.video.dataset.play = "off";
			spot.tile.dataset.video = track === undefined ? "off" : "on";
		}
		// A tile that left the page for a moment was paused by the browser.
		if (track !== undefined && spot.video.paused) play(spot.video);
	}

	/**
	 * The voice box while the call view gives the seat an audio track but no picture, on the desktop and with its
	 * setting on. The seat's voice is measured only while its box shows.
	 */
	function renderVoicebox(
		spot: CallSpot,
		seat: Seat,
		remote: RemoteView | undefined,
		form: Form | undefined,
	): void {
		const track =
			shownMarks.voicebox && form === "desktop" && remote?.video === undefined
				? remote?.audio
				: undefined;
		meters.measure(seat, track);
		spot.voicebox.hidden = track === undefined;
		spot.tile.dataset.voice = track === undefined ? "off" : "on";
		if (track !== undefined) {
			startVoiceFrames();
			return;
		}
		spot.voiceLevel = 0;
		lightVoicebox(spot);
	}

	function lightVoicebox(spot: CallSpot): void {
		for (const segments of spot.voiceColumns) {
			const lit = litSegments(spot.voiceLevel, segments.length);
			for (const [index, segment] of segments.entries())
				segment.toggleAttribute("data-lit", lit[index]);
		}
	}

	function startVoiceFrames(): void {
		if (voiceFrame !== undefined) return;
		voiceFrameAt = performance.now();
		voiceFrame = requestAnimationFrame(drawVoiceFrame);
	}

	/** One frame of every shown voice box; the frames stop when no box shows or the table left the page. */
	function drawVoiceFrame(now: number): void {
		voiceFrame = undefined;
		const elapsed = Math.max(0, now - voiceFrameAt);
		voiceFrameAt = now;
		let shown = false;
		for (const [seat, spot] of callSpots) {
			if (spot.voicebox.hidden) continue;
			shown = true;
			spot.voiceLevel = nextShownLevel(
				spot.voiceLevel,
				meters.level(seat),
				elapsed,
			);
			lightVoicebox(spot);
		}
		if (shown && element.isConnected)
			voiceFrame = requestAnimationFrame(drawVoiceFrame);
	}

	/**
	 * The status of each remote seat (handover §4, §7): nothing while the local user is outside the call, else
	 * the link state; a failed link offers Retry.
	 */
	function renderCallStates(): void {
		const view = callDisplay?.available ? callDisplay.view : undefined;
		for (const [seat, spot] of callSpots) {
			const remote = view?.remotes.find((item) => item.seat === seat);
			const isBot =
				latestView?.seats.find((player) => player.seat === seat)?.bot ===
					true || botControlSeats.includes(seat);
			const connected =
				view?.requested.inCall === true &&
				remote?.status === "connected" &&
				!isBot;
			spot.audioMuted.hidden = !connected || remote.peerSendsAudio;
			spot.audioDeaf.hidden =
				!connected ||
				!view.requested.send.audio ||
				view.mic !== "on" ||
				remote.peerReceivesAudio;
			renderVideo(spot, remote?.video);
			renderVoicebox(spot, seat, remote, view?.form);
			const status =
				view !== undefined && remote !== undefined
					? remoteCallStatus(remote, view, t)
					: undefined;
			spot.tile.dataset.call = remote?.status ?? "unknown";
			const presence = remoteCallPresence[seat];
			const showPresence = presence !== undefined && !view?.requested.inCall;
			spot.callPresence.hidden = !showPresence;
			spot.callPresence.replaceChildren(
				icon("mic", !presence?.sendsAudio),
				icon("camera", !presence?.sendsVideo),
			);
			spot.callPresence.setAttribute(
				"aria-label",
				showPresence ? t("In call") : "",
			);
			spot.callPresence.title =
				presence !== undefined && showPresence ? t("In call") : "";
			const label = seatLabels.get(seat) ?? SEAT_NAMES[seat];
			const roundTrip = shownMarks.networkQuality
				? seatRoundTrips.get(seat)
				: undefined;
			const shown = `${label}|${roundTrip?.text ?? ""}|${roundTrip?.title ?? ""}|${roundTrip?.quality ?? ""}|${
				status?.text === undefined
					? ""
					: `${status.text}|${status.connected}|${status.retry}`
			}`;
			if (shown === spot.shown) continue;
			spot.shown = shown;
			spot.caption.replaceChildren(
				label,
				...(status?.text === undefined
					? []
					: [
							el(
								"span",
								{ className: "tile-caption-status" },
								` · ${status.text}`,
							),
						]),
			);
			showNetworkBars(spot.networkBars, roundTrip);
			spot.state.hidden = status?.text === undefined;
			spot.state.replaceChildren(
				icon("phone", !status?.connected),
				status?.text ?? "",
			);
			if (status?.retry)
				spot.state.append(retryButton(seat, handlers.call, false));
		}
	}

	function renderCall(
		display: CallDisplay,
		presence: Readonly<Partial<Record<Seat, RemoteCallPresence>>> = {},
		hostInCall = false,
	): void {
		callDisplay = display;
		remoteCallPresence = presence;
		call.render(display, hostInCall);
		renderCallStates();
	}

	function setBotControls(
		hosting: boolean,
		bots: readonly Seat[],
		paused: boolean,
		pending = false,
	): void {
		botControlHost = hosting;
		hostAutoplayPending = pending;
		botControlSeats = bots;
		botControlPaused = paused;
		updateAutoplayControl();
		for (const [seat, spot] of callSpots) {
			const isBot = bots.includes(seat);
			spot.botOverlay.hidden = !isBot;
			showBotPicture(spot, isBot);
			spot.botControl.hidden = !hosting;
			spot.botControl.textContent = isBot
				? `👱 ${t("Switch to player")}`
				: `🤖 ${t("Switch to bot")}`;
			spot.botControl.dataset.bot = String(isBot);
		}
		renderCallStates();
		showNameShortcuts();
		if (latestView) renderMobilePlayers(latestView);
	}

	/** On a desktop, a click on a player's name opens the host's player name editor. */
	function namesEditable(): boolean {
		return (
			botControlHost &&
			desktop &&
			!sideways &&
			handlers.editPlayerNames !== undefined
		);
	}

	function nameShortcut(target: HTMLElement): HTMLElement {
		target.addEventListener("click", () => {
			if (namesEditable()) handlers.editPlayerNames?.();
		});
		target.addEventListener("keydown", (event) => {
			if (!namesEditable() || (event.key !== "Enter" && event.key !== " "))
				return;
			event.preventDefault();
			handlers.editPlayerNames?.();
		});
		showNameShortcut(target);
		return target;
	}

	function showNameShortcut(target: HTMLElement): void {
		const editable = namesEditable();
		target.classList.toggle("name-edit", editable);
		if (editable) {
			target.setAttribute("role", "button");
			target.tabIndex = 0;
			target.title = t("Player names");
		} else {
			target.removeAttribute("role");
			target.removeAttribute("tabindex");
			target.removeAttribute("title");
		}
	}

	function showNameShortcuts(): void {
		for (const name of element.querySelectorAll<HTMLElement>(
			".seat-label .name",
		))
			showNameShortcut(name);
		for (const spot of callSpots.values()) showNameShortcut(spot.caption);
	}

	function setPlayerAutoplay(
		available: boolean,
		enabled: boolean,
		pending: boolean,
		status: string,
	): void {
		// The room calls this on each of its renders; a render with no change would replace the button under a press.
		if (
			available === playerAutoplayAvailable &&
			enabled === playerAutoplayEnabled &&
			pending === playerAutoplayPending &&
			status === playerAutoplayStatus
		)
			return;
		playerAutoplayAvailable = available;
		playerAutoplayEnabled = enabled;
		playerAutoplayPending = pending;
		playerAutoplayStatus = status;
		updateAutoplayControl();
		if (latestView) render(latestView);
	}

	/**
	 * The viewer's pending choice. A level and a strain build one bid; Pass, X and XX are chosen alone. Nothing is
	 * sent until Confirm. A new choice replaces the previous choice.
	 */
	let pick: { level?: string; strain?: string; call?: Call } = {};
	let shown: TableView | undefined;
	let drawnBidBox = "";
	let botBid: Call | undefined;

	const STRAIN_BUTTONS: readonly {
		readonly strain: string;
		readonly label: string;
		readonly symbol: string;
	}[] = [
		{ strain: "C", label: "Clubs", symbol: SUIT_SYMBOLS.C },
		{ strain: "D", label: "Diamonds", symbol: SUIT_SYMBOLS.D },
		{ strain: "H", label: "Hearts", symbol: SUIT_SYMBOLS.H },
		{ strain: "S", label: "Spades", symbol: SUIT_SYMBOLS.S },
		{ strain: "NT", label: "No trump", symbol: "NT" },
	];

	const SPECIAL_CALLS: readonly {
		readonly call: Call;
		readonly label: string;
	}[] = [
		{ call: "X", label: "Double" },
		{ call: "XX", label: "Redouble" },
		{ call: "P", label: "Pass" },
	];

	function pickButton(
		text: string,
		name: string,
		enabled: boolean,
		pressed: boolean,
		onClick: () => void,
		className: string,
	): HTMLButtonElement {
		const node = button(text, onClick, {
			className,
			attrs: { "aria-label": name, "aria-pressed": String(pressed) },
		});
		node.disabled = !enabled;
		return node;
	}

	function updateBotCall(view: TableView): void {
		const node = bidBox.querySelector<HTMLButtonElement>(".bot-bid");
		if (!node) return;
		const suggestion =
			botBid !== undefined && view.bids.some((bid) => bid.call === botBid)
				? botBid
				: undefined;
		const value = suggestion ?? "";
		if (node.dataset.call === value) return;
		node.dataset.call = value;
		node.replaceChildren(
			`${t("Bot")}: `,
			...(suggestion === undefined
				? ["…"]
				: auctionCell(callText(suggestion), t)),
		);
		node.disabled = suggestion === undefined;
	}

	function renderBidBox(view: TableView): void {
		// A selection belongs to one call position; a new board or a new call clears it.
		if (
			shown?.board !== view.board ||
			shown.at !== view.at ||
			view.undo.requestId !== undefined
		)
			pick = {};
		shown = view;
		bidUndo.disabled =
			view.undo.requestId !== undefined || !view.undo.canRequest;
		bidUndoCancel.hidden = !view.undo.canCancel || compact;
		// The approval dialog asks the question.
		bidUndoStatus.textContent = view.undo.message;
		bidUndoStatus.hidden = view.undo.message === "" || view.undo.canVote;
		// A rebuild between the press and the release of a button loses the click, so draw only what changed.
		const key = JSON.stringify([
			view.board,
			view.bids,
			pick,
			compact,
			shownPointSystem,
			guideBlocked,
			shownMarks.guideButton,
			shownMarks.botBidHint,
			shownMarks.bidConfirmation,
		]);
		if (key === drawnBidBox) {
			updateBotCall(view);
			return;
		}
		drawnBidBox = key;
		const legal = new Set<string>(view.bids.map((bid) => bid.call));
		const bidCall =
			pick.level !== undefined && pick.strain !== undefined
				? `${pick.level}${pick.strain}`
				: undefined;
		const chosen: Call | undefined =
			pick.call ??
			(bidCall !== undefined && legal.has(bidCall)
				? (bidCall as Call)
				: undefined);
		const redraw = (): void => {
			if (shown !== undefined) renderBidBox(shown);
		};
		const select = (selection: typeof pick): void => {
			pick = selection;
			const selected =
				selection.call ??
				(selection.level !== undefined && selection.strain !== undefined
					? `${selection.level}${selection.strain}`
					: undefined);
			if (
				!shownMarks.bidConfirmation &&
				selected !== undefined &&
				legal.has(selected)
			) {
				handlers.act({ type: "call", call: selected as Call });
				return;
			}
			redraw();
		};
		const levels = el(
			"div",
			{ className: "bid-levels" },
			...[1, 2, 3, 4, 5, 6, 7].map((level) => {
				const text = String(level);
				return pickButton(
					text,
					t("Level {level}", { level }),
					view.bids.some((bid) => bid.call.startsWith(text)),
					pick.level === text,
					() => {
						select({ level: text, strain: pick.strain });
					},
					"level",
				);
			}),
		);
		const calls = el(
			"div",
			{ className: "bid-calls" },
			...STRAIN_BUTTONS.map(({ strain, label, symbol }) =>
				pickButton(
					symbol,
					t(label),
					pick.level === undefined
						? view.bids.some((bid) => bid.call.endsWith(strain))
						: legal.has(`${pick.level}${strain}`),
					pick.strain === strain,
					() => {
						select({ level: pick.level, strain });
					},
					`strain strain-${strain}`,
				),
			),
			...SPECIAL_CALLS.map(({ call, label }) =>
				pickButton(
					call === "P" ? t("PASS") : call,
					t(label),
					legal.has(call),
					pick.call === call,
					() => {
						select({ call });
					},
					call === "P" ? "pass" : call === "X" ? "double" : "redouble",
				),
			),
		);
		const chosenText = view.bids.find((bid) => bid.call === chosen)?.text;
		const confirm = button(
			chosenText === undefined ? t("Confirm") : `${t("Confirm")} ${chosenText}`,
			() => {
				if (chosen !== undefined) handlers.act({ type: "call", call: chosen });
			},
			{ className: "confirm", attrs: { "data-call": chosen ?? "" } },
		);
		if (chosen === "P" && chosenText !== undefined)
			confirm.replaceChildren(
				`${t("Confirm")} `,
				el("span", { className: "card-notation" }, chosenText),
			);
		else confirm.replaceChildren(...cardNotation(confirm.textContent ?? ""));
		const hint = conventionHint(shownPointSystem, view, chosen, t);
		if (hint !== undefined)
			confirm.append(
				" ",
				el(
					"span",
					{
						className: hint.includes("\n")
							? "convention-hint convention-lines"
							: "convention-hint",
					},
					...cardNotation(hint),
				),
			);
		confirm.disabled = chosen === undefined || !legal.has(chosen);
		const guideOpen = button(t("Guide"), () => guide.open(shownPointSystem), {
			className: "guide-open",
			attrs: { "aria-haspopup": "dialog" },
		});
		guideOpen.disabled = guideBlocked;
		const guideRow = el("div", { className: "bid-guide" });
		if (shownMarks.guideButton) guideRow.append(guideOpen);
		if (shownMarks.botBidHint) {
			const botCall = button(
				"",
				() => {
					const suggestion =
						botBid !== undefined &&
						shown?.bids.some((bid) => bid.call === botBid)
							? botBid
							: undefined;
					if (suggestion === undefined) return;
					select(
						/^[1-7]/.test(suggestion)
							? { level: suggestion.slice(0, 1), strain: suggestion.slice(1) }
							: { call: suggestion },
					);
				},
				{
					className: "bot-bid",
					attrs: {
						"data-testid": "bot-bid",
						title: t(
							shownMarks.bidConfirmation
								? "Select the bot's call. Confirm sends it."
								: "Make the bot's suggested call.",
						),
					},
				},
			);
			guideRow.append(botCall);
		}
		const ownCards = view.seats.find(
			(player) => player.turnPill?.yours,
		)?.pointCards;
		const transfer =
			ownCards && view.auction
				? conventionCalls(shownPointSystem, ownCards, view.auction.calls)?.find(
						({ meaning }) =>
							meaning.shape.kind === "accept" ||
							meaning.shape.kind === "short-suit",
					)
				: undefined;
		const explanation = transfer
			? el(
					"p",
					{
						className: "bid-explanation",
						attrs: { "data-testid": "transfer-explanation" },
					},
					...cardNotation(
						`${callText(transfer.call)}: ${meaningText(transfer.meaning, shownPointSystem, t)}`,
					),
				)
			: undefined;
		bidBox.replaceChildren(
			...(guideRow.childElementCount > 0 ? [guideRow] : []),
			levels,
			calls,
			...(shownMarks.bidConfirmation
				? [el("div", { className: "bid-actions" }, confirm)]
				: []),
			...(explanation ? [explanation] : []),
		);
		updateBotCall(view);
	}

	let drawnClaimCounts = "";
	function renderClaimPanel(view: TableView): void {
		if (
			claimDialog.open &&
			(!view.claim.canRequest ||
				view.board !== claimBoard ||
				view.claim.maxTricks !== claimRemaining)
		) {
			claimMode = null;
			claimDialog.close();
		}
		const choosing = claimMode === "choose" && view.claim.canRequest;
		const confirmingAll = claimMode === "all" && view.claim.canRequest;
		if (choosing) {
			if (claimCount !== null && claimCount > view.claim.maxTricks)
				claimCount = null;
			const key = `${view.claim.maxTricks}:${claimCount}`;
			// A button for each count from none to every remaining trick.
			if (key !== drawnClaimCounts)
				claimCounts.replaceChildren(
					...Array.from({ length: view.claim.maxTricks + 1 }, (_, count) =>
						button(
							String(count),
							() => {
								claimCount = count;
								if (latestView) renderClaimPanel(latestView);
							},
							{
								attrs: {
									"aria-pressed": String(count === claimCount),
									"data-testid": `claim-count-${count}`,
								},
							},
						),
					),
				);
			drawnClaimCounts = key;
		}
		claimQuestion.textContent = choosing
			? t("How many of the remaining {count} tricks will you take?", {
					count: view.claim.maxTricks,
				})
			: confirmingAll
				? t("Claim all {count} remaining tricks?", {
						count: view.claim.maxTricks,
					})
				: "";
		claimMessage.textContent = view.claim.message;
		claimCounts.hidden = !choosing;
		confirmClaim.disabled = choosing && claimCount === null;
		// The approval panel asks the players who decide the claim.
		claimPanel.hidden = view.claim.canVote || claimMessage.textContent === "";
	}

	/**
	 * Asks a player who decides an undo or a claim. A compact screen shows the panel directly below `below`, also to
	 * the requester of an undo, who can cancel it there. A desktop shows a dialog in the middle of the felt to the
	 * players who decide; the sidebar stays usable.
	 */
	function renderApproval(
		view: TableView,
		below: HTMLElement | undefined,
	): void {
		const undoOpen = view.undo.requestId !== undefined;
		approvalKind =
			view.undo.canVote || (compact && undoOpen)
				? "undo"
				: view.claim.canVote
					? "claim"
					: undefined;
		if (below !== undefined) {
			if (below.nextElementSibling !== approval) below.after(approval);
		} else if (approval.parentElement !== approvalBackdrop) {
			approvalBackdrop.append(approval);
		}
		const visible = approvalKind !== undefined;
		approval.hidden = !visible;
		approvalBackdrop.hidden = below !== undefined || !visible;
		approval.setAttribute("role", below === undefined ? "dialog" : "region");
		const undo = approvalKind === "undo";
		approvalTitle.textContent = t(undo ? "Undo request" : "Claim tricks");
		approvalQuestion.textContent = undo
			? view.undo.message
			: view.claim.message;
		approvalAccept.textContent = t(undo ? "Approve undo" : "Accept claim");
		approvalReject.textContent = t(undo ? "Reject undo" : "Reject claim");
		const canVote = undo ? view.undo.canVote : view.claim.canVote;
		approvalAccept.hidden = !canVote;
		approvalReject.hidden = !canVote;
		approvalCancel.hidden = !undo || !view.undo.canCancel;
		if (visible && !approvalWasVisible) approval.focus();
		approvalWasVisible = visible;
	}

	/**
	 * Names the players a dealt board waits for: in the middle of a desktop felt, where clicks pass through to the
	 * table, or after the approval panel below `below` on a compact screen.
	 */
	function renderWaiting(
		view: TableView,
		below: HTMLElement | undefined,
	): void {
		if (below !== undefined) {
			if (approval.nextElementSibling !== waitingNotice)
				approval.after(waitingNotice);
		} else if (waitingNotice.parentElement !== waitingOverlay) {
			waitingOverlay.append(waitingNotice);
		}
		const visible = view.waiting !== "";
		waitingNotice.hidden = !visible;
		waitingOverlay.hidden = below !== undefined || !visible;
		waitingText.textContent = visible ? view.waiting : "";
	}

	function clearFlights(): void {
		for (const flight of flights.values()) {
			clearTimeout(flight.timer);
			flight.node.remove();
		}
		flights.clear();
		queuedFlights.length = 0;
		pendingFlight = undefined;
		const win = element.ownerDocument.defaultView;
		win?.removeEventListener("resize", cancelFlights);
		win?.removeEventListener("scroll", cancelFlights, true);
		win?.visualViewport?.removeEventListener("resize", cancelFlights);
		win?.visualViewport?.removeEventListener("scroll", cancelFlights);
		element.ownerDocument.removeEventListener(
			"visibilitychange",
			onFlightVisibility,
		);
	}

	function cancelFlights(): void {
		clearFlights();
		deferredFlights.length = 0;
		if (collectingTrick && element.ownerDocument.hidden) finishCollection();
		else if (collectingTrick && !collectionOverlay)
			startCollection(collectingTrick);
		else if (incomingView) render(incomingView);
	}

	function onFlightVisibility(): void {
		if (element.ownerDocument.hidden) cancelFlights();
	}

	/** Capture the old hand before its played card is removed by the next render. */
	function prepareFlight(view: TableView): void {
		const previous = latestView;
		const win = element.ownerDocument.defaultView;
		if (
			!previous ||
			!win ||
			!(options.cardPlayAnimation?.() ?? DEFAULT_SETTINGS.cardPlayAnimation) ||
			view.board !== previous.board ||
			view.at <= presentationAt ||
			(previous.phase !== "play" &&
				!(previous.phase === "auction" && view.phase === "play")) ||
			element.ownerDocument.hidden ||
			win.matchMedia?.("(prefers-reduced-motion: reduce)").matches
		)
			return;
		const before = previous.trick?.finished
			? []
			: (previous.trick?.cards ?? []);
		const after =
			view.completedTrick && view.completedTrick.index > presentationIndex
				? view.completedTrick.cards
				: (view.trick?.cards ?? []);
		if (
			after.length !== before.length + 1 ||
			before.some(
				(card, i) =>
					card.seat !== after[i]?.seat || card.card !== after[i]?.card,
			)
		)
			return;
		const played = after.at(-1);
		if (!played) return;
		if (
			collectingTrick &&
			(view.trick?.finished !== false ||
				before.length !== deferredFlights.length)
		)
			return;
		const seat = previous.seats.find((entry) => entry.seat === played.seat);
		const hand = compact
			? {
					bottom: mobileHand,
					top: mobileOpponentTop,
					left: mobileOpponentLeft,
					right: mobileOpponentRight,
				}[played.position].querySelector<HTMLElement>(".hand")
			: seatNodes
					.get(played.position)
					?.node.querySelector<HTMLElement>(".hand");
		if (!seat || !hand) return;
		const source = seat.hand.visible
			? [...hand.querySelectorAll<HTMLElement>(".card")]
					.find((card) => card.dataset.card === played.card)
					?.querySelector<HTMLElement>(".face")
			: hand.querySelector<HTMLElement>(".back:last-child .face");
		if (!source) return;
		const rect = source.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const startRotation =
			!seat.hand.visible &&
			(played.position === "left" || played.position === "right")
				? 90
				: 0;
		const angle = Math.random() * Math.PI * 2;
		const radius = Math.sqrt(Math.random()) * 0.18;
		const deviation =
			options.cardPlayRotationDegrees?.() ??
			DEFAULT_SETTINGS.cardPlayRotationDegrees;
		const flight = {
			seat: played.seat,
			card: played.card,
			source: rect,
			startRotation,
			durationMs:
				options.cardPlayDurationMs?.() ?? DEFAULT_SETTINGS.cardPlayDurationMs,
			back: seat.hand.visible
				? undefined
				: (source.querySelector<HTMLImageElement>("img")?.cloneNode(true) as
						| HTMLImageElement
						| undefined),
			landing: {
				x: Math.cos(angle) * radius,
				y: Math.sin(angle) * radius,
				rotation:
					startRotation +
					(startRotation
						? 270 // Side backs start a quarter-turn sideways; land the revealed face upright.
						: played.position === "top" ||
								played.position === "bottom" ||
								seat.tags.includes("Dummy")
							? 360
							: 180) +
					(Math.random() * 2 - 1) * deviation,
				centerPercent:
					options.cardPlayCenterPercent?.() ??
					DEFAULT_SETTINGS.cardPlayCenterPercent,
			},
		};
		if (collectingTrick) deferredFlights.push(flight);
		else {
			if (before.length === 0) landingOffsets.clear();
			pendingFlight = flight;
			landingOffsets.set(played.seat, flight.landing);
		}
	}

	function startFlight(): void {
		const pending = pendingFlight;
		pendingFlight = undefined;
		if (!pending) return;
		const target = [...trick.querySelectorAll<HTMLElement>(".played")].find(
			(node) =>
				node.dataset.seat === pending.seat &&
				node.dataset.card === pending.card,
		);
		const win = element.ownerDocument.defaultView;
		if (!target || !win) return;
		if (flights.size > 0) {
			queuedFlights.push(pending);
			target.style.visibility = "hidden";
			return;
		}
		const destination = target.getBoundingClientRect();
		if (!destination.width || !destination.height) return;
		const board = compact ? mobileBoard : felt;
		const boardRect = board.getBoundingClientRect();
		const scale =
			board.offsetWidth > 0 ? boardRect.width / board.offsetWidth : 1;
		const width = target.offsetWidth * scale;
		const height = target.offsetHeight * scale;
		if (!width || !height) return;
		const moving = el("div", {
			className: "bridge-table card-flight",
			attrs: {
				"aria-hidden": "true",
				"data-played-card-style": playedCardStyle,
			},
		});
		Object.assign(moving.style, {
			left: `${destination.left + destination.width / 2 - width / 2}px`,
			top: `${destination.top + destination.height / 2 - height / 2}px`,
			width: `${width}px`,
			height: `${height}px`,
			zIndex: String(9999 + Number(target.style.zIndex || 0)),
		});
		const computed = win.getComputedStyle(target);
		for (const name of [
			"--card-w",
			"--card-h",
			"--rank-size",
			"--suit-font-scale",
			"--card-bg",
			"--card-fg",
			"--line",
			"--board-card-shadow",
		])
			moving.style.setProperty(name, computed.getPropertyValue(name));
		const face = target.cloneNode(true) as HTMLElement;
		Object.assign(face.style, {
			left: "0",
			top: "0",
			transform: "",
			visibility: "",
			width: "100%",
			height: "100%",
			fontSize: `${parseFloat(computed.fontSize) * scale}px`,
		});
		const originalText = target.querySelectorAll<HTMLElement>(
			".rank-corner, .played-center-suit",
		);
		const copiedText = face.querySelectorAll<HTMLElement>(
			".rank-corner, .played-center-suit",
		);
		originalText.forEach((part, index) => {
			const copy = copiedText[index];
			if (copy)
				copy.style.fontSize = `${parseFloat(win.getComputedStyle(part).fontSize) * scale}px`;
		});
		const rotor = el("div", { className: "card-flight-rotor" }, face);
		if (pending.back) {
			pending.back.className = "card-flight-back";
			rotor.append(pending.back);
		}
		moving.append(rotor);
		element.ownerDocument.body.append(moving);
		if (flights.size === 0) {
			win.addEventListener("resize", cancelFlights);
			win.addEventListener("scroll", cancelFlights, true);
			win.visualViewport?.addEventListener("resize", cancelFlights);
			win.visualViewport?.addEventListener("scroll", cancelFlights);
			element.ownerDocument.addEventListener(
				"visibilitychange",
				onFlightVisibility,
			);
		}
		target.style.visibility = "hidden";
		const x =
			pending.source.left +
			pending.source.width / 2 -
			destination.left -
			destination.width / 2;
		const y =
			pending.source.top +
			pending.source.height / 2 -
			destination.top -
			destination.height / 2;
		const rotation = landingOffsets.get(pending.seat)?.rotation ?? 180;
		const sourceWidth = pending.startRotation
			? pending.source.height
			: pending.source.width;
		const sourceHeight = pending.startRotation
			? pending.source.width
			: pending.source.height;
		const timing = {
			duration: pending.durationMs,
			easing: "cubic-bezier(0.333333, 0.666667, 0.666667, 1)",
			fill: "forwards" as const,
		};
		moving.animate(
			[
				{
					transform: `translate(${x}px, ${y}px) rotate(${pending.startRotation}deg) scale(${sourceWidth / width}, ${sourceHeight / height})`,
				},
				{ transform: `translate(0px, 0px) rotate(${rotation}deg) scale(1, 1)` },
			],
			timing,
		);
		if (pending.back) {
			rotor.animate(
				[
					{ transform: "perspective(800px) rotateY(180deg)" },
					{ transform: "perspective(800px) rotateY(0deg)" },
				],
				timing,
			);
			// Switch the sides at the edge-on point even if the browser paints both backfaces.
			face.animate(
				[
					{ opacity: 0, offset: 0, easing: "steps(1, end)" },
					{ opacity: 1, offset: 0.5 },
					{ opacity: 1, offset: 1 },
				],
				timing,
			);
			pending.back.animate(
				[
					{ opacity: 1, offset: 0, easing: "steps(1, end)" },
					{ opacity: 0, offset: 0.5 },
					{ opacity: 0, offset: 1 },
				],
				timing,
			);
		}
		const timer = setTimeout(() => {
			moving.remove();
			flights.delete(pending.seat);
			const landed = [...trick.querySelectorAll<HTMLElement>(".played")].find(
				(node) =>
					node.dataset.seat === pending.seat &&
					node.dataset.card === pending.card,
			);
			if (landed) landed.style.visibility = "";
			while (flights.size === 0 && queuedFlights.length > 0) {
				pendingFlight = queuedFlights.shift();
				startFlight();
			}
			if (flights.size === 0) {
				clearFlights();
				if (collectingTrick && !collectionOverlay)
					startCollection(collectingTrick);
			}
			if (incomingView) render(incomingView);
		}, pending.durationMs);
		flights.set(pending.seat, { node: moving, timer });
	}

	/** Show current cards separately from the fixed snapshot used for collection. */
	function showTrick(view: TableView): void {
		if (collectingTrick) {
			if (pendingFlight) {
				renderTrick(collectingTrick);
				startFlight();
			}
			if (!collectionOverlay && flights.size === 0)
				startCollection(collectingTrick);
			return;
		}
		renderTrick(view.trick?.finished ? undefined : view.trick);
		startFlight();
	}

	function finishCollection(redraw = true): void {
		clearTimeout(collectionTimer);
		collectionTimer = undefined;
		collectionOverlay?.remove();
		collectionOverlay = undefined;
		const win = element.ownerDocument.defaultView;
		win?.removeEventListener("resize", cancelCollection);
		win?.removeEventListener("scroll", cancelCollection, true);
		win?.visualViewport?.removeEventListener("resize", cancelCollection);
		win?.visualViewport?.removeEventListener("scroll", cancelCollection);
		element.ownerDocument.removeEventListener(
			"visibilitychange",
			onCollectionVisibility,
		);
		const wasCollecting = collectingTrick !== undefined;
		collectingTrick = undefined;
		if (wasCollecting) landingOffsets.clear();
		if (redraw && wasCollecting && incomingView) {
			const lead = incomingView.trick;
			if (
				lead &&
				!lead.finished &&
				deferredFlights.length > 0 &&
				lead.cards.length === deferredFlights.length &&
				deferredFlights.every(
					(flight, index) =>
						lead.cards[index]?.seat === flight.seat &&
						lead.cards[index]?.card === flight.card,
				)
			) {
				for (const flight of deferredFlights)
					landingOffsets.set(flight.seat, flight.landing);
				pendingFlight = deferredFlights[0];
				queuedFlights.push(...deferredFlights.slice(1));
			}
			deferredFlights.length = 0;
			render(incomingView);
			options.presentationDone?.();
		} else if (wasCollecting) deferredFlights.length = 0;
	}

	function cancelCollection(): void {
		deferredFlights.length = 0;
		finishCollection();
	}
	function onCollectionVisibility(): void {
		if (element.ownerDocument.hidden) cancelCollection();
	}

	function startCollection(completed: CompletedTrickView): void {
		renderTrick(completed);
		const nodes = [...trick.querySelectorAll<HTMLElement>(".played")];
		if (nodes.length !== 4 || !trick.isConnected) {
			finishCollection();
			return;
		}
		const doc = element.ownerDocument;
		const win = doc.defaultView;
		if (!win) {
			finishCollection();
			return;
		}
		const viewport = win.visualViewport;
		const board = compact ? mobileBoard : felt;
		const boardRect = board.getBoundingClientRect();
		const { width, height } = boardRect;
		if (width === 0 || height === 0) {
			finishCollection();
			return;
		}
		const rects = nodes.map((node) => node.getBoundingClientRect());
		const margin =
			Math.max(...rects.map((rect) => Math.hypot(rect.width, rect.height))) + 8;
		const endpoint = {
			top: [width / 2, -margin],
			right: [width + margin, height / 2],
			bottom: [width / 2, height + margin],
			left: [-margin, height / 2],
		}[completed.winnerPosition];
		const overlay = el("div", {
			className: "bridge-table trick-collection-overlay",
			attrs: {
				"aria-hidden": "true",
				"data-played-card-style": playedCardStyle,
			},
		});
		Object.assign(overlay.style, {
			left: `${boardRect.left}px`,
			top: `${boardRect.top}px`,
			width: `${width}px`,
			height: `${height}px`,
		});
		collectionOverlay = overlay;
		doc.body.append(overlay);
		win.addEventListener("resize", cancelCollection);
		win.addEventListener("scroll", cancelCollection, true);
		viewport?.addEventListener("resize", cancelCollection);
		viewport?.addEventListener("scroll", cancelCollection);
		doc.addEventListener("visibilitychange", onCollectionVisibility);
		const reduced =
			win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		const displayMs =
			options.trickDisplayMs?.() ?? DEFAULT_SETTINGS.trickDisplayMs;
		const winnerPauseMs =
			options.trickWinnerPauseMs?.() ?? DEFAULT_SETTINGS.trickWinnerPauseMs;
		const animate =
			options.trickAnimation?.() ?? DEFAULT_SETTINGS.trickAnimation;
		for (const [index, node] of nodes.entries()) {
			const rect = rects[index];
			if (!rect) continue;
			const clone = node.cloneNode(true) as HTMLElement;
			const computed = win.getComputedStyle(node);
			const rotated = landingOffsets.has(node.dataset.seat as Seat);
			const scale =
				rotated && board.offsetWidth > 0
					? boardRect.width / board.offsetWidth
					: node.offsetWidth > 0
						? rect.width / node.offsetWidth
						: 1;
			const cardWidth = rotated ? node.offsetWidth * scale : rect.width;
			const cardHeight = rotated ? node.offsetHeight * scale : rect.height;
			for (const name of [
				"--card-w",
				"--card-h",
				"--rank-size",
				"--suit-font-scale",
				"--card-bg",
				"--card-fg",
				"--line",
				"--board-card-shadow",
			])
				clone.style.setProperty(name, computed.getPropertyValue(name));
			const x = rect.left + rect.width / 2 - cardWidth / 2 - boardRect.left;
			const y = rect.top + rect.height / 2 - cardHeight / 2 - boardRect.top;
			Object.assign(clone.style, {
				position: "absolute",
				left: `${x}px`,
				top: `${y}px`,
				width: `${cardWidth}px`,
				height: `${cardHeight}px`,
				minWidth: "0",
				minHeight: "0",
				fontSize: `${parseFloat(computed.fontSize) * scale}px`,
				transform: computed.transform === "none" ? "" : computed.transform,
			});
			const originalText = node.querySelectorAll<HTMLElement>(
				".rank-corner, .played-center-suit",
			);
			const copiedText = clone.querySelectorAll<HTMLElement>(
				".rank-corner, .played-center-suit",
			);
			originalText.forEach((part, textIndex) => {
				const copy = copiedText[textIndex];
				if (copy)
					copy.style.fontSize = `${parseFloat(win.getComputedStyle(part).fontSize) * scale}px`;
			});
			const winner = node.dataset.seat === completed.winner;
			if (winner && animate) clone.classList.add("trick-winner");
			clone.style.zIndex = String(index + 1);
			overlay.append(clone);
			const dx = (endpoint[0] ?? 0) - (x + cardWidth / 2);
			const dy = (endpoint[1] ?? 0) - (y + cardHeight / 2);
			const base = clone.style.transform || "none";
			if (animate)
				clone.animate(
					reduced
						? [{ opacity: 1 }, { opacity: 0 }]
						: [
								{ transform: base },
								{
									transform: `translate(${dx}px, ${dy}px) ${base === "none" ? "" : base}`,
								},
							],
					{
						delay: winnerPauseMs,
						duration: reduced ? 150 : TRICK_SWEEP_MS,
						easing: "ease-in",
						fill: "forwards",
					},
				);
		}
		trick.replaceChildren();
		if (!animate && displayMs === 0) {
			finishCollection();
			return;
		}
		collectionTimer = setTimeout(
			() => finishCollection(),
			animate ? winnerPauseMs + (reduced ? 150 : TRICK_SWEEP_MS) : displayMs,
		);
	}

	/** The cards played to the current trick, each drawn with its long edge towards the player who played it. */
	function renderTrick(view: TrickView | undefined): void {
		trick.hidden = view === undefined;
		if (!view) {
			trick.replaceChildren();
			return;
		}
		trick.replaceChildren(
			...view.cards.map((played) =>
				el(
					"span",
					{
						className: `played pos-${played.position}`,
						attrs: {
							"data-seat": played.seat,
							"data-card": played.card,
							"data-suit": suitOf(played.card),
							"aria-label": played.text,
							title: t(SEAT_NAMES[played.seat]),
						},
					},
					el(
						"span",
						{ className: "played-legacy", attrs: { "aria-hidden": "true" } },
						el("span", { className: "rank" }, played.rank),
						el("span", { className: "suit" }, played.symbol),
					),
					el(
						"span",
						{ className: "played-corners", attrs: { "aria-hidden": "true" } },
						el("span", { className: "rank-corner top-left" }, played.rank),
						el("span", { className: "rank-corner top-right" }, played.rank),
						el("span", { className: "rank-corner bottom-left" }, played.rank),
						el("span", { className: "rank-corner bottom-right" }, played.rank),
					),
					el(
						"span",
						{
							className: "played-center-suit",
							attrs: { "aria-hidden": "true" },
						},
						played.symbol,
					),
				),
			),
		);
		for (const [index, node] of [
			...trick.querySelectorAll<HTMLElement>(".played"),
		].entries()) {
			node.style.zIndex = String(index + 1);
			const seat = node.dataset.seat as Seat;
			const offset = landingOffsets.get(seat);
			if (offset) {
				const centerShift =
					offset.centerPercent / 100 - (compact ? PHONE_LANDING_OUTWARD : 0);
				const horizontal = node.classList.contains("pos-left")
					? centerShift
					: node.classList.contains("pos-right")
						? -centerShift
						: 0;
				const vertical = node.classList.contains("pos-top")
					? centerShift
					: node.classList.contains("pos-bottom")
						? -centerShift
						: 0;
				node.style.left = `calc(var(--card-w) * ${offset.x} + var(--card-h) * ${horizontal})`;
				node.style.top = `calc(var(--card-h) * ${offset.y + vertical})`;
				node.style.transform = `rotate(${offset.rotation}deg)`;
			}
			if (
				flights.has(seat) ||
				queuedFlights.some(
					(flight) => flight.seat === seat && flight.card === node.dataset.card,
				)
			)
				node.style.visibility = "hidden";
		}
	}

	function setCountdown(seconds: number | undefined): void {
		scoringCountdown.hidden = seconds === undefined || seconds === 0;
		if (seconds === undefined) return;
		const board = latestView?.nextBoard?.board;
		scoringCountdown.textContent =
			board === undefined
				? ""
				: seconds > 0
					? t(
							seconds === 1
								? "Next board {board} in {seconds} second"
								: "Next board {board} in {seconds} seconds",
							{ board, seconds },
						)
					: "";
	}

	function renderScoring(view: TableView["scoring"]): void {
		scoring.hidden = view === undefined;
		if (!view) {
			scoring.replaceChildren();
			return;
		}
		const contract = view.contract;
		const symbol =
			contract === undefined
				? ""
				: contract.strain === "NT"
					? "NT"
					: SUIT_SYMBOLS[contract.strain];
		const notation =
			contract === undefined
				? ""
				: `${contract.level}${symbol}${contract.doubling}`;
		const position =
			notation === "" ? -1 : view.compactDetail.indexOf(notation);
		const detail =
			position < 0 || contract === undefined
				? [view.compactDetail]
				: [
						view.compactDetail.slice(0, position),
						el(
							"span",
							{ className: "scoring-inline-contract" },
							String(contract.level),
							el(
								"span",
								{ className: `strain strain-${contract.strain}` },
								symbol,
							),
							contract.doubling,
						),
						view.compactDetail.slice(position + notation.length),
					];
		const soloControls = view.solo
			? [
					el(
						"div",
						{ className: "scoring-actions" },
						...(view.solo.reviewing
							? []
							: [button(t("Review"), () => handlers.reviewResult?.())]),
						...(view.solo.showNext === false
							? []
							: [
									button(t("Next board"), () => handlers.nextBoard?.(), {
										attrs: { "data-testid": "next-board" },
									}),
								]),
					),
				]
			: [];
		const nextButton = soloControls[0]?.querySelector<HTMLButtonElement>(
			'[data-testid="next-board"]',
		);
		if (nextButton && view.solo) nextButton.disabled = !view.solo.ready;
		if (compact) {
			scoring.replaceChildren(
				el(
					"strong",
					{
						className: "mobile-scoring-outcome",
						attrs: { "data-outcome": view.compactOutcome },
					},
					t(view.compactOutcome),
				),
				...(view.compactDetail === ""
					? []
					: [el("p", { className: "mobile-scoring-detail" }, ...detail)]),
				scoringCountdown,
				...soloControls,
			);
			setCountdown(view.countdown);
			return;
		}
		scoring.replaceChildren(
			...(contract
				? [
						el(
							"p",
							{ className: "scoring-contract" },
							`${t("Contract")} `,
							contractStrong(contract),
						),
					]
				: []),
			el(
				"p",
				{
					className: "scoring-result",
					attrs: { "data-outcome": view.compactOutcome },
				},
				el("strong", {}, `${t(view.compactOutcome)}:`),
				...(view.compactDetail === "" ? [] : [" ", ...detail]),
			),
			scoringCountdown,
			...soloControls,
		);
		setCountdown(view.countdown);
	}

	function contractStrong(contract: AuctionEndView["contract"]): HTMLElement {
		return el(
			"strong",
			{ className: "bid" },
			String(contract.level),
			el(
				"span",
				{ className: `strain strain-${contract.strain}` },
				contract.strain === "NT" ? "NT" : SUIT_SYMBOLS[contract.strain],
			),
			contract.doubling,
		);
	}

	let shownAuctionEnd: string | undefined;
	function renderAuctionEnd(view: TableView["auctionEnd"]): void {
		const key = JSON.stringify(view) ?? "";
		if (key === shownAuctionEnd) return;
		shownAuctionEnd = key;
		auctionEnd.hidden = view === undefined;
		if (!view) {
			auctionEnd.replaceChildren();
			return;
		}
		auctionEnd.replaceChildren(
			el(
				"p",
				{ className: "scoring-contract" },
				`${t("Contract")} `,
				contractStrong(view.contract),
				` ${view.declarer}`,
			),
			el(
				"p",
				{
					className: "auction-end-vulnerability",
					attrs: { "data-vulnerable": String(view.vulnerable) },
				},
				view.vulnerability,
			),
			...(view.bothHands
				? [el("p", { className: "auction-end-both-hands" }, view.bothHands)]
				: []),
		);
	}

	/**
	 * A player's declared system opens its guide. A learned bot does not declare a guide system.
	 */
	function systemLabel(
		system: PointSystem | undefined,
		bot: boolean,
	): HTMLElement[] {
		if (bot)
			return [el("span", { className: "auction-system" }, t("Learned bot"))];
		if (system === undefined) return [];
		const text = t(SYSTEM_LABELS[system]);
		if (system === "other")
			return [el("span", { className: "auction-system" }, text)];
		const open = button(text, () => guide.open(system), {
			className: "auction-system",
			attrs: {
				title: t("Bidding guide"),
			},
		});
		open.disabled = guideBlocked;
		return [open];
	}

	/**
	 * A call that the guide describes is a button with its meaning as the title. A click shows the meaning under the
	 * call; a second click, Escape, or a click elsewhere closes it, as the browser closes an auto popover.
	 */
	function auctionCallCell(
		text: string,
		meaning: string | undefined,
		meanings: HTMLElement[],
	): (string | HTMLElement)[] {
		const content = auctionCell(text, t);
		if (meaning === undefined) return content;
		const shown = el(
			"span",
			{ className: "call-meaning", attrs: { popover: "auto" } },
			...cardNotation(meaning),
		);
		const call = el(
			"button",
			{
				className: "auction-call",
				attrs: { type: "button", title: meaning, "aria-description": meaning },
			},
			...content,
		);
		call.popoverTargetElement = shown;
		shown.addEventListener("beforetoggle", (event) => {
			if (event.newState === "open") placeMeaning(call, shown);
		});
		meanings.push(shown);
		return [call];
	}

	let drawnAuction = "";
	function renderAuction(view: TableView): void {
		const grid = view.auction;
		auction.hidden = grid === undefined;
		if (!grid) {
			drawnAuction = "";
			auction.replaceChildren();
			callMeanings.replaceChildren();
			return;
		}
		const rows = grid.rows;
		const names = new Map(view.seats.map((seat) => [seat.seat, seat.name]));
		// A rebuild closes an open meaning, so draw only when the auction, names, vulnerability or guide state changed.
		const key = JSON.stringify([
			grid,
			[...names],
			view.vulnerability,
			guideBlocked,
		]);
		if (key === drawnAuction) return;
		drawnAuction = key;
		const meanings: HTMLElement[] = [];
		auction.replaceChildren(
			el(
				"thead",
				{},
				el(
					"tr",
					{},
					...grid.seats.map((seat, index) => {
						const player = `${names.get(seat) || t(seat)} (${t(seat)})`;
						const side = seat === "N" || seat === "S" ? "ns" : "ew";
						const vulnerable = view.vulnerability.some(
							(line) => line.side === side && line.vulnerable,
						);
						return el(
							"th",
							{ attrs: { scope: "col", title: player } },
							el(
								"span",
								{
									className: "auction-player",
									attrs: { "data-vulnerable": String(vulnerable) },
								},
								player,
							),
							...systemLabel(grid.systems[index], grid.bots.includes(seat)),
						);
					}),
				),
			),
			el(
				"tbody",
				{},
				...rows.map((row, rowIndex) =>
					el(
						"tr",
						{},
						...grid.seats.map((_, index) =>
							el(
								"td",
								{},
								...auctionCallCell(
									row[index] ?? "",
									grid.meanings[rowIndex]?.[index],
									meanings,
								),
							),
						),
					),
				),
			),
		);
		callMeanings.replaceChildren(...meanings);
		auctionScroll.scrollTop = auctionScroll.scrollHeight;
	}

	// Each switch keeps its node when another seat changes.
	const mobileBotNodes = new Map<
		Seat,
		{ row: HTMLElement; name: HTMLElement; toggle: HTMLButtonElement }
	>();
	function renderMobilePlayers(view: TableView): void {
		const own = view.seats.find((player) => player.position === "bottom")?.seat;
		// On an upright phone the host finds these in the Host controls, so the board has the room; a guest keeps the
		// list of connected players below the board. A phone held sideways shows them at the top of the sidebar.
		if (!sideways) {
			const home = compact && botControlHost ? hostPlayers : mobileAuction;
			if (mobilePlayers.parentElement !== home) home.append(mobilePlayers);
		}
		mobileBotFold.hidden = !botControlHost;
		const others = view.seats.filter(
			(player) =>
				player.seat !== own &&
				player.presence !== "free" &&
				!(botControlHost && player.tags.includes("Host")),
		);
		const connected = others
			.filter((player) => player.presence === "online")
			.map((player) => `${player.name || player.label} (${t(player.seat)})`);
		connectedPlayers.textContent = t("Connected: {players}", {
			players: connected.length > 0 ? connected.join("  ") : t("None"),
		});
		const rows = view.seats
			.filter((player) => player.seat !== own)
			.map((player) => {
				let item = mobileBotNodes.get(player.seat);
				if (!item) {
					const name = el("span");
					const toggle = button("", () =>
						handlers.setBotSeat?.(
							player.seat,
							!botControlSeats.includes(player.seat),
						),
					);
					const row = el(
						"div",
						{
							className: "mobile-player-control",
							attrs: { "data-seat": player.seat },
						},
						name,
						toggle,
					);
					item = { row, name, toggle };
					mobileBotNodes.set(player.seat, item);
				}
				const label = `${player.name || player.label}${player.bot ? " 🤖" : ""} (${t(player.seat)})`;
				const text = botControlSeats.includes(player.seat)
					? `👱 ${t("Switch to player")}`
					: `🤖 ${t("Switch to bot")}`;
				if (item.name.textContent !== label) item.name.textContent = label;
				if (item.toggle.textContent !== text) item.toggle.textContent = text;
				item.toggle.hidden = !botControlHost;
				return item.row;
			});
		for (const child of [...mobileBotControls.children]) {
			if (!rows.includes(child as HTMLElement)) child.remove();
		}
		for (const [index, row] of rows.entries()) {
			const current = mobileBotControls.children[index];
			if (current !== row) mobileBotControls.insertBefore(row, current ?? null);
		}
	}

	function renderMobileRoundStatus(view: TableView): void {
		const ownSeat = view.seats.find((player) => player.position === "bottom");
		const ownSide =
			ownSeat?.seat === "E" || ownSeat?.seat === "W" ? "ew" : "ns";
		const record = (side: "ew" | "ns", label: string): HTMLElement => {
			const stats = view.statistics[side];
			const net = stats.won - stats.lost;
			return el(
				"span",
				{
					className: "mobile-round-record",
					attrs: {
						"data-own-side": String(ownSide === side),
						"data-result": net > 0 ? "positive" : net < 0 ? "negative" : "zero",
					},
				},
				el("span", { className: "mobile-round-label" }, label),
				": ",
				el("strong", {}, net > 0 ? `+${net}` : String(net)),
				` (${t("{points}p", { points: stats.total })})`,
			);
		};
		// Each side's points, and below them whether that side is vulnerable.
		const side = (key: "ew" | "ns", label: string): HTMLElement => {
			const line = view.vulnerability.find((entry) => entry.side === key);
			return el(
				"span",
				{ className: "mobile-round-side" },
				record(key, label),
				...(line
					? [
							el(
								"span",
								{
									className: "mobile-round-vulnerability",
									attrs: { "data-vulnerable": String(line.vulnerable) },
								},
								line.status,
							),
						]
					: []),
			);
		};
		mobileRoundLine.replaceChildren(
			el(
				"strong",
				{ className: "mobile-round-number" },
				`${t("Round")} ${view.board}`,
				...(view.header ? [": ", contractBid(view.header)] : []),
			),
			side("ew", t("E-W")),
			side("ns", t("N-S")),
		);
	}

	function opponentHand(
		position: "top" | "left" | "right",
	): HTMLElement | undefined {
		return (
			places[position].querySelector<HTMLElement>(".seat .hand") ?? undefined
		);
	}

	/**
	 * The "Previous game statistics" panel. Its counters are per deal, so the rows say "Deals"; the product has not
	 * yet chosen a game unit (bridge-auction-screen, Previous game statistics). The phone shows the same table when its
	 * round line opens.
	 */
	function renderScores(view: TableView): void {
		const { ns, ew } = view.statistics;
		const rows: readonly [string, number, number, boolean][] = [
			[t("Deals won"), ew.won, ns.won, false],
			[t("Deals lost"), ew.lost, ns.lost, false],
			[t("Total score"), ew.total, ns.total, true],
		];
		const parts = (): HTMLElement[] => [
			el("caption", {}, t("Previous game statistics")),
			el(
				"thead",
				{},
				el(
					"tr",
					{},
					el("th", {}, ""),
					el("th", { className: "num" }, t("E-W")),
					el("th", { className: "num" }, t("N-S")),
				),
			),
			el(
				"tbody",
				{},
				...rows.map(([label, eastWest, northSouth, total]) =>
					el(
						"tr",
						total ? { className: "total" } : {},
						el("th", {}, label),
						el("td", { className: "num" }, String(eastWest)),
						el("td", { className: "num" }, String(northSouth)),
					),
				),
			),
		];
		scores.replaceChildren(...parts());
		mobileScores.replaceChildren(...parts());
	}

	function actionItem(
		line: TableActionLine,
		names: Readonly<Partial<Record<Seat, string>>>,
	): HTMLElement {
		// A pending action's reason says which players the host waits for.
		const status =
			line.state === "not-accepted"
				? `${t(ACTION_STATUS[line.state])}: ${translateHostReason(line.reason ?? "rejected", names, t)}`
				: translateHostReason(
						line.reason ?? ACTION_STATUS[line.state],
						names,
						t,
					);
		return el(
			"li",
			{ attrs: { "data-state": line.state } },
			el("span", { className: "text" }, ...cardNotation(line.text)),
			el("span", { className: "status" }, status),
		);
	}

	/** Keep pre-result visibility while removing cards committed since the last play view. */
	function finalTrickView(
		previous: TableView,
		completed: CompletedTrickView,
	): TableView {
		const alreadyShown = previous.trick?.finished
			? []
			: (previous.trick?.cards ?? []);
		const newlyPlayed = completed.cards.filter(
			(card) =>
				!alreadyShown.some(
					(shown) => shown.seat === card.seat && shown.card === card.card,
				),
		);
		return {
			...previous,
			trick: completed,
			seats: previous.seats.map((seat) => {
				const cards = newlyPlayed.filter((played) => played.seat === seat.seat);
				if (cards.length === 0) return seat;
				const hand = seat.hand.visible
					? {
							...seat.hand,
							suits: seat.hand.suits.map((suit) => ({
								...suit,
								cards: suit.cards.filter(
									(card) => !cards.some((played) => played.card === card.card),
								),
							})),
						}
					: {
							...seat.hand,
							count: Math.max(0, seat.hand.count - cards.length),
						};
				return { ...seat, hand };
			}),
		};
	}

	function render(view: TableView): void {
		incomingView = view;
		if (
			!(options.cardPlayAnimation?.() ?? DEFAULT_SETTINGS.cardPlayAnimation)
		) {
			if (flights.size > 0 || queuedFlights.length > 0) clearFlights();
			deferredFlights.length = 0;
			landingOffsets.clear();
		}
		prepareFlight(view);
		const completed = view.completedTrick;
		const index = completed?.index ?? 0;
		const signature = completed
			? JSON.stringify([
					completed.index,
					completed.winner,
					completed.cards.map((card) => card.card),
				])
			: "";
		if (view.board !== presentationBoard) {
			clearFlights();
			deferredFlights.length = 0;
			landingOffsets.clear();
			finishCollection(false);
			presentationBoard = view.board;
			presentationIndex = index;
			presentationAt = view.at;
			presentationSignature = signature;
			lastPlayView = undefined;
		} else {
			const rolledBack = view.at < presentationAt;
			if (
				rolledBack ||
				index > presentationIndex + 1 ||
				(view.phase !== "play" && !completed)
			) {
				clearFlights();
				deferredFlights.length = 0;
				landingOffsets.clear();
			}
			if (
				collectingTrick &&
				(rolledBack ||
					index < collectingTrick.index ||
					index > collectingTrick.index ||
					(index === collectingTrick.index &&
						signature !== presentationSignature))
			) {
				clearFlights();
				deferredFlights.length = 0;
				finishCollection(false);
			}
			if (
				completed &&
				!rolledBack &&
				!element.ownerDocument.hidden &&
				index === presentationIndex + 1 &&
				lastPlayView?.phase === "play"
			) {
				const direction = t(SEAT_NAMES[completed.winner]);
				const player = completed.winnerName
					? `${direction} · ${completed.winnerName}`
					: direction;
				trickAnnouncement.textContent = t("{player} won the trick", { player });
				collectingTrick = completed;
			}
			presentationIndex = index;
			presentationAt = view.at;
			presentationSignature = signature;
		}
		if (collectingTrick && view.phase === "complete" && lastPlayView)
			view = finalTrickView(lastPlayView, collectingTrick);
		else if (view.phase === "play") lastPlayView = view;
		latestView = view;
		const flyingSeat =
			flights.keys().next().value ??
			pendingFlight?.seat ??
			collectingTrick?.cards.at(-1)?.seat;
		const nextSeat = view.seats.find((seat) => seat.turn);
		const nextActor = nextSeat?.tags.includes("Dummy")
			? view.seats.find((seat) => seat.tags.includes("Declarer"))
			: nextSeat;
		if (flyingSeat && nextActor?.bot && !view.yourTurn) {
			view = {
				...view,
				seats: view.seats.map((seat) => ({
					...seat,
					turn: seat.seat === flyingSeat,
					turnPill:
						seat.seat === flyingSeat
							? { action: "play" as const, yours: false }
							: undefined,
				})),
			};
		}
		updateAutoplayControl();
		shownPointSystem = pointSystem();
		guideBlocked = view.waiting !== "";
		if (guideBlocked && guide.element.open) guide.element.close();
		shownCardPoints = cardPoints();
		shownMarks = marks();
		const hideBidBox =
			shownMarks.hideBidBoxWhenWaiting && view.bids.length === 0;
		element.dataset.phase = view.phase;
		element.dataset.board = String(view.board);
		element.dataset.at = String(view.at);
		heading.textContent = t(view.heading || "Bridge table");
		vulnerability.replaceChildren(
			...view.vulnerability.map((line) =>
				el(
					"span",
					{ attrs: { "data-vulnerable": String(line.vulnerable) } },
					line.text,
				),
			),
		);
		details.textContent = t(view.details);
		prompt.textContent = view.prompt;
		felt.hidden = view.seats.length === 0;
		phase = view.phase;
		placeStatus();
		const lobby = view.phase === "waiting";
		const back = cardBackFor(view.board);
		for (const seat of view.seats) renderPlace(seat, lobby, back);
		for (const position of ["top", "left", "right", "bottom"] as const) {
			if (!view.seats.some((seat) => seat.position === position)) {
				places[position].replaceChildren();
				seatNodes.delete(position);
				if (position !== "bottom") videoSlots[position].replaceChildren();
			}
		}
		const mobileGameActive =
			compact &&
			(view.phase === "auction" ||
				view.phase === "play" ||
				view.phase === "complete");
		const announcementHome = mobileGameActive ? mobileBoard : felt;
		if (trickAnnouncement.parentElement !== announcementHome)
			announcementHome.append(trickAnnouncement);
		// Before the first board, a phone shows the same board with the backs of the joined seats, and nothing else of
		// the game.
		const mobileBoardActive =
			mobileGameActive || (compact && lobby && view.seats.length > 0);
		mobileAuction.hidden = !mobileBoardActive;
		// The middle of the phone board is the current trick, except while it shows the auction summary.
		const summaryInMiddle = mobileGameActive && view.auctionEnd !== undefined;
		const resultInMiddle =
			mobileGameActive &&
			view.phase === "complete" &&
			view.scoring !== undefined;
		if (summaryInMiddle || resultInMiddle) {
			mobileBoardCenter.removeAttribute("role");
			mobileBoardCenter.removeAttribute("aria-label");
		} else {
			mobileBoardCenter.setAttribute("role", "group");
			mobileBoardCenter.setAttribute("aria-label", t("Current trick"));
		}
		if (summaryInMiddle) {
			placeChildren(mobileBoardCenter, auctionEnd);
		} else if (resultInMiddle) {
			placeChildren(mobileBoardCenter, scoring);
		} else if (mobileGameActive && view.phase === "play") {
			placeChildren(mobileBoardCenter, trick);
		} else {
			mobileBoardCenter.replaceChildren();
			center.prepend(trick);
		}
		// A phone's result lies between the four hands, so it covers none of them; elsewhere the summaries lie on the
		// middle of the felt.
		if (compact && !resultInMiddle) {
			if (scoring.parentElement !== center) center.append(scoring);
		} else if (!compact && scoring.parentElement !== felt)
			waitingOverlay.before(scoring);
		if (auctionEnd.parentElement === null) waitingOverlay.before(auctionEnd);
		if (mobileBoardActive) {
			const ownSeat = seatNodes.get("bottom")?.node;
			if (ownSeat) placeChildren(mobileHand, ownSeat);
			else mobileHand.replaceChildren();
			for (const [position, target] of [
				["top", mobileOpponentTop],
				["left", mobileOpponentLeft],
				["right", mobileOpponentRight],
			] as const) {
				const player = view.seats.find((seat) => seat.position === position);
				const hand =
					player === undefined
						? undefined
						: (opponentHand(position) ??
							target.querySelector<HTMLElement>(".hand") ??
							undefined);
				// The hand moves here without its seat label, so the player's name is shown above it.
				const name =
					player === undefined
						? undefined
						: (target.querySelector<HTMLElement>(".mobile-board-name") ??
							el("span", { className: "mobile-board-name" }));
				if (name && player) {
					name.dataset.turn = String(player.turn);
					name.dataset.turnFrame = String(turnFramed(player));
					const key = JSON.stringify([
						player.label,
						player.pointCards,
						shownPointSystem,
						shownCardPoints,
					]);
					if (name.dataset.contentKey !== key) {
						name.dataset.contentKey = key;
						name.replaceChildren(
							el("span", { className: "mobile-board-name-text" }, player.label),
							...pointsPill(player.pointCards),
						);
					}
				}
				const topTrump =
					position === "top" &&
					view.phase === "complete" &&
					player?.hand.visible &&
					player.hand.suits.some((row) => row.trump && row.cards.length > 0)
						? (target.querySelector<HTMLElement>(":scope > .trump-label") ??
							el("span", { className: "trump-label" }, t("Trump suit")))
						: undefined;
				placeChildren(
					target,
					...(name ? [name] : []),
					...(topTrump ? [topTrump] : []),
					...(hand ? [hand] : []),
				);
				if (name && position !== "top") mobileSideNameObserver.observe(name);
				target.setAttribute(
					"aria-hidden",
					String(
						(view.phase !== "play" && view.phase !== "complete") ||
							hand === undefined ||
							hand.classList.contains("backs"),
					),
				);
			}
			updateMobileSideNameHeight();
		} else {
			mobileSideNameObserver.disconnect();
			mobileHand.replaceChildren();
			mobileOpponentTop.replaceChildren();
			mobileOpponentLeft.replaceChildren();
			mobileOpponentRight.replaceChildren();
			for (const target of [
				mobileOpponentTop,
				mobileOpponentLeft,
				mobileOpponentRight,
			])
				target.setAttribute("aria-hidden", "true");
		}
		if (mobileBoardActive && mobileTopbar.firstElementChild !== audioGroup)
			mobileTopbar.prepend(audioGroup);
		if (mobileGameActive) {
			placeChildren(mobileBidsFold, mobileBidsTitle, bidHistory);
			const first = view.phase === "play" ? bidUndoControls : mobileBidControls;
			const last = view.phase === "play" ? mobileBidControls : bidUndoControls;
			if (
				first.nextElementSibling !== last ||
				last.nextElementSibling !== mobileBoard
			)
				mobileBoard.before(first, last);
			// The history opens for each auction and folds when the auction summary or play starts; between those, the
			// player's choice stays.
			const bidsPhase =
				view.auctionEnd || view.phase === "complete" ? "play" : view.phase;
			if (bidsPhase !== mobileBidsPhase) {
				mobileBidsPhase = bidsPhase;
				mobileBidsFold.open = bidsPhase !== "play";
			}
			mobileBidsTitle.setAttribute(
				"aria-disabled",
				String(view.phase === "auction"),
			);
			placeChildren(
				mobileBidOverlay,
				...(view.phase === "auction" && !view.auctionEnd ? [bidBox] : []),
			);
			mobileBidOverlay.hidden =
				view.phase !== "auction" || view.auctionEnd !== undefined;
			mobileBidOverlay.classList.toggle("is-concealed", hideBidBox);
			placeChildren(
				mobileBidControls,
				...(view.phase === "play" ? [playControls, claimPanel] : []),
			);
			renderMobileTricks(view);
			renderMobileRoundStatus(view);
		} else {
			if (
				!mobileBoardActive &&
				!sideways &&
				call.row.firstElementChild !== audioGroup
			)
				call.row.prepend(audioGroup);
			mobileBidOverlay.hidden = true;
			if (bidUndoControls.parentElement !== bidHistory)
				bidHistory.append(bidUndoControls);
			placeChildren(
				bidRow,
				...(view.phase === "auction" ? [bidHistory, bidBox] : [bidBox]),
			);
		}
		// A phone held sideways has no call box and no video tiles, so the call buttons and the bot switches go to the
		// top of the sidebar.
		if (sideways) {
			placeChildren(sidewaysControls, audioGroup, mobilePlayers);
			if (sidebar.firstElementChild !== sidewaysControls)
				sidebar.prepend(sidewaysControls);
		} else sidewaysControls.remove();
		renderMobilePlayers(view);
		// A compact screen shows these below its board, or below the felt between the boards.
		const below = compact
			? mobileBoardActive
				? mobileBoard
				: felt
			: undefined;
		renderApproval(view, below);
		renderWaiting(view, below);
		const gameOver = view.phase === "complete";
		const playing = view.phase === "play";
		playControls.hidden = !playing && !gameOver;
		// "Claim …" offers a button for each count, so it waits until few tricks remain; "Claim all" stays.
		claim.hidden = view.phase !== "play" || !view.claim.choosable;
		claimAll.hidden = view.phase !== "play";
		claim.disabled = !view.claim.canRequest;
		claimAll.disabled = !view.claim.canRequest;
		compactClaim.hidden = view.phase !== "play" || !view.claim.choosable;
		compactClaim.disabled = !view.claim.canRequest;
		compactClaimAll.hidden = view.phase !== "play";
		compactClaimAll.disabled = !view.claim.canRequest;
		seatLabels = new Map(view.seats.map((seat) => [seat.seat, seat.label]));
		seatRoundTrips = new Map(
			view.seats.map((seat) => [seat.seat, seat.roundTrip]),
		);
		renderCallStates();
		renderAuction(view);
		showTrick(view);
		contract.replaceChildren(
			...cardNotation(
				[view.contract, view.tricks].filter((part) => part !== "").join(" · "),
			),
		);
		// The sidebar header and tricks panel show the contract and the tricks once play starts.
		contract.hidden = contract.textContent === "" || view.header !== undefined;
		const names = Object.fromEntries(
			view.seats.map((seat) => [seat.seat, seat.name]),
		);
		actions.replaceChildren(
			...view.actions.map((line) => actionItem(line, names)),
		);
		actions.hidden = view.actions.length === 0;
		gameSlot.hidden =
			view.scoring !== undefined || view.auctionEnd !== undefined;
		renderScoring(view.scoring);
		renderAuctionEnd(view.auctionEnd);
		// Without legal calls the box is either hidden or grayed out, according to the player's setting.
		bidRow.hidden = view.phase !== "auction";
		bidUndoControls.hidden =
			view.phase !== "auction" || view.auctionEnd !== undefined;
		bidBox.classList.toggle("is-concealed", hideBidBox);
		bidBox.classList.toggle("not-turn", view.bids.length === 0);
		renderBidBox(view);
		renderScores(view);
		undoRequestId = view.undo.requestId;
		// The question closes when its request can no longer go, such as after a new deal or another player's request.
		if (
			undoConfirmDialog.open &&
			(!view.undo.canRequest || view.board !== undoConfirmBoard)
		)
			undoConfirmDialog.close();
		claimRequestId = view.claim.requestId;
		undoMessage.textContent = view.undo.message;
		undoMessage.hidden = view.undo.message === "";
		playUndo.disabled = !view.undo.canRequest;
		compactUndo.hidden = view.phase === "auction";
		compactUndo.disabled = !view.undo.canRequest;
		cancelUndo.hidden = !view.undo.canCancel;
		renderClaimPanel(view);
		if (mobileGameActive)
			mobileBidControls.hidden =
				view.phase !== "play" ||
				(!Array.from(playControls.children).some(
					(control) => !control.hasAttribute("hidden"),
				) &&
					claimPanel.hidden);
		else mobileBidControls.hidden = true;
		// The Undo button of the play controls asks for an undo; the panel shows only an open request or its outcome.
		undoPanel.hidden =
			compact ||
			view.phase === "auction" ||
			view.undo.canVote ||
			(view.undo.requestId === undefined && view.undo.message === "");
		bidHistory.hidden = view.auction === undefined;
		historyTitle.hidden = view.phase === "auction" && !mobileGameActive;
		renderContractHead(view.header);
		renderTricks(view);
		const sidebarChildren = [
			contractPanel,
			...(mobileGameActive || view.phase === "auction" ? [] : [bidHistory]),
			tricksPanel,
			undoPanel,
			...(mobileGameActive ? [] : [claimPanel, playControls]),
			scores,
			sidebarEnd,
		];
		if (
			!sidebarChildren.every(
				(child, index) =>
					child ===
					sidebar.children[
						sidebar.children.length - sidebarChildren.length + index
					],
			)
		)
			sidebar.append(...sidebarChildren);
		placeSideGuide(view);
		options.playPresentationChanged?.();
	}

	/** The sidebar header: "1♣ by North · Anna", with the suit in the selected colour. */
	function renderContractHead(header: ContractHeader | undefined): void {
		contractPanel.hidden = header === undefined;
		if (!header) {
			contractHead.replaceChildren();
			return;
		}
		contractHead.replaceChildren(
			contractBid(header),
			el("span", { className: "by" }, t("by")),
			el(
				"span",
				{ className: "declarer" },
				header.name ? `${header.direction} · ${header.name}` : header.direction,
			),
		);
	}

	/** One row: the contract, then our tricks, the target and the opponents' tricks, each label beside its number. */
	function tricksCounts(
		header: ContractHeader | undefined,
		need: NonNullable<TableView["need"]>,
	): HTMLElement {
		const count = (label: string, value: string | number): HTMLElement =>
			el(
				"div",
				{ className: "count" },
				el("span", { className: "count-label" }, label),
				el("strong", {}, String(value)),
			);
		return el(
			"div",
			{ className: "tricks-counts" },
			...(header ? [contractBid(header)] : []),
			count(t("Our tricks"), `${need.ours} / ${need.target}`),
			count(t("Opponents'"), need.opponents),
		);
	}

	/** The contract and the trick counts, and what the viewer's side still needs. */
	function renderTricks(view: TableView): void {
		const need = view.need;
		tricksPanel.hidden = need === undefined;
		if (!need) {
			tricksPanel.replaceChildren();
			return;
		}
		tricksPanel.replaceChildren(...trickProgress(view, need));
	}

	function trickProgress(
		view: TableView,
		need: NonNullable<TableView["need"]>,
		concise = false,
	): HTMLElement[] {
		const header = view.header;
		const contract = header
			? `${header.level}${header.symbol}${header.doubling}`
			: "";
		return [
			tricksCounts(header, need),
			...(concise
				? []
				: [
						el(
							"p",
							{ className: "tricks-goal" },
							t(
								need.declaring
									? "{target} tricks to make {contract}"
									: "{target} defensive tricks to defeat {contract}",
								{ target: need.target, contract },
							),
						),
					]),
			el(
				"p",
				{
					className: "tricks-needed",
					attrs: {
						"data-status":
							need.status === "open" && need.needed === need.remaining
								? "at-risk"
								: need.status,
					},
				},
				t(
					need.status === "open"
						? concise
							? "{needed} needed · {remaining} left"
							: "{needed} more needed · {remaining} tricks remaining"
						: concise
							? "{remaining} left"
							: "{remaining} tricks remaining",
					{
						needed: need.needed,
						remaining: need.remaining,
					},
				),
			),
			...(view.trickStatus
				? [el("p", { className: "tricks-status" }, view.trickStatus)]
				: []),
		];
	}

	function renderMobileTricks(view: TableView): void {
		const need = view.need;
		mobileTricks.hidden = view.phase !== "play" || need === undefined;
		if (mobileTricks.hidden || !need) {
			mobileTricks.replaceChildren();
			return;
		}
		mobileTricks.replaceChildren(...trickProgress(view, need, true));
	}

	let currentLayout: Layout | undefined;
	function setForm(layout: Layout): void {
		if (layout !== currentLayout) {
			clearFlights();
			deferredFlights.length = 0;
			landingOffsets.clear();
		}
		currentLayout = layout;
		desktop = layout !== "compact";
		compact = layout === "compact";
		sideways = layout === "sideways";
		placeStatus();
		showNameShortcuts();
		if (latestView) render(latestView);
	}

	return {
		element,
		autoplayControl,
		autoplayStatus,
		mobileActions,
		hostPlayers,
		sidebar,
		sidebarEnd,
		render,
		collecting: () => collectingTrick !== undefined,
		playPresentationActive: () =>
			flights.size > 0 ||
			queuedFlights.length > 0 ||
			collectingTrick !== undefined,
		dispose: () => {
			mobileSideNameObserver.disconnect();
			clearFlights();
			deferredFlights.length = 0;
			finishCollection(false);
		},
		renderCall,
		setBotControls,
		setPlayerAutoplay,
		setForm,
		setCountdown,
		showBotBid(call) {
			botBid = call;
			if (shown !== undefined) renderBidBox(shown);
		},
	};
}
