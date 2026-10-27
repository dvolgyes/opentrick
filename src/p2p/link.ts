import { base64url, platformRandomBytes, type RandomBytes } from "../ids";

/**
 * The table link fragment (plan §4.1): `#k=<K>`. K is 16 CSPRNG bytes in base64url and is the only key to the table.
 * The fragment never reaches the web server; names and host metadata can be carried in the query.
 * The link carries no protocol version: a client and its peers check `LINK_VERSION` in the `hello` message.
 */

export const LINK_VERSION = "p2p-v1";
const KEY_BYTES = 16;
/** The text length of a key; checked before decoding, because other lengths are not valid base64. */
const KEY_TEXT_LENGTH = 22;
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export type Route =
	| { readonly kind: "create" }
	| { readonly kind: "table"; readonly key: string }
	| { readonly kind: "invalid" };

export function newTableKey(
	randomBytes: RandomBytes = platformRandomBytes,
): string {
	const bytes = randomBytes(KEY_BYTES);
	if (bytes.length !== KEY_BYTES) {
		throw new Error(`expected ${KEY_BYTES} random bytes`);
	}
	return base64url(bytes);
}

/** A canonical encoding of the 16-byte key, so one table has exactly one key text. */
export function isTableKey(value: unknown): value is string {
	if (typeof value !== "string" || value.length !== KEY_TEXT_LENGTH)
		return false;
	if (!KEY_PATTERN.test(value)) return false;
	const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return bytes.length === KEY_BYTES && base64url(bytes) === value;
}

export function parseRoute(hash: string): Route {
	const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
	if (fragment === "") return { kind: "create" };
	const params = new URLSearchParams(fragment);
	if (params.getAll("k").length !== 1) return { kind: "invalid" };
	const key = params.get("k");
	return isTableKey(key) ? { kind: "table", key } : { kind: "invalid" };
}

export function tableFragment(key: string): string {
	if (!isTableKey(key)) throw new Error("invalid table key");
	return `#k=${key}`;
}

/** Absolute link for sharing; `pageUrl` is the current page URL (its fragment is replaced). */
export function tableLink(pageUrl: string, key: string): string {
	const url = new URL(pageUrl);
	url.hash = tableFragment(key);
	return url.toString();
}
