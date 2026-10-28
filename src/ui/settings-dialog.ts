import { DEFAULT_BOT_TIMING } from "../bot/timing";
import { POINT_SYSTEMS, type PointSystem } from "../bridge/hand-points";
import { LOCAL_BIDDERS, type LocalBidder } from "../protocol";
import type { AppDeps } from "./deps";
import { button, el } from "./dom";
import { languageSelect, saveLanguage } from "./language-control";
import { BIDDER_NAMES } from "./model";
import {
	BAIZE_STRENGTHS,
	PAPER_STRENGTHS,
	readSettings,
	SCHEMES,
	type Scheme,
	type Settings,
	SHADOW_STRENGTHS,
	SUIT_COLOR_SCHEMES,
	SUIT_FONT_SIZES,
	type SuitColorScheme,
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
	selenized: "Selenized",
	gruvbox: "Gruvbox",
};

/* Clubs, diamonds, hearts, spades: text descriptions for the radio buttons. */
const SUIT_COLOR_NAMES = {
	standard: ["Black", "Red", "Red", "Black"],
	"green-blue": ["Green", "Blue", "Red", "Black"],
	"black-yellow": ["Black", "Yellow", "Red", "Green"],
	"purple-orange": ["Purple", "Orange", "Red", "Black"],
	"blue-yellow": ["Blue", "Yellow", "Red", "Black"],
	"green-orange": ["Green", "Orange", "Red", "Black"],
	"green-yellow-blue": ["Green", "Yellow", "Red", "Blue"],
	"pink-orange": ["Pink", "Orange", "Red", "Black"],
	"pink-yellow-cyan": ["Pink", "Yellow", "Orange", "Cyan"],
} as const satisfies Record<
	SuitColorScheme,
	readonly [string, string, string, string]
>;

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
		translateLabels = true,
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
					el(
						"label",
						{},
						input,
						` ${translateLabels ? t(labels[choices[index] as T]) : labels[choices[index] as T]}`,
					),
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
	const engine = radios(
		"settings-bidder",
		"Bidding bot",
		LOCAL_BIDDERS,
		BIDDER_NAMES,
	);
	const timeInput = (label: string, name: string, minimum: number) => {
		const input = el("input", {
			attrs: {
				type: "number",
				name,
				min: String(minimum / 1000),
				max: "60",
				step: "0.001",
				required: "",
			},
		});
		return {
			input,
			element: el("label", { className: "settings-row" }, label, input),
		};
	};
	const timing = {
		botCardDelayMs: timeInput(
			t("Minimum card time (seconds)"),
			"bot-card-delay",
			DEFAULT_BOT_TIMING.botCardDelayMs,
		),
		botBidDelayMs: timeInput(
			t("Minimum bid time (seconds)"),
			"bot-bid-delay",
			DEFAULT_BOT_TIMING.botBidDelayMs,
		),
		auctionPauseMs: timeInput(
			t("Pause after auction (seconds)"),
			"auction-pause",
			DEFAULT_BOT_TIMING.auctionPauseMs,
		),
		playTimeMs: timeInput(t("Card thinking budget (seconds)"), "play-time", 1),
	};
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
	const baize = el("input", {
		attrs: {
			type: "range",
			min: "0",
			max: "3",
			step: "1",
			name: "settings-baize-strength",
		},
	});
	const baizeValue = el("output", {});
	const updateBaizeLabel = () => {
		const labels = ["Off", "Mild", "Medium", "Strong"] as const;
		const label = t(labels[baize.valueAsNumber] ?? "Medium");
		baizeValue.textContent = label;
		baize.setAttribute("aria-valuetext", label);
	};
	baize.addEventListener("input", updateBaizeLabel);
	const baizeControl = el(
		"fieldset",
		{},
		el("legend", {}, t("Board texture")),
		el(
			"label",
			{ className: "settings-row" },
			`${t("Texture strength")} `,
			baize,
			baizeValue,
		),
	);
	const paper = el("input", {
		attrs: {
			type: "range",
			min: "0",
			max: "3",
			step: "1",
			name: "settings-paper-strength",
		},
	});
	const paperValue = el("output", {});
	const updatePaperLabel = () => {
		const labels = ["Off", "Mild", "Medium", "Strong"] as const;
		const label = t(labels[paper.valueAsNumber] ?? "Medium");
		paperValue.textContent = label;
		paper.setAttribute("aria-valuetext", label);
	};
	paper.addEventListener("input", updatePaperLabel);
	const paperControl = el(
		"fieldset",
		{},
		el("legend", {}, t("Card texture")),
		el(
			"label",
			{ className: "settings-row" },
			`${t("Texture strength")} `,
			paper,
			paperValue,
		),
	);
	const shadow = el("input", {
		attrs: {
			type: "range",
			min: "0",
			max: "4",
			step: "1",
			name: "settings-shadow-strength",
		},
	});
	const shadowValue = el("output", {});
	const updateShadowLabel = () => {
		const label = `${shadow.valueAsNumber * 25}%`;
		shadowValue.textContent = label;
		shadow.setAttribute("aria-valuetext", label);
	};
	shadow.addEventListener("input", updateShadowLabel);
	const shadowControl = el(
		"fieldset",
		{},
		el("legend", {}, t("Shadows")),
		el(
			"label",
			{ className: "settings-row" },
			`${t("Shadow intensity and distance")} `,
			shadow,
			shadowValue,
		),
	);
	const suitFontSize = radios(
		"settings-suit-font-size",
		"Suit and rank font size",
		SUIT_FONT_SIZES,
		{ S: "S", M: "M", L: "L", XL: "XL", XXL: "XXL", XXXL: "XXXL" },
		false,
	);
	const suitColorInputs = SUIT_COLOR_SCHEMES.map((choice, index) => {
		const names = SUIT_COLOR_NAMES[choice];
		const input = el("input", {
			attrs: {
				type: "radio",
				name: "settings-suit-colors",
				value: choice,
				"aria-label": t(
					"Set {number}: clubs {clubs}, diamonds {diamonds}, hearts {hearts}, spades {spades}",
					{
						number: index + 1,
						clubs: t(names[0]),
						diamonds: t(names[1]),
						hearts: t(names[2]),
						spades: t(names[3]),
					},
				),
			},
		});
		const marks = el(
			"span",
			{
				className: "suit-color-preview",
				attrs: { "data-suit-colors": choice },
			},
			...(
				[
					["C", "♣"],
					["D", "♦"],
					["H", "♥"],
					["S", "♠"],
				] as const
			).map(([suit, symbol]) =>
				el("span", { className: `strain-${suit}` }, symbol),
			),
		);
		return {
			input,
			label: el(
				"label",
				{},
				input,
				` ${t("Set {number}", { number: index + 1 })} `,
				marks,
			),
		};
	});
	const suitColors = el(
		"fieldset",
		{},
		el("legend", {}, t("Suit colours")),
		...suitColorInputs.map(({ label }) => label),
	);
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
		scheme.element,
		theme.element,
		baizeControl,
		paperControl,
		shadowControl,
		suitFontSize.element,
		suitColors,
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
		engine.element,
		el(
			"fieldset",
			{},
			el("legend", {}, t("Bot timing")),
			...Object.values(timing).map((control) => control.element),
			el(
				"p",
				{ className: "settings-hint" },
				t(
					"Thinking time counts toward the minimum delay. Bot settings apply when this browser runs the bots.",
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
		for (const { input } of Object.values(timing))
			if (!input.reportValidity()) return;
		const times = Object.fromEntries(
			Object.entries(timing).map(([field, control]) => [
				field,
				Math.round(control.input.valueAsNumber * 1000),
			]),
		) as Pick<Settings, keyof typeof timing>;
		const editable = bidding?.().editable ?? true;
		const settings: Settings = {
			...times,
			bidder: editable ? engine.value() : readSettings(deps.browser).bidder,
			pointSystem: points.value(),
			cardPoints: cardPoints.checked,
			theme: theme.value(),
			scheme: scheme.value(),
			baizeStrength: BAIZE_STRENGTHS[baize.valueAsNumber] ?? "medium",
			paperStrength: PAPER_STRENGTHS[paper.valueAsNumber] ?? "medium",
			shadowStrength: SHADOW_STRENGTHS[shadow.valueAsNumber] ?? "4",
			suitFontSize: suitFontSize.value(),
			suitColors:
				SUIT_COLOR_SCHEMES.find(
					(choice) =>
						suitColorInputs.find(({ input }) => input.value === choice)?.input
							.checked,
				) ?? "standard",
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
		element.ownerDocument.documentElement.dataset.suitFontSize =
			settings.suitFontSize;
		element.ownerDocument.documentElement.dataset.suitColors =
			settings.suitColors;
		element.ownerDocument.documentElement.dataset.baizeStrength =
			settings.baizeStrength;
		element.ownerDocument.documentElement.dataset.paperStrength =
			settings.paperStrength;
		element.ownerDocument.documentElement.dataset.shadowStrength =
			settings.shadowStrength;
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
			for (const field of Object.keys(timing) as (keyof typeof timing)[])
				timing[field].input.value = String(settings[field] / 1000);
			const bot = bidding?.() ?? { bidder: settings.bidder, editable: true };
			engine.set(bot.bidder);
			engine.element.disabled = !bot.editable;
			language.value = deps.savedLocale ?? "auto";
			points.set(settings.pointSystem);
			cardPoints.checked = settings.cardPoints;
			scheme.set(settings.scheme);
			theme.set(settings.theme);
			baize.value = String(BAIZE_STRENGTHS.indexOf(settings.baizeStrength));
			updateBaizeLabel();
			paper.value = String(PAPER_STRENGTHS.indexOf(settings.paperStrength));
			updatePaperLabel();
			shadow.value = String(SHADOW_STRENGTHS.indexOf(settings.shadowStrength));
			updateShadowLabel();
			suitFontSize.set(settings.suitFontSize);
			for (const { input } of suitColorInputs)
				input.checked = input.value === settings.suitColors;
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
