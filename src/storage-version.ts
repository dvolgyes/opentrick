import { TRANSFERS_PREFIX } from "./community/journal";
import { ROOM_PREFIX } from "./community/session";
import { STORAGE_VERSION } from "./p2p/storage";
import { CLIENT_PREFIX } from "./p2p/table";
import {
	BROWSER_PREFIX,
	HOST_PREFIX,
	type MaybeStorage,
	TAB_PREFIX,
} from "./session";

const VERSION_KEY = "opentrick.storage-version";
/** The builds before the version key stored version 1. */
const UNVERSIONED = 1;
/** The game data of the tables and the community rooms. The name, the language and the settings stay. */
const GAME_PREFIXES = [
	CLIENT_PREFIX,
	BROWSER_PREFIX,
	HOST_PREFIX,
	TAB_PREFIX,
	ROOM_PREFIX,
	TRANSFERS_PREFIX,
];

/**
 * Drops the game data of an older storage version from both web storages, then stores `version` (ADR 0008).
 * IndexedDB drops its tables when the page opens it at the new version (src/p2p/storage.ts). The data of a newer
 * version stays, so that a page of an older build in another tab drops nothing. Without localStorage, the stored
 * version is unknown, and nothing changes.
 */
export function dropOldGameData(
	browser: MaybeStorage,
	tab: MaybeStorage,
	version = STORAGE_VERSION,
): void {
	if (!browser) return;
	const text = browser.getItem(VERSION_KEY);
	const number = text === null ? UNVERSIONED : Number(text);
	// An unreadable version counts as older.
	const stored = Number.isSafeInteger(number) ? number : 0;
	if (stored < version) {
		for (const storage of [browser, tab]) {
			if (!storage) continue;
			const keys: string[] = [];
			for (let index = 0; index < storage.length; index++) {
				const key = storage.key(index);
				if (key && GAME_PREFIXES.some((prefix) => key.startsWith(prefix)))
					keys.push(key);
			}
			for (const key of keys) storage.removeItem(key);
		}
	}
	if (stored < version || text === null)
		browser.setItem(VERSION_KEY, String(version));
}
