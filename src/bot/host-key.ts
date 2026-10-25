import type { MaybeStorage } from "../session";

const STORAGE_KEY = "opentrick.openrouter-api-key";

const KEY_START = "sk-or-v1-";
const KEY_HASH = /^[0-9a-f]{64}$/i;

/**
 * The trimmed key. An OpenRouter key is "sk-or-v1-" and a 64-character hash; when the text before the hash is that
 * start with parts missing, such as "or-v1-" or nothing, the full start replaces it. Any other key stays as typed.
 */
export function normalizeHostApiKey(apiKey: string): string {
	const trimmed = apiKey.trim();
	const start = trimmed.slice(0, -64);
	const hash = trimmed.slice(-64);
	return KEY_HASH.test(hash) && isPartOfKeyStart(start)
		? `${KEY_START}${hash}`
		: trimmed;
}

/** Each character of the text is in the key start, in the same order. */
function isPartOfKeyStart(text: string): boolean {
	let at = 0;
	for (const character of text) {
		at = KEY_START.indexOf(character, at) + 1;
		if (at === 0) return false;
	}
	return true;
}

/** The key stays in this browser's local storage and is never part of room setup. */
export function readHostApiKey(storage: MaybeStorage): string {
	return normalizeHostApiKey(storage?.getItem(STORAGE_KEY) ?? "");
}

export function writeHostApiKey(storage: MaybeStorage, apiKey: string): void {
	if (!storage) throw new Error("local storage is not available");
	const normalized = normalizeHostApiKey(apiKey);
	if (normalized === "") storage.removeItem(STORAGE_KEY);
	else storage.setItem(STORAGE_KEY, normalized);
}
