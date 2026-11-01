import { afterEach, describe, expect, it } from "vitest";
import {
	connectedPair,
	destroyPairs,
	type Pair,
	random,
	wait,
} from "./trystero-pair";

// Directions and tracks changed from both sides of a Trystero connection (tests/browser/trystero-pair.ts).

afterEach(destroyPairs);

const DIRECTIONS: readonly RTCRtpTransceiverDirection[] = [
	"sendrecv",
	"sendonly",
	"recvonly",
	"inactive",
];

function localTracks(): Record<"audio" | "video", MediaStreamTrack> {
	const audio = new AudioContext()
		.createMediaStreamDestination()
		.stream.getAudioTracks()[0];
	const canvas = document.createElement("canvas");
	canvas.width = 64;
	canvas.height = 48;
	canvas.getContext("2d")?.fillRect(0, 0, 64, 48);
	const video = canvas.captureStream(10).getVideoTracks()[0];
	if (audio === undefined || video === undefined) throw new Error("no track");
	return { audio, video };
}

const REVERSE: Readonly<
	Record<RTCRtpTransceiverDirection, RTCRtpTransceiverDirection>
> = {
	sendrecv: "sendrecv",
	sendonly: "recvonly",
	recvonly: "sendonly",
	inactive: "inactive",
	stopped: "stopped",
};

function sends(direction: RTCRtpTransceiverDirection): boolean {
	return direction === "sendrecv" || direction === "sendonly";
}

function receives(direction: RTCRtpTransceiverDirection): boolean {
	return direction === "sendrecv" || direction === "recvonly";
}

/** The direction that an answer gives a section whose two sides want `local` and `remote`. */
function agreed(
	local: RTCRtpTransceiverDirection,
	remote: RTCRtpTransceiverDirection,
): RTCRtpTransceiverDirection {
	const theirs = REVERSE[remote];
	const send = sends(local) && sends(theirs);
	const receive = receives(local) && receives(theirs);
	if (send && receive) return "sendrecv";
	if (send) return "sendonly";
	if (receive) return "recvonly";
	return "inactive";
}

/** For each section: this side's current direction, and the one that both sides' wishes give. */
function sections(pair: Pair): { current: string[]; wanted: string[] } {
	const remote = new Map(
		pair.b.connection.getTransceivers().map((t) => [t.mid, t.direction]),
	);
	const current: string[] = [];
	const wanted: string[] = [];
	for (const transceiver of pair.a.connection.getTransceivers()) {
		const theirs = remote.get(transceiver.mid);
		current.push(`${transceiver.mid}:${transceiver.currentDirection}`);
		wanted.push(
			`${transceiver.mid}:${theirs === undefined ? "none" : agreed(transceiver.direction, theirs)}`,
		);
	}
	return { current, wanted };
}

describe("media on a Trystero connection", () => {
	for (const seed of [1, 2, 3, 4, 5]) {
		it(`renegotiates 200 changes from both sides without a peer error or a closed channel (seed ${seed})`, async () => {
			const next = random(seed);
			const pair = await connectedPair(next, 15);
			const tracks = localTracks();
			// Only the impolite side adds sections (src/call/peer.ts).
			pair.a.connection.addTransceiver(tracks.audio, { direction: "sendrecv" });
			pair.a.connection.addTransceiver(tracks.video, { direction: "sendrecv" });
			await expect
				.poll(() => pair.b.connection.getTransceivers().length, {
					timeout: 5000,
				})
				.toBe(2);
			const before = pair.descriptions;
			for (let step = 0; step < 200; step++) {
				const side = next() < 0.5 ? pair.a : pair.b;
				const both = next() < 0.2;
				for (const peer of both ? [pair.a, pair.b] : [side]) {
					const transceivers = peer.connection.getTransceivers();
					const transceiver =
						transceivers[Math.floor(next() * transceivers.length)];
					if (transceiver === undefined) continue;
					if (next() < 0.7) {
						transceiver.direction =
							DIRECTIONS[Math.floor(next() * DIRECTIONS.length)] ?? "inactive";
					} else {
						const kind = transceiver.receiver.track.kind as "audio" | "video";
						await transceiver.sender.replaceTrack(
							transceiver.sender.track === null ? tracks[kind] : null,
						);
					}
				}
				await wait(Math.floor(next() * 10));
			}
			await expect
				.poll(
					() => {
						const { current, wanted } = sections(pair);
						return (
							pair.a.connection.signalingState === "stable" &&
							pair.b.connection.signalingState === "stable" &&
							current.join() === wanted.join()
						);
					},
					{ timeout: 10_000 },
				)
				.toBe(true);
			// Many changes renegotiated; a replaced track alone needs no negotiation.
			expect(pair.descriptions - before).toBeGreaterThan(40);
			expect(pair.errors).toEqual([]);
			expect(pair.closes).toEqual([]);
			expect(pair.a.channel?.readyState).toBe("open");
			expect(pair.b.channel?.readyState).toBe("open");
			expect(pair.a.connection.connectionState).toBe("connected");
		}, 60_000);
	}
});
