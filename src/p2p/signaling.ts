import {
	createStrategy,
	type JoinRoom,
	libName,
	type StrategyAdapter,
	selfId,
} from "@trystero-p2p/core";
import { getMqttSockets, mqttAdapter, reconnectMqttBroker } from "./mqtt";
import {
	checkNostrRelay,
	getNostrSockets,
	nostrAdapter,
	nostrRelayResting,
	reconnectNostrRelay,
} from "./nostr";
import {
	getTrackerSockets,
	reconnectTracker,
	type TorrentRoomConfig,
	torrentAdapter,
} from "./torrent";

/**
 * The signaling of the mesh: the WebTorrent trackers, the Nostr relays and the MQTT brokers in one Trystero strategy
 * (ADR 0004).
 *
 * One strategy has one peer manager, so a page keeps one connection to each peer, also when it meets the peer
 * through two kinds of relay. A strategy for each kind would connect the pair once for each kind.
 *
 * The strategy reads the relay URLs of the first room that a page joins, and again after the page has left all
 * rooms; the mesh joins all its rooms with one config.
 */

export type RelayKind = "tracker" | "nostr" | "mqtt";

export type SignalingRoomConfig = TorrentRoomConfig & {
	readonly trackerUrls: readonly string[];
	readonly nostrRelayUrls: readonly string[];
	readonly mqttBrokerUrls: readonly string[];
};

/** The calls of the strategy that take a relay. */
type RelayCalls<TClient> = Pick<
	StrategyAdapter<TClient, SignalingRoomConfig>,
	"subscribe" | "announce"
> & {
	deactivate: NonNullable<
		StrategyAdapter<TClient, SignalingRoomConfig>["deactivate"]
	>;
};

type WithoutRelay<F> = F extends (relay: never, ...rest: infer A) => infer R
	? (...rest: A) => R
	: never;

/** A relay with its client bound to the calls of its kind, so the strategy routes each call to that kind. */
type Relay = {
	readonly [K in keyof RelayCalls<unknown>]: WithoutRelay<
		RelayCalls<unknown>[K]
	>;
};

/** One relay for each client, so the strategy sees the same relay object in each room. */
const relays = new WeakMap<object, Relay>();

const bound = <TClient extends object>(
	adapter: RelayCalls<TClient>,
	client: TClient,
): Relay => {
	const known = relays.get(client);
	if (known !== undefined) return known;
	const relay: Relay = {
		subscribe: (...rest) => adapter.subscribe(client, ...rest),
		announce: (...rest) => adapter.announce(client, ...rest),
		deactivate: (...rest) => adapter.deactivate(client, ...rest),
	};
	relays.set(client, relay);
	return relay;
};

const joinRoomStrategy: JoinRoom<SignalingRoomConfig> = createStrategy({
	init: (config: SignalingRoomConfig) => [
		...torrentAdapter
			.init(config.trackerUrls, config)
			.map((ready) => ready.then((client) => bound(torrentAdapter, client))),
		...nostrAdapter
			.init(config.nostrRelayUrls, config)
			.map((ready) => ready.then((client) => bound(nostrAdapter, client))),
		...mqttAdapter
			.init(config.mqttBrokerUrls, config)
			.map((ready) => ready.then((client) => bound(mqttAdapter, client))),
	],
	subscribe: (relay, ...rest) => relay.subscribe(...rest),
	announce: (relay, ...rest) => relay.announce(...rest),
	deactivate: (relay, ...rest) => relay.deactivate(...rest),
});

/**
 * Joins a room over the configured trackers, Nostr relays and MQTT brokers. The mesh, not Trystero, reconnects the relays after a
 * network change (`reconnectRelay`).
 */
export const joinRoom: JoinRoom<SignalingRoomConfig> = (
	config,
	roomId,
	callbacks,
) => {
	const { offersPerAnnounce } = config;
	if (
		offersPerAnnounce !== undefined &&
		!(Number.isInteger(offersPerAnnounce) && offersPerAnnounce > 0)
	) {
		throw new Error(
			`${libName}: offersPerAnnounce must be a positive integer, not ${offersPerAnnounce}`,
		);
	}
	return joinRoomStrategy(
		{
			...config,
			trickleIce: config.trickleIce ?? false,
			relayConfig: { ...config.relayConfig, manualReconnection: true },
		},
		roomId,
		callbacks,
	);
};

/** The relay sockets of each kind by URL, for the evidence that each relay is alive. */
export const relaySockets = (): Record<
	RelayKind,
	Record<string, WebSocket>
> => ({
	tracker: getTrackerSockets(),
	nostr: getNostrSockets(),
	mqtt: getMqttSockets(),
});

/** Replaces the socket to one relay now; a URL that the page never opened is ignored. */
export const reconnectRelay = (kind: RelayKind, url: string): void =>
	({
		tracker: reconnectTracker,
		nostr: reconnectNostrRelay,
		mqtt: reconnectMqttBroker,
	})[kind](url);

/** Whether the page sends nothing to a relay for a time, after its rate limit; only a Nostr relay rests. */
export const relayResting = (kind: RelayKind, url: string): boolean =>
	kind === "nostr" && nostrRelayResting(url);

/** Checks that a Nostr relay answers (src/p2p/relay-check.ts). */
export const checkRelay = checkNostrRelay;

export type * from "@trystero-p2p/core";

export type { TorrentRoomConfig } from "./torrent";
export { selfId };
