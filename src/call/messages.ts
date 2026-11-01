import { isRoomId } from "../ids";
import { isObject, isSeat, type JsonObject, type Seat } from "../protocol";
import type { Form } from "./device-class";
import type { MediaSwitches, Prefs } from "./policy";

/**
 * Call signaling messages (call/layout plan §4.4). The call transport wraps each message in an envelope with the
 * sender's seat and generation from the roster binding, so the sender identity comes only from the envelope.
 * Every parser rebuilds its value from the known fields, so unknown fields never pass through.
 */

/** At most 9 digits in the inbox topic. */
export const MAX_GENERATION = 999_999_999;

/** The sender's current call state. Every message that can introduce or update a peer carries it. */
export interface Announcement {
	readonly prefs: Prefs;
	/** Increases with each local change in one session; an older value than the last one seen is ignored. */
	readonly prefVersion: number;
	/** Decides whether this side receives video. */
	readonly form: Form;
}

export interface AnnounceMessage extends Announcement {
	readonly type: "join" | "resync" | "prefs";
	/** Sender call session: new for each Join, so a new value retires the old link to that seat. */
	readonly session: string;
}

export interface LeaveMessage {
	readonly type: "leave";
	readonly session: string;
}

/** The media itself is negotiated by Trystero on the table's connection (ADR 0009), not with these messages. */
export type CallMessage = AnnounceMessage | LeaveMessage;

/** One received message with the sender fields that the transport set. */
export interface CallEnvelope {
	readonly from: Seat;
	readonly fromGen: number;
	readonly message: CallMessage;
}

/** The seat holder that owns one inbox. */
export interface InboxIdentity {
	readonly roomId: string;
	readonly seat: Seat;
	readonly generation: number;
}

const SESSION_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `crypto.randomUUID()` output. */
export function isSession(value: unknown): value is string {
	return typeof value === "string" && SESSION_PATTERN.test(value);
}

function isIntegerIn(
	value: unknown,
	min: number,
	max: number,
): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= min &&
		value <= max
	);
}

function isGeneration(value: unknown): value is number {
	return isIntegerIn(value, 1, MAX_GENERATION);
}

/** The inbox topic of one seat holder. */
export function inboxTopic(inbox: InboxIdentity): string {
	if (
		!isRoomId(inbox.roomId) ||
		!isSeat(inbox.seat) ||
		!isGeneration(inbox.generation)
	) {
		throw new Error("invalid call inbox identity");
	}
	return `call:${inbox.roomId}:${inbox.seat}:${inbox.generation}`;
}

function parseSwitches(value: unknown): MediaSwitches | undefined {
	if (
		!isObject(value) ||
		typeof value.audio !== "boolean" ||
		typeof value.video !== "boolean"
	) {
		return undefined;
	}
	return { audio: value.audio, video: value.video };
}

export function parsePrefs(value: unknown): Prefs | undefined {
	if (!isObject(value) || typeof value.inCall !== "boolean") return undefined;
	const send = parseSwitches(value.send);
	const receive = parseSwitches(value.receive);
	if (send === undefined || receive === undefined) return undefined;
	return { inCall: value.inCall, send, receive };
}

function parseAnnouncement(value: JsonObject): Announcement | undefined {
	const prefs = parsePrefs(value.prefs);
	const { prefVersion, form } = value;
	if (
		prefs === undefined ||
		!isIntegerIn(prefVersion, 0, Number.MAX_SAFE_INTEGER) ||
		(form !== "desktop" && form !== "compact")
	) {
		return undefined;
	}
	return { prefs, prefVersion, form };
}

export function parseCallMessage(value: unknown): CallMessage | undefined {
	if (!isObject(value) || !isSession(value.session)) return undefined;
	const { type, session } = value;
	switch (type) {
		case "leave":
			return { type, session };
		case "join":
		case "resync":
		case "prefs": {
			const announcement = parseAnnouncement(value);
			return announcement && { type, session, ...announcement };
		}
		default:
			return undefined;
	}
}

/**
 * A payload for this inbox. Unknown keys are ignored. The room and the addressed generation must be this inbox's.
 */
export function parseEnvelope(
	value: unknown,
	inbox: InboxIdentity,
): CallEnvelope | undefined {
	if (
		!isObject(value) ||
		value.v !== 1 ||
		value.roomId !== inbox.roomId ||
		value.toGen !== inbox.generation
	) {
		return undefined;
	}
	const { from, fromGen } = value;
	if (!isSeat(from) || from === inbox.seat || !isGeneration(fromGen))
		return undefined;
	const message = parseCallMessage(value.message);
	return message && { from, fromGen, message };
}
