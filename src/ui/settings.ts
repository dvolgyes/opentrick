import { POINT_SYSTEMS, type PointSystem } from "../bridge/hand-points";
import type { MaybeStorage } from "../session";

export const THEMES = ["light", "dark", "auto"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Display and bot choices of one player, kept in this browser's local storage and never sent to the table.
 * The language keeps its own storage name.
 */
export interface Settings {
	readonly pointSystem: PointSystem;
	/** The points of the hand next to the cards. */
	readonly cardPoints: boolean;
	readonly theme: Theme;
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
	pointSystem: "hcp",
	cardPoints: true,
	theme: "light",
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
	const flags = Object.fromEntries(
		Object.entries(FLAGS).map(([field, name]) => [
			field,
			readFlag(read(name), DEFAULT_SETTINGS[field as keyof typeof FLAGS]),
		]),
	) as Record<keyof typeof FLAGS, boolean>;
	return {
		pointSystem: readChoice(
			storedPoints,
			POINT_SYSTEMS,
			DEFAULT_SETTINGS.pointSystem,
		),
		cardPoints: readFlag(
			read("card-points"),
			storedPoints !== "none" && DEFAULT_SETTINGS.cardPoints,
		),
		theme: readChoice(read("theme"), THEMES, DEFAULT_SETTINGS.theme),
		...flags,
	};
}

/** Saves display preferences independently of the table's bot policy. */
export function writeSettings(storage: MaybeStorage, settings: Settings): void {
	if (!storage) throw new Error("local storage is not available");
	storage.setItem(`${PREFIX}points`, settings.pointSystem);
	storage.setItem(`${PREFIX}card-points`, settings.cardPoints ? "1" : "0");
	storage.setItem(`${PREFIX}theme`, settings.theme);
	for (const [field, name] of Object.entries(FLAGS))
		storage.setItem(
			PREFIX + name,
			settings[field as keyof typeof FLAGS] ? "1" : "0",
		);
}
