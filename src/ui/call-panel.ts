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
 * Outside the call the desktop box has three rows: the heading, the switches as icons, and Join call. In the call it
 * is a tile of the own camera, as large as the other players' tiles, with the switches as its caption bar, and Leave
 * call and Mirror below it, where the other tiles have Switch to player. Mirror off shows a text in place of the
 * own camera on this page only.
 */

export interface CallHandlers {
	/** The local user confirmed Join with these switches. */
	join(selection: Switches): void;
	leave(): void;
	setSwitch(way: Way, medium: Medium, on: boolean): void;
	retry(seat: Seat): void;
	/** Read browser permission without requesting capture; unsupported queries resolve to `"unknown"`. */
	permission?(medium: Medium): Promise<PermissionState | "unknown">;
}

export interface CallControls {
	/** Desktop: the panel at the bottom-left of the table. */
	readonly panel: HTMLElement;
	/** Compact: a temporary message about a local problem, above the icon row. */
	readonly alert: HTMLElement;
	/** Compact: the one row of call icons and game actions. */
	readonly row: HTMLElement;
	/** Both forms: the shared dialog for local confirmations and incoming invitations. */
	readonly invite: HTMLDialogElement;
	/** `remoteInCall`: this page sees another player in the room call. */
	render(display: CallDisplay, remoteInCall?: boolean): void;
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

const ACTUAL_LABELS = {
	off: "Off",
	pending: "Pending",
	on: "On",
	denied: "Blocked",
	failed: "Unavailable",
} as const;

const PERMISSION_LABELS = {
	granted: "Granted",
	prompt: "Ask when used",
	denied: "Denied",
	unknown: "Unknown",
} as const;

type DialogMode = "join" | "rejoin" | "invite" | "leave";

interface CallChoice {
	readonly mode: DialogMode;
	selection: Switches;
}

/** The icon is the first child; replacing it keeps the focus on the button. */
function setIcon(node: HTMLElement, name: IconName, off: boolean): void {
	const key = `${name}:${off}`;
	if (node.dataset.icon === key) return;
	node.dataset.icon = key;
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
	let choice: CallChoice | undefined;

	function toggleButton(
		toggle: Toggle,
		onToggle?: (on: boolean) => void,
	): HTMLButtonElement {
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
		node.addEventListener("click", () => {
			const on = node.getAttribute("aria-pressed") !== "true";
			if (onToggle === undefined)
				handlers.setSwitch(toggle.way, toggle.medium, on);
			else onToggle(on);
		});
		if (onToggle === undefined) toggles.push({ toggle, node });
		return node;
	}

	function joinButton(
		withLabel: boolean,
		action: () => void,
	): HTMLButtonElement {
		const node = el("button", {
			className: "call-join",
			attrs: { type: "button", "aria-label": t("Join call") },
		});
		setIcon(node, "phone", false);
		if (withLabel) node.append(el("span", {}, t("Join call")));
		node.disabled = true;
		node.addEventListener("click", action);
		return node;
	}

	function callButton(withLabel: boolean): HTMLButtonElement {
		const node = joinButton(withLabel, () => {
			if (!last?.joinEnabled) return;
			openChoice(last.inCall ? "leave" : last.rejoin ? "rejoin" : "join");
		});
		node.setAttribute("aria-haspopup", "dialog");
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
	const selfOffCamera = el("span", { attrs: { "data-medium": "video" } });
	selfOffCamera.append(icon("camera", true));
	const selfOffMic = el("span", { attrs: { "data-medium": "audio" } });
	selfOff.append(selfOffCamera, selfOffMic);
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
		el("div", { className: "call-decoration" }, callButton(true), mirrorButton),
		note,
	);

	const alert = el("p", {
		className: "call-alert visually-hidden",
		attrs: { role: "status", "data-testid": "call-alert" },
	});
	alert.hidden = true;

	const roomCallGroup = el(
		"div",
		{
			className: "icon-group",
			attrs: { role: "group", "aria-label": t("Room call") },
		},
		callButton(false),
		// Compact devices show no video, but can send the camera.
		toggleButton(SEND_AUDIO),
		toggleButton(RECEIVE_AUDIO),
		toggleButton(SEND_VIDEO),
	);
	const row = el(
		"div",
		{ className: "icon-row", attrs: { "data-testid": "call-row" } },
		roomCallGroup,
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

	const dialogTitle = el("h2", { attrs: { id: "call-confirm-title" } });
	const question = el("p", { className: "approval-question" });
	const choiceToggles = TOGGLES.map((toggle) => {
		const node = toggleButton(toggle, (on) => {
			if (!choice || choice.mode === "leave") return;
			choice.selection = {
				...choice.selection,
				[toggle.way]: { ...choice.selection[toggle.way], [toggle.medium]: on },
			};
			renderChoice();
		});
		const status = el("span", {
			className: "call-choice-status",
			attrs: { id: `call-choice-${toggle.way}-${toggle.medium}` },
		});
		node.setAttribute("aria-describedby", status.id);
		node.append(
			el("span", { className: "call-choice-label" }, t(toggle.name), status),
		);
		return { node, toggle, status };
	});
	const permissions = (["audio", "video"] as const).map((medium) => ({
		medium,
		node: el("p", { attrs: { "data-medium": medium } }),
	}));
	const permissionSummary = el(
		"div",
		{ className: "call-permissions", attrs: { "aria-live": "polite" } },
		...permissions.map(({ node }) => node),
	);
	const confirmButton = joinButton(true, confirmChoice);
	const cancelButton = button(t("Don't join"), dismissChoice);
	cancelButton.autofocus = true;
	const dialog = el(
		"dialog",
		{
			className: "approval call-confirm",
			attrs: { "aria-labelledby": dialogTitle.id },
		},
		dialogTitle,
		question,
		el(
			"div",
			{ className: "call-choice-switches" },
			...choiceToggles.map(({ node }) => node),
		),
		permissionSummary,
		el("div", { className: "approval-actions" }, cancelButton, confirmButton),
	);
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		dismissChoice();
	});

	function closeChoice(): void {
		choice = undefined;
		dialog.close();
		dialog.removeAttribute("data-testid");
		dialog.classList.remove("call-invite");
	}

	function dismissChoice(): void {
		if (choice?.mode === "invite") invite = dismissInvite(invite);
		closeChoice();
	}

	function confirmChoice(): void {
		if (!choice || !last || confirmButton.disabled) return;
		if (choice.mode === "leave") {
			closeChoice();
			handlers.leave();
			return;
		}
		const selection = pressedSwitches(last.switches.map(choiceSwitch));
		invite = dismissInvite(invite);
		closeChoice();
		handlers.join(selection);
	}

	async function readPermission(
		current: CallChoice,
		medium: Medium,
		node: HTMLElement,
	): Promise<void> {
		const label =
			medium === "audio"
				? "Microphone permission: {state}"
				: "Camera permission: {state}";
		node.textContent = t(label, { state: t("Unknown") });
		const state = (await handlers.permission?.(medium)) ?? "unknown";
		if (choice === current && dialog.open && dialog.isConnected)
			node.textContent = t(label, { state: t(PERMISSION_LABELS[state]) });
	}

	function openChoice(mode: DialogMode): void {
		if (choice || !dialog.isConnected || !last?.joinEnabled) return;
		const leaving = mode === "leave";
		const invited = mode === "invite";
		const name = invited ? t("Join call") : last.joinName;
		const current = {
			mode,
			selection: last.rejoin ?? pressedSwitches(last.switches),
		};
		choice = current;
		dialog.dataset.testid = invited ? "call-invite" : "call-confirm";
		dialog.classList.toggle("call-invite", invited);
		dialogTitle.textContent = name;
		question.hidden = !invited;
		question.textContent = invited ? t("A player started a room call.") : "";
		confirmButton.classList.toggle("approval-accept", !leaving);
		confirmButton.classList.toggle("approval-reject", leaving);
		confirmButton.dataset.inCall = String(leaving);
		confirmButton.setAttribute("aria-label", name);
		const label = confirmButton.querySelector("span");
		if (label) label.textContent = name;
		cancelButton.textContent = leaving ? t("Stay in call") : t("Don't join");
		cancelButton.classList.toggle("approval-accept", leaving);
		cancelButton.classList.toggle("approval-reject", !leaving);
		permissionSummary.hidden = leaving;
		renderChoice();
		dialog.showModal();
		if (!leaving)
			for (const { medium, node } of permissions)
				void readPermission(current, medium, node);
	}

	function choiceSwitch(state: SwitchView): SwitchView {
		if (!choice || choice.mode === "leave") return state;
		const { way, medium } = state;
		const selected = choice.selection[way][medium];
		const available =
			display?.available && display.view.media[way].includes(medium);
		const cameraMissing =
			way === "send" &&
			medium === "video" &&
			display?.available &&
			display.cameraAvailable === false;
		return {
			...state,
			enabled: available === true && (!cameraMissing || selected),
			pressed: available === true && selected,
		};
	}

	function renderChoice(): void {
		if (!choice || !last) return;
		const leaving = choice.mode === "leave";
		let hasMedia = false;
		for (const item of choiceToggles) {
			const view = last.switches.find(
				(s) => s.way === item.toggle.way && s.medium === item.toggle.medium,
			);
			if (!view) continue;
			const state = choiceSwitch(view);
			const missingCamera =
				state.way === "send" &&
				state.medium === "video" &&
				display?.available &&
				display.cameraAvailable === false;
			hasMedia ||= state.pressed && !missingCamera;
			renderToggle(item, leaving ? { ...state, enabled: false } : state);
			const selected = t(state.pressed ? "On" : "Off");
			const status = leaving
				? t("Selected: {state} · Actual: {actual}", {
						state: selected,
						actual: t(ACTUAL_LABELS[state.actual]),
					})
				: selected;
			const text =
				state.disabledReason === undefined
					? status
					: `${status} — ${state.disabledReason}`;
			if (item.status.textContent !== text) item.status.textContent = text;
		}
		confirmButton.disabled = !leaving && !hasMedia;
	}

	function updateDialog(): void {
		if (!last) return;
		if (
			choice &&
			(!last.joinEnabled ||
				last.inCall !== (choice.mode === "leave") ||
				(choice.mode === "invite" && !invite.due))
		)
			closeChoice();
		if (choice) renderChoice();
		else if (invite.due && last.joinEnabled && !last.inCall)
			openChoice("invite");
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
		const offHint =
			!view.pressed && toggle.medium === "audio"
				? toggle.way === "send"
					? t("No audio is sent; others can't hear you")
					: t("Silent; you can't hear anyone")
				: undefined;
		setTitle(
			node,
			reason === undefined
				? (offHint ?? t(toggle.name))
				: `${t(toggle.name)}. ${t(reason)}`,
		);
		setIcon(node, toggle.icon, !view.pressed);
	}

	/**
	 * Desktop: the own tile shows the own camera, the text that it is sent while Mirror is off, or a crossed camera
	 * beside a mic that is crossed while the mic is not sent.
	 */
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
		setIcon(
			selfOffMic,
			"mic",
			!(display?.available && display.view.mic === "on"),
		);
		setTitle(
			selfOffMic,
			display?.available && display.view.mic === "on"
				? t("Send mic audio")
				: t("No audio is sent; others can't hear you"),
		);
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

	function render(next: CallDisplay, remoteInCall = false): void {
		display = next;
		const view = callControlsView(next, t);
		last = view;
		invite = nextInvite(invite, remoteInCall, view.inCall);
		panel.dataset.status = next.available ? next.view.status : "unavailable";
		panel.dataset.botsOnly = String(!next.available && next.botsOnly === true);
		roomCallGroup.dataset.botsOnly = String(
			!next.available && next.botsOnly === true,
		);
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
		updateDialog();
	}

	return { panel, alert, row, invite: dialog, render };
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
