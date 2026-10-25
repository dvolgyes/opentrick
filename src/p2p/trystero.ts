import type { MeshConfig } from "./config";
import { RELAY_CHECK_ANSWER_MS } from "./limits";
import { Mesh, type MeshHandlers } from "./mesh";
import { watchNetworkChanges } from "./network-watch";
import type { Clock } from "./ports";
import {
	checkRelay,
	joinRoom,
	reconnectRelay,
	relayResting,
	relaySockets,
	selfId,
} from "./signaling";
import { stunProbe } from "./stun-probe";

export interface TrysteroMeshOptions {
	/** A Node-compatible WebRTC implementation; browsers use their global constructor. */
	readonly rtcPolyfill?: typeof RTCPeerConnection;
	/**
	 * Whether the frequent relay checks, and the close of silent links on a visible and online page, are on (a
	 * setting), asked at each tick; without it they are off.
	 */
	readonly relayChecks?: () => boolean;
}

/** The production mesh: the real Trystero bundle over the configured trackers and Nostr relays. */
export function trysteroMesh(
	tableId: string,
	key: string,
	config: MeshConfig,
	clock: Clock,
	{ rtcPolyfill, relayChecks }: TrysteroMeshOptions = {},
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
							watchNetwork: (onChange: () => void, onShown: () => void) =>
								watchNetworkChanges(
									{
										window,
										document,
										connection: (navigator as { connection?: EventTarget })
											.connection,
										wall: clock.wall,
									},
									onChange,
									onShown,
								),
						}),
				probeStun: stunProbe(rtcPolyfill ?? RTCPeerConnection),
				...(relayChecks === undefined
					? {}
					: {
							relayChecks: {
								on: relayChecks,
								check: (url: string) => checkRelay(url, RELAY_CHECK_ANSWER_MS),
							},
						}),
				...(relayChecks === undefined || typeof document === "undefined"
					? {}
					: {
							// A hidden or offline page can miss messages that its peers sent.
							silentLinks: () =>
								relayChecks() &&
								document.visibilityState === "visible" &&
								navigator.onLine,
						}),
				clock,
			},
			handlers,
		);
}
