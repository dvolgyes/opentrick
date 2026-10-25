import {
	normalizeHostApiKey,
	readHostApiKey,
	writeHostApiKey,
} from "../bot/host-key";
import { checkOpenRouterKey } from "../bot/key-check";
import { POINT_SYSTEMS, type PointSystem } from "../bridge/hand-points";
import { type BotModel, botModelLabel } from "../protocol";
import type { AppDeps } from "./deps";
import { button, el } from "./dom";
import { languageSelect, saveLanguage } from "./language-control";
import {
	CUSTOM_MODEL_SLOT,
	customModelProblem,
	effectiveModelOrder,
	type ModelSlot,
	readSettings,
	resolveModelOrder,
	type Settings,
	THEMES,
	type Theme,
	writeSettings,
} from "./settings";

const POINT_SYSTEM_LABELS: Readonly<Record<PointSystem, string>> = {
	hcp: "Milton/HCP (4-3-2-1)",
	"hcp-corrected": "Corrected Milton HCP",
	vienna: "Vienna (7-5-3-1)",
	reith: "Reith (6-4-3-2-1)",
	"four-aces": "Four Aces (3-2-1-½)",
	other: "Other",
};

const THEME_LABELS: Readonly<Record<Theme, string>> = {
	light: "Light",
	dark: "Dark",
	auto: "Automatic",
};

const FLAG_LABELS = {
	bidTurnFrame: "Frame the player whose turn it is to bid",
	playTurnFrame: "Frame the player whose turn it is to play",
	bidTurnText: "Show as text whose turn it is to bid",
	playTurnText: "Show as text whose turn it is to play",
	networkQuality: "Show the network quality",
} as const satisfies Partial<Record<keyof Settings, string>>;

export interface SettingsDialog {
	readonly element: HTMLDialogElement;
	/** Shows the stored settings. */
	open(): void;
}

/** What a Save changed that a running table must apply. */
export interface SavedSettings {
	/** The model that accepted a new OpenRouter key or custom model; undefined when Save checked nothing. */
	readonly checkedModel: string | undefined;
	readonly modelOrderChanged: boolean;
}

/**
 * The player's own settings, kept in this browser. Save checks a new OpenRouter key, or a custom model, with one
 * request before it stores anything; a failed check keeps the dialog open with the reason. A new language reloads the
 * page; any other change calls `saved`, so the page can apply it.
 */
export function settingsDialog(
	deps: AppDeps,
	reload: () => void,
	saved: (change: SavedSettings) => void = () => {},
): SettingsDialog {
	const { t } = deps;
	const element = el("dialog", {
		className: "settings-dialog",
		attrs: {
			"aria-labelledby": "settings-title",
			"data-testid": "settings-dialog",
		},
	});
	const language = languageSelect(deps);
	const radios = <T extends string>(
		name: string,
		legend: string,
		choices: readonly T[],
		labels: Readonly<Record<T, string>>,
	): { element: HTMLFieldSetElement; value(): T; set(value: T): void } => {
		const inputs = choices.map((choice) =>
			el("input", { attrs: { type: "radio", name, value: choice } }),
		);
		return {
			element: el(
				"fieldset",
				{},
				el("legend", {}, t(legend)),
				...inputs.map((input, index) =>
					el("label", {}, input, ` ${t(labels[choices[index] as T])}`),
				),
			),
			value: () =>
				(inputs.find((input) => input.checked)?.value ?? choices[0]) as T,
			set(value) {
				for (const input of inputs) input.checked = input.value === value;
			},
		};
	};
	const points = radios(
		"settings-points",
		"Bidding system",
		POINT_SYSTEMS,
		POINT_SYSTEM_LABELS,
	);
	const cardPoints = el("input", { attrs: { type: "checkbox" } });
	points.element.append(
		el("label", {}, cardPoints, ` ${t("Show the points next to the cards")}`),
	);
	const theme = radios("settings-theme", "Theme", THEMES, THEME_LABELS);
	const flags = Object.fromEntries(
		Object.keys(FLAG_LABELS).map((field) => [
			field,
			el("input", { attrs: { type: "checkbox" } }),
		]),
	) as Record<keyof typeof FLAG_LABELS, HTMLInputElement>;
	const relayChecks = el("input", {
		attrs: { type: "checkbox", "aria-describedby": "settings-relay-checks" },
	});
	const apiKey = el("input", {
		attrs: {
			type: "password",
			autocomplete: "new-password",
			"aria-label": t("OpenRouter API key"),
		},
	});
	apiKey.addEventListener("input", () => {
		apiKey.value = normalizeHostApiKey(apiKey.value);
	});
	const customModel = el("input", {
		attrs: {
			type: "text",
			autocomplete: "off",
			spellcheck: "false",
			placeholder: "vendor/model",
			"aria-label": t("Custom model"),
		},
	});
	const orderList = el("ol", {
		className: "model-priority-list",
		attrs: { "aria-label": t("Bot model order") },
	});
	const status = el("p", { attrs: { role: "status" } });
	let order: ModelSlot[] = [];
	let shownModel = "";
	// A Cancel or a new Save makes the result of a running check irrelevant.
	let attempt = 0;

	const slotLabel = (slot: ModelSlot): string =>
		slot !== CUSTOM_MODEL_SLOT
			? botModelLabel(slot)
			: shownModel === ""
				? t("Custom model (not set)")
				: shownModel;

	const renderOrder = (): void => {
		// An empty custom model stays last, so only the slots before it move.
		const movable = shownModel === "" ? order.length - 1 : order.length;
		orderList.replaceChildren(
			...order.map((slot, index) => {
				const label = slotLabel(slot);
				const move = (offset: -1 | 1): void => {
					const target = index + offset;
					if (target < 0 || target >= movable) return;
					[order[index], order[target]] = [
						order[target] as ModelSlot,
						order[index] as ModelSlot,
					];
					renderOrder();
				};
				return el(
					"li",
					{ attrs: { "data-model": slot } },
					el(
						"span",
						{ className: "model-priority-label" },
						`${index + 1}. ${label}`,
					),
					button("↑", () => move(-1), {
						attrs: {
							"aria-label": t("Move {model} up", { model: label }),
							...(index === 0 || index >= movable ? { disabled: "" } : {}),
						},
					}),
					button("↓", () => move(1), {
						attrs: {
							"aria-label": t("Move {model} down", { model: label }),
							...(index >= movable - 1 ? { disabled: "" } : {}),
						},
					}),
				);
			}),
		);
	};

	customModel.addEventListener("input", () => {
		const next = customModel.value.trim();
		// A custom model that was empty was not in the order the player chose, so it goes first again.
		order = resolveModelOrder(
			shownModel === ""
				? order.filter((slot) => slot !== CUSTOM_MODEL_SLOT)
				: order,
			next,
		);
		shownModel = next;
		renderOrder();
	});

	const save = button(t("Save settings"), () => void saveSettings());
	element.append(
		el("h2", { attrs: { id: "settings-title" } }, t("Settings")),
		el("label", { className: "settings-row" }, `${t("Language")} `, language),
		points.element,
		theme.element,
		el(
			"fieldset",
			{},
			el("legend", {}, t("Turn and network display")),
			...Object.entries(FLAG_LABELS).map(([field, label]) =>
				el(
					"label",
					{},
					flags[field as keyof typeof FLAG_LABELS],
					` ${t(label)}`,
				),
			),
		),
		el(
			"fieldset",
			{},
			el("legend", {}, t("Connection")),
			el("label", {}, relayChecks, ` ${t("Check the connection more often")}`),
			el(
				"p",
				{
					className: "settings-hint",
					attrs: { id: "settings-relay-checks" },
				},
				t(
					"Turn this on if your network connection is unstable, for example on a train, on weak mobile data or on Wi-Fi that drops. The page then finds a lost connection sooner, and it sends a few more messages to the public relays.",
				),
			),
		),
		el(
			"fieldset",
			{},
			el("legend", {}, t("Bots")),
			el(
				"label",
				{ className: "settings-row" },
				`${t("OpenRouter API key")} `,
				apiKey,
			),
			el(
				"label",
				{ className: "settings-row" },
				`${t("Custom model")} `,
				customModel,
			),
			el("p", { className: "settings-order-title" }, t("Bot model order")),
			orderList,
		),
		status,
		el(
			"div",
			{ className: "settings-actions" },
			save,
			button(t("Cancel"), () => element.close()),
		),
	);
	element.addEventListener("close", () => {
		attempt++;
		save.disabled = false;
		status.textContent = "";
	});

	async function saveSettings(): Promise<void> {
		const current = attempt + 1;
		attempt = current;
		const stored = readSettings(deps.browser);
		const storedKey = readHostApiKey(deps.browser);
		const key = normalizeHostApiKey(apiKey.value);
		const model = customModel.value.trim();
		const problem = customModelProblem(model);
		if (problem !== undefined) {
			status.textContent = t(problem);
			return;
		}
		if (model !== "" && key === "") {
			status.textContent = t(
				"Enter an OpenRouter API key to use a custom model.",
			);
			return;
		}
		const settings: Settings = {
			pointSystem: points.value(),
			cardPoints: cardPoints.checked,
			theme: theme.value(),
			bidTurnFrame: flags.bidTurnFrame.checked,
			playTurnFrame: flags.playTurnFrame.checked,
			bidTurnText: flags.bidTurnText.checked,
			playTurnText: flags.playTurnText.checked,
			networkQuality: flags.networkQuality.checked,
			relayChecks: relayChecks.checked,
			customModel: model,
			modelOrder: resolveModelOrder(order, model),
		};
		const changed = key !== storedKey || model !== stored.customModel;
		let checkedModel: string | undefined;
		if (key !== "" && changed) {
			// A custom model must answer with this key; without one, the first model checks the key.
			const checked = model !== "" ? model : effectiveModelOrder(settings)[0];
			if (checked === undefined)
				throw new Error("the model order has no model to check");
			save.disabled = true;
			status.textContent = t("Checking the OpenRouter key with {model}…", {
				model: checked,
			});
			// The request sends the model id as text; BotModel only names the built-in models.
			const result = await checkOpenRouterKey(key, checked as BotModel);
			if (attempt !== current) return;
			save.disabled = false;
			if (!result.ok) {
				status.textContent = t(
					"The OpenRouter key check with {model} failed: {reason}",
					{ model: checked, reason: result.reason },
				);
				return;
			}
			checkedModel = checked;
		}
		try {
			writeHostApiKey(deps.browser, key);
			writeSettings(deps.browser, settings);
		} catch {
			status.textContent = t("This browser could not store the settings.");
			return;
		}
		const languageChanged = language.value !== (deps.savedLocale ?? "auto");
		if (languageChanged) saveLanguage(deps, language.value);
		element.close();
		if (languageChanged) reload();
		else
			saved({
				checkedModel,
				modelOrderChanged:
					effectiveModelOrder(settings).join(",") !==
					effectiveModelOrder(stored).join(","),
			});
	}

	return {
		element,
		open() {
			const settings = readSettings(deps.browser);
			language.value = deps.savedLocale ?? "auto";
			points.set(settings.pointSystem);
			cardPoints.checked = settings.cardPoints;
			theme.set(settings.theme);
			for (const field of Object.keys(
				FLAG_LABELS,
			) as (keyof typeof FLAG_LABELS)[])
				flags[field].checked = settings[field];
			relayChecks.checked = settings.relayChecks;
			apiKey.value = readHostApiKey(deps.browser);
			customModel.value = settings.customModel;
			shownModel = settings.customModel;
			order = [...settings.modelOrder];
			renderOrder();
			status.textContent = "";
			save.disabled = false;
			if (!element.open) element.showModal();
		},
	};
}
