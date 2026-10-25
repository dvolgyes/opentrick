import { schnorr } from "@noble/secp256k1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RTCPeerConnection as WeriftPeerConnection } from "werift";
import { APP_ID } from "../../src/p2p/config";
import {
	checkRelay,
	joinRoom,
	type Room,
	reconnectRelay,
	relayResting,
	relaySockets,
	selfId,
} from "../../src/p2p/signaling";

/** A relay socket that opens at once and records each message; it answers only what a test delivers. */
class FakeRelay {
	static readonly sockets: FakeRelay[] = [];
	readonly url: string;
	readonly sent: unknown[] = [];
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;

	constructor(url: string) {
		this.url = url;
		FakeRelay.sockets.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.onopen?.();
		});
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data));
	}

	close(): void {
		this.readyState = 3;
	}

	/** The relay sends the raw text to the page. */
	deliver(data: string): void {
		this.onmessage?.({ data });
	}
}

const rtcPolyfill = WeriftPeerConnection as unknown as typeof RTCPeerConnection;

/** The last socket to `url`. */
function socket(url: string): FakeRelay | undefined {
	return FakeRelay.sockets.findLast((relay) => relay.url === url);
}

function sent(url: string): unknown[] {
	return socket(url)?.sent ?? [];
}

type NostrEvent = {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	tags: string[][];
	content: string;
	sig: string;
};

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/** The filters of each REQ to a Nostr relay, with the subscription ID. */
function requests(url: string): { subId: string; topics: string[] }[] {
	return sent(url)
		.filter(isArray)
		.filter((message) => message[0] === "REQ")
		.map((message) => ({
			subId: String(message[1]),
			topics: (message[2] as { "#x": string[] })["#x"],
		}));
}

function events(url: string): NostrEvent[] {
	return sent(url)
		.filter(isArray)
		.filter((message) => message[0] === "EVENT")
		.map((message) => message[1] as NostrEvent);
}

function topicOf(event: NostrEvent): string | undefined {
	return event.tags.find((tag) => tag[0] === "x")?.[1];
}

/** The announcements: events whose content names this page and carries no offer. */
function announcements(url: string): NostrEvent[] {
	return events(url).filter((event) => {
		const content = JSON.parse(event.content) as Record<string, unknown>;
		return content.peerId === selfId && content.offer === undefined;
	});
}

/** The tracker announces that carry offers. */
function trackerAnnounces(url: string): Record<string, unknown>[] {
	return sent(url).filter(
		(message): message is Record<string, unknown> =>
			!isArray(message) &&
			Array.isArray((message as { offers?: unknown }).offers) &&
			((message as { offers: unknown[] }).offers.length ?? 0) > 0,
	);
}

const fromHex = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/** The rooms that a test joined; each test leaves them at its end, also when it fails. */
const joined: Room[] = [];

function join(
	roomId: string,
	urls: { trackers?: string[]; nostr?: string[] },
	offersPerAnnounce?: number,
): Room {
	const room = joinRoom(
		{
			appId: APP_ID,
			rtcPolyfill,
			trackerUrls: urls.trackers ?? [],
			nostrRelayUrls: urls.nostr ?? [],
			...(offersPerAnnounce === undefined ? {} : { offersPerAnnounce }),
		},
		roomId,
	);
	joined.push(room);
	return room;
}

afterEach(async () => {
	await Promise.all(joined.splice(0).map((room) => room.leave()));
	FakeRelay.sockets.splice(0);
	vi.unstubAllGlobals();
});

describe("the signaling strategy over Nostr relays only", () => {
	it("subscribes, announces with a valid signed event, and opens no tracker socket", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const relay = "wss://nostr-only.test";
		join("nostr-only", { nostr: [relay] });
		await expect
			.poll(() => announcements(relay).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		expect(FakeRelay.sockets.map((made) => made.url)).toEqual([relay]);
		const subscribed = requests(relay).flatMap((request) => request.topics);
		const event = announcements(relay)[0] as NostrEvent;
		expect(subscribed).toContain(topicOf(event));
		expect(event.kind).toBeGreaterThanOrEqual(20_000);
		expect(event.kind).toBeLessThan(30_000);
		const id = await sha256Hex(
			JSON.stringify([
				0,
				event.pubkey,
				event.created_at,
				event.kind,
				event.tags,
				event.content,
			]),
		);
		expect(event.id).toBe(id);
		await expect(
			schnorr.verifyAsync(
				fromHex(event.sig),
				fromHex(id),
				fromHex(event.pubkey),
			),
		).resolves.toBe(true);
		// The sockets of earlier tests stay registered, as in a page.
		expect(Object.keys(relaySockets().nostr)).toContain(relay);
		expect(Object.keys(relaySockets().tracker)).not.toContain(relay);
	}, 20_000);

	it("sends an offer to a peer that announces on the room's topic", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const relay = "wss://nostr-offer.test";
		join("nostr-offer", { nostr: [relay] });
		await expect
			.poll(() => announcements(relay).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const rootTopic = topicOf(announcements(relay)[0] as NostrEvent);
		const subscription = requests(relay).find((request) =>
			request.topics.includes(rootTopic ?? ""),
		);
		// The lower peer ID makes the offer, and no ID of Trystero's alphabet is above this one.
		const peerId = "z".repeat(20);
		socket(relay)?.deliver(
			JSON.stringify([
				"EVENT",
				subscription?.subId,
				{ content: JSON.stringify({ peerId }), tags: [["x", rootTopic]] },
			]),
		);
		await expect
			.poll(
				() =>
					events(relay).filter((event) => {
						const content = JSON.parse(event.content) as Record<
							string,
							unknown
						>;
						return (
							typeof content.offer === "string" && topicOf(event) !== rootTopic
						);
					}).length,
				{ timeout: 10_000 },
			)
			.toBeGreaterThan(0);
	}, 20_000);

	it("ignores relay messages that are not well-formed", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const relay = "wss://nostr-malformed.test";
		join("nostr-malformed", { nostr: [relay] });
		await expect
			.poll(() => announcements(relay).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const rootTopic = String(topicOf(announcements(relay)[0] as NostrEvent));
		const subId = String(requests(relay)[0]?.subId);
		for (const data of [
			"not json",
			"null",
			"7",
			"{}",
			"[]",
			JSON.stringify(["EVENT"]),
			JSON.stringify(["EVENT", subId, null]),
			JSON.stringify([
				"EVENT",
				subId,
				{ content: 5, tags: [["x", rootTopic]] },
			]),
			JSON.stringify(["EVENT", subId, { content: "{}", tags: "x" }]),
			JSON.stringify([
				"EVENT",
				subId,
				{ content: "{}", tags: [null, 5, ["x"]] },
			]),
			JSON.stringify([
				"EVENT",
				subId,
				{ content: "not json", tags: [["x", rootTopic]] },
			]),
			JSON.stringify([
				"EVENT",
				subId,
				{ content: "[]", tags: [["x", rootTopic]] },
			]),
			JSON.stringify(["OK", 5]),
			JSON.stringify(["OK", "id", "yes", 5]),
			JSON.stringify(["CLOSED", subId, 7]),
			JSON.stringify(["NOTICE", {}]),
			JSON.stringify(["EOSE", 9]),
		])
			expect(() => socket(relay)?.deliver(data), data).not.toThrow();
		// Content that is not a signal must not reject a promise either; the test fails on an unhandled rejection.
		await new Promise((resolve) => setTimeout(resolve, 200));
	}, 20_000);

	it("subscribes and announces again on a reconnect", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const relay = "wss://nostr-reconnect.test";
		join("nostr-reconnect", { nostr: [relay] });
		await expect
			.poll(() => announcements(relay).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const first = socket(relay);
		reconnectRelay("nostr", relay);
		expect(socket(relay)).not.toBe(first);
		await expect
			.poll(
				() => [requests(relay).length > 0, announcements(relay).length > 0],
				{ timeout: 5_000 },
			)
			.toEqual([true, true]);
	}, 20_000);

	it("rests a relay that rejects an announcement with a rate limit", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const relay = "wss://nostr-rate-limited.test";
		join("nostr-rate-limited", { nostr: [relay] });
		await expect
			.poll(() => announcements(relay).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		expect(relayResting("nostr", relay)).toBe(false);
		const announcement = announcements(relay)[0] as NostrEvent;
		socket(relay)?.deliver(
			JSON.stringify(["OK", announcement.id, false, "rate-limited: slow down"]),
		);
		expect(relayResting("nostr", relay)).toBe(true);
		expect(relayResting("tracker", relay)).toBe(false);
	}, 20_000);
});

/** The page's messages of `type` to the relay after the first `from` messages. */
function sentOfType(url: string, type: string, from = 0): unknown[][] {
	return sent(url)
		.slice(from)
		.filter(isArray)
		.filter((message) => message[0] === type);
}

/** A room on one fake Nostr relay that has subscribed and announced; resolves to the count of sent messages. */
async function announcedOn(relay: string): Promise<number> {
	vi.stubGlobal("WebSocket", FakeRelay);
	join(relay.replace("wss://", ""), { nostr: [relay] });
	await expect
		.poll(() => announcements(relay).length, { timeout: 10_000 })
		.toBeGreaterThan(0);
	return sent(relay).length;
}

describe("the check of a Nostr relay", () => {
	it("asks for one event that cannot exist, and closes the subscription after the relay's answer", async () => {
		const relay = "wss://nostr-check.test";
		const before = await announcedOn(relay);
		const answer = checkRelay(relay, 1_000);
		const [request] = sentOfType(relay, "REQ", before);
		const subId = String(request?.[1]);
		const filter = request?.[2] as { ids: string[]; limit: number };
		expect(Object.keys(filter).sort()).toEqual(["ids", "limit"]);
		expect(filter.ids).toHaveLength(1);
		expect(filter.ids[0]).toMatch(/^[0-9a-f]{64}$/);
		expect(filter.limit).toBe(1);
		expect(sentOfType(relay, "REQ", before)).toHaveLength(1);
		socket(relay)?.deliver(JSON.stringify(["EOSE", subId]));
		await expect(answer).resolves.toBe("answered");
		expect(sentOfType(relay, "CLOSE", before)).toEqual([["CLOSE", subId]]);
	}, 20_000);

	it("reports a refusal, and does not subscribe again or rest the relay because of it", async () => {
		const relay = "wss://nostr-check-refused.test";
		const before = await announcedOn(relay);
		const answer = checkRelay(relay, 1_000);
		const subId = String(sentOfType(relay, "REQ", before)[0]?.[1]);
		socket(relay)?.deliver(
			JSON.stringify(["CLOSED", subId, "rate-limited: slow down"]),
		);
		await expect(answer).resolves.toBe("refused");
		// The adapter subscribes again after a CLOSED of its own subscription, after about 5 s.
		await new Promise((resolve) => setTimeout(resolve, 6_000));
		expect(sentOfType(relay, "REQ", before)).toHaveLength(1);
		expect(sentOfType(relay, "CLOSE", before)).toEqual([]);
		expect(relayResting("nostr", relay)).toBe(false);
	}, 20_000);

	it("reports a relay that does not answer in time, and closes the subscription", async () => {
		const relay = "wss://nostr-check-silent.test";
		const before = await announcedOn(relay);
		await expect(checkRelay(relay, 100)).resolves.toBe("silent");
		const subId = sentOfType(relay, "REQ", before)[0]?.[1];
		expect(sentOfType(relay, "CLOSE", before)).toEqual([["CLOSE", subId]]);
	}, 20_000);

	it("sends nothing to a relay that rests the page, or to an unknown relay", async () => {
		const relay = "wss://nostr-check-resting.test";
		const before = await announcedOn(relay);
		const announcement = announcements(relay)[0] as NostrEvent;
		socket(relay)?.deliver(
			JSON.stringify(["OK", announcement.id, false, "rate-limited: slow down"]),
		);
		await expect(checkRelay(relay, 1_000)).resolves.toBe("not-sent");
		await expect(checkRelay("wss://unknown.test", 1_000)).resolves.toBe(
			"not-sent",
		);
		expect(sent(relay).length).toBe(before);
	}, 20_000);

	it("sends nothing to a socket that is not open", async () => {
		const relay = "wss://nostr-check-closed.test";
		const before = await announcedOn(relay);
		socket(relay)?.close();
		await expect(checkRelay(relay, 1_000)).resolves.toBe("not-sent");
		expect(sent(relay).length).toBe(before);
	}, 20_000);
});

describe("the signaling strategy over trackers only", () => {
	it("announces offers to the tracker and opens no Nostr socket", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const tracker = "wss://tracker-only.test";
		join("tracker-only", { trackers: [tracker] });
		await expect
			.poll(() => trackerAnnounces(tracker).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		expect(FakeRelay.sockets.map((made) => made.url)).toEqual([tracker]);
		expect(Object.keys(relaySockets().tracker)).toContain(tracker);
		expect(Object.keys(relaySockets().nostr)).not.toContain(tracker);
	}, 20_000);

	it("announces again on a reconnect", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const tracker = "wss://tracker-reconnect.test";
		join("tracker-reconnect", { trackers: [tracker] });
		await expect
			.poll(() => trackerAnnounces(tracker).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const first = socket(tracker);
		reconnectRelay("tracker", tracker);
		expect(socket(tracker)).not.toBe(first);
		await expect
			.poll(() => sent(tracker).length, { timeout: 5_000 })
			.toBeGreaterThan(0);
	}, 20_000);
});

describe("the signaling strategy over trackers and Nostr relays", () => {
	it("announces on both kinds of relay in one room", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		const tracker = "wss://both-tracker.test";
		const relay = "wss://both-nostr.test";
		join("both", { trackers: [tracker], nostr: [relay] });
		await expect
			.poll(
				() => [
					trackerAnnounces(tracker).length > 0,
					announcements(relay).length > 0,
				],
				{ timeout: 10_000 },
			)
			.toEqual([true, true]);
	}, 20_000);

	it("opens no socket at all when both lists are empty", async () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		join("no-relays", {});
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(FakeRelay.sockets).toEqual([]);
	});

	it("refuses an offer count that is not a positive whole number", () => {
		vi.stubGlobal("WebSocket", FakeRelay);
		for (const count of [0, -1, 1.5, Number.NaN])
			expect(() => join("bad-count", {}, count)).toThrow("offersPerAnnounce");
	});
});
