import {
	DEFAULT_PLAY_TIME_MS,
	isPlayTimeMs,
	playTimeMs,
} from "../bot/play-budget";
import { POINT_SYSTEMS, type PointSystem } from "../bridge/hand-points";
import {
	DEFAULT_BOT_SETUP,
	LOCAL_BIDDERS,
	type LocalBidder,
} from "../protocol";
import type { MaybeStorage } from "../session";

/** The colour themes of themes.css; each has a light and a dark palette. */
export const THEMES = ["normal", "solarized", "selenized", "gruvbox"] as const;
export type Theme = (typeof THEMES)[number];

/** The palette of the theme: "auto" follows the light or dark preference of the browser. */
export const SCHEMES = ["auto", "light", "dark"] as const;
export type Scheme = (typeof SCHEMES)[number];

/**
 * Display and bot choices of one player, kept in this browser's local storage and never sent to the table.
 * The language keeps its own storage name.
 */
export interface Settings {
	readonly bidder: LocalBidder;
	/** Local card-search target; a future settings control can edit the persisted value. */
	readonly playTimeMs: number;
	readonly pointSystem: PointSystem;
	/** The points of the hand next to the cards. */
	readonly cardPoints: boolean;
	readonly theme: Theme;
	readonly scheme: Scheme;
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
	bidder: DEFAULT_BOT_SETUP.bidder,
	playTimeMs: DEFAULT_PLAY_TIME_MS,
	pointSystem: "hcp",
	cardPoints: true,
	theme: "normal",
	scheme: "auto",
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
	const flags = Object.fromEntries(
		Object.entries(FLAGS).map(([field, name]) => [
			field,
			readFlag(read(name), DEFAULT_SETTINGS[field as keyof typeof FLAGS]),
		]),
	) as Record<keyof typeof FLAGS, boolean>;
	return {
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
		...flags,
	};
}

/** Saves this browser's display and bot preferences. */
export function writeSettings(storage: MaybeStorage, settings: Settings): void {
	if (!storage) throw new Error("local storage is not available");
	const budget = playTimeMs(settings.playTimeMs);
	if (!LOCAL_BIDDERS.includes(settings.bidder))
		throw new Error("unknown bidding engine");
	storage.setItem(`${PREFIX}bidder`, settings.bidder);
	storage.setItem(`${PREFIX}play-time-ms`, String(budget));
	storage.setItem(`${PREFIX}points`, settings.pointSystem);
	storage.setItem(`${PREFIX}card-points`, settings.cardPoints ? "1" : "0");
	storage.setItem(`${PREFIX}theme-style`, settings.theme);
	storage.setItem(`${PREFIX}scheme`, settings.scheme);
	storage.removeItem(`${PREFIX}theme`);
	for (const [field, name] of Object.entries(FLAGS))
		storage.setItem(
			PREFIX + name,
			settings[field as keyof typeof FLAGS] ? "1" : "0",
		);
}
