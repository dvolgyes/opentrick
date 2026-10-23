import { afterEach, describe, expect, it, vi } from "vitest";
import { RTCPeerConnection as WeriftPeerConnection } from "werift";
import { APP_ID } from "../../src/p2p/config";
import { joinRoom, type Room } from "../../src/p2p/torrent";

type Sent = Record<string, unknown>;

/** A tracker socket that opens at once and records each message; it answers only what a test delivers. */
class FakeTracker {
	static readonly sockets = new Map<string, FakeTracker>();
	readonly url: string;
	readonly sent: Sent[] = [];
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;

	constructor(url: string) {
		this.url = url;
		FakeTracker.sockets.set(url, this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.onopen?.();
		});
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data));
	}

	close(): void {}

	/** The tracker sends the raw text to the page. */
	deliver(data: string): void {
		this.onmessage?.({ data });
	}
}

const rtcPolyfill = WeriftPeerConnection as unknown as typeof RTCPeerConnection;

function sent(url: string): Sent[] {
	return FakeTracker.sockets.get(url)?.sent ?? [];
}

/** The offer count of the first announce that carries offers. */
function firstOfferCount(url: string): number | undefined {
	const withOffers = sent(url).find(
		(message) => Array.isArray(message.offers) && message.offers.length > 0,
	);
	return (withOffers?.offers as unknown[] | undefined)?.length;
}

/** The rooms that a test joined; each test leaves them at its end, also when it fails. */
const joined: Room[] = [];

/**
 * Joins a room named after the tracker. Trystero gives back the open room when a page joins a room ID again, so a
 * room that a test leaves open must not reach the next test.
 */
function join(url: string, offersPerAnnounce?: number): Room {
	const room = joinRoom(
		{
			appId: APP_ID,
			rtcPolyfill,
			relayConfig: { urls: [url] },
			...(offersPerAnnounce === undefined ? {} : { offersPerAnnounce }),
		},
		url,
	);
	joined.push(room);
	return room;
}

afterEach(async () => {
	await Promise.all(joined.splice(0).map((room) => room.leave()));
	vi.unstubAllGlobals();
});

describe("the torrent tracker strategy", () => {
	it("sends one offer in each announce when the room sets no count", async () => {
		vi.stubGlobal("WebSocket", FakeTracker);
		const url = "wss://default-count.test";
		const room = join(url);
		await expect.poll(() => firstOfferCount(url), { timeout: 10_000 }).toBe(1);
		await room.leave();
	}, 20_000);

	it("sends the room's offer count in each announce", async () => {
		vi.stubGlobal("WebSocket", FakeTracker);
		const url = "wss://room-count.test";
		const room = join(url, 3);
		await expect.poll(() => firstOfferCount(url), { timeout: 10_000 }).toBe(3);
		await room.leave();
	}, 20_000);

	it("refuses an offer count that is not a positive whole number", () => {
		vi.stubGlobal("WebSocket", FakeTracker);
		for (const count of [0, -1, 1.5, Number.NaN])
			expect(() => join("wss://bad-count.test", count)).toThrow(
				"offersPerAnnounce",
			);
	});

	it("tells the tracker that the page stopped when it leaves the room", async () => {
		vi.stubGlobal("WebSocket", FakeTracker);
		const url = "wss://stopped.test";
		const room = join(url);
		await expect.poll(() => firstOfferCount(url), { timeout: 10_000 }).toBe(1);
		const infoHash = sent(url)[0]?.info_hash;
		await room.leave();
		await expect
			.poll(() => sent(url).filter((message) => message.event === "stopped"), {
				timeout: 5_000,
			})
			.toEqual([
				expect.objectContaining({
					action: "announce",
					event: "stopped",
					info_hash: infoHash,
					numwant: 0,
				}),
			]);
	}, 20_000);

	it("ignores tracker messages that are not well-formed announce replies", async () => {
		vi.stubGlobal("WebSocket", FakeTracker);
		const url = "wss://malformed.test";
		const room = join(url);
		await expect.poll(() => firstOfferCount(url), { timeout: 10_000 }).toBe(1);
		const tracker = FakeTracker.sockets.get(url);
		const infoHash = String(sent(url)[0]?.info_hash);
		for (const data of [
			"not json",
			"null",
			"[]",
			"7",
			JSON.stringify({ info_hash: infoHash, interval: "600" }),
			JSON.stringify({ info_hash: infoHash, interval: Number.MAX_VALUE }),
			JSON.stringify({ "failure reason": { text: "x" } }),
			JSON.stringify({
				info_hash: infoHash,
				offer_id: "a".repeat(20),
				peer_id: "b".repeat(20),
				offer: { type: "offer", sdp: 5 },
			}),
			JSON.stringify({
				info_hash: infoHash,
				offer_id: "a".repeat(20),
				peer_id: "b".repeat(20),
				answer: null,
			}),
		])
			expect(() => tracker?.deliver(data), data).not.toThrow();
		await room.leave();
	}, 20_000);
});
