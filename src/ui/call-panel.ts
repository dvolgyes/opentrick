import type { Medium, Switches } from "../call/policy";
import { englishTranslator, type Translate } from "../i18n";
import { SEAT_NAMES, type Seat } from "../protocol";
import {
	type CallControlsView,
	type CallDisplay,
	callControlsView,
	dismissInvite,
	NO_INVITE,
	nextInvite,
	remoteCallStatus,
	type SwitchView,
	selfPicture,
	type Way,
} from "./call-model";
import { button, el } from "./dom";
import { type IconName, icon } from "./icons";
import { play } from "./remote-audio";

/**
 * The local call controls (handover §2, §6, §7): a box at the bottom-left of the desktop table, and one icon row on
 * compact devices. The switches are the choice that Join starts the call with, so Join needs no second step. The
 * stylesheet shows the copy that fits the device class, so each control has one accessible name in both forms. The
 * controls only call the handlers; the call controller owns every rule.
 *
 * Outside the call the desktop box has three rows: the heading, the switches as icons, and Join call. In the call it
 * is a tile of the own camera, as large as the other players' tiles, with the switches as its caption bar, and Leave
 * call and Mirror below it, where the other tiles have Switch to player. Mirror off shows a text in place of the
 * own camera on this page only.
 *
 * When a guest's page sees the host go into the room call, a dialog in the middle of the screen invites the player:
 * the switches of the device, Join call, and Don't join, which only closes it.
 */

export interface CallHandlers {
	/** The local user confirmed Join with these switches. */
	join(selection: Switches): void;
	leave(): void;
	setSwitch(way: Way, medium: Medium, on: boolean): void;
	retry(seat: Seat): void;
}

export interface CallControls {
	/** Desktop: the panel at the bottom-left of the table. */
	readonly panel: HTMLElement;
	/** Compact: a temporary message about a local problem, above the icon row. */
	readonly alert: HTMLElement;
	/** Compact: the one row of call icons and game actions. */
	readonly row: HTMLElement;
	/** Both forms: the invitation to the host's room call. */
	readonly invite: HTMLDialogElement;
	/** `hostInCall`: this guest's page sees the host in the room call. */
	render(display: CallDisplay, hostInCall?: boolean): void;
}

interface Toggle {
	readonly way: Way;
	readonly medium: Medium;
	readonly icon: IconName;
	/** Spells out the way and the medium; also the tooltip, as the switch shows only its icon. */
	readonly name: string;
}

const SEND_AUDIO: Toggle = {
	way: "send",
	medium: "audio",
	icon: "mic",
	name: "Send mic audio",
};
const RECEIVE_AUDIO: Toggle = {
	way: "receive",
	medium: "audio",
	icon: "speaker",
	name: "Hear others: receive audio",
};
const SEND_VIDEO: Toggle = {
	way: "send",
	medium: "video",
	icon: "camera",
	name: "Send camera video",
};
const RECEIVE_VIDEO: Toggle = {
	way: "receive",
	medium: "video",
	icon: "display",
	name: "See cameras: receive video",
};
const TOGGLES = [SEND_AUDIO, RECEIVE_AUDIO, SEND_VIDEO, RECEIVE_VIDEO] as const;

/** How long the compact message about a local problem stays. */
const ALERT_MS = 6_000;

interface ToggleNode {
	readonly toggle: Toggle;
	readonly node: HTMLButtonElement;
}

/** The icon is the first child; replacing it keeps the focus on the button. */
function setIcon(node: HTMLElement, name: IconName, off: boolean): void {
	const next = icon(name, off);
	const current = node.firstElementChild;
	if (current === null) node.prepend(next);
	else current.replaceWith(next);
}

function setTitle(node: HTMLElement, title: string): void {
	if (title === "") node.removeAttribute("title");
	else node.title = title;
}

/** The switches that are pressed now: what Join starts the call with. */
function pressedSwitches(switches: readonly SwitchView[]): Switches {
	const on = (way: Way, medium: Medium): boolean =>
		switches.some((s) => s.way === way && s.medium === medium && s.pressed);
	return {
		send: { audio: on("send", "audio"), video: on("send", "video") },
		receive: { audio: on("receive", "audio"), video: on("receive", "video") },
	};
}

export function callControls(
	handlers: CallHandlers,
	gameActions: readonly HTMLElement[],
	t: Translate = englishTranslator,
): CallControls {
	const toggles: ToggleNode[] = [];
	const joins: HTMLButtonElement[] = [];
	let last: CallControlsView | undefined;
	let display: CallDisplay | undefined;
	let shownAlert: string | undefined;
	let alertTimer: ReturnType<typeof setTimeout> | undefined;
	/** Desktop: show the own camera in the own tile. Only this page; it never changes what is sent. */
	let mirror = true;
	let selfTrack: MediaStreamTrack | undefined;
	let invite = NO_INVITE;

	function toggleButton(toggle: Toggle): HTMLButtonElement {
		const node = el("button", {
			className: "call-toggle",
			attrs: {
				type: "button",
				"aria-label": t(toggle.name),
				"aria-pressed": "false",
				"data-way": toggle.way,
				"data-medium": toggle.medium,
			},
		});
		setIcon(node, toggle.icon, true);
		node.disabled = true;
		node.addEventListener("click", () =>
			handlers.setSwitch(
				toggle.way,
				toggle.medium,
				node.getAttribute("aria-pressed") !== "true",
			),
		);
		toggles.push({ toggle, node });
		return node;
	}

	function joinButton(withLabel: boolean): HTMLButtonElement {
		const node = el("button", {
			className: "call-join",
			attrs: { type: "button", "aria-label": t("Join call") },
		});
		setIcon(node, "phone", false);
		if (withLabel) node.append(el("span", {}, t("Join call")));
		node.disabled = true;
		node.addEventListener("click", () => {
			if (last?.inCall) handlers.leave();
			else if (last?.rejoin !== undefined) handlers.join(last.rejoin);
			else if (last !== undefined)
				handlers.join(pressedSwitches(last.switches));
		});
		joins.push(node);
		return node;
	}

	const note = el("p", {
		className: "note visually-hidden",
		attrs: { role: "status", "data-testid": "call-note" },
	});
	const retries = el("div", { className: "call-retries" });
	const heading = el("h4", {}, `${t("Optional")} ${t("room call")}`);
	const selfVideo = el("video", {
		attrs: { "aria-hidden": "true", "data-testid": "video-self" },
	});
	selfVideo.muted = true;
	selfVideo.playsInline = true;
	selfVideo.autoplay = true;
	selfVideo.hidden = true;
	const selfText = el(
		"span",
		{ className: "call-self-text" },
		t("VIDEO IN PROGRESS"),
	);
	const selfOff = el("span", {
		className: "call-self-off",
		attrs: { "aria-hidden": "true" },
	});
	selfOff.append(icon("camera", true));
	const self = el(
		"div",
		{ className: "call-self", attrs: { "data-testid": "call-self" } },
		selfOff,
		selfVideo,
		selfText,
	);
	self.hidden = true;
	const mirrorButton = el(
		"button",
		{
			className: "call-mirror",
			attrs: {
				type: "button",
				"aria-label": t("Mirror my camera"),
				"aria-pressed": "true",
			},
		},
		icon("mirror"),
		el("span", {}, t("Mirror")),
	);
	mirrorButton.hidden = true;
	mirrorButton.addEventListener("click", () => {
		mirror = !mirror;
		renderSelf();
	});
	const panel = el(
		"section",
		{
			className: "call-panel",
			attrs: { "aria-label": t("Room call"), "data-testid": "call-panel" },
		},
		heading,
		self,
		retries,
		el(
			"div",
			{ className: "call-switches tile-caption" },
			...TOGGLES.map((toggle) => toggleButton(toggle)),
		),
		el("div", { className: "call-decoration" }, joinButton(true), mirrorButton),
		note,
	);

	const alert = el("p", {
		className: "call-alert visually-hidden",
		attrs: { role: "status", "data-testid": "call-alert" },
	});
	alert.hidden = true;

	const row = el(
		"div",
		{ className: "icon-row", attrs: { "data-testid": "call-row" } },
		el(
			"div",
			{
				className: "icon-group",
				attrs: { role: "group", "aria-label": t("Room call") },
			},
			joinButton(false),
			// Compact devices are audio only: no camera controls.
			toggleButton(SEND_AUDIO),
			toggleButton(RECEIVE_AUDIO),
		),
		el("span", {
			className: "icon-separator",
			attrs: { "aria-hidden": "true" },
		}),
		el(
			"div",
			{
				className: "icon-group game-group",
				attrs: { role: "group", "aria-label": t("Game actions") },
			},
			...gameActions,
		),
	);

	const inviteTitle = el(
		"h2",
		{ attrs: { id: "call-invite-title" } },
		`${t("Optional")} ${t("room call")}`,
	);
	const inviteToggles = TOGGLES.map((toggle) => toggleButton(toggle));
	const inviteJoin = joinButton(true);
	inviteJoin.classList.add("approval-accept");
	inviteJoin.addEventListener("click", dismiss);
	const inviteDialog = el(
		"dialog",
		{
			className: "approval call-invite",
			attrs: {
				"aria-labelledby": inviteTitle.id,
				"data-testid": "call-invite",
			},
		},
		inviteTitle,
		el(
			"p",
			{ className: "approval-question" },
			t("The host started a room call."),
		),
		el("div", { className: "call-invite-switches" }, ...inviteToggles),
		el(
			"div",
			{ className: "approval-actions" },
			inviteJoin,
			button(t("Don't join"), dismiss, { className: "approval-reject" }),
		),
	);
	// Escape is Don't join.
	inviteDialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		dismiss();
	});

	function dismiss(): void {
		invite = dismissInvite(invite);
		renderInvite();
	}

	/** The invitation shows while it is due and this player can join; a phone sees only its audio switches. */
	function renderInvite(): void {
		const media = display?.available ? display.view.media : [];
		for (const node of inviteToggles)
			node.hidden = !media.some((medium) => medium === node.dataset.medium);
		// Not Join's enabled state: with all switches off the invitation stays open, and its Join waits for a switch.
		const open =
			invite.due &&
			display?.available === true &&
			display.view.canJoin &&
			last !== undefined &&
			!last.inCall;
		if (open && !inviteDialog.open && inviteDialog.isConnected)
			inviteDialog.showModal();
		else if (!open && inviteDialog.open) inviteDialog.close();
	}

	function renderJoins(): void {
		const view = last;
		if (view === undefined) return;
		const name = view.joinName;
		for (const node of joins) {
			node.disabled = !view.joinEnabled;
			node.setAttribute("aria-label", name);
			node.dataset.inCall = String(view.inCall);
			setTitle(node, view.joinEnabled ? name : view.note);
			const label = node.querySelector("span");
			if (label !== null) label.textContent = name;
		}
	}

	function renderToggle(item: ToggleNode, view: SwitchView): void {
		const { node, toggle } = item;
		node.disabled = !view.enabled;
		node.setAttribute("aria-pressed", String(view.pressed));
		node.dataset.actual = view.actual;
		const reason = view.disabledReason;
		setTitle(
			node,
			reason === undefined ? t(toggle.name) : `${t(toggle.name)}. ${t(reason)}`,
		);
		setIcon(node, toggle.icon, !view.pressed);
	}

	/** Desktop: the own tile shows the own camera, the text that it is sent while Mirror is off, or a crossed camera. */
	function renderSelf(): void {
		const picture =
			display === undefined ? "none" : selfPicture(display, mirror);
		const track =
			picture === "camera" && display?.available
				? display.view.localVideo
				: undefined;
		if (selfTrack !== track) {
			selfTrack = track;
			selfVideo.srcObject =
				track === undefined ? null : new MediaStream([track]);
			selfVideo.dataset.play = "off";
		}
		selfVideo.hidden = track === undefined;
		if (track !== undefined && selfVideo.paused) play(selfVideo);
		selfText.hidden = picture !== "hidden";
		selfOff.hidden = picture !== "none";
		self.dataset.picture = picture;
		mirrorButton.setAttribute("aria-pressed", String(mirror));
		setIcon(mirrorButton, "mirror", !mirror);
	}

	/** Desktop: one Retry per seat whose direct connection failed (handover §4, §6). */
	function renderRetries(): void {
		const view = display?.available ? display.view : undefined;
		const failed =
			view?.remotes.filter(
				(remote) => remoteCallStatus(remote, view, t).retry,
			) ?? [];
		const key = failed.map((remote) => remote.seat).join("");
		if (retries.dataset.seats === key) return;
		retries.dataset.seats = key;
		retries.replaceChildren(
			...failed.map((remote) => retryButton(remote.seat, handlers, true, t)),
		);
	}

	/** Compact: the message appears when a problem starts and goes away after ALERT_MS. */
	function renderAlert(text: string | undefined): void {
		if (text === shownAlert) return;
		shownAlert = text;
		clearTimeout(alertTimer);
		alert.textContent = text ?? "";
		alert.hidden = text === undefined;
		if (text !== undefined) {
			alertTimer = setTimeout(() => {
				alert.hidden = true;
			}, ALERT_MS);
		}
	}

	function render(next: CallDisplay, hostInCall = false): void {
		display = next;
		const view = callControlsView(next, t);
		last = view;
		invite = nextInvite(invite, hostInCall, view.inCall);
		panel.dataset.status = next.available ? next.view.status : "unavailable";
		panel.dataset.inCall = String(view.inCall);
		heading.hidden = view.inCall;
		self.hidden = !view.inCall;
		mirrorButton.hidden = !view.inCall;
		renderSelf();
		for (const item of toggles) {
			const state = view.switches.find(
				(s) => s.way === item.toggle.way && s.medium === item.toggle.medium,
			);
			if (state !== undefined) renderToggle(item, state);
		}
		renderJoins();
		note.textContent = t(view.note);
		renderRetries();
		renderAlert(view.alert === undefined ? undefined : t(view.alert));
		renderInvite();
	}

	return { panel, alert, row, invite: inviteDialog, render };
}

/**
 * Asks for a new connection attempt to one seat. Only local: it never changes the other player's call. The panel
 * names the seat; the compact seat label already does.
 */
export function retryButton(
	seat: Seat,
	handlers: CallHandlers,
	inPanel: boolean,
	t: Translate = (message) => message,
): HTMLButtonElement {
	const name = SEAT_NAMES[seat];
	return button(
		inPanel ? t("Retry {name}", { name }) : t("Retry"),
		() => handlers.retry(seat),
		{
			className: "call-retry",
			attrs: {
				"aria-label": t("Retry call connection to {name}", { name }),
				"data-testid": `${inPanel ? "call" : "seat"}-retry-${seat}`,
			},
		},
	);
}
