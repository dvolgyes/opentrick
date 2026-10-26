import { describe, expect, it } from "vitest";
import { BOT_MODEL } from "../../src/bot/strategy";
import { BOT_MODELS, DEFAULT_BOT_SETUP } from "../../src/protocol";
import {
	CUSTOM_MODEL_SLOT,
	customModelProblem,
	DEFAULT_SETTINGS,
	effectiveModelOrder,
	readSettings,
	resolveModelOrder,
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

const CUSTOM = "anthropic/claude-sonnet-5.5";

describe("player settings", () => {
	it("uses corrected HCP, the light theme, every turn and network display, the voice box, no frequent relay checks, the phone layout for a phone in landscape and the mobile view for a portrait window when nothing is stored", () => {
		expect(readSettings(memoryStorage())).toEqual({
			pointSystem: "hcp-corrected",
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
			customModel: "",
			modelOrder: [...BOT_MODELS, CUSTOM_MODEL_SLOT],
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
			customModel: CUSTOM,
			modelOrder: [
				BOT_MODELS[2],
				CUSTOM_MODEL_SLOT,
				...BOT_MODELS.filter((model) => model !== BOT_MODELS[2]),
			],
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
		storage.setItem("opentrick.settings.custom-model", "not a model");
		storage.setItem(
			"opentrick.settings.model-order",
			`unknown/model,${BOT_MODELS[3]},${BOT_MODELS[3]}`,
		);
		expect(readSettings(storage)).toEqual({
			...DEFAULT_SETTINGS,
			modelOrder: [
				BOT_MODELS[3],
				...BOT_MODELS.filter((model) => model !== BOT_MODELS[3]),
				CUSTOM_MODEL_SLOT,
			],
		});
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
});

describe("custom model", () => {
	it("accepts an OpenRouter model id and rejects other text", () => {
		expect(customModelProblem("")).toBeUndefined();
		expect(customModelProblem(CUSTOM)).toBeUndefined();
		expect(customModelProblem("~openai/gpt-sol-latest:free")).toBeUndefined();
		expect(customModelProblem("gpt")).toBeDefined();
		expect(customModelProblem("a/b,c/d")).toBeDefined();
		expect(customModelProblem("a/b c")).toBeDefined();
		expect(customModelProblem(`a/${"b".repeat(200)}`)).toBeDefined();
		expect(customModelProblem(BOT_MODELS[0])).toBeDefined();
	});
});

describe("model order", () => {
	const rotated = [...BOT_MODELS.slice(1), BOT_MODELS[0]];

	it("puts a set custom model first when no order is stored", () => {
		expect(resolveModelOrder(undefined, CUSTOM)).toEqual([
			CUSTOM_MODEL_SLOT,
			...BOT_MODELS,
		]);
	});

	it("puts a set custom model first when the stored order has no custom model", () => {
		expect(resolveModelOrder(rotated, CUSTOM)).toEqual([
			CUSTOM_MODEL_SLOT,
			...rotated,
		]);
	});

	it("keeps the stored place of a set custom model", () => {
		const stored = [BOT_MODELS[1], CUSTOM_MODEL_SLOT, ...rotated.slice(1)];
		expect(resolveModelOrder(stored, CUSTOM)).toEqual(stored);
	});

	it("puts an empty custom model last, whatever the stored order says", () => {
		expect(resolveModelOrder([CUSTOM_MODEL_SLOT, ...rotated], "")).toEqual([
			...rotated,
			CUSTOM_MODEL_SLOT,
		]);
	});

	it("adds missing built-in models in their default order", () => {
		expect(resolveModelOrder([BOT_MODELS[4]], "")).toEqual([
			BOT_MODELS[4],
			...BOT_MODELS.filter((model) => model !== BOT_MODELS[4]),
			CUSTOM_MODEL_SLOT,
		]);
	});

	it("names the models to ask, without an empty custom model", () => {
		expect(
			effectiveModelOrder({
				...DEFAULT_SETTINGS,
				customModel: CUSTOM,
				modelOrder: [BOT_MODELS[1], CUSTOM_MODEL_SLOT, ...rotated.slice(1)],
			}),
		).toEqual([BOT_MODELS[1], CUSTOM, ...rotated.slice(1)]);
		expect(effectiveModelOrder(DEFAULT_SETTINGS)).toEqual([...BOT_MODELS]);
	});
});

describe("the default bot model", () => {
	it("is Luna, with Mercury as the fallback, in the settings and in a new room", () => {
		expect(effectiveModelOrder(DEFAULT_SETTINGS).slice(0, 2)).toEqual([
			"openai/gpt-6-luna",
			"inception/mercury-3",
		]);
		expect(DEFAULT_BOT_SETUP.model).toBe("openai/gpt-6-luna");
		expect(DEFAULT_BOT_SETUP.fallbackModel).toBe("inception/mercury-3");
		expect(BOT_MODEL).toBe("openai/gpt-6-luna");
	});
});
