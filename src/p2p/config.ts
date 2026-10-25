import { parseStunUrls, rtcConfiguration } from "../call/ice";

/**
 * Mesh settings from the build environment (plan §4.2): the tracker list from `VITE_TRACKER_URLS`, the Nostr relay
 * list from `VITE_NOSTR_RELAY_URLS` and the STUN list from `VITE_STUN_URLS`. The page never falls back to
 * Trystero's own defaults, so a configuration value alone decides which outside services see the page.
 */

/** Unversioned, so pages of different versions meet and report the mismatch. */
export const APP_ID = "github.com/dvolgyes/opentrick";

/** The trackers that relayed an offer between two sockets in every check (ADR 0004). */
export const DEFAULT_TRACKER_URLS: readonly string[] = [
	"wss://tracker.openwebtorrent.com",
	"wss://tracker.webtorrent.dev",
	"wss://open.ftorrent.com",
	"wss://tracker.novage.com.ua",
];

/** The Nostr relays that passed an ephemeral event between two sockets in every check (ADR 0004). */
export const DEFAULT_NOSTR_RELAY_URLS: readonly string[] = [
	"wss://nos.lol",
	"wss://relay.primal.net",
	"wss://relay.snort.social",
	"wss://nostr.mom",
	"wss://offchain.pub",
];

const MAX_RELAY_URLS = 8;

export interface MeshConfig {
	readonly trackers: readonly string[];
	readonly nostrRelays: readonly string[];
	readonly rtc: RTCConfiguration;
}

export type MeshConfigResult =
	| { readonly ok: true; readonly config: MeshConfig }
	| { readonly ok: false; readonly error: string };

type Env = Readonly<Record<string, string | undefined>>;

type UrlsResult =
	| { readonly ok: true; readonly urls: readonly string[] }
	| { readonly ok: false; readonly error: string };

/** Only `wss:` URLs without credentials, query or fragment: a relay sees the page's address, so it must be named. */
function isRelayUrl(text: string): boolean {
	if (!URL.canParse(text)) return false;
	const url = new URL(text);
	return (
		url.protocol === "wss:" &&
		url.hostname !== "" &&
		url.username === "" &&
		url.password === "" &&
		url.search === "" &&
		url.hash === ""
	);
}

/** Empty or absent gives the default; `none` turns the relays off for tests, so no relay of this kind sees the page. */
function parseRelayUrls(
	value: string | undefined,
	defaults: readonly string[],
	name: string,
	variable: string,
): UrlsResult {
	if (value?.trim().toLowerCase() === "none") return { ok: true, urls: [] };
	const urls = (value ?? "").split(/[\s,]+/).filter((url) => url !== "");
	if (urls.length === 0) return { ok: true, urls: defaults };
	if (urls.length > MAX_RELAY_URLS) {
		return {
			ok: false,
			error: `At most ${MAX_RELAY_URLS} ${name} URLs are allowed (${variable}).`,
		};
	}
	const bad = urls.find((url) => !isRelayUrl(url));
	if (bad !== undefined) {
		return {
			ok: false,
			error: `Not a valid wss: ${name} URL in ${variable}: ${bad}`,
		};
	}
	return { ok: true, urls: [...new Set(urls)] };
}

export function parseTrackerUrls(value: string | undefined): UrlsResult {
	return parseRelayUrls(
		value,
		DEFAULT_TRACKER_URLS,
		"tracker",
		"VITE_TRACKER_URLS",
	);
}

export function parseNostrRelayUrls(value: string | undefined): UrlsResult {
	return parseRelayUrls(
		value,
		DEFAULT_NOSTR_RELAY_URLS,
		"Nostr relay",
		"VITE_NOSTR_RELAY_URLS",
	);
}

export function readMeshConfig(env: Env): MeshConfigResult {
	const trackers = parseTrackerUrls(env.VITE_TRACKER_URLS);
	if (!trackers.ok) return trackers;
	const nostr = parseNostrRelayUrls(env.VITE_NOSTR_RELAY_URLS);
	if (!nostr.ok) return nostr;
	// The relay sockets are kept by URL, so one URL cannot serve both protocols.
	const both = trackers.urls.find((url) => nostr.urls.includes(url));
	if (both !== undefined) {
		return {
			ok: false,
			error: `A URL cannot be both a tracker and a Nostr relay: ${both}`,
		};
	}
	const stun = parseStunUrls(env.VITE_STUN_URLS);
	if (!stun.ok) return stun;
	return {
		ok: true,
		config: {
			trackers: trackers.urls,
			nostrRelays: nostr.urls,
			rtc: rtcConfiguration(stun.urls),
		},
	};
}
