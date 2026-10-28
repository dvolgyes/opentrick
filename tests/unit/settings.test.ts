import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_SETUP } from "../../src/protocol";
import { discardLegacyBotSettings } from "../../src/ui/legacy-bot-settings";
import {
	BAIZE_STRENGTHS,
	DEFAULT_SETTINGS,
	PAPER_STRENGTHS,
	readSettings,
	SUIT_COLOR_SCHEMES,
	SUIT_FONT_SIZES,
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
	it("defaults to readable bot pacing and a separate five-second thinking budget", () => {
		expect(readSettings(undefined)).toMatchObject({
			botCardDelayMs: 1000,
			botBidDelayMs: 3000,
			auctionPauseMs: 3000,
			playTimeMs: 5000,
		});
	});
	it("uses HCP, the normal theme in the automatic scheme, every turn and network display, the voice box, no frequent relay checks, the phone layout for a phone in landscape and the mobile view for a portrait window when nothing is stored", () => {
		expect(readSettings(memoryStorage())).toEqual({
			bidder: "sl",
			playTimeMs: 5000,
			botCardDelayMs: 1000,
			botBidDelayMs: 3000,
			auctionPauseMs: 3000,
			pointSystem: "hcp",
			cardPoints: true,
			theme: "selenized",
			scheme: "auto",
			suitFontSize: "M",
			suitColors: "standard",
			baizeStrength: "strong",
			paperStrength: "visible",
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
			bidder: "sl",
			playTimeMs: 150,
			botCardDelayMs: 2000,
			botBidDelayMs: 4000,
			auctionPauseMs: 5000,
			pointSystem: "vienna",
			cardPoints: false,
			theme: "solarized",
			scheme: "dark",
			suitFontSize: "XL",
			suitColors: "green-orange",
			baizeStrength: "mild",
			paperStrength: "mild",
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
		storage.setItem("opentrick.settings.bidder", "../../private");
		storage.setItem("opentrick.settings.points", "goren");
		storage.setItem("opentrick.settings.theme-style", "<b>solarized</b>");
		storage.setItem("opentrick.settings.scheme", "auto ");
		storage.setItem("opentrick.settings.suit-font-size", "200%; color: red");
		storage.setItem("opentrick.settings.suit-colors", "invalid");
		storage.setItem("opentrick.settings.baize-strength", "invalid");
		storage.setItem("opentrick.settings.paper-strength", "invalid");
		storage.setItem("opentrick.settings.bid-turn-frame", "yes");
		expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
	});

	it("stores each card texture strength and rejects invalid values", () => {
		const storage = memoryStorage();
		for (const paperStrength of PAPER_STRENGTHS) {
			writeSettings(storage, { ...DEFAULT_SETTINGS, paperStrength });
			expect(readSettings(storage).paperStrength).toBe(paperStrength);
		}
		expect(() =>
			writeSettings(storage, {
				...DEFAULT_SETTINGS,
				paperStrength: "invalid" as never,
			}),
		).toThrow("unknown card texture strength");
	});

	it("stores each board texture strength and rejects invalid values", () => {
		const storage = memoryStorage();
		for (const baizeStrength of BAIZE_STRENGTHS) {
			writeSettings(storage, { ...DEFAULT_SETTINGS, baizeStrength });
			expect(readSettings(storage).baizeStrength).toBe(baizeStrength);
		}
		expect(() =>
			writeSettings(storage, {
				...DEFAULT_SETTINGS,
				baizeStrength: "invalid" as never,
			}),
		).toThrow("unknown board texture strength");
	});

	it.each(["S", "M", "L", "XL", "XXL", "XXXL"] as const)(
		"persists suit and rank font size %s",
		(suitFontSize) => {
			const storage = memoryStorage();
			expect(SUIT_FONT_SIZES).toContain(suitFontSize);
			writeSettings(storage, { ...DEFAULT_SETTINGS, suitFontSize });
			expect(readSettings(storage).suitFontSize).toBe(suitFontSize);
		},
	);

	it("persists each suit colour scheme and rejects unknown choices", () => {
		const storage = memoryStorage();
		for (const suitColors of SUIT_COLOR_SCHEMES) {
			writeSettings(storage, { ...DEFAULT_SETTINGS, suitColors });
			expect(readSettings(storage).suitColors).toBe(suitColors);
		}
		expect(() =>
			writeSettings(storage, {
				...DEFAULT_SETTINGS,
				suitColors: "invalid" as never,
			}),
		).toThrow("unknown suit colour scheme");
	});

	it("ignores the earlier flat theme, and removes it on the next save", () => {
		const storage = memoryStorage();
		for (const earlier of ["light", "warm", "solarized", "dark", "auto"]) {
			storage.setItem("opentrick.settings.theme", earlier);
			expect(readSettings(storage)).toMatchObject({
				theme: "selenized",
				scheme: "auto",
			});
		}
		writeSettings(storage, DEFAULT_SETTINGS);
		expect(storage.getItem("opentrick.settings.theme")).toBeNull();
		expect(storage.getItem("opentrick.settings.theme-style")).toBe("selenized");
		expect(storage.getItem("opentrick.settings.scheme")).toBe("auto");
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
	it("validates each persisted timing floor and rejects invalid writes before changing storage", () => {
		const storage = memoryStorage();
		for (const [field, key, floor] of [
			["botCardDelayMs", "bot-card-delay-ms", 1000],
			["botBidDelayMs", "bot-bid-delay-ms", 3000],
			["auctionPauseMs", "auction-pause-ms", 3000],
		] as const) {
			for (const value of ["0", String(floor - 1), "60001", "NaN", "1000.5"]) {
				storage.setItem(`opentrick.settings.${key}`, value);
				expect(readSettings(storage)[field]).toBe(floor);
			}
			storage.setItem(`opentrick.settings.${key}`, "60000");
			expect(readSettings(storage)[field]).toBe(60000);
			storage.clear();
			expect(() =>
				writeSettings(storage, { ...DEFAULT_SETTINGS, [field]: floor - 1 }),
			).toThrow(/milliseconds/);
			expect(storage.length).toBe(0);
		}
	});
	it("validates persisted search budgets and rejects an invalid budget before saving", () => {
		const storage = memoryStorage();
		for (const value of [
			"0",
			"-1",
			"NaN",
			"Infinity",
			"60001",
			"0.5",
			"garbage",
		]) {
			storage.setItem("opentrick.settings.play-time-ms", value);
			expect(readSettings(storage).playTimeMs).toBe(5000);
		}
		for (const value of ["150", "5000", "60000"]) {
			storage.setItem("opentrick.settings.play-time-ms", value);
			expect(readSettings(storage).playTimeMs).toBe(Number(value));
		}
		storage.clear();
		expect(() =>
			writeSettings(storage, { ...DEFAULT_SETTINGS, playTimeMs: 0 }),
		).toThrow(/play time/);
		expect(storage.length).toBe(0);
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
	it("defaults to the WBridge5 imitation and discards retired credentials without changing display choices", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.openrouter-api-key", "obsolete-test-key");
		storage.setItem("opentrick.openrouter-spend-usd", "2");
		storage.setItem("opentrick.settings.custom-model", "retired/model");
		storage.setItem("opentrick.settings.model-order", "retired/model");
		storage.setItem("opentrick.settings.theme-style", "solarized");
		storage.setItem("opentrick.settings.scheme", "dark");
		storage.setItem("opentrick.settings.play-time-ms", "250");
		const before = readSettings(storage);
		discardLegacyBotSettings(storage);
		expect(storage.length).toBe(3);
		expect(readSettings(storage)).toEqual(before);
		expect(readSettings(storage)).toMatchObject({
			theme: "solarized",
			scheme: "dark",
			playTimeMs: 250,
		});
		expect(DEFAULT_BOT_SETUP).toEqual({ seats: [], bidder: "sl" });
	});
});
