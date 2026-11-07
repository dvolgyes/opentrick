import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_SETUP } from "../../src/protocol";
import { discardLegacyBotSettings } from "../../src/ui/legacy-bot-settings";
import {
	BAIZE_STRENGTHS,
	DEFAULT_SETTINGS,
	PAPER_STRENGTHS,
	readSettings,
	SHADOW_STRENGTHS,
	SUIT_COLOR_SCHEMES,
	SUIT_FONT_SIZES,
	settingsSaved,
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
			auctionPauseMs: 5000,
			playTimeMs: 5000,
		});
	});
	it("defaults the completed trick display to two seconds and the solo next-board button to visible", () => {
		expect(readSettings(memoryStorage())).toMatchObject({
			trickDisplayMs: 2000,
			trickWinnerPauseMs: 1000,
			soloNextBoard: true,
		});
	});
	it("defaults and remembers the played-card animation preferences", () => {
		const storage = memoryStorage();
		expect(readSettings(storage)).toMatchObject({
			cardPlayAnimation: true,
			cardPlayDurationMs: 2000,
			cardPlayRotationDegrees: 10,
			cardPlayCenterPercent: 25,
		});
		const settings = {
			...DEFAULT_SETTINGS,
			cardPlayAnimation: false,
			cardPlayDurationMs: 0,
			cardPlayRotationDegrees: 20,
			cardPlayCenterPercent: 40,
		};
		writeSettings(storage, settings);
		expect(readSettings(storage)).toMatchObject(settings);
	});

	it("repairs mismatched card animation settings when saving", () => {
		const storage = memoryStorage();
		for (const [cardPlayAnimation, cardPlayDurationMs] of [
			[false, 2000],
			[true, 0],
		] as const) {
			writeSettings(storage, {
				...DEFAULT_SETTINGS,
				cardPlayAnimation,
				cardPlayDurationMs,
			});
			expect(readSettings(storage)).toMatchObject({
				cardPlayAnimation: true,
				cardPlayDurationMs: 1000,
			});
		}
	});

	it("rejects invalid played-card animation values and ignores malformed stored values", () => {
		const storage = memoryStorage();
		for (const [key, value] of [
			["card-play-duration-ms", "-100"],
			["card-play-rotation-degrees", "181"],
			["card-play-center-percent", "101"],
		] as const)
			storage.setItem(`opentrick.settings.${key}`, value);
		expect(readSettings(storage)).toMatchObject({
			cardPlayDurationMs: 2000,
			cardPlayRotationDegrees: 10,
			cardPlayCenterPercent: 25,
		});
		for (const change of [
			{ cardPlayDurationMs: 150 },
			{ cardPlayRotationDegrees: -1 },
			{ cardPlayCenterPercent: 101 },
		])
			expect(() =>
				writeSettings(storage, { ...DEFAULT_SETTINGS, ...change }),
			).toThrow();
	});
	it("uses the default settings when nothing is stored", () => {
		expect(readSettings(memoryStorage())).toEqual({
			bidder: "sl",
			playTimeMs: 5000,
			botCardDelayMs: 1000,
			botBidDelayMs: 3000,
			auctionPauseMs: 5000,
			pointSystem: "hcp-corrected",
			cardPoints: true,
			theme: "selenized",
			scheme: "light",
			suitFontSize: "XXL",
			suitColors: "green-orange",
			baizeStrength: "medium",
			paperStrength: "medium",
			shadowStrength: "4",
			panelTexture: true,
			bidTurnFrame: true,
			playTurnFrame: true,
			bidTurnText: true,
			playTurnText: true,
			networkQuality: true,
			voicebox: true,
			botAnimation: true,
			guidePanel: true,
			guideButton: false,
			botBidHint: true,
			bidConfirmation: true,
			cardPlayAnimation: true,
			cardPlayDurationMs: 2000,
			cardPlayRotationDegrees: 10,
			cardPlayCenterPercent: 25,
			trickAnimation: true,
			trickDisplayMs: 2000,
			trickWinnerPauseMs: 1000,
			soloAutoAdvance: false,
			soloNextBoard: true,
			hideBidBoxWhenWaiting: true,
			relayChecks: false,
			landscapeDesktop: false,
			portraitMobile: true,
		});
		expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("defaults the player's guide to corrected HCP, and preserves a saved choice", () => {
		const storage = memoryStorage();
		expect(readSettings(storage).pointSystem).toBe("hcp-corrected");
		storage.setItem("opentrick.settings.points", "hcp");
		expect(readSettings(storage).pointSystem).toBe("hcp");
	});

	it("keeps a previously saved three-second auction pause", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.settings.auction-pause-ms", "3000");
		expect(readSettings(storage).auctionPauseMs).toBe(3000);
	});

	it("keeps saved choices while using defaults for other settings", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.settings.suit-font-size", "S");
		storage.setItem("opentrick.settings.suit-colors", "standard");
		storage.setItem("opentrick.settings.hide-bid-box-when-waiting", "0");
		expect(readSettings(storage)).toMatchObject({
			suitFontSize: "S",
			suitColors: "standard",
			hideBidBoxWhenWaiting: false,
			theme: "selenized",
			scheme: "light",
			baizeStrength: "medium",
			paperStrength: "medium",
			shadowStrength: "4",
		});
	});

	it("reads back what it stores, under the opentrick prefix", () => {
		const storage = memoryStorage();
		const settings = {
			bidder: "sl",
			playTimeMs: 1000,
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
			shadowStrength: "2",
			panelTexture: false,
			bidTurnFrame: false,
			playTurnFrame: true,
			bidTurnText: false,
			playTurnText: false,
			networkQuality: false,
			voicebox: false,
			botAnimation: false,
			guidePanel: false,
			guideButton: true,
			botBidHint: false,
			bidConfirmation: false,
			cardPlayAnimation: true,
			cardPlayDurationMs: 3500,
			cardPlayRotationDegrees: 20,
			cardPlayCenterPercent: 40,
			trickAnimation: false,
			trickDisplayMs: 4000,
			trickWinnerPauseMs: 1500,
			soloAutoAdvance: true,
			soloNextBoard: false,
			hideBidBoxWhenWaiting: false,
			relayChecks: true,
			landscapeDesktop: false,
			portraitMobile: true,
		} as const;
		writeSettings(storage, settings);
		expect(readSettings(storage)).toEqual(settings);
		for (let index = 0; index < storage.length; index++)
			expect(storage.key(index)).toMatch(/^opentrick\.settings\./);
	});

	it("validates and restores the winner highlight pause", () => {
		const storage = memoryStorage();
		for (const value of ["-1", "5001", "150", "not a number"]) {
			storage.setItem("opentrick.settings.trick-winner-pause-ms", value);
			expect(readSettings(storage).trickWinnerPauseMs).toBe(1000);
		}
		for (const value of [0, 1500, 5000]) {
			writeSettings(storage, {
				...DEFAULT_SETTINGS,
				trickWinnerPauseMs: value,
			});
			expect(readSettings(storage).trickWinnerPauseMs).toBe(value);
		}
		expect(() =>
			writeSettings(storage, { ...DEFAULT_SETTINGS, trickWinnerPauseMs: 5100 }),
		).toThrow();
	});

	it("validates and restores the completed-trick display time", () => {
		const storage = memoryStorage();
		for (const value of ["-1", "60001", "not a number"]) {
			storage.setItem("opentrick.settings.trick-display-ms", value);
			expect(readSettings(storage).trickDisplayMs).toBe(2000);
		}
		storage.setItem("opentrick.settings.trick-display-ms", "0");
		expect(readSettings(storage).trickDisplayMs).toBe(0);
		expect(() =>
			writeSettings(storage, { ...DEFAULT_SETTINGS, trickDisplayMs: 1500 }),
		).toThrow();
	});

	it("knows the first run: no save yet, while a single stored value or no storage does not count", () => {
		const storage = memoryStorage();
		expect(settingsSaved(storage)).toBe(false);
		// A test or an earlier version can store one value without a save.
		storage.setItem("opentrick.settings.play-time-ms", "150");
		expect(settingsSaved(storage)).toBe(false);
		writeSettings(storage, DEFAULT_SETTINGS);
		expect(settingsSaved(storage)).toBe(true);
		// A browser that cannot store the settings cannot leave the first run, so it does not have one.
		expect(settingsSaved(undefined)).toBe(true);
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
		storage.setItem("opentrick.settings.shadow-strength", "invalid");
		storage.setItem("opentrick.settings.bid-turn-frame", "yes");
		storage.setItem("opentrick.settings.guide-button", "<script>");
		storage.setItem("opentrick.settings.hide-bid-box-when-waiting", "yes");
		storage.setItem("opentrick.settings.bid-confirmation", "yes");
		expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
	});

	it("stores the five shadow settings and rejects invalid values", () => {
		const storage = memoryStorage();
		expect(SHADOW_STRENGTHS).toEqual(["0", "1", "2", "3", "4"]);
		for (const shadowStrength of SHADOW_STRENGTHS) {
			writeSettings(storage, { ...DEFAULT_SETTINGS, shadowStrength });
			expect(readSettings(storage).shadowStrength).toBe(shadowStrength);
		}
		expect(() =>
			writeSettings(storage, {
				...DEFAULT_SETTINGS,
				shadowStrength: "invalid" as never,
			}),
		).toThrow("unknown shadow strength");
	});

	it("stores each card texture strength and rejects invalid values", () => {
		expect(PAPER_STRENGTHS).toEqual(["off", "mild", "medium", "strong"]);
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
		expect(BAIZE_STRENGTHS).toEqual(["off", "mild", "medium", "strong"]);
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

	it("preserves the earlier middle texture settings", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.settings.baize-strength", "normal");
		storage.setItem("opentrick.settings.paper-strength", "visible");
		const settings = readSettings(storage);
		expect(settings.baizeStrength).toBe("medium");
		expect(settings.paperStrength).toBe("medium");
		writeSettings(storage, settings);
		expect(storage.getItem("opentrick.settings.baize-strength")).toBe("medium");
		expect(storage.getItem("opentrick.settings.paper-strength")).toBe("medium");
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
				scheme: "light",
			});
		}
		writeSettings(storage, DEFAULT_SETTINGS);
		expect(storage.getItem("opentrick.settings.theme")).toBeNull();
		expect(storage.getItem("opentrick.settings.theme-style")).toBe("selenized");
		expect(storage.getItem("opentrick.settings.scheme")).toBe("light");
	});

	it("reads the earlier choice of no points as the default bidding system without card points", () => {
		const storage = memoryStorage();
		storage.setItem("opentrick.settings.points", "none");
		expect(readSettings(storage)).toMatchObject({
			pointSystem: "hcp-corrected",
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
	it("accepts zero delays, normalizes older fractional seconds, and rejects invalid writes", () => {
		const storage = memoryStorage();
		for (const [field, key, fallback] of [
			["botCardDelayMs", "bot-card-delay-ms", 1000],
			["botBidDelayMs", "bot-bid-delay-ms", 3000],
			["auctionPauseMs", "auction-pause-ms", 5000],
		] as const) {
			for (const value of ["", "-1", "60001", "NaN", "Infinity", "1000.5"]) {
				storage.setItem(`opentrick.settings.${key}`, value);
				expect(readSettings(storage)[field]).toBe(fallback);
			}
			storage.setItem(`opentrick.settings.${key}`, "0");
			expect(readSettings(storage)[field]).toBe(0);
			storage.setItem(`opentrick.settings.${key}`, "1500");
			expect(readSettings(storage)[field]).toBe(2000);
			storage.setItem(`opentrick.settings.${key}`, "60000");
			expect(readSettings(storage)[field]).toBe(60000);
			storage.clear();
			for (const value of [-1, 1500, 60001]) {
				expect(() =>
					writeSettings(storage, { ...DEFAULT_SETTINGS, [field]: value }),
				).toThrow();
				expect(storage.length).toBe(0);
			}
			writeSettings(storage, { ...DEFAULT_SETTINGS, [field]: 0 });
			expect(readSettings(storage)[field]).toBe(0);
			storage.clear();
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
		for (const [value, expected] of [
			["150", 1000],
			["1500", 2000],
			["5000", 5000],
			["60000", 60000],
		] as const) {
			storage.setItem("opentrick.settings.play-time-ms", value);
			expect(readSettings(storage).playTimeMs).toBe(expected);
		}
		storage.clear();
		for (const value of [0, 999, 1500, 60001]) {
			expect(() =>
				writeSettings(storage, { ...DEFAULT_SETTINGS, playTimeMs: value }),
			).toThrow();
			expect(storage.length).toBe(0);
		}
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
			playTimeMs: 1000,
		});
		expect(DEFAULT_BOT_SETUP).toEqual({ seats: [], bidder: "sl" });
	});
});
