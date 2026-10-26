import { describe, expect, it } from "vitest";
import { readPersonalName, savePersonalName } from "../../src/ui/personal-name";

it("stores the personal name without a timestamp or expiry and provides a normalized suggestion", () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
		key: () => null,
		length: 0,
	};
	expect(readPersonalName(storage)).toBe("");
	expect(savePersonalName(storage, " Ce\u0301line ")).toBe(true);
	expect([...values]).toEqual([["opentrick.player-name", "Céline"]]);
	expect(readPersonalName(storage)).toBe("Céline");
	expect(savePersonalName(storage, "player")).toBe(false);
	expect(readPersonalName(storage)).toBe("Céline");
});

describe("without persistent browser storage", () => {
	it("provides an empty suggestion and reports that a name cannot be stored", () => {
		expect(readPersonalName(undefined)).toBe("");
		expect(savePersonalName(undefined, "Alice")).toBe(false);
	});
});
