import { describe, expect, it } from "vitest";
import {
	normalizeHostApiKey,
	readHostApiKey,
	writeHostApiKey,
} from "../../src/bot/host-key";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => void values.delete(key),
		setItem: (key, value) => values.set(key, value),
	};
}

describe("host OpenRouter API key", () => {
	it("trims the key when saving and when reading older stored values", () => {
		const storage = memoryStorage();
		writeHostApiKey(storage, "  fresh-key\n");
		expect(readHostApiKey(storage)).toBe("fresh-key");

		storage.setItem("opentrick.openrouter-api-key", "\tlegacy-key  ");
		expect(readHostApiKey(storage)).toBe("legacy-key");
	});

	it("removes a saved key when the input contains only whitespace", () => {
		const storage = memoryStorage();
		writeHostApiKey(storage, "  key  ");
		writeHostApiKey(storage, " \n\t ");
		expect(readHostApiKey(storage)).toBe("");
	});
});

describe("the sk-or-v1- start of an OpenRouter key", () => {
	const hash = "0123456789abcdef".repeat(4);
	const key = `sk-or-v1-${hash}`;

	it("is added in full, or where parts of it are missing, after the trim", () => {
		for (const start of [
			"",
			"-",
			"1-",
			"v1-",
			"-v1-",
			"r-v1-",
			"or-v1-",
			"-or-v1-",
			"k-or-v1-",
			"sk-or-v1-",
			"sk-",
			"sk-or-",
			"sk-or-v1",
			"skorv1",
			"or-",
		])
			expect(normalizeHostApiKey(` \t${start}${hash}\n`), start).toBe(key);
	});

	it("is not added to a key that has no 64-character hash at the end, or other text before it", () => {
		for (const other of [
			"test-key",
			hash.slice(1),
			`sk-or-v1-${hash.slice(1)}`,
			`sk-or-v1-${hash}0`,
			`sk-or-v2-${hash}`,
			`sk-proj-${hash}`,
			`x${hash}`,
			`${hash.slice(0, 63)}g`,
		])
			expect(normalizeHostApiKey(other), other).toBe(other);
	});

	it("is in the stored key", () => {
		const storage = memoryStorage();
		writeHostApiKey(storage, `or-v1-${hash}`);
		expect(storage.getItem("opentrick.openrouter-api-key")).toBe(key);
		storage.setItem("opentrick.openrouter-api-key", hash);
		expect(readHostApiKey(storage)).toBe(key);
	});
});
