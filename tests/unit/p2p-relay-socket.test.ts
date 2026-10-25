import { afterEach, describe, expect, it, vi } from "vitest";
import { relaySocket } from "../../src/p2p/relay-socket";

/** A WebSocket that the test opens, closes and fills with messages. */
class FakeWebSocket {
	static readonly made: FakeWebSocket[] = [];
	readonly url: string;
	readyState = 0;
	readonly sent: string[] = [];
	closed = false;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.made.push(this);
	}

	open(): void {
		this.readyState = 1;
		this.onopen?.();
	}

	/** The server or the network ends the socket. */
	drop(): void {
		this.readyState = 3;
		this.onclose?.();
	}

	receive(data: string): void {
		this.onmessage?.({ data });
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
		this.readyState = 3;
	}
}

const URL_A = "wss://relay.test";

function latest(): FakeWebSocket {
	const socket = FakeWebSocket.made.at(-1);
	if (socket === undefined) throw new Error("no socket");
	return socket;
}

afterEach(() => {
	FakeWebSocket.made.splice(0);
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("relaySocket", () => {
	it("opens at once and resolves ready on the first open", async () => {
		vi.stubGlobal("WebSocket", FakeWebSocket);
		const client = relaySocket(
			URL_A,
			() => {},
			() => {},
		);
		expect(FakeWebSocket.made).toHaveLength(1);
		latest().open();
		await expect(client.ready).resolves.toBe(client);
		expect(client.url).toBe(URL_A);
	});

	it("replaces a socket at once on reconnect, and the old socket's late events reach nothing", () => {
		vi.stubGlobal("WebSocket", FakeWebSocket);
		const messages: string[] = [];
		const reconnects = { count: 0 };
		const client = relaySocket(
			URL_A,
			(data) => messages.push(data),
			() => reconnects.count++,
		);
		const old = latest();
		old.open();
		client.reconnect();
		expect(FakeWebSocket.made).toHaveLength(2);
		expect(old.closed).toBe(true);
		expect(client.socket).toBe(latest());
		old.receive("late");
		old.drop();
		expect(messages).toEqual([]);
		expect(FakeWebSocket.made).toHaveLength(2);
		latest().open();
		expect(reconnects.count).toBe(1);
		latest().receive("fresh");
		expect(messages).toEqual(["fresh"]);
	});

	it("sends only on an open socket", () => {
		vi.stubGlobal("WebSocket", FakeWebSocket);
		const client = relaySocket(
			URL_A,
			() => {},
			() => {},
		);
		client.send("early");
		latest().open();
		client.send("hello");
		expect(latest().sent).toEqual(["hello"]);
	});

	it("retries a dropped socket after a doubling random wait, and a reconnect starts the wait again", () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.999);
		vi.stubGlobal("WebSocket", FakeWebSocket);
		const client = relaySocket(
			URL_A,
			() => {},
			() => {},
		);
		latest().drop();
		vi.advanceTimersByTime(3_000);
		expect(FakeWebSocket.made).toHaveLength(1);
		vi.advanceTimersByTime(400);
		expect(FakeWebSocket.made).toHaveLength(2);
		latest().drop();
		vi.advanceTimersByTime(6_000);
		expect(FakeWebSocket.made).toHaveLength(2);
		// A reconnect does not wait for the pending retry, and the retry after it does not come.
		client.reconnect();
		expect(FakeWebSocket.made).toHaveLength(3);
		vi.advanceTimersByTime(60_000);
		expect(FakeWebSocket.made).toHaveLength(3);
		latest().drop();
		vi.advanceTimersByTime(3_400);
		expect(FakeWebSocket.made).toHaveLength(4);
	});

	it("stays closed after close, also on reconnect", () => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", FakeWebSocket);
		const client = relaySocket(
			URL_A,
			() => {},
			() => {},
		);
		latest().open();
		client.close();
		expect(latest().closed).toBe(true);
		latest().drop();
		client.reconnect();
		vi.advanceTimersByTime(120_000);
		expect(FakeWebSocket.made).toHaveLength(1);
		expect(client.isClosed).toBe(true);
	});
});
