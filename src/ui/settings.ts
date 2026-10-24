import { POINT_SYSTEMS, type PointSystem } from "../bridge/hand-points";
import { BOT_MODELS, type BotModel } from "../protocol";
import type { MaybeStorage } from "../session";

export const THEMES = ["light", "dark", "auto"] as const;
export type Theme = (typeof THEMES)[number];

/** The place of the custom model in the model order. Model ids contain "/", so it cannot name a model. */
export const CUSTOM_MODEL_SLOT = "custom";
export type ModelSlot = BotModel | typeof CUSTOM_MODEL_SLOT;

/**
 * Display and bot choices of one player, kept in this browser's local storage and never sent to the table.
 * The language and the OpenRouter key keep their own storage names.
 */
export interface Settings {
	readonly pointSystem: PointSystem;
	readonly theme: Theme;
	readonly bidTurnFrame: boolean;
	readonly playTurnFrame: boolean;
	readonly bidTurnText: boolean;
	readonly playTurnText: boolean;
	readonly networkQuality: boolean;
	/** An OpenRouter model id, or "" for none. */
	readonly customModel: string;
	/** Each built-in model and the custom slot once; the slot is last while the custom model is "". */
	readonly modelOrder: readonly ModelSlot[];
}

export const DEFAULT_SETTINGS: Settings = {
	pointSystem: "hcp-corrected",
	theme: "light",
	bidTurnFrame: true,
	playTurnFrame: true,
	bidTurnText: true,
	playTurnText: true,
	networkQuality: true,
	customModel: "",
	modelOrder: [...BOT_MODELS, CUSTOM_MODEL_SLOT],
};

const PREFIX = "opentrick.settings.";
const FLAGS = {
	bidTurnFrame: "bid-turn-frame",
	playTurnFrame: "play-turn-frame",
	bidTurnText: "bid-turn-text",
	playTurnText: "play-turn-text",
	networkQuality: "network-quality",
} as const satisfies Partial<Record<keyof Settings, string>>;

const MODEL_ID = /^~?[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._~:-]+$/;
const MODEL_ID_MAX_LENGTH = 200;

/** Why `model` (already trimmed) cannot be the custom model, as an English message; undefined when it can. */
export function customModelProblem(model: string): string | undefined {
	if (model === "") return undefined;
	if (model.length > MODEL_ID_MAX_LENGTH || !MODEL_ID.test(model))
		return "Enter an OpenRouter model id, for example vendor/model.";
	if ((BOT_MODELS as readonly string[]).includes(model))
		return "This model is already in the list.";
	return undefined;
}

/**
 * Each built-in model once, in the stored order, then the missing ones in their default order. A set custom
 * model keeps its stored place, or goes first when the stored order has none; an empty one goes last.
 */
export function resolveModelOrder(
	stored: readonly string[] | undefined,
	customModel: string,
): ModelSlot[] {
	const known = new Set<string>([...BOT_MODELS, CUSTOM_MODEL_SLOT]);
	const order = [...new Set(stored ?? [])].filter((slot): slot is ModelSlot =>
		known.has(slot),
	);
	for (const model of BOT_MODELS) if (!order.includes(model)) order.push(model);
	const builtIn = order.filter((slot) => slot !== CUSTOM_MODEL_SLOT);
	if (customModel === "") return [...builtIn, CUSTOM_MODEL_SLOT];
	return order.includes(CUSTOM_MODEL_SLOT)
		? order
		: [CUSTOM_MODEL_SLOT, ...builtIn];
}

/** The model ids to ask, in order; an empty custom model is left out. */
export function effectiveModelOrder(settings: Settings): string[] {
	return settings.modelOrder.flatMap((slot) =>
		slot !== CUSTOM_MODEL_SLOT
			? [slot]
			: settings.customModel === ""
				? []
				: [settings.customModel],
	);
}

function readChoice<T extends string>(
	value: string | null | undefined,
	choices: readonly T[],
	fallback: T,
): T {
	return choices.find((choice) => choice === value) ?? fallback;
}

function readFlag(
	value: string | null | undefined,
	fallback: boolean,
): boolean {
	return value === "1" ? true : value === "0" ? false : fallback;
}

/** Stored text is untrusted: each value that is not a valid choice reads as its default. */
export function readSettings(storage: MaybeStorage): Settings {
	const read = (name: string): string | null | undefined =>
		storage?.getItem(PREFIX + name);
	const storedModel = (read("custom-model") ?? "").trim();
	const customModel =
		customModelProblem(storedModel) === undefined ? storedModel : "";
	const storedOrder = read("model-order");
	const flags = Object.fromEntries(
		Object.entries(FLAGS).map(([field, name]) => [
			field,
			readFlag(read(name), DEFAULT_SETTINGS[field as keyof typeof FLAGS]),
		]),
	) as Record<keyof typeof FLAGS, boolean>;
	return {
		pointSystem: readChoice(
			read("points"),
			POINT_SYSTEMS,
			DEFAULT_SETTINGS.pointSystem,
		),
		theme: readChoice(read("theme"), THEMES, DEFAULT_SETTINGS.theme),
		...flags,
		customModel,
		modelOrder: resolveModelOrder(
			storedOrder ? storedOrder.split(",") : undefined,
			customModel,
		),
	};
}

/** An empty custom model is not stored in the order, so setting one later puts it first. */
export function writeSettings(storage: MaybeStorage, settings: Settings): void {
	if (!storage) throw new Error("local storage is not available");
	storage.setItem(`${PREFIX}points`, settings.pointSystem);
	storage.setItem(`${PREFIX}theme`, settings.theme);
	for (const [field, name] of Object.entries(FLAGS))
		storage.setItem(
			PREFIX + name,
			settings[field as keyof typeof FLAGS] ? "1" : "0",
		);
	if (settings.customModel === "") storage.removeItem(`${PREFIX}custom-model`);
	else storage.setItem(`${PREFIX}custom-model`, settings.customModel);
	storage.setItem(
		`${PREFIX}model-order`,
		settings.modelOrder
			.filter(
				(slot) => settings.customModel !== "" || slot !== CUSTOM_MODEL_SLOT,
			)
			.join(","),
	);
}
