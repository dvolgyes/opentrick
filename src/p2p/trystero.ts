import type { MeshConfig } from "./config";
import { Mesh, type MeshHandlers } from "./mesh";
import { watchNetworkChanges } from "./network-watch";
import type { Clock } from "./ports";
import {
	joinRoom,
	reconnectRelay,
	relayResting,
	relaySockets,
	selfId,
} from "./signaling";
import { stunProbe } from "./stun-probe";

/** The production mesh: the real Trystero bundle over the configured trackers and Nostr relays. */
export function trysteroMesh(
	tableId: string,
	key: string,
	config: MeshConfig,
	clock: Clock,
	rtcPolyfill?: typeof RTCPeerConnection,
): (handlers: MeshHandlers) => Mesh {
	return (handlers) =>
		new Mesh(
			{
				tableId,
				key,
				config,
				rtcPolyfill,
				joinRoom,
				self: selfId,
				relaySockets,
				reconnectRelay,
				relayResting,
				...(typeof window === "undefined"
					? {}
					: {
							watchNetwork: (onChange: () => void) =>
								watchNetworkChanges(
									{
										window,
										document,
										connection: (navigator as { connection?: EventTarget })
											.connection,
										wall: clock.wall,
									},
									onChange,
								),
						}),
				probeStun: stunProbe(rtcPolyfill ?? RTCPeerConnection),
				clock,
			},
			handlers,
		);
}
