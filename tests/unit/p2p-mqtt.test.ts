import { generate, type Packet, parser } from "mqtt-packet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RTCPeerConnection as WeriftPeerConnection } from "werift";
import { APP_ID } from "../../src/p2p/config";
import {
	joinRoom,
	type Room,
	reconnectRelay,
	relayResting,
	relaySockets,
	selfId,
} from "../../src/p2p/signaling";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/**
 * A browser WebSocket to a fake relay. A socket with the `mqtt` subprotocol is an MQTT broker: it reads the page's
 * packets and answers CONNECT, SUBSCRIBE, UNSUBSCRIBE and PINGREQ as a broker does, and passes a PUBLISH only when a
 * test delivers it. Any other socket is a tracker or a Nostr relay, which records the page's JSON messages.
 */
class FakeSocket extends EventTarget {
	static readonly sockets: FakeSocket[] = [];
	/** Whether a new MQTT socket closes before its CONNACK, as a broker that refuses the page. */
	static refuse = false;
	readonly CONNECTING = CONNECTING;
	readonly OPEN = OPEN;
	readonly url: string;
	readonly protocols: string[];
	readonly packets: Packet[] = [];
	readonly json: unknown[] = [];
	readyState = CONNECTING;
	binaryType = "blob";
	bufferedAmount = 0;
	readonly #parser = parser({ protocolVersion: 4 });

	constructor(url: string, protocols?: string | string[]) {
		super();
		this.url = url;
		this.protocols = protocols === undefined ? [] : [protocols].flat();
		FakeSocket.sockets.push(this);
		this.#parser.on("packet", (packet: Packet) => this.#answer(packet));
		setTimeout(() => {
			if (this.readyState !== CONNECTING) return;
			this.readyState = OPEN;
			this.dispatchEvent(new Event("open"));
		});
	}

	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onclose: ((event: Event) => void) | null = null;

	/** Calls the `on` property of the event's type as well, as a browser does. */
	override dispatchEvent(event: Event): boolean {
		const handler = {
			open: this.onopen,
			message: this.onmessage,
			close: this.onclose,
		}[event.type];
		handler?.call(this, event as MessageEvent);
		return super.dispatchEvent(event);
	}

	send(data: string | ArrayBufferView | ArrayBuffer): void {
		if (typeof data === "string") this.json.push(JSON.parse(data));
		else
			this.#parser.parse(
				Buffer.from(
					data instanceof ArrayBuffer
						? new Uint8Array(data)
						: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
				),
			);
	}

	close(): void {
		if (this.readyState === CLOSED) return;
		this.readyState = CLOSED;
		setTimeout(() => this.dispatchEvent(new Event("close")));
	}

	/** The broker passes a message on `topic` to the page. */
	deliver(topic: string, payload: string | Buffer): void {
		this.#send({
			cmd: "publish",
			topic,
			payload,
			qos: 0,
			dup: false,
			retain: false,
		});
	}

	#answer(packet: Packet): void {
		this.packets.push(packet);
		switch (packet.cmd) {
			case "connect":
				if (FakeSocket.refuse) this.close();
				else
					this.#send({ cmd: "connack", returnCode: 0, sessionPresent: false });
				return;
			case "subscribe":
				this.#send({
					cmd: "suback",
					messageId: packet.messageId,
					granted: packet.subscriptions.map(() => 0),
				});
				return;
			case "unsubscribe":
				this.#send({
					cmd: "unsuback",
					messageId: packet.messageId,
					granted: [],
				});
				return;
			case "pingreq":
				this.#send({ cmd: "pingresp" });
				return;
			default:
				return;
		}
	}

	#send(packet: Packet): void {
		const bytes = generate(packet);
		const data = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		);
		setTimeout(() => {
			if (this.readyState === OPEN)
				this.dispatchEvent(new MessageEvent("message", { data }));
		});
	}
}

const rtcPolyfill = WeriftPeerConnection as unknown as typeof RTCPeerConnection;

/** Two URLs of the same place; mqtt.js writes the default port into the URL of its socket. */
const same = (a: string, b: string): boolean =>
	new URL(a).href === new URL(b).href;

/** The sockets to `url`, oldest first. */
const socketsTo = (url: string): FakeSocket[] =>
	FakeSocket.sockets.filter((made) => same(made.url, url));

/** The last socket to `url`. */
const socket = (url: string): FakeSocket | undefined => socketsTo(url).at(-1);

const packetsOf = <C extends Packet["cmd"]>(
	url: string,
	cmd: C,
): Extract<Packet, { cmd: C }>[] =>
	(socket(url)?.packets ?? []).filter(
		(packet): packet is Extract<Packet, { cmd: C }> => packet.cmd === cmd,
	);

const subscribed = (url: string): string[] =>
	packetsOf(url, "subscribe").flatMap((packet) =>
		packet.subscriptions.map((subscription) => subscription.topic),
	);

const payloadOf = (packet: { payload: string | Buffer }): unknown => {
	try {
		return JSON.parse(String(packet.payload));
	} catch {
		return undefined;
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** The announcements: messages that name this page and carry no offer. */
const announcements = (url: string) =>
	packetsOf(url, "publish").filter((packet) => {
		const payload = payloadOf(packet);
		return (
			isRecord(payload) &&
			payload.peerId === selfId &&
			payload.offer === undefined
		);
	});

/** The rooms that a test joined; each test leaves them at its end, also when it fails. */
const joined: Room[] = [];

function join(
	roomId: string,
	urls: { trackers?: string[]; nostr?: string[]; mqtt?: string[] },
): Room {
	const room = joinRoom(
		{
			appId: APP_ID,
			rtcPolyfill,
			trackerUrls: urls.trackers ?? [],
			nostrRelayUrls: urls.nostr ?? [],
			mqttBrokerUrls: urls.mqtt ?? [],
		},
		roomId,
	);
	joined.push(room);
	return room;
}

/** A room on one fake broker that has subscribed and announced. */
async function announcedOn(broker: string): Promise<void> {
	vi.stubGlobal("WebSocket", FakeSocket);
	join(broker.replace("wss://", ""), { mqtt: [broker] });
	await expect
		.poll(() => announcements(broker).length, { timeout: 10_000 })
		.toBeGreaterThan(0);
}

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await Promise.all(joined.splice(0).map((room) => room.leave()));
	FakeSocket.sockets.splice(0);
	FakeSocket.refuse = false;
	vi.unstubAllGlobals();
});

describe("the signaling strategy over MQTT brokers only", () => {
	it("connects without credentials, announces on a topic it subscribed to, and opens no other socket", async () => {
		const broker = "wss://mqtt-only.test/mqtt";
		await announcedOn(broker);
		expect(FakeSocket.sockets.every((made) => same(made.url, broker))).toBe(
			true,
		);
		expect(socket(broker)?.protocols).toEqual(["mqtt"]);
		const [connect] = packetsOf(broker, "connect");
		expect(connect?.username).toBeUndefined();
		expect(connect?.password).toBeUndefined();
		const topic = announcements(broker)[0]?.topic;
		expect(subscribed(broker)).toContain(topic);
		// The sockets of earlier tests stay registered, as in a page.
		expect(Object.keys(relaySockets().mqtt)).toContain(broker);
		expect(Object.keys(relaySockets().nostr)).not.toContain(broker);
		expect(Object.keys(relaySockets().tracker)).not.toContain(broker);
		expect(relayResting("mqtt", broker)).toBe(false);
	}, 20_000);

	it("sends an offer to a peer that announces on the room's topic", async () => {
		const broker = "wss://mqtt-offer.test/mqtt";
		await announcedOn(broker);
		const rootTopic = String(announcements(broker)[0]?.topic);
		// The lower peer ID makes the offer, and no ID of Trystero's alphabet is above this one.
		socket(broker)?.deliver(
			rootTopic,
			JSON.stringify({ peerId: "z".repeat(20) }),
		);
		await expect
			.poll(
				() =>
					packetsOf(broker, "publish").filter((packet) => {
						const payload = payloadOf(packet);
						return (
							isRecord(payload) &&
							typeof payload.offer === "string" &&
							packet.topic !== rootTopic
						);
					}).length,
				{ timeout: 10_000 },
			)
			.toBeGreaterThan(0);
	}, 20_000);

	it("ignores messages that are not signals", async () => {
		const broker = "wss://mqtt-malformed.test/mqtt";
		await announcedOn(broker);
		const rootTopic = String(announcements(broker)[0]?.topic);
		for (const payload of [
			"not json",
			"null",
			"7",
			"[]",
			"{}",
			JSON.stringify({ peerId: 5 }),
			JSON.stringify({ peerId: "z".repeat(20), offer: 5 }),
			Buffer.from([0xff, 0xfe, 0x00]),
		])
			socket(broker)?.deliver(rootTopic, payload);
		socket(broker)?.deliver("a topic the page never subscribed to", "{}");
		// The test fails on an unhandled rejection.
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(socket(broker)?.readyState).toBe(OPEN);
	}, 20_000);

	it("replaces the socket at once on a reconnect, then subscribes and announces again", async () => {
		const broker = "wss://mqtt-reconnect.test/mqtt";
		await announcedOn(broker);
		const first = socket(broker);
		reconnectRelay("mqtt", broker);
		// mqtt.js alone would wait for its reconnect period first.
		await expect
			.poll(() => socket(broker) !== first, { timeout: 500 })
			.toBe(true);
		expect(first?.readyState).toBe(CLOSED);
		await expect
			.poll(
				() => [subscribed(broker).length > 0, announcements(broker).length > 0],
				{ timeout: 5_000 },
			)
			.toEqual([true, true]);
	}, 20_000);

	it("waits longer before each new socket to a broker that keeps refusing the page", async () => {
		const broker = "wss://mqtt-refuses.test/mqtt";
		await announcedOn(broker);
		FakeSocket.refuse = true;
		// The longest wait of each retry: 3.3 s, then 6.7 s, then 13.3 s, so new sockets at 3.3 s, 10 s and 23.3 s.
		vi.spyOn(Math, "random").mockReturnValue(0.999_999);
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
		});
		socket(broker)?.close();
		await vi.advanceTimersByTimeAsync(3_000);
		expect(socketsTo(broker)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(socketsTo(broker)).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(socketsTo(broker)).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1_500);
		expect(socketsTo(broker)).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(12_000);
		expect(socketsTo(broker)).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(1_500);
		expect(socketsTo(broker)).toHaveLength(4);
	}, 20_000);

	it("ignores a reconnect of a broker that the page never opened", () => {
		vi.stubGlobal("WebSocket", FakeSocket);
		expect(() =>
			reconnectRelay("mqtt", "wss://mqtt-unknown.test/mqtt"),
		).not.toThrow();
		expect(FakeSocket.sockets).toEqual([]);
	});
});

describe("the signaling strategy over all three kinds of relay", () => {
	it("announces on a tracker, a Nostr relay and an MQTT broker in one room", async () => {
		vi.stubGlobal("WebSocket", FakeSocket);
		const tracker = "wss://three-tracker.test";
		const relay = "wss://three-nostr.test";
		const broker = "wss://three-mqtt.test/mqtt";
		join("three", { trackers: [tracker], nostr: [relay], mqtt: [broker] });
		await expect
			.poll(
				() => [
					(socket(tracker)?.json ?? []).some(
						(message) => isRecord(message) && message.action === "announce",
					),
					(socket(relay)?.json ?? []).some(
						(message) => Array.isArray(message) && message[0] === "EVENT",
					),
					announcements(broker).length > 0,
				],
				{ timeout: 10_000 },
			)
			.toEqual([true, true, true]);
	}, 20_000);
});
