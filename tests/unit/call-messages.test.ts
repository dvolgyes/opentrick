import { describe, expect, it } from "vitest";
import {
	type InboxIdentity,
	inboxTopic,
	isSession,
	MAX_GENERATION,
	parseCallMessage,
	parseEnvelope,
} from "../../src/call/messages";

const ROOM = "abcdefghijklmnopqrstuv";
const SESSION_A = "0f8e2c1a-1b2c-4d3e-8f90-a1b2c3d4e5f6";
const PREFS = {
	inCall: true,
	send: { audio: true, video: false },
	receive: { audio: true, video: true },
};
const ANNOUNCEMENT = { prefs: PREFS, prefVersion: 3, form: "desktop" };

function join(extra: Record<string, unknown> = {}) {
	return { type: "join", session: SESSION_A, ...ANNOUNCEMENT, ...extra };
}

describe("isSession", () => {
	it("accepts a lowercase UUID and rejects other text", () => {
		expect(isSession(SESSION_A)).toBe(true);
		expect(isSession(SESSION_A.toUpperCase())).toBe(false);
		expect(isSession(SESSION_A.slice(1))).toBe(false);
		expect(isSession(42)).toBe(false);
	});
});

describe("inboxTopic", () => {
	it("builds the topic that the receive policy expects", () => {
		expect(inboxTopic({ roomId: ROOM, seat: "E", generation: 7 })).toBe(
			`call:${ROOM}:E:7`,
		);
		expect(
			inboxTopic({ roomId: ROOM, seat: "N", generation: MAX_GENERATION }),
		).toBe(`call:${ROOM}:N:999999999`);
	});

	it.each([
		{ roomId: "short", seat: "N", generation: 1 },
		{ roomId: ROOM, seat: "X", generation: 1 },
		{ roomId: ROOM, seat: "N", generation: 0 },
		{ roomId: ROOM, seat: "N", generation: MAX_GENERATION + 1 },
		{ roomId: ROOM, seat: "N", generation: 1.5 },
	])("throws on an invalid identity %o", (inbox) => {
		expect(() => inboxTopic(inbox as InboxIdentity)).toThrow(
			"invalid call inbox identity",
		);
	});
});

describe("parseCallMessage: announcements", () => {
	it.each(["join", "resync", "prefs"])("accepts %s", (type) => {
		expect(parseCallMessage(join({ type }))).toEqual({
			type,
			session: SESSION_A,
			...ANNOUNCEMENT,
		});
	});

	it("drops unknown keys at every level", () => {
		const parsed = parseCallMessage(
			join({
				extra: 1,
				prefs: { ...PREFS, extra: 2, send: { ...PREFS.send, extra: 3 } },
			}),
		);
		expect(parsed).toEqual({
			type: "join",
			session: SESSION_A,
			...ANNOUNCEMENT,
		});
	});

	it("accepts prefVersion 0 and rejects negative or fractional versions", () => {
		expect(parseCallMessage(join({ prefVersion: 0 }))).toBeDefined();
		expect(parseCallMessage(join({ prefVersion: -1 }))).toBeUndefined();
		expect(parseCallMessage(join({ prefVersion: 1.5 }))).toBeUndefined();
		expect(parseCallMessage(join({ prefVersion: "1" }))).toBeUndefined();
	});

	it("accepts only the two device classes", () => {
		expect(parseCallMessage(join({ form: "compact" }))).toBeDefined();
		expect(parseCallMessage(join({ form: "tablet" }))).toBeUndefined();
		expect(parseCallMessage(join({ form: undefined }))).toBeUndefined();
	});

	it("rejects incomplete preferences", () => {
		expect(
			parseCallMessage(join({ prefs: { ...PREFS, inCall: "yes" } })),
		).toBeUndefined();
		expect(
			parseCallMessage(join({ prefs: { ...PREFS, send: { audio: true } } })),
		).toBeUndefined();
		expect(
			parseCallMessage(join({ prefs: { ...PREFS, receive: null } })),
		).toBeUndefined();
	});

	it("rejects a missing or malformed session and an unknown type", () => {
		expect(parseCallMessage(join({ session: undefined }))).toBeUndefined();
		expect(parseCallMessage(join({ session: "me" }))).toBeUndefined();
		expect(parseCallMessage(join({ type: "hello" }))).toBeUndefined();
		// The media is negotiated on the table connection now (ADR 0009).
		for (const type of ["offer", "answer", "ice"]) {
			expect(parseCallMessage(join({ type, sdp: "v=0" }))).toBeUndefined();
		}
		expect(parseCallMessage([join()])).toBeUndefined();
		expect(parseCallMessage(null)).toBeUndefined();
	});

	it("accepts leave with only a session", () => {
		expect(
			parseCallMessage({ type: "leave", session: SESSION_A, prefs: PREFS }),
		).toEqual({ type: "leave", session: SESSION_A });
		expect(parseCallMessage({ type: "leave" })).toBeUndefined();
	});
});

describe("parseEnvelope", () => {
	const inbox: InboxIdentity = { roomId: ROOM, seat: "N", generation: 4 };
	const envelope = (extra: Record<string, unknown> = {}) => ({
		v: 1,
		roomId: ROOM,
		from: "E",
		fromGen: 2,
		toGen: 4,
		id: "3e0c5f7a-0000-4000-8000-000000000000",
		message: join(),
		...extra,
	});

	it("accepts the database envelope and ignores the added id", () => {
		expect(parseEnvelope(envelope(), inbox)).toEqual({
			from: "E",
			fromGen: 2,
			message: { type: "join", session: SESSION_A, ...ANNOUNCEMENT },
		});
	});

	it.each([
		["another version", { v: 2 }],
		["another room", { roomId: "vutsrqponmlkjihgfedcba" }],
		["an older generation of this seat", { toGen: 3 }],
		["a sender at this seat", { from: "N" }],
		["an invalid sender", { from: "X" }],
		["sender generation 0", { fromGen: 0 }],
		["a sender generation over the limit", { fromGen: MAX_GENERATION + 1 }],
		["an invalid message", { message: join({ form: "tablet" }) }],
	])("rejects %s", (_name, extra) => {
		expect(parseEnvelope(envelope(extra), inbox)).toBeUndefined();
	});

	it("rejects a value that is not an object", () => {
		expect(parseEnvelope("call", inbox)).toBeUndefined();
		expect(parseEnvelope(null, inbox)).toBeUndefined();
	});
});
