import { describe, expect, it } from "vitest";
import {
	isTableKey,
	newTableKey,
	parseRoute,
	tableFragment,
	tableLink,
} from "../../src/p2p/link";

/** 16 bytes of 0xfb, encoded by Node's own base64url encoder. */
const KEY = "-_v7-_v7-_v7-_v7-_v7-w";

describe("newTableKey", () => {
	it("encodes 16 random bytes as 22 base64url characters", () => {
		expect(newTableKey((length) => new Uint8Array(length).fill(0xfb))).toBe(
			KEY,
		);
	});

	it("gives distinct valid keys from the platform generator", () => {
		const keys = new Set(Array.from({ length: 50 }, () => newTableKey()));
		expect(keys.size).toBe(50);
		for (const key of keys) expect(isTableKey(key)).toBe(true);
	});

	it("refuses a generator that returns the wrong number of bytes", () => {
		expect(() => newTableKey(() => new Uint8Array(15))).toThrow(
			"expected 16 random bytes",
		);
	});
});

describe("isTableKey", () => {
	it.each([
		["21 characters", KEY.slice(0, 21)],
		["23 characters", `${KEY}A`],
		["the 32-byte key of an earlier link", `${KEY}${KEY.slice(0, 21)}`],
		["standard base64", `${KEY.slice(0, 21)}+`],
		["padding", `${KEY.slice(0, 21)}=`],
		// The last character carries 2 unused bits; "x" sets one, so the text is not the canonical encoding.
		["a non-canonical final character", `${KEY.slice(0, 21)}x`],
		["a number", 22],
	])("rejects %s", (_label, value) => {
		expect(isTableKey(value)).toBe(false);
	});
});

describe("parseRoute", () => {
	it("routes an empty fragment to the create page", () => {
		expect(parseRoute("")).toEqual({ kind: "create" });
		expect(parseRoute("#")).toEqual({ kind: "create" });
	});

	it("reads the table link that it writes", () => {
		expect(parseRoute(tableFragment(KEY))).toEqual({ kind: "table", key: KEY });
		const link = tableLink("https://example.org/bridge/?x=1#old", KEY);
		expect(link).toBe(`https://example.org/bridge/?x=1#k=${KEY}`);
		expect(parseRoute(new URL(link).hash)).toEqual({ kind: "table", key: KEY });
	});

	it("ignores a version parameter: the wire protocol checks the version", () => {
		expect(parseRoute(`#v=p2p-v9&k=${KEY}`)).toEqual({
			kind: "table",
			key: KEY,
		});
	});

	it.each([
		["no key", "#v=p2p-v1"],
		["an earlier link key", `#v=p2p-v1&k=${KEY}${KEY.slice(0, 21)}`],
		["a short key", "#k=abc"],
		["a non-canonical key", `#k=${KEY.slice(0, 21)}x`],
		["two keys", `#k=${KEY}&k=${KEY}`],
		["an unknown fragment", "#hello"],
	])("rejects %s", (_label, hash) => {
		expect(parseRoute(hash)).toEqual({ kind: "invalid" });
	});
});

describe("tableFragment", () => {
	it("refuses an invalid key", () => {
		expect(() => tableFragment("abc")).toThrow("invalid table key");
	});
});
