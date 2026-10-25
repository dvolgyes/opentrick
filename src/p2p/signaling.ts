import {
	createStrategy,
	type JoinRoom,
	libName,
	selfId,
} from "@trystero-p2p/core";
import { getNostrSockets, nostrAdapter, reconnectNostrRelay } from "./nostr";
import type { RelayClient } from "./relay-socket";
import {
	getTrackerSockets,
	reconnectTracker,
	type TorrentRoomConfig,
	torrentAdapter,
} from "./torrent";

/**
 * The signaling of the mesh: the WebTorrent trackers and the Nostr relays in one Trystero strategy (ADR 0004).
 *
 * One strategy has one peer manager, so a page keeps one connection to each peer, also when it meets the peer
 * through a tracker and through a Nostr relay. Two strategies, one for each kind, would each connect the pair.
 *
 * The strategy reads the relay URLs of the first room that a page joins, and again after the page has left all
 * rooms; the mesh joins all its rooms with one config.
 */

export type RelayKind = "tracker" | "nostr";

export type SignalingRoomConfig = TorrentRoomConfig & {
	readonly trackerUrls: readonly string[];
	readonly nostrRelayUrls: readonly string[];
};

type Relay =
	| { readonly kind: "tracker"; readonly client: RelayClient }
	| { readonly kind: "nostr"; readonly client: RelayClient };

/** One tagged relay for each client, so the strategy sees the same relay object in each room. */
const relays = new WeakMap<RelayClient, Relay>();

const tagged = (kind: RelayKind, client: RelayClient): Relay => {
	const known = relays.get(client);
	if (known !== undefined) return known;
	const relay = { kind, client };
	relays.set(client, relay);
	return relay;
};

const joinRoomStrategy: JoinRoom<SignalingRoomConfig> = createStrategy({
	init: (config: SignalingRoomConfig) => [
		...torrentAdapter
			.init(config.trackerUrls, config)
			.map((ready) => ready.then((client) => tagged("tracker", client))),
		...nostrAdapter
			.init(config.nostrRelayUrls, config)
			.map((ready) => ready.then((client) => tagged("nostr", client))),
	],
	subscribe: (relay, rootTopic, selfTopic, onMessage, getOffers, context) =>
		relay.kind === "tracker"
			? torrentAdapter.subscribe(
					relay.client,
					rootTopic,
					selfTopic,
					onMessage,
					getOffers,
					context,
				)
			: nostrAdapter.subscribe(
					relay.client,
					rootTopic,
					selfTopic,
					onMessage,
					getOffers,
					context,
				),
	announce: (relay, rootTopic, selfTopic, extraPayload, context) =>
		relay.kind === "tracker"
			? torrentAdapter.announce(
					relay.client,
					rootTopic,
					selfTopic,
					extraPayload,
					context,
				)
			: nostrAdapter.announce(
					relay.client,
					rootTopic,
					selfTopic,
					extraPayload,
					context,
				),
	deactivate: (relay, rootTopic, selfTopic, context) =>
		relay.kind === "tracker"
			? torrentAdapter.deactivate(relay.client, rootTopic, selfTopic, context)
			: nostrAdapter.deactivate(relay.client, rootTopic, selfTopic, context),
});

/**
 * Joins a room over the configured trackers and Nostr relays. The mesh, not Trystero, reconnects the relays after a
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
});

/** Replaces the socket to one relay now; a URL that the page never opened is ignored. */
export const reconnectRelay = (kind: RelayKind, url: string): void =>
	kind === "tracker" ? reconnectTracker(url) : reconnectNostrRelay(url);

export type * from "@trystero-p2p/core";

export type { TorrentRoomConfig } from "./torrent";
export { selfId };
