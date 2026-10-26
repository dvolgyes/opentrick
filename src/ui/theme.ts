import type { Theme } from "./settings";

/** Shows the page in this theme: themes.css keys each palette to the data-theme attribute of the root element. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
	root.dataset.theme = theme;
}
