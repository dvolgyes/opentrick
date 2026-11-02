import type { Translate } from "../i18n";
import { button, el } from "./dom";

/** Explains the three entry paths and the browser-held invitation and recovery model. */
export function helpDialog(t: Translate): HTMLDialogElement {
	const dialog = el("dialog", {
		className: "help-dialog",
		attrs: {
			"aria-labelledby": "help-title",
			"aria-describedby": "help-intro",
		},
	});
	const sections = [
		[
			"Play with bots",
			"Start a game with three bots. No invitation is needed.",
		],
		[
			"Invite friends",
			"Without accounts, an invitation link helps friends find the same table. Create a table, copy the complete invitation link, and send it privately to your partner and the other players. Anyone with the link can try to join.",
		],
		[
			"Find online players",
			"Find online players and wait for a compatible table to form automatically. No invitation is needed unless you invite friends to join your group first.",
		],
		[
			"Bot fallback",
			"A seat set to Online, then bot can use a bot after the wait, only when every human allows it and has completed their wait.",
		],
		[
			"Audio and video",
			"Audio and video calls are optional in private games. They are currently disabled for all community games, even if no community player is present. This may change in the future.",
		],
		[
			"Returning to a table",
			"To return, open the full table link in the same browser. Clearing site data removes local seat and recovery records. A saved table on a device expires after about eight hours of inactivity.",
		],
	] as const;
	dialog.append(
		el(
			"div",
			{ className: "help-dialog-heading" },
			el("h2", { attrs: { id: "help-title" } }, t("How to play")),
			button(t("Close"), () => dialog.close(), { className: "help-close" }),
		),
		el(
			"p",
			{ className: "help-intro", attrs: { id: "help-intro" } },
			t(
				"No registration or account is required. A chosen display name is saved in this browser when you start or join a game.",
			),
		),
		el(
			"div",
			{ className: "help-sections" },
			...sections.map(([title, text]) =>
				el("section", {}, el("h3", {}, t(title)), el("p", {}, t(text))),
			),
		),
	);
	return dialog;
}
