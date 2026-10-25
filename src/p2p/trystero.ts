import type { MeshConfig } from "./config";
import { Mesh, type MeshHandlers } from "./mesh";
import type { Clock } from "./ports";
import { joinRoom, reconnectRelay, relaySockets, selfId } from "./signaling";
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
				...(typeof window === "undefined"
					? {}
					: { watchNetwork: browserNetworkChanges }),
				probeStun: stunProbe(rtcPolyfill ?? RTCPeerConnection),
				clock,
			},
			handlers,
		);
}

/**
 * The browser's network changes: the page comes online again, or the connection type changes (Wi-Fi to mobile data
 * and back, where the browser has the Network Information API).
 */
function browserNetworkChanges(onChange: () => void): () => void {
	const connection = (navigator as { connection?: EventTarget }).connection;
	window.addEventListener("online", onChange);
	connection?.addEventListener("change", onChange);
	return () => {
		window.removeEventListener("online", onChange);
		connection?.removeEventListener("change", onChange);
	};
}
