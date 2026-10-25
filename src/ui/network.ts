import { englishTranslator, type Translate } from "../i18n";
import { el } from "./dom";
import type { NetworkLine } from "./model";

export interface NetworkPanel {
	readonly element: HTMLElement;
	render(lines: readonly NetworkLine[]): void;
}

/** A "Network" section, closed unless `open`; it keeps its open state while its lines update. */
export function networkPanel(
	t: Translate = englishTranslator,
	open = false,
): NetworkPanel {
	const list = el("dl", {});
	const element = el(
		"details",
		{ className: "network", attrs: { "data-testid": "network" } },
		el("summary", {}, t("Network")),
		list,
	);
	element.open = open;
	return {
		element,
		render(lines) {
			list.replaceChildren(
				...lines.flatMap((line) => [
					el("dt", {}, line.label),
					el("dd", {}, line.value),
				]),
			);
		},
	};
}
