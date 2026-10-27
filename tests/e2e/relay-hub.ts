import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import { generate, type Packet, parser } from "mqtt-packet";

/**
 * Fake signaling servers in the test process: a WebTorrent tracker, a Nostr relay and an MQTT broker that pass
 * messages only between
 * the browser contexts of one test. Pages reach them through `context.routeWebSocket`, so no message leaves the
 * machine and a test can select which kind of relay a page uses. Each hub keeps only what its protocol needs to
 * route a message; it never reads a session description.
 */

type Kind = "tracker" | "nostr" | "mqtt";

interface Socket {
	readonly label: string;
	readonly relay: string;
	readonly route: WebSocketRoute;
	readonly openedAt: number;
	/** A dead socket looks open to the page, but nothing passes in either direction (a half-open socket). */
	dead: boolean;
}

interface Subscription {
	readonly kinds: readonly number[];
	readonly topics: readonly string[];
}

interface NostrEvent {
	readonly id: string;
	readonly kind: number;
	readonly tags: readonly (readonly string[])[];
}

export class RelayHub {
	readonly kind: Kind;
	readonly urls: readonly string[];
	readonly #sockets: Socket[] = [];
	/** Tracker: the latest socket of each peer ID, by info hash. */
	readonly #swarms = new Map<string, Map<string, Socket>>();
	/** Nostr: the subscriptions of each socket, by subscription ID. */
	readonly #subscriptions = new Map<Socket, Map<string, Subscription>>();
	/** MQTT: the topics that each socket subscribed to. */
	readonly #topics = new Map<Socket, Set<string>>();
	readonly #received = new Map<string, number>();

	constructor(kind: Kind, urls: readonly string[]) {
		this.kind = kind;
		this.urls = urls;
	}

	/** Routes the context's sockets to this hub's URLs here; call it before the context opens a page. */
	async install(context: BrowserContext, label: string): Promise<void> {
		const hosts = new Set(this.urls.map((url) => new URL(url).host));
		await context.routeWebSocket(
			(url) => hosts.has(url.host),
			(route) => this.#accept(route, label),
		);
	}

	/** Messages that pages of `label` sent here and the hub accepted. */
	received(label: string): number {
		return this.#received.get(label) ?? 0;
	}

	/** When the latest socket of `label` opened (Date.now()), or undefined. */
	lastOpened(label: string): number | undefined {
		return this.#sockets.findLast((socket) => socket.label === label)?.openedAt;
	}

	/** The open sockets of `label` stop passing messages, as after a network change; new sockets work. */
	silence(label: string): void {
		for (const socket of this.#sockets)
			if (socket.label === label) socket.dead = true;
	}

	#accept(route: WebSocketRoute, label: string): void {
		const socket: Socket = {
			label,
			relay: route.url(),
			route,
			openedAt: Date.now(),
			dead: false,
		};
		this.#sockets.push(socket);
		// Without connectToServer, the page's socket is open at once and no message leaves the test process.
		if (this.kind === "mqtt") {
			this.#acceptMqtt(socket);
			return;
		}
		route.onMessage((message) => {
			if (socket.dead || typeof message !== "string") return;
			const data = parse(message);
			if (data === undefined) return;
			this.#received.set(label, this.received(label) + 1);
			if (this.kind === "tracker") this.#tracker(socket, data);
			else this.#nostr(socket, data);
		});
		route.onClose(() => this.#close(socket));
	}

	#close(socket: Socket): void {
		socket.dead = true;
		this.#subscriptions.delete(socket);
		this.#topics.delete(socket);
		for (const [hash, swarm] of this.#swarms) {
			for (const [peer, active] of swarm)
				if (active === socket) swarm.delete(peer);
			if (swarm.size === 0) this.#swarms.delete(hash);
		}
	}

	/**
	 * MQTT 3.1.1 at QoS 0: CONNECT, SUBSCRIBE, UNSUBSCRIBE and PINGREQ are answered, and each PUBLISH passes to each
	 * socket that subscribed to its topic, also to the sender, as a public broker does.
	 */
	#acceptMqtt(socket: Socket): void {
		const topics = new Set<string>();
		this.#topics.set(socket, topics);
		const read = parser({ protocolVersion: 4 });
		read.on("packet", (packet: Packet) => {
			this.#received.set(socket.label, this.received(socket.label) + 1);
			if (packet.cmd === "connect")
				sendMqtt(socket, {
					cmd: "connack",
					returnCode: 0,
					sessionPresent: false,
				});
			else if (packet.cmd === "pingreq") sendMqtt(socket, { cmd: "pingresp" });
			else if (packet.cmd === "subscribe") {
				for (const { topic } of packet.subscriptions) topics.add(topic);
				sendMqtt(socket, {
					cmd: "suback",
					messageId: packet.messageId,
					granted: packet.subscriptions.map(() => 0),
				});
			} else if (packet.cmd === "unsubscribe") {
				for (const topic of packet.unsubscriptions) topics.delete(topic);
				sendMqtt(socket, {
					cmd: "unsuback",
					messageId: packet.messageId,
					granted: [],
				});
			} else if (packet.cmd === "publish")
				for (const [target, subscribed] of this.#topics)
					if (target.relay === socket.relay && subscribed.has(packet.topic))
						sendMqtt(target, {
							cmd: "publish",
							topic: packet.topic,
							payload: packet.payload,
							qos: 0,
							retain: false,
							dup: false,
						});
		});
		socket.route.onMessage((message) => {
			if (!socket.dead && typeof message !== "string") read.parse(message);
		});
		socket.route.onClose(() => this.#close(socket));
	}

	/** The WebTorrent announce: register the peer, reply, and pass each offer to another peer, each answer to its peer. */
	#tracker(socket: Socket, data: unknown): void {
		if (!isRecord(data) || data.action !== "announce") return;
		const hash = data.info_hash;
		const peer = data.peer_id;
		if (typeof hash !== "string" || typeof peer !== "string") return;
		const swarmKey = JSON.stringify([socket.relay, hash]);
		const swarm = this.#swarms.get(swarmKey) ?? new Map<string, Socket>();
		this.#swarms.set(swarmKey, swarm);
		swarm.set(peer, socket);
		if (data.answer !== undefined) {
			const target = swarm.get(String(data.to_peer_id));
			if (target)
				send(target, {
					action: "announce",
					info_hash: hash,
					peer_id: peer,
					answer: data.answer,
					offer_id: data.offer_id,
				});
			return;
		}
		send(socket, {
			action: "announce",
			interval: 120,
			info_hash: hash,
			complete: swarm.size,
			incomplete: 0,
		});
		const others = [...swarm].filter(([id]) => id !== peer);
		const offers = Array.isArray(data.offers) ? data.offers : [];
		for (const [index, offer] of offers.entries()) {
			const target = others[index]?.[1];
			if (!target || !isRecord(offer)) continue;
			send(target, {
				action: "announce",
				info_hash: hash,
				peer_id: peer,
				offer: offer.offer,
				offer_id: offer.offer_id,
			});
		}
	}

	/** NIP-01: REQ stores a subscription, EVENT is confirmed and passed to each matching subscription, CLOSE ends one. */
	#nostr(socket: Socket, data: unknown): void {
		if (!Array.isArray(data)) return;
		const [type, ...rest] = data as unknown[];
		const subscriptions =
			this.#subscriptions.get(socket) ?? new Map<string, Subscription>();
		this.#subscriptions.set(socket, subscriptions);
		if (type === "REQ") {
			const [subId, ...filters] = rest;
			if (typeof subId !== "string") return;
			subscriptions.set(subId, {
				kinds: filters.flatMap((filter) =>
					isRecord(filter) && Array.isArray(filter.kinds) ? filter.kinds : [],
				),
				topics: filters.flatMap((filter) =>
					isRecord(filter) && Array.isArray(filter["#x"]) ? filter["#x"] : [],
				),
			});
			send(socket, ["EOSE", subId]);
		} else if (type === "CLOSE") {
			subscriptions.delete(String(rest[0]));
		} else if (type === "EVENT") {
			const event = rest[0] as NostrEvent;
			send(socket, ["OK", event.id, true, ""]);
			const topic = event.tags.find((tag) => tag[0] === "x")?.[1] ?? "";
			for (const [target, list] of this.#subscriptions)
				for (const [subId, filter] of list)
					if (
						target.relay === socket.relay &&
						filter.kinds.includes(event.kind) &&
						filter.topics.includes(topic)
					)
						send(target, ["EVENT", subId, event]);
		}
	}
}

function send(socket: Socket, data: unknown): void {
	if (!socket.dead) socket.route.send(JSON.stringify(data));
}

function sendMqtt(socket: Socket, packet: Packet): void {
	if (!socket.dead) socket.route.send(generate(packet));
}

function parse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
