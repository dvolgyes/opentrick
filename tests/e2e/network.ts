import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import { generate, type Packet, parser } from "mqtt-packet";

interface SocketPair {
	readonly page: WebSocketRoute;
	readonly server: WebSocketRoute;
}

/**
 * Cuts one browser context off from the trackers, the Nostr relays and the MQTT brokers, as a relay outage would (plan §9). Blocking
 * closes the open relay sockets on both sides and refuses new ones. Direct WebRTC links between the pages stay up.
 */
export class NetworkSwitch {
	#blocked = false;
	readonly #sockets = new Set<SocketPair>();

	static async install(
		context: BrowserContext,
		relayUrls: readonly string[],
	): Promise<NetworkSwitch> {
		const network = new NetworkSwitch();
		const hosts = new Set(relayUrls.map((url) => new URL(url).host));
		await context.routeWebSocket(
			(url) => hosts.has(url.host),
			(socket) => network.#socket(socket),
		);
		return network;
	}

	async block(): Promise<void> {
		this.#blocked = true;
		const open = [...this.#sockets];
		this.#sockets.clear();
		await Promise.all(
			open.flatMap(({ page, server }) => [server.close(), page.close()]),
		);
	}

	unblock(): void {
		this.#blocked = false;
	}

	#socket(page: WebSocketRoute): void {
		if (this.#blocked) {
			void page.close();
			return;
		}
		// Without message handlers, Playwright forwards all traffic and closures between the two sides.
		this.#sockets.add({ page, server: page.connectToServer() });
	}
}

/**
 * Withholds the WebRTC offers of one browser context for `ms` after its first relay socket opens, as if each
 * page that the relays chose could not answer. The tracker announces arrive without their offers, the Nostr
 * events and MQTT messages that carry an offer or an answer do not arrive, and the offers and answers that the
 * relays pass to the context are dropped. The announce replies and the Nostr and MQTT announcements still pass, so
 * the page keeps its announce schedule. The filter reads only which fields a message has, never a session
 * description.
 */
export async function withholdOffers(
	context: BrowserContext,
	relayUrls: readonly string[],
	ms: number,
): Promise<void> {
	const hosts = new Set(relayUrls.map((url) => new URL(url).host));
	let until: number | undefined;
	const withheld = () => until !== undefined && Date.now() < until;
	await context.routeWebSocket(
		(url) => hosts.has(url.host),
		(page) => {
			until ??= Date.now() + ms;
			// With message handlers, Playwright forwards nothing on its own, so each handler sends on.
			const server = page.connectToServer();
			// An MQTT broker sends binary frames, and a frame can hold a part of a packet or several packets.
			const fromPage = mqttFilter(withheld);
			const fromServer = mqttFilter(withheld);
			page.onMessage((message) => {
				if (typeof message !== "string") fromPage(message, server);
				else if (!withheld()) server.send(message);
				else if (!publishesSignal(message)) server.send(withoutOffers(message));
			});
			server.onMessage((message) => {
				if (typeof message !== "string") fromServer(message, page);
				else if (!withheld() || !carriesSignal(message)) page.send(message);
			});
		},
	);
}

/**
 * Passes the MQTT packets of one direction of a socket on, without the PUBLISH packets that carry an offer or an
 * answer while `withheld()`. Each frame passes on as the packets that it completes.
 */
function mqttFilter(
	withheld: () => boolean,
): (frame: Buffer, to: WebSocketRoute) => void {
	const packets: Packet[] = [];
	const read = parser({ protocolVersion: 4 });
	read.on("packet", (packet: Packet) => packets.push(packet));
	return (frame, to) => {
		read.parse(frame);
		const kept = packets
			.splice(0)
			.filter(
				(packet) =>
					!(withheld() && packet.cmd === "publish" && isSignal(packet.payload)),
			);
		if (kept.length > 0)
			to.send(Buffer.concat(kept.map((packet) => generate(packet))));
	};
}

/** An MQTT message whose JSON names an offer or an answer. */
function isSignal(payload: string | Buffer): boolean {
	let data: unknown;
	try {
		data = JSON.parse(String(payload));
	} catch {
		return false;
	}
	return isRecord(data) && ("offer" in data || "answer" in data);
}

/** An announce without its offers; any other message unchanged. */
function withoutOffers(message: string | Buffer): string | Buffer {
	if (typeof message !== "string") return message;
	const data: unknown = JSON.parse(message);
	if (!isRecord(data) || !Array.isArray(data.offers)) return message;
	return JSON.stringify({ ...data, offers: [] });
}

/** An offer or an answer that a tracker or a Nostr relay passes from another page. */
function carriesSignal(message: string | Buffer): boolean {
	if (typeof message !== "string") return false;
	const data: unknown = JSON.parse(message);
	if (Array.isArray(data)) return data[0] === "EVENT" && isSignalEvent(data[2]);
	return isRecord(data) && ("offer" in data || "answer" in data);
}

/** A Nostr event from the page that carries an offer or an answer. */
function publishesSignal(message: string | Buffer): boolean {
	if (typeof message !== "string") return false;
	const data: unknown = JSON.parse(message);
	return Array.isArray(data) && data[0] === "EVENT" && isSignalEvent(data[1]);
}

/** A Nostr event whose content names an offer or an answer. */
function isSignalEvent(event: unknown): boolean {
	if (!isRecord(event) || typeof event.content !== "string") return false;
	const content: unknown = JSON.parse(event.content);
	return isRecord(content) && ("offer" in content || "answer" in content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
