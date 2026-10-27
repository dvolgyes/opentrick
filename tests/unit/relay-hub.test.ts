import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import { generate } from "mqtt-packet";
import { expect, it } from "vitest";
import { RelayHub } from "../e2e/relay-hub";

async function relay(kind: "tracker" | "nostr" | "mqtt" = "tracker") {
	let connect: ((route: WebSocketRoute) => void) | undefined;
	const hub = new RelayHub(kind, [
		"wss://tracker.example",
		"wss://other.example",
	]);
	await hub.install(
		{
			routeWebSocket: async (_url: unknown, handler: typeof connect) => {
				connect = handler;
			},
		} as unknown as BrowserContext,
		"test",
	);
	return (peer: string, url = "wss://tracker.example") => {
		let receive: (value: string | Buffer) => void = () => undefined;
		let close: () => void = () => undefined;
		const messages: (string | Buffer)[] = [];
		connect?.({
			url: () => url,
			onMessage: (handler: typeof receive) => {
				receive = handler;
			},
			onClose: (handler: typeof close) => {
				close = handler;
			},
			send: (value: string | Buffer) => {
				messages.push(value);
			},
		} as unknown as WebSocketRoute);
		return {
			messages,
			write: (value: string | Buffer) => receive(value),
			close: () => close(),
			announce: (offers: unknown[] = []) =>
				receive(
					JSON.stringify({
						action: "announce",
						info_hash: "room",
						peer_id: peer,
						offers,
					}),
				),
		};
	};
}

it("the test tracker gives an offer to a live peer after an earlier peer disconnects", async () => {
	const socket = await relay();
	const departed = socket("old");
	departed.announce();
	const live = socket("live");
	live.announce();
	departed.close();
	departed.messages.length = 0;
	live.messages.length = 0;
	const newcomer = socket("new");
	newcomer.announce([{ offer_id: "offer", offer: "description" }]);
	expect(departed.messages).toEqual([]);
	expect(live.messages.map((value) => JSON.parse(value.toString()))).toEqual([
		{
			action: "announce",
			info_hash: "room",
			peer_id: "new",
			offer: "description",
			offer_id: "offer",
		},
	]);
});

it("test trackers do not forward offers between separate relay URLs", async () => {
	const socket = await relay();
	const elsewhere = socket("elsewhere", "wss://other.example");
	elsewhere.announce();
	elsewhere.messages.length = 0;
	const sender = socket("sender");
	sender.announce([{ offer_id: "offer", offer: "description" }]);
	expect(elsewhere.messages).toEqual([]);
});

it.each(["nostr", "mqtt"] as const)(
	"test %s relays deliver only to live subscribers of the same URL",
	async (kind) => {
		const socket = await relay(kind);
		const same = socket("same");
		const elsewhere = socket("elsewhere", "wss://other.example");
		const departed = socket("departed");
		for (const peer of [same, elsewhere, departed]) {
			peer.write(
				kind === "nostr"
					? JSON.stringify(["REQ", "sub", { kinds: [20000], "#x": ["topic"] }])
					: generate({
							cmd: "subscribe",
							messageId: 1,
							subscriptions: [{ topic: "topic", qos: 0 }],
						}),
			);
			peer.messages.length = 0;
		}
		departed.close();
		const publisher = socket("publisher");
		publisher.write(
			kind === "nostr"
				? JSON.stringify([
						"EVENT",
						{ id: "event", kind: 20000, tags: [["x", "topic"]] },
					])
				: generate({
						cmd: "publish",
						topic: "topic",
						payload: "message",
						qos: 0,
						retain: false,
						dup: false,
					}),
		);
		expect(elsewhere.messages).toEqual([]);
		expect(departed.messages).toEqual([]);
		expect(same.messages).toHaveLength(1);
	},
);
