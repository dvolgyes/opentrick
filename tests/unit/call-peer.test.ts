import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Form } from "../../src/call/device-class";
import { CONNECT_TIMEOUT_MS, PeerLink } from "../../src/call/peer";
import {
	join,
	MEDIA,
	type Medium,
	mediaPlan,
	type Party,
	PRESETS,
	type PresetId,
	type Switches,
	setSwitch,
} from "../../src/call/policy";
import { AUDIO, BOTH, party } from "./call-fakes";
import {
	asConnection,
	asTrack,
	FakeTrack,
	type FakeTransceiver,
	FakeTrysteroPair,
} from "./call-rtc-fakes";

/** Long enough for every queued step of one negotiation; shorter than every timer in `peer.ts`. */
const SETTLE_MS = 50;

async function settle(ms = SETTLE_MS): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
}

function switched(
	local: Party,
	way: "send" | "receive",
	on: boolean,
	medium: Medium = "audio",
): Party {
	return {
		...local,
		prefs: setSwitch(local.prefs, local.form, way, medium, on),
	};
}

/** North (impolite) and East (polite) with their links to each other on one table connection. */
class Pair {
	table = new FakeTrysteroPair();
	/** The table has no connection to the other seat, as during a reconnect. */
	offline = false;
	readonly micA = new FakeTrack("audio");
	readonly micB = new FakeTrack("audio");
	readonly camA = new FakeTrack("video");
	readonly camB = new FakeTrack("video");
	readonly northChanges = vi.fn();
	readonly eastChanges = vi.fn();
	readonly north: PeerLink;
	readonly east: PeerLink;

	constructor(
		north: Party,
		east: Party,
		setup: (pair: Pair) => void = () => undefined,
	) {
		setup(this);
		this.north = this.northLink(north, east);
		this.east = new PeerLink({
			seat: "N",
			polite: true,
			local: east,
			remote: north,
			connection: () => (this.offline ? undefined : asConnection(this.table.b)),
			tracks: { audio: asTrack(this.micB), video: asTrack(this.camB) },
			onState: this.eastChanges,
		});
	}

	/** A link at North to East, as the call makes one for each new call session. */
	northLink(north: Party, east: Party): PeerLink {
		return new PeerLink({
			seat: "E",
			polite: false,
			local: north,
			remote: east,
			connection: () => (this.offline ? undefined : asConnection(this.table.a)),
			tracks: { audio: asTrack(this.micA), video: asTrack(this.camA) },
			onState: this.northChanges,
		});
	}

	get a() {
		return this.table.a;
	}

	get b() {
		return this.table.b;
	}

	get ta(): FakeTransceiver {
		const [transceiver] = this.a.getTransceivers();
		if (transceiver === undefined) throw new Error("no transceiver at N");
		return transceiver;
	}

	get tb(): FakeTransceiver {
		const [transceiver] = this.b.getTransceivers();
		if (transceiver === undefined) throw new Error("no transceiver at E");
		return transceiver;
	}

	/** The transceiver of the medium at N (`a`) or at E (`b`), if the connection has one. */
	section(side: "a" | "b", medium: Medium): FakeTransceiver | undefined {
		return this[side]
			.getTransceivers()
			.find((transceiver) => transceiver.receiver.track.kind === medium);
	}

	/** The name of the local track that the section sends (fakes of one kind are deep-equal, so names compare). */
	sending(side: "a" | "b", medium: Medium): string | null {
		const track = this.section(side, medium)?.sender.track ?? null;
		if (track === null) return null;
		const names = new Map<MediaStreamTrack, string>([
			[asTrack(this.micA), "micA"],
			[asTrack(this.micB), "micB"],
			[asTrack(this.camA), "camA"],
			[asTrack(this.camB), "camB"],
		]);
		return names.get(track) ?? "other";
	}

	/** The seat that offered each negotiation round, in order. */
	rounds(): string[] {
		return this.table.offers.map((side) => (side === "a" ? "N" : "E"));
	}
}

async function connectedPair(north = AUDIO, east = AUDIO): Promise<Pair> {
	const pair = new Pair(north, east);
	await settle();
	pair.table.connect();
	return pair;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("PeerLink on the table connection (ADR 0009)", () => {
	it("puts one audio section on the connection from the impolite side, negotiated in one round", async () => {
		const pair = new Pair(AUDIO, AUDIO);
		await settle();
		expect(pair.rounds()).toEqual(["N"]);
		expect(pair.a.signalingState).toBe("stable");
		expect(pair.b.signalingState).toBe("stable");
		// The impolite side owns the m-lines; the polite side only uses the one it received.
		expect(pair.a.getTransceivers()).toHaveLength(1);
		expect(pair.b.getTransceivers()).toHaveLength(1);
		expect(pair.ta.currentDirection).toBe("sendrecv");
		expect(pair.tb.currentDirection).toBe("sendrecv");
		expect(pair.ta.sender.track).toBe(asTrack(pair.micA));
		expect(pair.tb.sender.track).toBe(asTrack(pair.micB));
		expect(pair.north.state).toBe("connecting");
		expect(pair.north.connected).toBe(false);

		pair.table.connect();
		expect(pair.north.state).toBe("connected");
		expect(pair.north.connected).toBe(true);
		expect(pair.east.state).toBe("connected");
		expect(pair.north.remoteAudio).toBe(pair.ta.receiver.track);
		expect(pair.east.remoteAudio).toBe(pair.tb.receiver.track);
	});

	it("never sends a track from a listen-only side", async () => {
		const pair = new Pair(AUDIO, party("listen"));
		await settle();
		expect(pair.ta.currentDirection).toBe("sendonly");
		expect(pair.tb.currentDirection).toBe("recvonly");
		expect(pair.tb.sender.track).toBeNull();
		expect(pair.tb.sender.replacements).toBe(0);
	});

	it("removes the track when the impolite side turns send off, then renegotiates", async () => {
		const pair = await connectedPair();
		const quiet = switched(AUDIO, "send", false);
		pair.north.update(quiet, AUDIO);
		pair.east.update(AUDIO, quiet);
		await settle();
		expect(pair.ta.sender.track).toBeNull();
		expect(pair.rounds()).toEqual(["N", "N"]);
		expect(pair.ta.currentDirection).toBe("recvonly");
		expect(pair.tb.currentDirection).toBe("sendonly");
		expect(pair.tb.sender.track).toBe(asTrack(pair.micB));
		expect(pair.north.state).toBe("connected");
	});

	it("lets the polite side stop sending with its own negotiation, before the impolite side hears of it", async () => {
		const pair = await connectedPair();
		const quiet = switched(AUDIO, "send", false);
		pair.east.update(quiet, AUDIO);
		await settle();
		expect(pair.tb.sender.track).toBeNull();
		expect(pair.rounds()).toEqual(["N", "E"]);
		expect(pair.ta.currentDirection).toBe("sendonly");
		expect(pair.tb.currentDirection).toBe("recvonly");

		// Its prefs reach the impolite side, whose plan now agrees.
		pair.north.update(AUDIO, quiet);
		await settle();
		expect(pair.ta.currentDirection).toBe("sendonly");
		expect(pair.tb.currentDirection).toBe("recvonly");
		expect(pair.tb.sender.track).toBeNull();
		expect(pair.b.getTransceivers()).toHaveLength(1);
	});

	it("stops receiving after the polite side turns receive off", async () => {
		const pair = await connectedPair();
		const deaf = switched(AUDIO, "receive", false);
		pair.east.update(deaf, AUDIO);
		pair.north.update(AUDIO, deaf);
		await settle();
		expect(pair.ta.currentDirection).toBe("recvonly");
		expect(pair.tb.currentDirection).toBe("sendonly");
		expect(pair.ta.sender.track).toBeNull();
	});

	it("follows the microphone where the plan sends audio", async () => {
		const pair = await connectedPair(AUDIO, party("listen"));
		const other = new FakeTrack("audio");
		pair.north.setTrack("audio", asTrack(other));
		pair.east.setTrack("audio", asTrack(other));
		await settle();
		expect(pair.ta.sender.track).toBe(asTrack(other));
		expect(pair.tb.sender.track).toBeNull();

		pair.north.setTrack("audio", null);
		await settle();
		expect(pair.ta.sender.track).toBeNull();
	});
});

describe("PeerLink state and lifecycle (call/layout plan §4.5)", () => {
	it("is unavailable when not connected in time, and connected once the connection is", async () => {
		const pair = new Pair(AUDIO, AUDIO);
		await settle(CONNECT_TIMEOUT_MS - SETTLE_MS);
		expect(pair.north.state).toBe("connecting");
		await settle(SETTLE_MS);
		expect(pair.north.state).toBe("unavailable");

		pair.a.setConnection("connected");
		expect(pair.north.state).toBe("connected");
		// The table reconnects a lost connection, and the link moves to the new one.
		pair.a.setConnection("disconnected");
		expect(pair.north.state).toBe("reconnecting");
		pair.a.setConnection("failed");
		expect(pair.north.state).toBe("reconnecting");
	});

	it("starts a new connect window on renew", async () => {
		const pair = new Pair(AUDIO, AUDIO);
		await settle(CONNECT_TIMEOUT_MS);
		expect(pair.north.state).toBe("unavailable");

		pair.north.renew();
		expect(pair.north.state).toBe("connecting");
		await settle(CONNECT_TIMEOUT_MS - SETTLE_MS);
		expect(pair.north.state).toBe("connecting");
		await settle(SETTLE_MS);
		expect(pair.north.state).toBe("unavailable");
	});

	it("makes the link unavailable on a refused change, reports only the error name, and renews on Retry", async () => {
		const pair = await connectedPair();
		const sender = pair.ta.sender;
		const replaceTrack = sender.replaceTrack.bind(sender);
		sender.replaceTrack = () =>
			Promise.reject(new DOMException("track of another kind", "TypeError"));
		const other = asTrack(new FakeTrack("audio"));
		pair.north.setTrack("audio", other);
		await settle();
		expect(pair.north.state).toBe("unavailable");
		expect(pair.north.fault).toBe("TypeError");
		// The connection is fine: the fault stays until Retry.
		pair.a.setConnection("connected");
		expect(pair.north.state).toBe("unavailable");

		sender.replaceTrack = replaceTrack;
		pair.north.renew();
		await settle();
		expect(pair.north.state).toBe("connected");
		expect(pair.north.fault).toBeUndefined();
		expect(sender.track).toBe(other);
	});

	it("stops the media on close, keeps the table connection, and a later link uses the same section", async () => {
		const pair = await connectedPair();
		const changes = pair.northChanges.mock.calls.length;
		pair.north.close();
		await settle(CONNECT_TIMEOUT_MS);
		expect(pair.a.closed).toBe(false);
		expect(pair.a.connectionState).toBe("connected");
		expect(pair.ta.direction).toBe("inactive");
		expect(pair.ta.sender.track).toBeNull();
		expect([pair.ta.currentDirection, pair.tb.currentDirection]).toEqual([
			"inactive",
			"inactive",
		]);
		expect(pair.northChanges).toHaveBeenCalledTimes(changes);
		pair.north.update(BOTH, BOTH);
		pair.a.setConnection("disconnected");
		await settle();
		expect(pair.a.getTransceivers()).toHaveLength(1);
		expect(pair.northChanges).toHaveBeenCalledTimes(changes);

		pair.a.setConnection("connected");
		const again = pair.northLink(AUDIO, AUDIO);
		await settle();
		expect(pair.a.getTransceivers()).toHaveLength(1);
		expect([pair.ta.currentDirection, pair.tb.currentDirection]).toEqual([
			"sendrecv",
			"sendrecv",
		]);
		expect(pair.ta.sender.track).toBe(asTrack(pair.micA));
		expect(again.state).toBe("connected");
	});

	it("shows reconnecting without a table connection, and moves to the new connection on rebind", async () => {
		const pair = await connectedPair();
		const old = pair.a;
		const oldSection = pair.ta;
		pair.offline = true;
		pair.north.rebind();
		pair.east.rebind();
		expect(pair.north.state).toBe("reconnecting");
		expect(pair.north.remoteAudio).toBeUndefined();
		// Trystero can keep the old connection open after the page leaves the table; it carries no media of the link.
		await settle();
		expect(old.closed).toBe(false);
		expect(oldSection.direction).toBe("inactive");
		expect(oldSection.sender.track).toBeNull();

		pair.table = new FakeTrysteroPair();
		pair.offline = false;
		pair.north.rebind();
		pair.east.rebind();
		await settle();
		expect(pair.rounds()).toEqual(["N"]);
		expect(pair.ta.sender.track).toBe(asTrack(pair.micA));
		expect(pair.north.state).toBe("connecting");
		pair.table.connect();
		expect(pair.north.state).toBe("connected");

		// The old connection no longer reaches the link.
		const changes = pair.northChanges.mock.calls.length;
		old.setConnection("failed");
		expect(pair.northChanges).toHaveBeenCalledTimes(changes);
	});
});

/** What one medium of a negotiated pair looks like at N and at E. */
function observed(pair: Pair, medium: Medium) {
	const [a, b] = [pair.section("a", medium), pair.section("b", medium)];
	return {
		sections: [a !== undefined, b !== undefined],
		directions: [a?.currentDirection ?? null, b?.currentDirection ?? null],
		sends: [pair.sending("a", medium), pair.sending("b", medium)],
	};
}

/** The same, derived from the policy alone. */
function expected(north: Party, east: Party, medium: Medium) {
	const [n, e] = [
		mediaPlan(north, east)[medium],
		mediaPlan(east, north)[medium],
	];
	// The audio section always exists; the video one only when some video may flow.
	const present = medium === "audio" || n.direction !== "inactive";
	const [mine, theirs] =
		medium === "audio" ? ["micA", "micB"] : ["camA", "camB"];
	return {
		sections: [present, present],
		directions: present ? [n.direction, e.direction] : [null, null],
		sends: [n.send ? mine : null, e.send ? theirs : null],
	};
}

describe("PeerLink video and asymmetric combinations (call/layout plan C6)", () => {
	const pairs = PRESETS.flatMap((n) =>
		PRESETS.map((e): [PresetId, PresetId] => [n.id, e.id]),
	);

	it.each(pairs)(
		"N %s, E %s: both media follow the plan in one round",
		async (n, e) => {
			const north = party(n);
			const east = party(e);
			const pair = new Pair(north, east);
			await settle();
			expect(pair.rounds()).toEqual(["N"]);
			for (const medium of MEDIA) {
				expect(observed(pair, medium)).toEqual(expected(north, east, medium));
			}
		},
	);

	// The four switches are independent, so a side can also send only video or only audio (owner question,
	// 2026-11-01): every combination of switches and forms, not only the presets.
	const flags = [false, true];
	const combinations = flags.flatMap((sendAudio) =>
		flags.flatMap((receiveAudio) =>
			flags.flatMap((sendVideo) =>
				flags.map(
					(receiveVideo): Switches => ({
						send: { audio: sendAudio, video: sendVideo },
						receive: { audio: receiveAudio, video: receiveVideo },
					}),
				),
			),
		),
	);
	const forms: readonly Form[] = ["desktop", "compact"];
	const parties = forms.flatMap((form) =>
		combinations.map((selection) => ({ prefs: join(selection, form), form })),
	);

	it("follows the plan in one round for every pair of switch combinations and forms", async () => {
		for (const north of parties) {
			for (const east of parties) {
				const pair = new Pair(north, east);
				await settle();
				const case_ = JSON.stringify({ north, east });
				expect(pair.rounds(), case_).toEqual(["N"]);
				for (const medium of MEDIA) {
					expect(observed(pair, medium), `${medium} ${case_}`).toEqual(
						expected(north, east, medium),
					);
				}
			}
		}
	});

	it("has a video section that carries both cameras for two desktops on Both", async () => {
		const pair = new Pair(BOTH, BOTH);
		await settle();
		expect(observed(pair, "video")).toEqual({
			sections: [true, true],
			directions: ["sendrecv", "sendrecv"],
			sends: ["camA", "camB"],
		});
	});

	it("has no video section for two compact devices on Both: audio only", async () => {
		const pair = new Pair(party("both", "compact"), party("both", "compact"));
		await settle();
		expect(observed(pair, "audio").directions).toEqual([
			"sendrecv",
			"sendrecv",
		]);
		expect(observed(pair, "video")).toEqual({
			sections: [false, false],
			directions: [null, null],
			sends: [null, null],
		});
	});

	it.each([
		["desktop", "compact", ["recvonly", "sendonly"], [null, "camB"]],
		["compact", "desktop", ["sendonly", "recvonly"], ["camA", null]],
	] as const)(
		"N %s, E %s on Both: the compact camera reaches the desktop, and no video reaches the compact side",
		async (n, e, directions, sends) => {
			const pair = new Pair(party("both", n), party("both", e));
			await settle();
			expect(observed(pair, "audio").directions).toEqual([
				"sendrecv",
				"sendrecv",
			]);
			expect(observed(pair, "video")).toEqual({
				sections: [true, true],
				directions,
				sends,
			});
		},
	);

	it("ignores the Receive video switch of a compact party (stored or forged prefs)", async () => {
		const pair = new Pair(BOTH, { ...BOTH, form: "compact" });
		await settle();
		expect(pair.sending("a", "video")).toBeNull();
		expect(pair.section("a", "video")?.currentDirection).toBe("recvonly");
	});

	it("answers an offered two-way video section on a compact side with its camera only", async () => {
		// A modified desktop client offers its camera to a compact peer anyway.
		const pair = new Pair(BOTH, { ...BOTH, form: "compact" }, (p) => {
			const add = p.a.addTransceiver.bind(p.a);
			p.a.addTransceiver = (trackOrKind, init) => {
				const transceiver = add(trackOrKind, init);
				if (p.a.getTransceivers().length === 1) {
					add(asTrack(p.camA), { direction: "sendrecv" });
				}
				return transceiver;
			};
		});
		await settle();
		const video = pair.section("b", "video");
		expect(video?.direction).toBe("sendonly");
		expect(video?.currentDirection).toBe("sendonly");
		expect(pair.sending("b", "video")).toBe("camB");
		expect(observed(pair, "audio").directions).toEqual([
			"sendrecv",
			"sendrecv",
		]);
		expect(pair.rounds()).toEqual(["N"]);
	});

	it("adds the video section when the impolite side starts its camera, and keeps it inactive after Send off", async () => {
		const watch = party("watch");
		const pair = await connectedPair(AUDIO, watch);
		expect(pair.section("a", "video")).toBeUndefined();

		const camera = switched(AUDIO, "send", true, "video");
		pair.north.update(camera, watch);
		pair.east.update(watch, camera);
		await settle();
		expect(pair.rounds()).toEqual(["N", "N"]);
		expect(observed(pair, "video")).toEqual({
			sections: [true, true],
			directions: ["sendonly", "recvonly"],
			sends: ["camA", null],
		});
		expect(pair.east.remoteVideo).toBe(
			pair.section("b", "video")?.receiver.track,
		);

		pair.north.setTrack("video", null);
		pair.north.update(AUDIO, watch);
		pair.east.update(watch, AUDIO);
		await settle();
		expect(pair.a.getTransceivers()).toHaveLength(2);
		expect(observed(pair, "video")).toEqual({
			sections: [true, true],
			directions: ["inactive", "inactive"],
			sends: [null, null],
		});
		expect(observed(pair, "audio").directions).toEqual([
			"sendrecv",
			"sendrecv",
		]);
		expect(pair.east.remoteVideo).toBeUndefined();
	});

	it("lets the polite side start its camera: the impolite side adds the section, the polite side only answers", async () => {
		const watch = party("watch");
		const pair = await connectedPair(watch, AUDIO);
		const camera = switched(AUDIO, "send", true, "video");
		pair.east.update(camera, watch);
		await settle();
		expect(pair.rounds()).toEqual(["N"]);
		expect(pair.section("b", "video")).toBeUndefined();

		pair.north.update(watch, camera);
		await settle();
		expect(pair.rounds()).toEqual(["N", "N"]);
		expect(observed(pair, "video")).toEqual({
			sections: [true, true],
			directions: ["recvonly", "sendonly"],
			sends: [null, "camB"],
		});
		expect(pair.north.remoteVideo).toBe(
			pair.section("a", "video")?.receiver.track,
		);
		// East's section only sends: its receiver track gives no picture.
		expect(pair.east.remoteVideo).toBeUndefined();
	});

	it("gives the received picture only while its track is unmuted, and reports each change", async () => {
		const pair = await connectedPair(BOTH, BOTH);
		const track = pair.section("a", "video")?.receiver.track;
		if (track === undefined) throw new Error("no video section at N");
		expect(pair.north.remoteVideo).toBe(asTrack(track));
		const changes = pair.northChanges.mock.calls.length;

		// No frames arrive: the peer's camera is blocked, or its first frames are not here yet.
		track.setMuted(true);
		expect(pair.north.remoteVideo).toBeUndefined();
		expect(pair.northChanges).toHaveBeenCalledTimes(changes + 1);

		track.setMuted(false);
		expect(pair.north.remoteVideo).toBe(asTrack(track));
		expect(pair.northChanges).toHaveBeenCalledTimes(changes + 2);
	});

	it("gives the picture of a muted track while frames arrive, as Chrome shows after a rolled-back offer", async () => {
		const pair = await connectedPair(BOTH, BOTH);
		const video = pair.section("a", "video");
		if (video === undefined) throw new Error("no video section at N");
		video.receiver.track.setMuted(true);
		expect(pair.north.remoteVideo).toBeUndefined();

		// Frames arrive, but the track stays muted and gives no event: the link looks again within 500 ms.
		const now = () => performance.timeOrigin + performance.now();
		video.receiver.sources = [{ timestamp: now() }];
		await settle(500);
		expect(pair.north.remoteVideo).toBe(asTrack(video.receiver.track));

		video.receiver.sources = [{ timestamp: now() - 5_000 }];
		await settle(500);
		expect(pair.north.remoteVideo).toBeUndefined();
	});

	it("detaches the camera on Send off without a renegotiation", async () => {
		const pair = await connectedPair(BOTH, BOTH);
		pair.east.setTrack("video", null);
		await settle();
		expect(pair.sending("b", "video")).toBeNull();
		expect(pair.rounds()).toEqual(["N"]);
	});

	it("gives audio the priority on a connection with video, and sets each sender once", async () => {
		const pair = await connectedPair(BOTH, BOTH);
		for (const side of ["a", "b"] as const) {
			expect(pair.section(side, "audio")?.sender.getParameters()).toEqual({
				encodings: [{ priority: "high", networkPriority: "high" }],
			});
			expect(pair.section(side, "video")?.sender.getParameters()).toEqual({
				degradationPreference: "maintain-framerate",
				encodings: [{ priority: "low", networkPriority: "low" }],
			});
		}
		const settings = () =>
			[...pair.a.getTransceivers(), ...pair.b.getTransceivers()].map(
				(transceiver) => transceiver.sender.settings,
			);
		expect(settings()).toEqual([1, 1, 1, 1]);

		const quiet = switched(BOTH, "send", false);
		pair.north.update(quiet, BOTH);
		pair.east.update(BOTH, quiet);
		await settle();
		expect(pair.rounds()).toEqual(["N", "N"]);
		expect(settings()).toEqual([1, 1, 1, 1]);
	});

	it("leaves the senders of an audio-only connection as they are", async () => {
		const pair = await connectedPair();
		expect([pair.ta.sender.settings, pair.tb.sender.settings]).toEqual([0, 0]);
	});
});
