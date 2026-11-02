import type { AppDeps } from "./deps";
import { button, el } from "./dom";
import { helpDialog } from "./help-dialog";
import { languageControl } from "./language-control";
import { sitePath } from "./site-path";

/** Shared opening and community navigation. */
export function siteHeader(deps: AppDeps): HTMLElement {
	const help = helpDialog(deps.t);
	return el(
		"div",
		{ className: "create-header" },
		el(
			"a",
			{
				className: "opening-brand",
				attrs: { href: sitePath(new URL(deps.pageUrl()).pathname, "home") },
			},
			el(
				"span",
				{ className: "opening-brand-mark", attrs: { "aria-hidden": "true" } },
				"♠",
			),
			el("span", {}, "OpenTrick"),
		),
		languageControl(deps),
		button(deps.t("Help"), () => help.showModal(), {
			className: "opening-help",
		}),
		help,
	);
}
