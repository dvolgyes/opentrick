import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_SETUP } from "../../src/protocol";
import { discardLegacyBotSettings } from "../../src/ui/legacy-bot-settings";
import {
	DEFAULT_SETTINGS,
	readSettings,
	writeSettings,
} from "../../src/ui/settings";

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

describe("player settings", () => {
	it("uses HCP, the light theme, every turn and network display, the voice box, no frequent relay checks, the phone layout for a phone in landscape and the mobile view for a portrait window when nothing is stored", () => {
		expect(readSettings(memoryStorage())).toEqual({
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
		});
		expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("reads back what it stores, under the opentrick prefix", () => {
		const storage = memoryStorage();
		const settings = {
			pointSystem: "vienna",
			cardPoints: false,
			theme: "auto",
			bidTurnFrame: false,
			playTurnFrame: true,
			bidTurnText: false,
			playTurnText: false,
			networkQuality: false,
			voicebox: false,
			relayChecks: true,
			landscapeDesktop: false,
			portraitMobile: true,
		} as const;
		writeSettings(storage, settings);
		expect(readSettings(storage)).toEqual(settings);
		for (let index = 0; index < storage.length; index++)
			expect(storage.key(index)).toMatch(/^opentrick\.settings\./);
	});

	it("replaces each unknown or malformed stored value with its default", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.settings.points", "goren");
		storage.setItem("opentrick.settings.theme", "<b>dark</b>");
		storage.setItem("opentrick.settings.bid-turn-frame", "yes");
		expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
	});

	it("reads the earlier choice of no points as the default bidding system without card points", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.settings.points", "none");
		expect(readSettings(storage)).toMatchObject({
			pointSystem: "hcp",
			cardPoints: false,
		});
		storage.setItem("opentrick.settings.card-points", "1");
		expect(readSettings(storage).cardPoints).toBe(true);
	});

	it("throws when the browser cannot store settings", () => {
		expect(() => writeSettings(undefined, DEFAULT_SETTINGS)).toThrow(
			"local storage is not available",
		);
	});
});

describe("local bot migration", () => {
	it("allows a guest to continue when browser storage is denied", () => {
		const storage = memoryStorage();
		storage.removeItem = () => {
			throw new Error("storage denied");
		};
		expect(discardLegacyBotSettings(storage)).toBe(false);
	});
	it("defaults to SL and discards retired credentials without changing display choices", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.openrouter-api-key", "obsolete-test-key");
		storage.setItem("opentrick.openrouter-spend-usd", "2");
		storage.setItem("opentrick.settings.custom-model", "retired/model");
		storage.setItem("opentrick.settings.model-order", "retired/model");
		storage.setItem("opentrick.settings.theme", "dark");
		discardLegacyBotSettings(storage);
		expect(storage.length).toBe(1);
		expect(readSettings(storage).theme).toBe("dark");
		expect(DEFAULT_BOT_SETUP).toEqual({ seats: [], bidder: "sl" });
	});
});
