import { APP_ID, type MeshConfig } from "../p2p/config";
import { joinRoom, type Room, selfId } from "../p2p/signaling";

export interface CommunityChannel {
	readonly self: string;
	peers(): readonly string[];
	send(message: unknown, to?: readonly string[]): void;
	leave(): Promise<void>;
}

export interface ChannelHandlers {
	message(peer: string, value: unknown): void;
	join(peer: string): void;
	leave(peer: string): void;
	problem(): void;
}

export type OpenCommunity = (
	room: string,
	key: string | undefined,
	handlers: ChannelHandlers,
) => CommunityChannel;
export const DISCOVERY_ROOM = "waiting-v1";
export const MAX_LOBBY_PEERS = 11;
const MAX_BYTES = 16 * 1024;

/**
 * Discovery and formation share a strategy, but never the game's application namespace.
 * Each room owns its handlers and membership; leaving discovery does not close a private formation room.
 * No media API is exposed. A capacity breach leaves discovery instead of closing a shared peer connection.
 */
export function communityTransport(config: MeshConfig): OpenCommunity {
	return (name, key, handlers) => {
		let closed = false;
		const rates = new Map<string, { since: number; count: number }>();
		const room: Room = joinRoom(
			{
				appId: `${APP_ID}/community-v1`,
				...(key === undefined ? {} : { password: key }),
				rtcConfig: config.rtc,
				trackerUrls: config.trackers,
				nostrRelayUrls: config.nostrRelays,
				mqttBrokerUrls: config.mqttBrokers,
				maxReceiveBytes: MAX_BYTES,
				offersPerAnnounce: key === undefined ? MAX_LOBBY_PEERS + 1 : 8,
			},
			name,
			{},
		);
		const action = room.makeAction<string>("formation-v1");
		const leave = async (): Promise<void> => {
			if (closed) return;
			closed = true;
			rates.clear();
			await room.leave();
		};
		action.onReceive = ({ peerId, byteLength }) => {
			if (closed || byteLength > MAX_BYTES) return false;
			const now = performance.now();
			let rate = rates.get(peerId);
			if (!rate || now - rate.since >= 1_000) {
				rate = { since: now, count: 0 };
				rates.set(peerId, rate);
			}
			return ++rate.count <= 32;
		};
		action.onMessage = (text, { peerId }) => {
			if (closed || typeof text !== "string" || text.length > MAX_BYTES) return;
			let value: unknown;
			try {
				value = JSON.parse(text);
			} catch (error) {
				if (error instanceof SyntaxError) return;
				throw error;
			}
			handlers.message(peerId, value);
		};
		room.onPeerJoin = (peer) => {
			if (closed) return;
			const maximum = key === undefined ? MAX_LOBBY_PEERS : 7;
			if (Object.keys(room.getPeers()).length > maximum) {
				void leave();
				handlers.problem();
				return;
			}
			handlers.join(peer);
		};
		room.onPeerLeave = (peer) => {
			rates.delete(peer);
			if (!closed) handlers.leave(peer);
		};
		return {
			self: selfId,
			peers: () => (closed ? [] : Object.keys(room.getPeers())),
			send: (message, to) => {
				if (closed) return;
				const text = JSON.stringify(message);
				if (new TextEncoder().encode(text).length > MAX_BYTES) return;
				void action
					.send(text, to === undefined ? undefined : { target: [...to] })
					.catch(() => {
						if (!closed) handlers.problem();
					});
			},
			leave,
		};
	};
}
