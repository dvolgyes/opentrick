import type { Scheme, Theme } from "./settings";

/** The light or dark preference of the browser and the system. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The part of `window` that tells the light or dark preference, and its changes. */
export interface SchemeWindow {
	matchMedia(query: string): {
		readonly matches: boolean;
		addEventListener(type: "change", listener: () => void): void;
		removeEventListener(type: "change", listener: () => void): void;
	};
}

/**
 * Shows the page in this theme and scheme: themes.css keys each palette to the data-theme and data-scheme attributes
 * of the root element. The automatic scheme takes the light or dark preference of the system.
 */
export function applyTheme(
	root: HTMLElement,
	theme: Theme,
	scheme: Scheme,
	prefersDark: boolean,
): void {
	root.dataset.theme = theme;
	root.dataset.scheme =
		scheme === "auto" ? (prefersDark ? "dark" : "light") : scheme;
}

/**
 * Applies the chosen theme now and again whenever the system preference changes, so the automatic scheme follows it.
 * `chosen` is read on each change, so a saved choice applies. Returns the function that stops following.
 */
export function watchTheme(
	root: HTMLElement,
	win: SchemeWindow,
	chosen: () => { readonly theme: Theme; readonly scheme: Scheme },
): () => void {
	const system = win.matchMedia(DARK_QUERY);
	const apply = () => {
		const { theme, scheme } = chosen();
		applyTheme(root, theme, scheme, system.matches);
	};
	apply();
	system.addEventListener("change", apply);
	return () => system.removeEventListener("change", apply);
}
