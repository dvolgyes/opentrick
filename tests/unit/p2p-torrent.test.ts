import { afterEach, describe, expect, it, vi } from "vitest";
import { RTCPeerConnection as WeriftPeerConnection } from "werift";
import { APP_ID } from "../../src/p2p/config";
import { REJOIN_MAX_MS, REJOIN_MS } from "../../src/p2p/limits";
import { joinRoom, type Room } from "../../src/p2p/signaling";
import { nextSlotMs } from "../../src/p2p/torrent";

type Sent = Record<string, unknown>;

/** A tracker socket that opens at once and records each message; it answers only what a test delivers. */
class FakeTracker {
	static readonly sockets = new Map<string, FakeTracker>();
	readonly url: string;
	readonly sent: Sent[] = [];
	/** The clock time of each sent message. */
	readonly sentAt: number[] = [];
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
		this.sentAt.push(Date.now());
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
			trackerUrls: [url],
			nostrRelayUrls: [],
			mqttBrokerUrls: [],
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
	vi.useRealTimers();
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

	it("puts no tracker slot in the 2 s before a rejoin of a page alone since it opened, so a rejoin does not drop the offers of an announce", () => {
		// A peer that answers an offer of the left room ignores the page's next offers for 23 s (Trystero's answer
		// timeout), so an announce just before the rejoin blocks the link that the rejoin is for.
		const rejoins: number[] = [];
		for (let at = 0, wait = REJOIN_MS; at + wait <= 600_000; ) {
			at += wait;
			rejoins.push(at);
			wait = Math.min(REJOIN_MAX_MS, wait * 2);
		}
		for (const count of [1, 2, 3, 4]) {
			const slots: number[] = [];
			for (let index = 0; index < count; index++) {
				const slot = { index, count, originMs: 0 };
				// Trystero's fast start ends about 2.1 s after the join; from then on each announce waits for its slot.
				for (let at = 2_100; at <= 600_000; ) {
					at += nextSlotMs(slot, at);
					slots.push(at);
				}
			}
			const before = rejoins.flatMap((rejoin) =>
				slots
					.filter((at) => at > rejoin - 2_000 && at <= rejoin)
					.map((at) => `slot at ${at} ms, rejoin at ${rejoin} ms`),
			);
			expect(before, `${count} trackers`).toEqual([]);
		}
	});

	it("announces to each tracker in its own slot: with 4 trackers, each one every 120 s and 30 s after the one before", async () => {
		// The clock moves with real time, so the offers are made, and a test step moves it ahead.
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "Date"],
			shouldAdvanceTime: true,
		});
		vi.stubGlobal("WebSocket", FakeTracker);
		const urls = [0, 1, 2, 3].map((index) => `wss://slot-${index}.test`);
		joined.push(
			joinRoom(
				{
					appId: APP_ID,
					rtcPolyfill,
					trackerUrls: urls,
					nostrRelayUrls: [],
					mqttBrokerUrls: [],
				},
				"slots",
			),
		);
		await expect
			.poll(() => urls.map((url) => firstOfferCount(url)), { timeout: 10_000 })
			.toEqual([1, 1, 1, 1]);
		for (let step = 0; step < 250; step++)
			await vi.advanceTimersByTimeAsync(1_000);
		// The first 4 announces to each tracker are the fast start of Trystero, at the same time for all trackers.
		const steady = urls.map((url) =>
			(FakeTracker.sockets.get(url)?.sentAt ?? []).slice(4),
		);
		// The slots start 5 s after the join, after the fast start, so the first steady announce is the slot of tracker 0.
		const reference = steady[0]?.[0] ?? Number.NaN;
		// How late each announce is after the slot of its tracker, in seconds. The offers expire after 120 s, and the
		// announce that makes new ones is late by the time that they take: about 6 s on the test clock.
		const lateness = steady.map((times, index) =>
			times.map((time) => {
				const fromSlot = (time - reference) / 1_000 - index * 30;
				return (((fromSlot % 120) + 180) % 120) - 60;
			}),
		);
		// In 250 s: tracker 0 at 5 s, 125 s and 245 s; tracker 1 at 35 s and 155 s; and so on.
		lateness.forEach((late, index) => {
			expect(late, urls[index]).toHaveLength(index === 0 ? 3 : 2);
			for (const seconds of late) {
				expect(seconds, urls[index]).toBeGreaterThanOrEqual(-1);
				expect(seconds, urls[index]).toBeLessThanOrEqual(10);
			}
		});
	}, 60_000);
});
