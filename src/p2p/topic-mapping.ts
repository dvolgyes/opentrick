/*
 * The topic mapping of Trystero 0.26.0, copied from @trystero-p2p/core (src/topic-strategy.ts and
 * `shouldActivatePassiveRoom` of src/signal-handler.ts), which the core does not export for an adapter of the
 * combined strategy (`signaling.ts`). Merge Trystero's changes by hand on an upgrade of @trystero-p2p/core. The
 * Nostr relays (`nostr.ts`) and the MQTT brokers (`mqtt.ts`) use it.
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
	type JoinRoomConfig,
	libName,
	type StrategyAdapter,
	type StrategyContext,
	type StrategyMessage,
	selfId,
	type TopicPublishContext,
	type TopicStrategyAdapter,
	type TopicSubscriptionContext,
	toJson,
} from "@trystero-p2p/core";

const steadyAnnounceIntervalMs = 60_000;

/** The topic functions of a relay kind, as a topic strategy of the core takes them. */
export type TopicFunctions<TRelay> = Pick<
	TopicStrategyAdapter<TRelay, JoinRoomConfig>,
	"subscribeTopic" | "publishTopic" | "unpublishTopic"
>;

/** A relay kind of the combined strategy: `init` takes the URLs of the kind, and there is no default list. */
export type RelayAdapter<TRelay> = Omit<
	StrategyAdapter<TRelay, JoinRoomConfig>,
	"init" | "deactivate"
> & {
	init: (urls: readonly string[], config: JoinRoomConfig) => Promise<TRelay>[];
	deactivate: NonNullable<
		StrategyAdapter<TRelay, JoinRoomConfig>["deactivate"]
	>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const requireContext = (
	context: StrategyContext<JoinRoomConfig> | undefined,
): StrategyContext<JoinRoomConfig> => {
	if (!context)
		throw new Error(`${libName}: topic strategy missing room context`);
	return context;
};

function makeTopicContext(
	context: StrategyContext<JoinRoomConfig>,
	kind: "root" | "self",
	rootTopic: string,
	selfTopic: string,
): TopicSubscriptionContext;
function makeTopicContext(
	context: StrategyContext<JoinRoomConfig>,
	kind: "announce" | "signal",
	rootTopic: string,
	selfTopic: string,
): TopicPublishContext;
function makeTopicContext(
	context: StrategyContext<JoinRoomConfig>,
	kind: "root" | "self" | "announce" | "signal",
	rootTopic: string,
	selfTopic: string,
): TopicSubscriptionContext | TopicPublishContext {
	return {
		kind,
		appId: context.appId,
		roomId: context.roomId,
		rootTopic,
		selfTopic,
	} as TopicSubscriptionContext | TopicPublishContext;
}

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

/**
 * The strategy functions over the topics of a room: each page subscribes to the room's root topic and to its own
 * topic, announces on the root topic every 60 s, and sends each signal to the topic of its peer. A passive room
 * subscribes to its own topic only after another page's announcement.
 */
export const topicMapping = <TRelay>({
	subscribeTopic,
	publishTopic,
	unpublishTopic,
}: TopicFunctions<TRelay>): Pick<
	RelayAdapter<TRelay>,
	"subscribe" | "announce" | "deactivate"
> => ({
	subscribe: async (relay, rootTopic, selfTopic, onMessage, _, rawContext) => {
		const context = requireContext(rawContext);
		const signalPeer = (peerTopic: string, signal: string) =>
			void publishTopic(
				relay,
				peerTopic,
				signal,
				makeTopicContext(context, "signal", rootTopic, selfTopic),
			);
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
					relay,
					selfTopic,
					(topic, msg) => {
						if (!didCleanup) void onMessage(topic, msg, signalPeer);
					},
					makeTopicContext(context, "self", rootTopic, selfTopic),
				),
			).then((cleanup) => {
				selfCleanup = cleanup;
				if (didCleanup) cleanupSelf(cleanup);
			});
			return selfSubscriptionP;
		};
		if (!context.isPassive) await ensureSelfSubscription();
		const rootCleanup = await subscribeTopic(
			relay,
			rootTopic,
			async (topic, msg) => {
				if (didCleanup) return;
				if (context.isPassive && shouldActivatePassiveRoom(msg))
					await ensureSelfSubscription();
				if (!didCleanup) await onMessage(topic, msg, signalPeer);
			},
			makeTopicContext(context, "root", rootTopic, selfTopic),
		);
		return () => {
			didCleanup = true;
			if (selfCleanup) cleanupSelf(selfCleanup);
			rootCleanup();
		};
	},

	announce: async (relay, rootTopic, selfTopic, extraPayload, rawContext) => {
		const context = requireContext(rawContext);
		const result = await publishTopic(
			relay,
			rootTopic,
			toJson({ peerId: selfId, ...extraPayload }),
			makeTopicContext(context, "announce", rootTopic, selfTopic),
		);
		return typeof result === "number" ||
			(result !== undefined && "stopAnnouncing" in result)
			? result
			: {
					nextAnnounceMs: result?.nextAnnounceMs ?? steadyAnnounceIntervalMs,
					reannounceOnDisconnect: result?.reannounceOnDisconnect ?? true,
				};
	},

	deactivate: (relay, rootTopic, selfTopic, rawContext) =>
		unpublishTopic?.(
			relay,
			rootTopic,
			makeTopicContext(
				requireContext(rawContext),
				"announce",
				rootTopic,
				selfTopic,
			),
		),
});
