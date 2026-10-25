import type { Form } from "./device-class";

/**
 * Pure call media policy (handover §2, §3). Local preferences change only through the local functions here;
 * a peer's preferences are inputs to the peer's side of `allowed` and are never written into local ones.
 */

export const MEDIA = ["audio", "video"] as const;
export type Medium = (typeof MEDIA)[number];

export type Direction = "sendrecv" | "sendonly" | "recvonly" | "inactive";

export interface MediaSwitches {
	readonly audio: boolean;
	readonly video: boolean;
}

/** The four consent switches: Send audio, Receive audio, Send video, Receive video. */
export interface Switches {
	readonly send: MediaSwitches;
	readonly receive: MediaSwitches;
}

export interface Prefs extends Switches {
	readonly inCall: boolean;
}

/** One side of a pair: its preferences and its device class. */
export interface Party {
	readonly prefs: Prefs;
	readonly form: Form;
}

export type PresetId = "out" | "audio" | "camera" | "watch" | "both" | "listen";

export interface Preset {
	readonly id: PresetId;
	readonly label: string;
	readonly switches: Switches;
}

function switches(
	sendAudio: boolean,
	receiveAudio: boolean,
	sendVideo: boolean,
	receiveVideo: boolean,
): Switches {
	return {
		send: { audio: sendAudio, video: sendVideo },
		receive: { audio: receiveAudio, video: receiveVideo },
	};
}

/** Handover §2 table, in its order. */
export const PRESETS: readonly Preset[] = [
	{
		id: "out",
		label: "Not in call",
		switches: switches(false, false, false, false),
	},
	{
		id: "audio",
		label: "Audio only",
		switches: switches(true, true, false, false),
	},
	{
		id: "camera",
		label: "Send camera; hear others",
		switches: switches(true, true, true, false),
	},
	{
		id: "watch",
		label: "See cameras; send voice",
		switches: switches(true, true, false, true),
	},
	{
		id: "both",
		label: "Audio + video both ways",
		switches: switches(true, true, true, true),
	},
	{
		id: "listen",
		label: "Listen only",
		switches: switches(false, true, false, false),
	},
];

export const NOT_IN_CALL: Prefs = {
	inCall: false,
	...switches(false, false, false, false),
};

export function presetById(id: PresetId): Preset {
	const preset = PRESETS.find((p) => p.id === id);
	if (preset === undefined) throw new Error(`unknown call preset: ${id}`);
	return preset;
}

/**
 * Whether the device shows a received medium: a compact device shows no video. Every device can send both media.
 * The switches keep their values on every device, so the desktop view receives video again after a rotation.
 */
export function receives(form: Form, medium: Medium): boolean {
	return medium === "audio" || form === "desktop";
}

/** A switch that works on this device is on. */
function anyOn(value: Switches, form: Form): boolean {
	return MEDIA.some(
		(m) => value.send[m] || (value.receive[m] && receives(form, m)),
	);
}

/** The local user confirms Join. All available switches off means the user stays outside the call. */
export function join(selection: Switches, form: Form): Prefs {
	return {
		inCall: anyOn(selection, form),
		send: selection.send,
		receive: selection.receive,
	};
}

/**
 * The status that the peers hear (handover §2: "A denied or missing device disables that outgoing capability"):
 * the Send switch of each `unavailable` medium is off. The local switches keep the user's request.
 */
export function sendable(prefs: Prefs, unavailable: readonly Medium[]): Prefs {
	return {
		...prefs,
		send: {
			audio: prefs.send.audio && !unavailable.includes("audio"),
			video: prefs.send.video && !unavailable.includes("video"),
		},
	};
}

export function samePrefs(a: Prefs, b: Prefs): boolean {
	return (
		a.inCall === b.inCall &&
		MEDIA.every(
			(medium) =>
				a.send[medium] === b.send[medium] &&
				a.receive[medium] === b.receive[medium],
		)
	);
}

/** Leave keeps the switches as the next default but ends participation. */
export function leave(prefs: Prefs): Prefs {
	return { ...prefs, inCall: false };
}

/**
 * One local switch change. Turning the last switch that works on this device off leaves the call; turning a switch
 * on outside the call does not join it (Join needs its own confirmation).
 */
export function setSwitch(
	prefs: Prefs,
	form: Form,
	way: "send" | "receive",
	medium: Medium,
	on: boolean,
): Prefs {
	const changed: Switches = {
		...prefs,
		[way]: { ...prefs[way], [medium]: on },
	};
	return { ...changed, inCall: prefs.inCall && anyOn(changed, form) };
}

/**
 * Handover §3 `allowed(A → B, m)` without the membership term: the caller creates links only for current seat
 * holders (call-layout plan §4.1). An unknown peer (`undefined`) never grants anything.
 */
export function allowed(
	from: Party | undefined,
	to: Party | undefined,
	medium: Medium,
): boolean {
	if (from === undefined || to === undefined) return false;
	return (
		from.prefs.inCall &&
		to.prefs.inCall &&
		from.prefs.send[medium] &&
		to.prefs.receive[medium] &&
		receives(to.form, medium)
	);
}

export function direction(send: boolean, receive: boolean): Direction {
	if (send && receive) return "sendrecv";
	if (send) return "sendonly";
	if (receive) return "recvonly";
	return "inactive";
}

export interface MediumPlan {
	readonly send: boolean;
	readonly receive: boolean;
	readonly direction: Direction;
}

/** What the local side may send to and receive from one peer, per medium. */
export function mediaPlan(
	local: Party,
	remote: Party | undefined,
): Readonly<Record<Medium, MediumPlan>> {
	const plan = (medium: Medium): MediumPlan => {
		const send = allowed(local, remote, medium);
		const receive = allowed(remote, local, medium);
		return { send, receive, direction: direction(send, receive) };
	};
	return { audio: plan("audio"), video: plan("video") };
}
