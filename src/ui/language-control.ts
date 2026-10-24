import { formatBuildDate } from "../build";
import type { AppDeps } from "./deps";
import { el } from "./dom";

const LOCALE_STORAGE_KEY = "opentrick.locale";

/**
 * A select of the languages; "auto" follows the browser's preferred languages, and English when none of them is
 * offered.
 */
export function languageSelect(deps: AppDeps): HTMLSelectElement {
	const select = el("select", {
		attrs: { "aria-label": deps.t("Language"), title: deps.t("Language") },
	});
	select.disabled = deps.browser === undefined;
	for (const [value, label] of [
		["auto", `🌐 ${deps.t("Automatic")}`],
		["en", "🇬🇧 English"],
		["de", "🇩🇪 Deutsch"],
		["hu", "🇭🇺 Magyar"],
		["no", "🇳🇴 Norsk (bokmål)"],
		["es", "🇪🇸 Español"],
		["pt", "🇵🇹 Português"],
		["fr", "🇫🇷 Français"],
		["it", "🇮🇹 Italiano"],
		["nl", "🇳🇱 Nederlands"],
	] as const) {
		const option = el("option", { attrs: { value } }, label);
		option.selected =
			value === "auto" ? deps.savedLocale === undefined : value === deps.locale;
		select.append(option);
	}
	return select;
}

/** Stores the value of a `languageSelect`; the page must reload for it to take effect. */
export function saveLanguage(deps: AppDeps, value: string): void {
	if (value === "auto") deps.browser?.removeItem(LOCALE_STORAGE_KEY);
	else deps.browser?.setItem(LOCALE_STORAGE_KEY, value);
}

/** The build date and the language picker; a change of language reloads the page. */
export function languageControl(deps: AppDeps): HTMLElement {
	const select = languageSelect(deps);
	select.addEventListener("change", () => {
		saveLanguage(deps, select.value);
		location.reload();
	});
	const version = el(
		"span",
		{
			className: "build-version",
			attrs: { title: deps.build.commit, "data-testid": "build-version" },
		},
		formatBuildDate(deps.build.date),
	);
	return el(
		"div",
		{ className: "language-control" },
		version,
		el("label", {}, select),
	);
}
