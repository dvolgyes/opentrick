import type { AppDeps } from "./deps";
import { el } from "./dom";

/** This count is local direct connections, not a global count of people. */
export function discoveryCount(deps: AppDeps): {
	element: HTMLElement;
	dispose: () => void;
} {
	const element = el("p", { attrs: { "data-testid": "discovery-count" } });
	const update = () => {
		const count = deps.discovery?.count;
		element.textContent =
			count === undefined
				? deps.t("Discovery connection unavailable")
				: `${deps.t("Connected browsers in discovery")}: ${count}`;
	};
	const dispose = deps.discovery?.subscribe(update) ?? (() => {});
	update();
	return { element, dispose };
}
