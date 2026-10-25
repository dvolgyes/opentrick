/*
 * The Nostr strategy of Trystero 0.26.0, copied from @trystero-p2p/nostr (dist/index.mjs) together with the topic
 * mapping of @trystero-p2p/core (src/topic-strategy.ts and `shouldActivatePassiveRoom` of src/signal-handler.ts).
 * Merge Trystero's changes by hand on an upgrade of @trystero-p2p/core. The changes from upstream:
 *
 * - This is an adapter of the combined strategy (`signaling.ts`), not a strategy of its own, so a page that meets
 *   a peer through a tracker and through a Nostr relay keeps one connection to it.
 * - `init` takes the relay URLs; there is no default list and no redundancy count.
 * - The sockets come from `relay-socket.ts`, which can reconnect at once (`reconnectNostrRelay`).
 * - A relay message that is not valid JSON, or whose fields have the wrong types, is ignored. Upstream throws in
 *   the socket handler.
 *
 * As upstream, the page does not check the signature of the events it receives: each page signs with a new key, so
 * a valid signature proves nothing about the sender, and the room password encrypts and authenticates each offer.
 *
 * Copyright (c) 2021 Dan Motzenbecker
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */

import { schnorr } from "@noble/secp256k1";
import {
	createRelayManager,
	genId,
	hashWith,
	type JoinRoomConfig,
	libName,
	type StrategyAdapter,
	type StrategyContext,
	type StrategyMessage,
	selfId,
	strToNum,
	toHex,
	toJson,
} from "@trystero-p2p/core";
import { type RelayClient, relaySocket } from "./relay-socket";

const relayManager = createRelayManager<RelayClient>((client) => client.socket);
const clients: Record<string, RelayClient> = {};
const tag = "x";
const eventMsgType = "EVENT";
const { secretKey, publicKey } = schnorr.keygen();
const pubkey = toHex(publicKey);
const kindCache: Record<string, number> = {};
const maxTopicsPerSubscription = 250;
const steadyAnnounceIntervalMs = 60_000;
const maxRelayBackoffMs = 900_000;
const subscriptionRetryMs = 5_333;
const relayBackoffs = new WeakMap<
	RelayClient,
	{ delayMs: number; untilMs: number }
>();
const announcementMessages = relayManager.scoped<string>();
const retiredRelays = new WeakSet<RelayClient>();

/** Not exported by @trystero-p2p/core 0.26.0 (src/types.ts). */
type AnnounceResult =
	| number
	| { stopAnnouncing: true }
	| { nextAnnounceMs: number; reannounceOnDisconnect?: boolean };

type TopicHandler = (topic: string, data: string) => void;

type Batcher = {
	subIds: string[];
	topics: Map<string, TopicHandler>;
	updateTimer: ReturnType<typeof setTimeout> | null;
	flushWaiters: Set<() => void>;
	retryTimer: ReturnType<typeof setTimeout> | null;
	retryMs: number;
	pendingEose: Set<string>;
	requestedAt: number;
};

const batchers: Record<string, Batcher> = {};

/** A relay message in the fields that the page reads (NIP-01). */
type RelayMessage =
	| { type: "EVENT"; subId: string; topic: string; content: string }
	| { type: "OK"; accepted: boolean; reason: string }
	| { type: "EOSE"; subId: string }
	| { type: "CLOSED"; subId: string; reason: string }
	| { type: "NOTICE"; text: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The topic of an event's first `x` tag. */
const tagTopic = (tags: unknown): string | undefined => {
	if (!Array.isArray(tags)) return undefined;
	for (const entry of tags) {
		if (Array.isArray(entry) && entry[0] === tag) {
			return typeof entry[1] === "string" && entry[1] !== ""
				? entry[1]
				: undefined;
		}
	}
	return undefined;
};

/** A relay message, or undefined for text that is not JSON, a type the page does not read, or a malformed field. */
const parseRelayMessage = (raw: string): RelayMessage | undefined => {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!Array.isArray(data)) return undefined;
	const [type, first, second, third] = data as unknown[];
	switch (type) {
		case "EVENT": {
			if (typeof first !== "string" || !isRecord(second)) return undefined;
			const topic = tagTopic(second.tags);
			const { content } = second;
			return topic !== undefined && typeof content === "string"
				? { type, subId: first, topic, content }
				: undefined;
		}
		case "OK":
			return typeof second === "boolean"
				? {
						type,
						accepted: second,
						reason: typeof third === "string" ? third : "",
					}
				: undefined;
		case "EOSE":
			return typeof first === "string" ? { type, subId: first } : undefined;
		case "CLOSED":
			return typeof first === "string"
				? {
						type,
						subId: first,
						reason: typeof second === "string" ? second : "",
					}
				: undefined;
		case "NOTICE":
			return typeof first === "string" ? { type, text: first } : undefined;
		default:
			return undefined;
	}
};

const backoffRelay = (client: RelayClient): number => {
	const previous = relayBackoffs.get(client);
	const delayMs = Math.min(
		previous?.delayMs
			? Math.max(steadyAnnounceIntervalMs, previous.delayMs * 2)
			: steadyAnnounceIntervalMs,
		maxRelayBackoffMs,
	);
	relayBackoffs.set(client, { delayMs, untilMs: Date.now() + delayMs });
	return delayMs;
};

const getRelayBackoffMs = (client: RelayClient): number => {
	const state = relayBackoffs.get(client);
	if (!state) return 0;
	const remainingMs = state.untilMs - Date.now();
	if (remainingMs > 0) return remainingMs;
	return 0;
};

const nextAnnounce = (nextAnnounceMs: number): AnnounceResult => ({
	nextAnnounceMs,
});
const stopAnnouncing: AnnounceResult = { stopAnnouncing: true };

const retireRelay = (client: RelayClient): boolean => {
	if (retiredRelays.has(client)) return false;
	retiredRelays.add(client);
	relayBackoffs.delete(client);
	client.close();
	return true;
};

const now = (): number => Math.floor(Date.now() / 1000);

const topicToKind = (topic: string): number =>
	(kindCache[topic] ??= strToNum(topic, 10_000) + 20_000);

const createEvent = async (topic: string, content: string): Promise<string> => {
	const payload = {
		kind: topicToKind(topic),
		tags: [[tag, topic]],
		created_at: now(),
		content,
		pubkey,
	};
	const id = await hashWith(
		"SHA-256",
		toJson([
			0,
			payload.pubkey,
			payload.created_at,
			payload.kind,
			payload.tags,
			payload.content,
		]),
	);
	return toJson([
		eventMsgType,
		{
			...payload,
			id: toHex(id),
			sig: toHex(await schnorr.signAsync(id, secretKey)),
		},
	]);
};

const resolveBatchFlush = (batcher: Batcher): void => {
	for (const resolve of batcher.flushWaiters) resolve();
	batcher.flushWaiters.clear();
};

const batchAdd = (
	client: RelayClient,
	topic: string,
	handler: TopicHandler,
): void => {
	const batcher = batchers[client.url] ?? {
		subIds: [],
		topics: new Map(),
		updateTimer: null,
		flushWaiters: new Set(),
		retryTimer: null,
		retryMs: subscriptionRetryMs,
		pendingEose: new Set(),
		requestedAt: 0,
	};
	batchers[client.url] = batcher;
	batcher.topics.set(topic, handler);
	scheduleBatchFlush(client, batcher);
};

const batchRemove = (client: RelayClient, topic: string): void => {
	const batcher = batchers[client.url];
	if (!batcher) return;
	batcher.topics.delete(topic);
	delete announcementMessages.forRelay(client)[topic];
	if (batcher.topics.size === 0) {
		if (batcher.retryTimer !== null) clearTimeout(batcher.retryTimer);
		if (batcher.updateTimer !== null) {
			clearTimeout(batcher.updateTimer);
			batcher.updateTimer = null;
		}
		resolveBatchFlush(batcher);
		for (const subId of batcher.subIds) client.send(toJson(["CLOSE", subId]));
		delete batchers[client.url];
	} else scheduleBatchFlush(client, batcher);
};

const scheduleBatchFlush = (client: RelayClient, batcher: Batcher): void => {
	if (batcher.updateTimer !== null) return;
	batcher.updateTimer = setTimeout(() => {
		batcher.updateTimer = null;
		try {
			flushBatch(client);
		} finally {
			resolveBatchFlush(batcher);
		}
	}, 0);
};

const waitForBatchFlush = (client: RelayClient): Promise<void> => {
	const batcher = batchers[client.url];
	if (!batcher || batcher.updateTimer === null) return Promise.resolve();
	return new Promise((resolve) => batcher.flushWaiters.add(resolve));
};

const flushBatch = (client: RelayClient): void => {
	const batcher = batchers[client.url];
	if (!batcher || batcher.topics.size === 0) return;
	const topics = [...batcher.topics.keys()];
	const chunks: string[][] = [];
	const since = now();
	for (let i = 0; i < topics.length; i += maxTopicsPerSubscription)
		chunks.push(topics.slice(i, i + maxTopicsPerSubscription));
	while (batcher.subIds.length > chunks.length) {
		const subId = batcher.subIds.pop();
		if (subId) client.send(toJson(["CLOSE", subId]));
	}
	batcher.pendingEose.clear();
	batcher.requestedAt = Date.now();
	chunks.forEach((chunk, i) => {
		const subId = batcher.subIds[i] ?? genId(64);
		batcher.subIds[i] = subId;
		batcher.pendingEose.add(subId);
		client.send(
			toJson([
				"REQ",
				subId,
				{ kinds: [...new Set(chunk.map(topicToKind))], since, "#x": chunk },
			]),
		);
	});
};

const resubscribeOnReconnect = (client: RelayClient): void => {
	const batcher = batchers[client.url];
	if (batcher && batcher.topics.size > 0 && !client.isClosed) {
		if (getRelayBackoffMs(client) > 0) {
			retrySubscription(client, true);
			return;
		}
		if (batcher.retryTimer !== null) {
			clearTimeout(batcher.retryTimer);
			batcher.retryTimer = null;
		}
		flushBatch(client);
		replayAnnouncements(client);
	}
};

const replayAnnouncements = (client: RelayClient): void => {
	Object.entries(announcementMessages.forRelay(client)).forEach(
		([topic, payload]) => {
			void publishMessage(client, topic, payload, true);
		},
	);
};

/** Each announcement differs by a nonce, so a relay does not drop a repeat as a duplicate. */
const withNonce = (payload: string): string => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return payload;
	}
	return isRecord(parsed) ? toJson({ ...parsed, nonce: genId(8) }) : payload;
};

const publishMessage = async (
	client: RelayClient,
	topic: string,
	payload: string,
	isAnnouncement: boolean,
): Promise<AnnounceResult | undefined> => {
	if (retiredRelays.has(client) || client.isClosed)
		return isAnnouncement ? stopAnnouncing : undefined;
	const remaining = getRelayBackoffMs(client);
	if (remaining > 0 || client.socket.readyState !== 1)
		return isAnnouncement
			? nextAnnounce(Math.max(steadyAnnounceIntervalMs, remaining))
			: undefined;
	const event = await createEvent(
		topic,
		isAnnouncement ? withNonce(payload) : payload,
	);
	if (isAnnouncement && !batchers[client.url]?.topics.has(topic))
		return nextAnnounce(steadyAnnounceIntervalMs);
	if (
		getRelayBackoffMs(client) > 0 ||
		client.isClosed ||
		client.socket.readyState !== 1
	)
		return isAnnouncement ? nextAnnounce(steadyAnnounceIntervalMs) : undefined;
	client.send(event);
	if (isAnnouncement) return nextAnnounce(steadyAnnounceIntervalMs);
	return undefined;
};

const retrySubscription = (client: RelayClient, rateLimited: boolean): void => {
	const batcher = batchers[client.url];
	if (!batcher || (batcher.retryTimer !== null && !rateLimited)) return;
	if (batcher.retryTimer !== null) clearTimeout(batcher.retryTimer);
	const delay = rateLimited ? getRelayBackoffMs(client) : batcher.retryMs;
	batcher.retryMs = Math.min(batcher.retryMs * 2, steadyAnnounceIntervalMs);
	batcher.retryTimer = setTimeout(
		() => {
			batcher.retryTimer = null;
			resubscribeOnReconnect(client);
		},
		Math.max(delay, subscriptionRetryMs),
	);
};

const handleRelayMessage = (
	client: RelayClient,
	config: JoinRoomConfig,
	raw: string,
): void => {
	const message = parseRelayMessage(raw);
	if (message === undefined) return;
	if (message.type === eventMsgType) {
		const batcher = batchers[client.url];
		if (batcher?.subIds.includes(message.subId))
			batcher.topics.get(message.topic)?.(message.topic, message.content);
		return;
	}
	const prefix = `${libName}: relay failure from ${client.url} - `;
	const didRejectEvent = message.type === "OK" && !message.accepted;
	const isClosed = message.type === "CLOSED";
	const rejectionReason =
		message.type === "OK" || message.type === "CLOSED" ? message.reason : "";
	const isRateLimited =
		(didRejectEvent || isClosed) && rejectionReason.startsWith("rate-limited:");
	const isDuplicate =
		didRejectEvent && rejectionReason.startsWith("duplicate:");
	const isTerminalRejection = /^(blocked|restricted|auth-required|pow):/.test(
		rejectionReason,
	);
	if (
		message.type === "OK" &&
		message.accepted &&
		getRelayBackoffMs(client) === 0
	)
		relayBackoffs.delete(client);
	if (
		(didRejectEvent || isClosed) &&
		isTerminalRejection &&
		!retireRelay(client)
	)
		return;
	if (isRateLimited) backoffRelay(client);
	else if (message.type === "EOSE") {
		const batcher = batchers[client.url];
		if (
			batcher?.pendingEose.delete(message.subId) &&
			batcher.pendingEose.size === 0
		) {
			batcher.retryMs = subscriptionRetryMs;
			if (batcher.retryTimer !== null) {
				clearTimeout(batcher.retryTimer);
				batcher.retryTimer = null;
			}
			if (Date.now() - batcher.requestedAt >= 1000) replayAnnouncements(client);
		}
	}
	if (isClosed && !isTerminalRejection)
		retrySubscription(client, isRateLimited);
	if (!isDuplicate && config.relayConfig?.warnOnRelayFailure !== false) {
		if (message.type === "NOTICE") console.warn(prefix + message.text);
		else if (didRejectEvent || isClosed) console.warn(prefix + rejectionReason);
	}
};

type TopicContext = {
	kind: "announce" | "signal";
};

const subscribeTopic = (
	client: RelayClient,
	topic: string,
	onMessage: (topic: string, msg: string) => void | Promise<void>,
	kind: "root" | "self",
): (() => void) | Promise<() => void> => {
	const handler: TopicHandler = (topic, data) => void onMessage(topic, data);
	batchAdd(client, topic, handler);
	const cleanup = () => {
		if (batchers[client.url]?.topics.get(topic) === handler)
			batchRemove(client, topic);
	};
	return kind === "root"
		? waitForBatchFlush(client).then(() => cleanup)
		: cleanup;
};

const publishTopic = (
	client: RelayClient,
	topic: string,
	payload: string,
	{ kind }: TopicContext,
): Promise<AnnounceResult | undefined> => {
	if (kind === "announce")
		announcementMessages.forRelay(client)[topic] = payload;
	return publishMessage(client, topic, payload, kind === "announce");
};

const unpublishTopic = (client: RelayClient, topic: string): void => {
	delete announcementMessages.forRelay(client)[topic];
};

/** Whether a message on a passive room's topic should wake the room: an announcement of another active page. */
const shouldActivatePassiveRoom = (msg: StrategyMessage): boolean => {
	let payload: unknown = msg;
	if (typeof msg === "string") {
		try {
			payload = JSON.parse(msg);
		} catch {
			return false;
		}
	}
	if (!isRecord(payload)) return false;
	const hasInvalidSignalField =
		["offer", "answer", "candidate"].some(
			(key) =>
				key in payload &&
				(typeof payload[key] !== "string" || payload[key] === ""),
		) ||
		("peer" in payload && typeof msg === "string");
	if (hasInvalidSignalField) return false;
	const text = (key: string): string | undefined =>
		typeof payload[key] === "string" && payload[key] !== ""
			? payload[key]
			: undefined;
	const peerId = text("peerId");
	return Boolean(
		peerId &&
			peerId !== selfId &&
			payload.passive !== true &&
			!text("answer") &&
			!text("candidate"),
	);
};

type NostrAdapter = Omit<
	StrategyAdapter<RelayClient, JoinRoomConfig>,
	"init" | "deactivate"
> & {
	init: (
		urls: readonly string[],
		config: JoinRoomConfig,
	) => Promise<RelayClient>[];
	deactivate: NonNullable<
		StrategyAdapter<RelayClient, JoinRoomConfig>["deactivate"]
	>;
};

const requireContext = (
	context: StrategyContext<JoinRoomConfig> | undefined,
): StrategyContext<JoinRoomConfig> => {
	if (!context)
		throw new Error(`${libName}: topic strategy missing room context`);
	return context;
};

/** The Nostr relays of the combined strategy (`signaling.ts`), one client for each URL in the page. */
export const nostrAdapter: NostrAdapter = {
	init: (urls, config) =>
		urls.map((url) => {
			const client = relayManager.register(url, () =>
				relaySocket(
					url,
					(data) => handleRelayMessage(client, config, data),
					() => resubscribeOnReconnect(client),
				),
			);
			clients[url] = client;
			return client.ready;
		}),

	subscribe: async (client, rootTopic, selfTopic, onMessage, _, rawContext) => {
		const context = requireContext(rawContext);
		const signalPeer = (peerTopic: string, signal: string) =>
			void publishTopic(client, peerTopic, signal, { kind: "signal" });
		let selfCleanup: (() => void) | null = null;
		let selfCleanupDone = false;
		let selfSubscriptionP: Promise<void> | null = null;
		let didCleanup = false;
		const cleanupSelf = (cleanup: () => void) => {
			if (selfCleanupDone) return;
			selfCleanupDone = true;
			cleanup();
		};
		const ensureSelfSubscription = () => {
			selfSubscriptionP ??= Promise.resolve(
				subscribeTopic(
					client,
					selfTopic,
					(topic, msg) => {
						if (!didCleanup) void onMessage(topic, msg, signalPeer);
					},
					"self",
				),
			).then((cleanup) => {
				selfCleanup = cleanup;
				if (didCleanup) cleanupSelf(cleanup);
			});
			return selfSubscriptionP;
		};
		if (!context.isPassive) await ensureSelfSubscription();
		const rootCleanup = await subscribeTopic(
			client,
			rootTopic,
			async (topic, msg) => {
				if (didCleanup) return;
				if (context.isPassive && shouldActivatePassiveRoom(msg))
					await ensureSelfSubscription();
				if (!didCleanup) await onMessage(topic, msg, signalPeer);
			},
			"root",
		);
		return () => {
			didCleanup = true;
			if (selfCleanup) cleanupSelf(selfCleanup);
			rootCleanup();
		};
	},

	announce: async (client, rootTopic, _, extraPayload) => {
		const result = await publishTopic(
			client,
			rootTopic,
			toJson({ peerId: selfId, ...extraPayload }),
			{ kind: "announce" },
		);
		return typeof result === "number" ||
			(result !== undefined && "stopAnnouncing" in result)
			? result
			: {
					nextAnnounceMs: result?.nextAnnounceMs ?? steadyAnnounceIntervalMs,
					reannounceOnDisconnect: result?.reannounceOnDisconnect ?? true,
				};
	},

	deactivate: (client, rootTopic) => unpublishTopic(client, rootTopic),
};

/** The Nostr relay sockets by URL, for the evidence that each relay is alive. */
export const getNostrSockets = relayManager.getSockets;

/** Replaces the socket to a Nostr relay now, after a network change or a long silence. */
export const reconnectNostrRelay = (url: string): void =>
	clients[url]?.reconnect();
