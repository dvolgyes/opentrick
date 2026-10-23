import { describe, expect, it } from "vitest";
import { TABLE_OFFERS } from "../../src/p2p/limits";
import {
	type JoinMeshRoom,
	Mesh,
	type MeshHandlers,
	type MeshRoom,
} from "../../src/p2p/mesh";
import { seatRendezvous } from "../../src/p2p/rendezvous";
import type { TorrentRoomConfig } from "../../src/p2p/torrent";
import { TABLE } from "./p2p-fixtures";

const KEY = "k".repeat(43);

/** A room without peers; actions send nothing. */
function emptyRoom(): MeshRoom {
	return {
		makeAction: () => ({
			send: async () => {},
			onMessage: null,
			onReceiveProgress: null,
			onReceive: null,
		}),
		getPeers: () => ({}),
		leave: async () => {},
		onPeerJoin: null,
		onPeerLeave: null,
	};
}

const handlers: MeshHandlers = {
	join: () => {},
	leave: () => {},
	ctl: () => {},
	log: () => {},
	call: () => {},
	change: () => {},
};

/** A mesh whose `joinRoom` records the room ID and config of each join. */
function recordingMesh(): {
	mesh: Mesh;
	joins: { roomId: string; config: TorrentRoomConfig }[];
} {
	const joins: { roomId: string; config: TorrentRoomConfig }[] = [];
	const joinRoom: JoinMeshRoom = (config, roomId) => {
		joins.push({ roomId, config });
		return emptyRoom();
	};
	const mesh = new Mesh(
		{
			tableId: TABLE,
			key: KEY,
			config: { trackers: ["wss://tracker.test"], rtc: {} },
			joinRoom,
			self: "0123456789AbCdEfGhIj",
			trackerSockets: () => ({}),
			clock: { monotonic: () => 0, wall: () => 0 },
		},
		handlers,
	);
	return { mesh, joins };
}

describe("the mesh's tracker offers", () => {
	it("asks for an offer to each other seat in each announce of the table room", () => {
		const { joins } = recordingMesh();
		expect(joins).toEqual([
			{
				roomId: TABLE,
				config: expect.objectContaining({ offersPerAnnounce: TABLE_OFFERS }),
			},
		]);
	});

	it("keeps Trystero's one offer in a pair room", async () => {
		const { mesh, joins } = recordingMesh();
		mesh.seek(new Map([[seatRendezvous("N", "E"), ""]]));
		await expect
			.poll(() => {
				mesh.tick();
				return joins.length;
			})
			.toBe(2);
		expect(joins[1]?.roomId).not.toBe(TABLE);
		expect(joins[1]?.config).not.toHaveProperty("offersPerAnnounce");
	});
});
