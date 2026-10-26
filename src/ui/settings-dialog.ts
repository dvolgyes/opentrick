import { POINT_SYSTEMS, type PointSystem } from "../bridge/hand-points";
import { LOCAL_BIDDERS, type LocalBidder } from "../protocol";
import type { AppDeps } from "./deps";
import { button, el } from "./dom";
import { languageSelect, saveLanguage } from "./language-control";
import {
	readSettings,
	SCHEMES,
	type Scheme,
	type Settings,
	THEMES,
	type Theme,
	writeSettings,
} from "./settings";
import { applyTheme, DARK_QUERY } from "./theme";

const POINT_SYSTEM_LABELS: Readonly<Record<PointSystem, string>> = {
	hcp: "Milton/HCP (4-3-2-1)",
	"hcp-corrected": "Corrected Milton HCP",
	vienna: "Vienna (7-5-3-1)",
	reith: "Reith (6-4-3-2-1)",
	"four-aces": "Four Aces (3-2-1-½)",
	other: "Other",
};

const SCHEME_LABELS: Readonly<Record<Scheme, string>> = {
	auto: "Automatic",
	light: "Light",
	dark: "Dark",
};

const THEME_LABELS: Readonly<Record<Theme, string>> = {
	normal: "Normal",
	solarized: "Solarized",
};

const FLAG_LABELS = {
	bidTurnFrame: "Frame the player whose turn it is to bid",
	playTurnFrame: "Frame the player whose turn it is to play",
	bidTurnText: "Show as text whose turn it is to bid",
	playTurnText: "Show as text whose turn it is to play",
	networkQuality: "Show the network quality",
	voicebox: "Show the voice box for a player without video",
} as const satisfies Partial<Record<keyof Settings, string>>;

const ORIENTATION_LABELS = {
	landscapeDesktop: "On a phone or tablet in landscape, show the desktop view",
	portraitMobile: "On a computer with a portrait window, show the mobile view",
} as const satisfies Partial<Record<keyof Settings, string>>;

export interface SettingsDialog {
	readonly element: HTMLDialogElement;
	/** Shows the stored settings. */
	open(): void;
	refreshBidding(): void;
}

/** Local display and bot preferences; a language change reloads the page. */
export function settingsDialog(
	deps: AppDeps,
	reload: () => void,
	saved: (bidder?: LocalBidder) => void = () => {},
	bidding?: () => { readonly bidder: LocalBidder; readonly editable: boolean },
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
	const engine = radios("settings-bidder", "Bidding engine", LOCAL_BIDDERS, {
		sl: "Local · WBridge5 imitation",
		"rl-fsp": "Local · RL/FSP learned system",
	});
	const cardPoints = el("input", { attrs: { type: "checkbox" } });
	points.element.append(
		el("label", {}, cardPoints, ` ${t("Show the points next to the cards")}`),
	);
	const scheme = radios(
		"settings-scheme",
		"Appearance",
		SCHEMES,
		SCHEME_LABELS,
	);
	const theme = radios("settings-theme", "Theme", THEMES, THEME_LABELS);
	const flags = Object.fromEntries(
		Object.keys(FLAG_LABELS).map((field) => [
			field,
			el("input", { attrs: { type: "checkbox" } }),
		]),
	) as Record<keyof typeof FLAG_LABELS, HTMLInputElement>;
	const orientation = Object.fromEntries(
		Object.keys(ORIENTATION_LABELS).map((field) => [
			field,
			el("input", { attrs: { type: "checkbox" } }),
		]),
	) as Record<keyof typeof ORIENTATION_LABELS, HTMLInputElement>;
	const relayChecks = el("input", {
		attrs: { type: "checkbox", "aria-describedby": "settings-relay-checks" },
	});
	const status = el("p", { attrs: { role: "status" } });
	const save = button(t("Save settings"), () => void saveSettings());
	// The settings scroll; the status and the buttons stay below them.
	const content = el(
		"div",
		{
			className: "settings-content",
			attrs: { "data-testid": "settings-content" },
		},
		el("h2", { attrs: { id: "settings-title" } }, t("Settings")),
		el("label", { className: "settings-row" }, `${t("Language")} `, language),
		points.element,
		engine.element,
		scheme.element,
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
			el("legend", {}, t("Screen orientation")),
			...Object.entries(ORIENTATION_LABELS).map(([field, label]) =>
				el(
					"label",
					{},
					orientation[field as keyof typeof ORIENTATION_LABELS],
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
	);
	element.append(
		content,
		el(
			"div",
			{ className: "settings-footer" },
			status,
			el(
				"div",
				{ className: "settings-actions" },
				save,
				button(t("Cancel"), () => element.close()),
			),
		),
	);
	element.addEventListener("close", () => {
		save.disabled = false;
		status.textContent = "";
	});

	function saveSettings(): void {
		const editable = bidding?.().editable ?? true;
		const settings: Settings = {
			bidder: editable ? engine.value() : readSettings(deps.browser).bidder,
			playTimeMs: readSettings(deps.browser).playTimeMs,
			pointSystem: points.value(),
			cardPoints: cardPoints.checked,
			theme: theme.value(),
			scheme: scheme.value(),
			bidTurnFrame: flags.bidTurnFrame.checked,
			playTurnFrame: flags.playTurnFrame.checked,
			bidTurnText: flags.bidTurnText.checked,
			playTurnText: flags.playTurnText.checked,
			networkQuality: flags.networkQuality.checked,
			voicebox: flags.voicebox.checked,
			relayChecks: relayChecks.checked,
			landscapeDesktop: orientation.landscapeDesktop.checked,
			portraitMobile: orientation.portraitMobile.checked,
		};
		try {
			writeSettings(deps.browser, settings);
		} catch {
			status.textContent = t("This browser could not store the settings.");
			return;
		}
		applyTheme(
			element.ownerDocument.documentElement,
			settings.theme,
			settings.scheme,
			element.ownerDocument.defaultView?.matchMedia(DARK_QUERY).matches ??
				false,
		);
		const languageChanged = language.value !== (deps.savedLocale ?? "auto");
		if (languageChanged) saveLanguage(deps, language.value);
		element.close();
		saved(editable ? settings.bidder : undefined);
		if (languageChanged) reload();
	}

	return {
		element,
		refreshBidding() {
			engine.element.disabled = !(bidding?.().editable ?? true);
		},
		open() {
			const settings = readSettings(deps.browser);
			const bot = bidding?.() ?? { bidder: settings.bidder, editable: true };
			engine.set(bot.bidder);
			engine.element.disabled = !bot.editable;
			language.value = deps.savedLocale ?? "auto";
			points.set(settings.pointSystem);
			cardPoints.checked = settings.cardPoints;
			scheme.set(settings.scheme);
			theme.set(settings.theme);
			for (const field of Object.keys(
				FLAG_LABELS,
			) as (keyof typeof FLAG_LABELS)[])
				flags[field].checked = settings[field];
			for (const field of Object.keys(
				ORIENTATION_LABELS,
			) as (keyof typeof ORIENTATION_LABELS)[])
				orientation[field].checked = settings[field];
			relayChecks.checked = settings.relayChecks;
			status.textContent = "";
			save.disabled = false;
			if (!element.open) element.showModal();
		},
	};
}
