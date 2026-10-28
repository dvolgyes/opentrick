import {
	DEFAULT_PLAY_TIME_MS,
	isPlayTimeMs,
	playTimeMs,
} from "../bot/play-budget";
import {
	type BotTiming,
	botTiming,
	DEFAULT_BOT_TIMING,
	isBotTimingMs,
} from "../bot/timing";
import { POINT_SYSTEMS, type PointSystem } from "../bridge/hand-points";
import {
	DEFAULT_BOT_SETUP,
	LOCAL_BIDDERS,
	type LocalBidder,
} from "../protocol";
import type { MaybeStorage } from "../session";

/**
 * The colour themes of themes.css; each has a light and a dark palette. The first one is the default, which the page
 * script of index.html also reads.
 */
export const THEMES = ["selenized", "normal", "solarized", "gruvbox"] as const;
export type Theme = (typeof THEMES)[number];

/** The palette of the theme: "auto" follows the light or dark preference of the browser. */
export const SCHEMES = ["auto", "light", "dark"] as const;
export type Scheme = (typeof SCHEMES)[number];

export const SUIT_FONT_SIZES = ["S", "M", "L", "XL", "XXL", "XXXL"] as const;
export type SuitFontSize = (typeof SUIT_FONT_SIZES)[number];

export const SUIT_COLOR_SCHEMES = [
	"standard",
	"green-blue",
	"black-yellow",
	"purple-orange",
	"blue-yellow",
	"green-orange",
	"green-yellow-blue",
	"pink-orange",
	"pink-yellow-cyan",
] as const;
export type SuitColorScheme = (typeof SUIT_COLOR_SCHEMES)[number];

export const BAIZE_STRENGTHS = ["mild", "normal", "strong"] as const;
export type BaizeStrength = (typeof BAIZE_STRENGTHS)[number];

export const PAPER_STRENGTHS = ["off", "mild", "visible", "strong"] as const;
export type PaperStrength = (typeof PAPER_STRENGTHS)[number];

/**
 * Display and bot choices of one player, kept in this browser's local storage and never sent to the table.
 * The language keeps its own storage name.
 */
export interface Settings extends BotTiming {
	readonly bidder: LocalBidder;
	/** Local card-search target, separate from the minimum time between visible actions. */
	readonly playTimeMs: number;
	readonly pointSystem: PointSystem;
	/** The points of the hand next to the cards. */
	readonly cardPoints: boolean;
	readonly theme: Theme;
	readonly scheme: Scheme;
	/** Size of suit and rank notation relative to its original size (M). */
	readonly suitFontSize: SuitFontSize;
	readonly suitColors: SuitColorScheme;
	readonly baizeStrength: BaizeStrength;
	readonly paperStrength: PaperStrength;
	readonly bidTurnFrame: boolean;
	readonly playTurnFrame: boolean;
	readonly bidTurnText: boolean;
	readonly playTurnText: boolean;
	readonly networkQuality: boolean;
	/** Green bars on the tile of a player whose voice arrives without video (src/ui/voice-meter.ts). */
	readonly voicebox: boolean;
	/** Frequent checks of the Nostr relays, for an unstable network (src/p2p/relay-check.ts). */
	readonly relayChecks: boolean;
	/** A phone or tablet in landscape gets the desktop view (src/call/device-class.ts). */
	readonly landscapeDesktop: boolean;
	/** A computer with a portrait window gets the mobile view (src/call/device-class.ts). */
	readonly portraitMobile: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	...DEFAULT_BOT_TIMING,
	bidder: DEFAULT_BOT_SETUP.bidder,
	playTimeMs: DEFAULT_PLAY_TIME_MS,
	pointSystem: "hcp",
	cardPoints: true,
	theme: "selenized",
	scheme: "auto",
	suitFontSize: "M",
	suitColors: "standard",
	baizeStrength: "strong",
	paperStrength: "visible",
	bidTurnFrame: true,
	playTurnFrame: true,
	bidTurnText: true,
	playTurnText: true,
	networkQuality: true,
	voicebox: true,
	relayChecks: false,
	landscapeDesktop: false,
	portraitMobile: true,
};

const PREFIX = "opentrick.settings.";
const TIMING_KEYS = {
	botCardDelayMs: "bot-card-delay-ms",
	botBidDelayMs: "bot-bid-delay-ms",
	auctionPauseMs: "auction-pause-ms",
} as const;
const FLAGS = {
	bidTurnFrame: "bid-turn-frame",
	playTurnFrame: "play-turn-frame",
	bidTurnText: "bid-turn-text",
	playTurnText: "play-turn-text",
	networkQuality: "network-quality",
	voicebox: "voicebox",
	relayChecks: "relay-checks",
	landscapeDesktop: "landscape-desktop",
	portraitMobile: "portrait-mobile",
} as const satisfies Partial<Record<keyof Settings, string>>;

function readChoice<T extends string>(
	value: string | null | undefined,
	choices: readonly T[],
	fallback: T,
): T {
	return choices.find((choice) => choice === value) ?? fallback;
}

function readFlag(
	value: string | null | undefined,
	fallback: boolean,
): boolean {
	return value === "1" ? true : value === "0" ? false : fallback;
}

/** Stored text is untrusted: each value that is not a valid choice reads as its default. */
export function readSettings(storage: MaybeStorage): Settings {
	const read = (name: string): string | null | undefined =>
		storage?.getItem(PREFIX + name);
	// An earlier version stored "none" for no points: no system preference, so the default system without card points.
	const storedPoints = read("points");
	const storedPlayTime = Number(read("play-time-ms"));
	const timing = Object.fromEntries(
		Object.entries(TIMING_KEYS).map(([field, name]) => {
			const minimum = DEFAULT_BOT_TIMING[field as keyof BotTiming];
			const value = Number(read(name));
			return [field, isBotTimingMs(value, minimum) ? value : minimum];
		}),
	) as unknown as BotTiming;
	const flags = Object.fromEntries(
		Object.entries(FLAGS).map(([field, name]) => [
			field,
			readFlag(read(name), DEFAULT_SETTINGS[field as keyof typeof FLAGS]),
		]),
	) as Record<keyof typeof FLAGS, boolean>;
	return {
		...timing,
		bidder: readChoice(read("bidder"), LOCAL_BIDDERS, DEFAULT_SETTINGS.bidder),
		playTimeMs: isPlayTimeMs(storedPlayTime)
			? storedPlayTime
			: DEFAULT_PLAY_TIME_MS,
		pointSystem: readChoice(
			storedPoints,
			POINT_SYSTEMS,
			DEFAULT_SETTINGS.pointSystem,
		),
		cardPoints: readFlag(
			read("card-points"),
			storedPoints !== "none" && DEFAULT_SETTINGS.cardPoints,
		),
		// The earlier "theme" name held a flat theme, such as "dark"; it is not read, so the choice starts again.
		theme: readChoice(read("theme-style"), THEMES, DEFAULT_SETTINGS.theme),
		scheme: readChoice(read("scheme"), SCHEMES, DEFAULT_SETTINGS.scheme),
		suitFontSize: readChoice(
			read("suit-font-size"),
			SUIT_FONT_SIZES,
			DEFAULT_SETTINGS.suitFontSize,
		),
		suitColors: readChoice(
			read("suit-colors"),
			SUIT_COLOR_SCHEMES,
			DEFAULT_SETTINGS.suitColors,
		),
		baizeStrength: readChoice(
			read("baize-strength"),
			BAIZE_STRENGTHS,
			DEFAULT_SETTINGS.baizeStrength,
		),
		paperStrength: readChoice(
			read("paper-strength"),
			PAPER_STRENGTHS,
			DEFAULT_SETTINGS.paperStrength,
		),
		...flags,
	};
}

/** Saves this browser's display and bot preferences. */
export function writeSettings(storage: MaybeStorage, settings: Settings): void {
	if (!storage) throw new Error("local storage is not available");
	const budget = playTimeMs(settings.playTimeMs);
	const timing = botTiming(settings);
	if (!LOCAL_BIDDERS.includes(settings.bidder))
		throw new Error("unknown bidding engine");
	if (!SUIT_FONT_SIZES.includes(settings.suitFontSize))
		throw new Error("unknown suit and rank font size");
	if (!SUIT_COLOR_SCHEMES.includes(settings.suitColors))
		throw new Error("unknown suit colour scheme");
	if (!BAIZE_STRENGTHS.includes(settings.baizeStrength))
		throw new Error("unknown board texture strength");
	if (!PAPER_STRENGTHS.includes(settings.paperStrength))
		throw new Error("unknown card texture strength");
	storage.setItem(`${PREFIX}bidder`, settings.bidder);
	storage.setItem(`${PREFIX}play-time-ms`, String(budget));
	for (const [field, name] of Object.entries(TIMING_KEYS))
		storage.setItem(PREFIX + name, String(timing[field as keyof BotTiming]));
	storage.setItem(`${PREFIX}points`, settings.pointSystem);
	storage.setItem(`${PREFIX}card-points`, settings.cardPoints ? "1" : "0");
	storage.setItem(`${PREFIX}theme-style`, settings.theme);
	storage.setItem(`${PREFIX}scheme`, settings.scheme);
	storage.setItem(`${PREFIX}suit-font-size`, settings.suitFontSize);
	storage.setItem(`${PREFIX}suit-colors`, settings.suitColors);
	storage.setItem(`${PREFIX}baize-strength`, settings.baizeStrength);
	storage.setItem(`${PREFIX}paper-strength`, settings.paperStrength);
	storage.removeItem(`${PREFIX}theme`);
	for (const [field, name] of Object.entries(FLAGS))
		storage.setItem(
			PREFIX + name,
			settings[field as keyof typeof FLAGS] ? "1" : "0",
		);
}
