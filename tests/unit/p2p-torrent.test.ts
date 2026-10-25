import { afterEach, describe, expect, it, vi } from "vitest";
import { RTCPeerConnection as WeriftPeerConnection } from "werift";
import { APP_ID } from "../../src/p2p/config";
import { joinRoom, type Room } from "../../src/p2p/signaling";

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

	it("announces to each tracker in its own slot: with 4 trackers, each one every 40 s and 10 s after the one before", async () => {
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
		// The offers expire after 120 s, and the announce that makes new ones is late by the time that they take.
		for (let step = 0; step < 115; step++)
			await vi.advanceTimersByTimeAsync(1_000);
		// The first 4 announces to each tracker are the fast start of Trystero, at the same time for all trackers.
		const steady = urls.map((url) =>
			(FakeTracker.sockets.get(url)?.sentAt ?? []).slice(4),
		);
		const seconds = (ms: number) => Math.round(ms / 1_000);
		for (const times of steady) {
			expect(times.length).toBeGreaterThanOrEqual(2);
			expect(
				times
					.slice(1)
					.map((time, index) => seconds(time - (times[index] ?? Number.NaN))),
			).toEqual(times.slice(1).map(() => 40));
		}
		// The phase of each tracker in the 40 s period, from the phase of the first tracker.
		const first = steady.map((times) => times[0] ?? Number.NaN);
		const phases = first.map(
			(time) => ((seconds(time - (first[0] ?? Number.NaN)) % 40) + 40) % 40,
		);
		expect(phases).toEqual([0, 10, 20, 30]);
	}, 60_000);
});
