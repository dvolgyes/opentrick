/*
 * The MQTT strategy of Trystero 0.26.0, copied from @trystero-p2p/mqtt (dist/index.mjs), with the topic mapping of
 * @trystero-p2p/core in `topic-mapping.ts`. Merge Trystero's changes by hand on an upgrade of @trystero-p2p/core. The
 * changes from upstream:
 *
 * - This is an adapter of the combined strategy (`signaling.ts`), not a strategy of its own, so a page that meets
 *   a peer through two kinds of relay keeps one connection to it.
 * - `init` takes the broker URLs; there is no default list and no redundancy count.
 * - The client uses the WebSocket of the browser, also in Node (the bot), so `getMqttSockets` reports one kind of
 *   socket.
 * - mqtt.js opens a closed socket again after a fixed second. Here the wait is random below a period that doubles
 *   from FIRST_RETRY_MS to MAX_RETRY_MS, as for the other relays (`relay-socket.ts`), and `reconnectMqttBroker`
 *   replaces the socket at once.
 * - A client error is not logged: mqtt.js opens the socket again by itself, and the Network panel shows the broker.
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

import {
	createRelayManager,
	type StrategyMessage,
	type TopicPublishContext,
	type TopicSubscriptionContext,
	toJson,
} from "@trystero-p2p/core";
import mqtt, { type MqttClient } from "mqtt";
import { type RelayAdapter, topicMapping } from "./topic-mapping";

const FIRST_RETRY_MS = 3_333;
const MAX_RETRY_MS = 60_000;
/** mqtt.js closes a socket that answers no ping for 1.5 times this, and the brokers see the page as alive. */
const KEEPALIVE_S = 30;
const OPEN = 1;
const CONNECTING = 0;

type TopicHandler = (topic: string, data: string) => void;

type TopicState = {
	refs: number;
	handler?: TopicHandler;
	token?: symbol;
	ready?: Promise<void>;
	announcement?: string;
};

/** The browser WebSocket under the client's current stream (`browserStreamBuilder` of mqtt.js). */
const socketOf = (client: MqttClient): WebSocket | undefined =>
	(client.stream as { socket?: WebSocket } | undefined)?.socket;

const relayManager = createRelayManager<MqttClient>(socketOf);
const topicStates = relayManager.scoped<TopicState>();
const pendingBatches = new WeakMap<
	MqttClient,
	{ topics: Set<string>; promise: Promise<void> }
>();
const clients: Record<string, MqttClient> = {};
/** The retry period of each client, and whether its next retry starts at once. */
const retries = new WeakMap<MqttClient, { periodMs: number; now: boolean }>();

const ensureSubscribed = (
	client: MqttClient,
	states: Record<string, TopicState>,
	topic: string,
): Promise<void> => {
	const state = states[topic];
	if (!state) return Promise.resolve();
	if (state.ready) return state.ready;
	let batch = pendingBatches.get(client);
	if (!batch) {
		const topics = new Set<string>();
		batch = {
			topics,
			promise: new Promise((resolve) => {
				queueMicrotask(() => {
					pendingBatches.delete(client);
					const activeTopics = [...topics].filter(
						(t) => (states[t]?.refs ?? 0) > 0,
					);
					resolve(
						activeTopics.length > 0
							? client.subscribeAsync(activeTopics).then(
									() => {},
									// A subscription that fails is made again at the next connect.
									() => {},
								)
							: undefined,
					);
				});
			}),
		};
		pendingBatches.set(client, batch);
	}
	batch.topics.add(topic);
	state.ready = batch.promise;
	return state.ready;
};

const connect = (url: string): MqttClient => {
	const client = mqtt.connect(url, {
		forceNativeWebSocket: true,
		keepalive: KEEPALIVE_S,
		queueQoSZero: false,
		reconnectPeriod: FIRST_RETRY_MS,
		resubscribe: false,
	});
	const retry = { periodMs: FIRST_RETRY_MS, now: false };
	retries.set(client, retry);
	// The client is registered only after this function returns.
	const states = topicStates.forKey(url);
	client
		.on("message", (topic, payload) =>
			states[topic]?.handler?.(topic, payload.toString()),
		)
		.on("connect", () => {
			retry.periodMs = FIRST_RETRY_MS;
			const topics = Object.keys(states).filter(
				(topic) => (states[topic]?.refs ?? 0) > 0,
			);
			if (topics.length === 0) return;
			client.subscribeAsync(topics).then(
				() => {
					for (const [topic, state] of Object.entries(states))
						if (state.announcement) client.publish(topic, state.announcement);
				},
				() => {},
			);
		})
		.on("error", () => {});
	// Before the handler of mqtt.js, which schedules the next connect with the reconnect period.
	client.prependListener("close", () => {
		client.options.reconnectPeriod = retry.now
			? 1
			: Math.max(1, Math.random() * retry.periodMs);
		if (!retry.now) retry.periodMs = Math.min(retry.periodMs * 2, MAX_RETRY_MS);
		retry.now = false;
	});
	return client;
};

const subscribeTopic = (
	client: MqttClient,
	topic: string,
	onMessage: (topic: string, msg: StrategyMessage) => void | Promise<void>,
	context: TopicSubscriptionContext,
): (() => void) | Promise<() => void> => {
	const states = topicStates.forRelay(client);
	states[topic] ??= { refs: 0 };
	const state = states[topic];
	const token = Symbol(topic);
	const topicHandler: TopicHandler = (topic, data) =>
		void onMessage(topic, data);
	state.handler = topicHandler;
	state.token = token;
	state.refs += 1;
	const cleanup = () => {
		state.refs = Math.max(0, state.refs - 1);
		if (state.handler === topicHandler) delete state.handler;
		if (state.token === token) delete state.token;
		if (state.refs === 0) {
			if (state.ready) client.unsubscribe(topic);
			delete states[topic];
		}
	};
	if (context.kind === "root")
		return Promise.all([
			ensureSubscribed(client, states, context.selfTopic),
			ensureSubscribed(client, states, topic),
		]).then(() => cleanup);
	return states[context.rootTopic]
		? ensureSubscribed(client, states, topic).then(() => cleanup)
		: cleanup;
};

const publishTopic = (
	client: MqttClient,
	topic: string,
	msg: StrategyMessage,
	{ kind }: TopicPublishContext,
): void => {
	const payload = typeof msg === "string" ? msg : toJson(msg);
	if (kind === "announce") {
		const states = topicStates.forRelay(client);
		states[topic] ??= { refs: 0 };
		states[topic].announcement = payload;
	}
	if (client.connected) client.publish(topic, payload);
};

const unpublishTopic = (client: MqttClient, topic: string): void => {
	delete topicStates.forRelay(client)[topic]?.announcement;
};

/** The MQTT brokers of the combined strategy (`signaling.ts`), one client for each URL in the page. */
export const mqttAdapter: RelayAdapter<MqttClient> = {
	init: (urls) =>
		urls.map((url) => {
			const client = relayManager.register(url, () => connect(url));
			clients[url] = client;
			return client.connected
				? Promise.resolve(client)
				: new Promise((resolve) =>
						client.once("connect", () => resolve(client)),
					);
		}),

	...topicMapping({ subscribeTopic, publishTopic, unpublishTopic }),
};

/** The MQTT broker sockets by URL, for the evidence that each broker is alive. */
export const getMqttSockets = relayManager.getSockets;

/**
 * Replaces the socket to an MQTT broker now, after a network change or a long silence. An open or opening socket
 * closes, and the client connects again at once; a client that waits to connect again connects now.
 */
export const reconnectMqttBroker = (url: string): void => {
	const client = clients[url];
	const retry = client && retries.get(client);
	if (client === undefined || retry === undefined) return;
	retry.periodMs = FIRST_RETRY_MS;
	const state = socketOf(client)?.readyState;
	if (state === OPEN || state === CONNECTING) {
		retry.now = true;
		client.stream.destroy();
	} else client.reconnect();
};
