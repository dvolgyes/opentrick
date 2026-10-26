import { playerName, unnamedPlayer } from "../players";
import { SEAT_NAMES, type Seat } from "../protocol";
import type { AppDeps } from "./deps";
import { button, el } from "./dom";
import { readPersonalName, savePersonalName } from "./personal-name";

/** A suggestion is editable and does not claim a seat until the person confirms. */
export function nameEntry(
	root: HTMLElement,
	deps: AppDeps,
	seat: Seat,
	confirmed: (name: string) => void,
): void {
	if (root.querySelector('[data-testid="name-entry"]')) return;
	const name = el("input", {
		attrs: {
			type: "text",
			autocomplete: "name",
			"aria-label": deps.t("Your name"),
			"data-testid": "personal-name",
		},
	});
	name.value = readPersonalName(deps.browser);
	const error = el("p", { attrs: { role: "alert" } });
	const dialog = el("dialog", {
		attrs: {
			"data-testid": "name-entry",
			"aria-labelledby": "name-entry-title",
		},
	});
	const form = el(
		"form",
		{},
		el(
			"h2",
			{ attrs: { id: "name-entry-title" } },
			deps.t("Join {seat}", { seat: deps.t(SEAT_NAMES[seat]) }),
		),
		el("label", {}, deps.t("Your name"), name),
		error,
		el("button", { attrs: { type: "submit" } }, deps.t("Join game")),
		button(deps.t("Cancel"), () => dialog.close()),
	);
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const value = playerName(name.value);
		if (!value || unnamedPlayer(value)) {
			error.textContent = deps.t("Enter your name to take this seat.");
			return;
		}
		savePersonalName(deps.browser, value);
		dialog.close();
		confirmed(value);
	});
	dialog.addEventListener("close", () => dialog.remove(), { once: true });
	dialog.append(form);
	root.append(dialog);
	dialog.showModal();
	name.focus();
	name.select();
}
