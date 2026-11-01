import { afterEach, describe, expect, it } from "vitest";
import { type LocalTracks, PeerLink } from "../../src/call/peer";
import {
	direction,
	MEDIA,
	type Medium,
	type Party,
} from "../../src/call/policy";
import {
	connectedPair,
	destroyPairs,
	type Pair,
	random,
	wait,
} from "./trystero-pair";

// The call's media link on a real Trystero connection in Chrome: the link puts its sections on the table's
// connection, and Trystero negotiates them (tests/browser/trystero-pair.ts).

type Sends = readonly Medium[];

/** What one side sends: nothing, audio only, video only, or both. */
const SENDS: readonly Sends[] = [[], ["audio"], ["video"], ["audio", "video"]];

function label(sends: Sends): string {
	return sends.length === 0 ? "nothing" : sends.join(" + ");
}

/** A desktop seat in the call that receives everything and sends `sends`. */
function party(sends: Sends): Party {
	return {
		form: "desktop",
		prefs: {
			inCall: true,
			send: { audio: sends.includes("audio"), video: sends.includes("video") },
			receive: { audio: true, video: true },
		},
	};
}

const streams: MediaStream[] = [];
const links: PeerLink[] = [];

afterEach(() => {
	for (const link of links.splice(0)) link.close();
	destroyPairs();
	for (const stream of streams.splice(0))
		for (const track of stream.getTracks()) track.stop();
});

/** Chrome's generated microphone and camera. */
async function devices(): Promise<LocalTracks> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: true,
		video: { width: 160, height: 120 },
	});
	streams.push(stream);
	return {
		audio: stream.getAudioTracks()[0] ?? null,
		video: stream.getVideoTracks()[0] ?? null,
	};
}

interface Side {
	readonly link: PeerLink;
	connection: RTCPeerConnection | undefined;
	sends: Sends;
}

/** A media link on `connection`; North is impolite, East is polite. */
async function side(
	polite: boolean,
	connection: RTCPeerConnection,
	sends: Sends,
	peerSends: Sends,
): Promise<Side> {
	const tracks = await devices();
	const holder = { connection } as {
		connection: RTCPeerConnection | undefined;
	};
	const link = new PeerLink({
		seat: polite ? "N" : "E",
		polite,
		local: party(sends),
		remote: party(peerSends),
		onState: () => undefined,
		connection: () => holder.connection,
		tracks,
	});
	links.push(link);
	return {
		link,
		get connection() {
			return holder.connection;
		},
		set connection(value) {
			holder.connection = value;
		},
		sends,
	};
}

/** Both links, each on its end of the pair's connection. `impoliteFirst`: the Trystero initiator is North. */
async function call(
	pair: Pair,
	impoliteFirst: boolean,
	northSends: Sends,
	eastSends: Sends,
): Promise<{ north: Side; east: Side }> {
	const [northPeer, eastPeer] = impoliteFirst
		? [pair.a, pair.b]
		: [pair.b, pair.a];
	const [north, east] = await Promise.all([
		side(false, northPeer.connection, northSends, eastSends),
		side(true, eastPeer.connection, eastSends, northSends),
	]);
	return { north, east };
}

function update(north: Side, east: Side, northSends: Sends, eastSends: Sends) {
	north.sends = northSends;
	east.sends = eastSends;
	north.link.update(party(northSends), party(eastSends));
	east.link.update(party(eastSends), party(northSends));
}

async function receivedBytes(
	connection: RTCPeerConnection,
): Promise<Record<Medium, number>> {
	const bytes = { audio: 0, video: 0 };
	for (const report of (await connection.getStats()).values()) {
		if (report.type === "inbound-rtp")
			bytes[report.kind as Medium] += report.bytesReceived ?? 0;
	}
	return bytes;
}

/** Which media arrive on `connection` within 700 ms. */
async function arriving(
	connection: RTCPeerConnection | undefined,
): Promise<readonly Medium[]> {
	if (connection === undefined) return [];
	const before = await receivedBytes(connection);
	await wait(700);
	const after = await receivedBytes(connection);
	return MEDIA.filter((medium) => after[medium] > before[medium]);
}

/** The negotiated direction of each medium's section; a section that does not exist is `none`. */
function negotiated(connection: RTCPeerConnection | undefined): string[] {
	return MEDIA.map((medium) => {
		const transceiver = connection
			?.getTransceivers()
			.find((t) => t.receiver.track.kind === medium);
		return `${medium}:${transceiver?.currentDirection ?? "none"}`;
	});
}

/** Whether each section has the direction that the two sides' sends give; no video section is needed without video. */
function sectionsMatch(
	connection: RTCPeerConnection | undefined,
	sends: Sends,
	receives: Sends,
): boolean {
	return negotiated(connection).every((entry, index) => {
		const medium = MEDIA[index] ?? "audio";
		const wanted = direction(sends.includes(medium), receives.includes(medium));
		return (
			entry === `${medium}:${wanted}` ||
			(entry === "video:none" && wanted === "inactive")
		);
	});
}

/** Waits until the media that each side sends arrive at the other side, and nothing else arrives. */
async function expectFlows(north: Side, east: Side): Promise<void> {
	await expect
		.poll(
			async () => {
				const [atNorth, atEast] = await Promise.all([
					arriving(north.connection),
					arriving(east.connection),
				]);
				return {
					atNorth,
					atEast,
					connected: north.link.connected && east.link.connected,
					northSections: sectionsMatch(
						north.connection,
						north.sends,
						east.sends,
					),
					eastSections: sectionsMatch(east.connection, east.sends, north.sends),
					videoAtNorth: north.link.remoteVideo !== undefined,
					videoAtEast: east.link.remoteVideo !== undefined,
				};
			},
			{ timeout: 20_000, interval: 0 },
		)
		.toEqual({
			atNorth: MEDIA.filter((medium) => east.sends.includes(medium)),
			atEast: MEDIA.filter((medium) => north.sends.includes(medium)),
			connected: true,
			northSections: true,
			eastSections: true,
			videoAtNorth: east.sends.includes("video"),
			videoAtEast: north.sends.includes("video"),
		});
}

function expectTableIntact(pair: Pair): void {
	expect(pair.errors).toEqual([]);
	expect(pair.closes).toEqual([]);
	expect(pair.a.channel?.readyState).toBe("open");
	expect(pair.b.channel?.readyState).toBe("open");
}

function iceUfrag(connection: RTCPeerConnection | undefined): string {
	return (
		connection?.localDescription?.sdp.match(/a=ice-ufrag:(\S+)/)?.[1] ?? ""
	);
}

describe("call media link on the table's Trystero connection", () => {
	for (const northSends of SENDS) {
		for (const eastSends of SENDS) {
			it(`North sends ${label(northSends)}, East sends ${label(eastSends)}`, async () => {
				const pair = await connectedPair(random(7), 5);
				const { north, east } = await call(pair, true, northSends, eastSends);
				await expectFlows(north, east);
				expectTableIntact(pair);
			}, 30_000);
		}
	}

	it("walks through all 16 combinations on one connection without an ICE restart, with the polite seat as the Trystero initiator", async () => {
		const pair = await connectedPair(random(11), 15);
		const { north, east } = await call(pair, false, [], []);
		await expectFlows(north, east);
		const ufrags = [iceUfrag(pair.a.connection), iceUfrag(pair.b.connection)];
		for (const northSends of SENDS) {
			for (const eastSends of SENDS) {
				update(north, east, northSends, eastSends);
				await expectFlows(north, east);
			}
		}
		// Back to nothing at the end: every section is inactive and no media arrives.
		update(north, east, [], []);
		await expectFlows(north, east);
		expect([iceUfrag(pair.a.connection), iceUfrag(pair.b.connection)]).toEqual(
			ufrags,
		);
		expectTableIntact(pair);
	}, 180_000);

	it("shows the video of a section whose first offer was rolled back in a collision", async () => {
		// North adds the video section while East (the Trystero initiator) offers its audio change: North's
		// offer is rolled back. Chrome then keeps the receiver track muted although frames arrive (probe, Chrome 155).
		const pair = await connectedPair(random(23), 0);
		const { north, east } = await call(pair, false, [], ["audio"]);
		await expectFlows(north, east);
		update(north, east, [], ["video"]);
		await expectFlows(north, east);
		expectTableIntact(pair);
	}, 60_000);

	it("close() stops the media but keeps the table connection, and a new link reuses the sections", async () => {
		const pair = await connectedPair(random(13), 5);
		const both: Sends = ["audio", "video"];
		const { north, east } = await call(pair, true, both, both);
		await expectFlows(north, east);
		north.link.close();
		// East still wants to send; the closed North link does not turn its sections on again.
		east.link.update(party(both), party(both));
		await expect
			.poll(
				async () => ({
					atNorth: await arriving(north.connection),
					atEast: await arriving(east.connection),
					sections: negotiated(north.connection),
					senders: north.connection
						?.getTransceivers()
						.map((t) => t.sender.track),
				}),
				{ timeout: 10_000, interval: 0 },
			)
			.toEqual({
				atNorth: [],
				atEast: [],
				sections: ["audio:inactive", "video:inactive"],
				senders: [null, null],
			});
		expectTableIntact(pair);
		pair.a.sendData(new TextEncoder().encode("still open"));
		await expect.poll(() => pair.received.b).toEqual(["still open"]);

		const again = await side(false, pair.a.connection, both, both);
		await expectFlows(again, east);
		expect(pair.a.connection.getTransceivers()).toHaveLength(2);
		expectTableIntact(pair);
	}, 60_000);

	it("rebind() moves both links to a new table connection after a reconnect", async () => {
		const first = await connectedPair(random(17), 5);
		const { north, east } = await call(first, true, ["audio"], ["video"]);
		await expectFlows(north, east);

		north.connection = undefined;
		north.link.rebind();
		expect(north.link.state).toBe("reconnecting");
		expect(north.link.connected).toBe(false);

		first.a.destroy();
		first.b.destroy();
		const second = await connectedPair(random(19), 5);
		north.connection = second.a.connection;
		east.connection = second.b.connection;
		north.link.rebind();
		east.link.rebind();
		await expectFlows(north, east);
		expectTableIntact(second);
	}, 60_000);
});
