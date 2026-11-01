/**
 * Stand-ins for the browser media objects in `peer.ts` and `media.ts` tests. The fake connection follows the
 * JSEP rules that the link relies on: `negotiationneeded` after a new section or a direction change in `stable`,
 * `signalingstatechange` before the remote offer's promise resolves, answer directions as the intersection with the
 * reversed offer, and transceivers created by a remote offer. Its "SDP" is JSON with one direction per m-line.
 * `FakeTrysteroPair` negotiates two of them as Trystero does on the table's data channel.
 */

export class FakeTrack extends EventTarget {
	readyState: MediaStreamTrackState = "live";
	muted = false;
	stops = 0;

	constructor(readonly kind: "audio" | "video") {
		super();
	}

	/** Media stopped or started to arrive on a receiver track. */
	setMuted(muted: boolean): void {
		this.muted = muted;
		this.dispatchEvent(new Event(muted ? "mute" : "unmute"));
	}

	stop(): void {
		this.stops++;
		this.readyState = "ended";
	}

	/** The device went away or the permission was revoked. */
	end(): void {
		this.readyState = "ended";
		this.dispatchEvent(new Event("ended"));
	}
}

export function fakeStream(...tracks: FakeTrack[]): MediaStream {
	return {
		getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
		getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
	} as unknown as MediaStream;
}

export const asTrack = (track: FakeTrack): MediaStreamTrack =>
	track as unknown as MediaStreamTrack;

/** The sender settings that `peer.ts` tunes; Chrome starts every encoding at "low". */
interface FakeSendParameters {
	degradationPreference?: RTCDegradationPreference;
	encodings: {
		priority?: RTCPriorityType;
		networkPriority?: RTCPriorityType;
	}[];
}

class FakeSender {
	replacements = 0;
	settings = 0;
	#parameters: FakeSendParameters = {
		encodings: [{ priority: "low", networkPriority: "low" }],
	};

	constructor(public track: MediaStreamTrack | null) {}

	replaceTrack(track: MediaStreamTrack | null): Promise<void> {
		this.replacements++;
		this.track = track;
		return Promise.resolve();
	}

	/** A copy, as in the browser: changes apply only through setParameters. */
	getParameters(): FakeSendParameters {
		return structuredClone(this.#parameters);
	}

	setParameters(parameters: FakeSendParameters): Promise<void> {
		this.settings++;
		this.#parameters = structuredClone(parameters);
		return Promise.resolve();
	}
}

class FakeReceiver {
	/** The RTP sources of recent frames; `peer.ts` reads their timestamps. */
	sources: { timestamp: number }[] = [];

	constructor(readonly track: FakeTrack) {}

	getSynchronizationSources(): { timestamp: number }[] {
		return [...this.sources];
	}
}

export class FakeTransceiver {
	currentDirection: RTCRtpTransceiverDirection | null = null;
	readonly sender: FakeSender;
	readonly receiver: FakeReceiver;
	#direction: RTCRtpTransceiverDirection;
	readonly #changed: () => void;

	constructor(
		kind: "audio" | "video",
		direction: RTCRtpTransceiverDirection,
		track: MediaStreamTrack | null,
		changed: () => void,
	) {
		this.#direction = direction;
		this.#changed = changed;
		this.sender = new FakeSender(track);
		this.receiver = new FakeReceiver(new FakeTrack(kind));
	}

	get direction(): RTCRtpTransceiverDirection {
		return this.#direction;
	}

	set direction(direction: RTCRtpTransceiverDirection) {
		if (direction === this.#direction) return;
		this.#direction = direction;
		this.#changed();
	}
}

interface Section {
	readonly kind: "audio" | "video";
	readonly direction: RTCRtpTransceiverDirection;
}

interface FakeSdp {
	readonly type: "offer" | "answer";
	readonly sections: readonly Section[];
}

const SENDS = new Set(["sendrecv", "sendonly"]);
const RECEIVES = new Set(["sendrecv", "recvonly"]);

function directionOf(
	send: boolean,
	receive: boolean,
): RTCRtpTransceiverDirection {
	if (send && receive) return "sendrecv";
	if (send) return "sendonly";
	return receive ? "recvonly" : "inactive";
}

function reversed(
	direction: RTCRtpTransceiverDirection,
): RTCRtpTransceiverDirection {
	return directionOf(RECEIVES.has(direction), SENDS.has(direction));
}

function intersect(
	a: RTCRtpTransceiverDirection,
	b: RTCRtpTransceiverDirection,
): RTCRtpTransceiverDirection {
	return directionOf(
		SENDS.has(a) && SENDS.has(b),
		RECEIVES.has(a) && RECEIVES.has(b),
	);
}

function parseFakeSdp(sdp: string): FakeSdp {
	return JSON.parse(sdp) as FakeSdp;
}

function invalidState(message: string): DOMException {
	return new DOMException(message, "InvalidStateError");
}

export class FakePeerConnection extends EventTarget {
	connectionState: RTCPeerConnectionState = "new";
	localDescription: RTCSessionDescriptionInit | null = null;
	remoteDescription: RTCSessionDescriptionInit | null = null;
	closed = false;
	readonly #transceivers: FakeTransceiver[] = [];
	#signalingState: RTCSignalingState = "stable";
	/** A section or a direction changed since this side's last description. */
	#needed = false;
	#announcing = false;

	get signalingState(): RTCSignalingState {
		return this.#signalingState;
	}

	/** A `negotiationneeded` is due: the next offer from this side carries a change. */
	get negotiationNeeded(): boolean {
		return this.#needed;
	}

	addTransceiver(
		trackOrKind: MediaStreamTrack | string,
		init: RTCRtpTransceiverInit = {},
	): FakeTransceiver {
		const kind = (
			typeof trackOrKind === "string" ? trackOrKind : trackOrKind.kind
		) as "audio" | "video";
		const track = typeof trackOrKind === "string" ? null : trackOrKind;
		this.#transceivers.push(this.#transceiver(kind, init.direction, track));
		this.#changed();
		return this.#transceivers.at(-1) as FakeTransceiver;
	}

	getTransceivers(): FakeTransceiver[] {
		return [...this.#transceivers];
	}

	async setLocalDescription(): Promise<void> {
		await Promise.resolve();
		this.#open();
		this.#needed = false;
		if (this.#signalingState === "have-remote-offer") {
			const offer = parseFakeSdp(this.remoteDescription?.sdp ?? "");
			const sections = offer.sections.map((section, index) => {
				const transceiver = this.#transceivers[index];
				if (transceiver === undefined) throw invalidState("no transceiver");
				const direction = intersect(
					transceiver.direction,
					reversed(section.direction),
				);
				transceiver.currentDirection = direction;
				return { kind: section.kind, direction };
			});
			this.localDescription = { type: "answer", sdp: sdp("answer", sections) };
			this.#signal("stable");
		} else {
			const sections = this.#transceivers.map((transceiver) => ({
				kind: transceiver.receiver.track.kind,
				direction: transceiver.direction,
			}));
			this.localDescription = { type: "offer", sdp: sdp("offer", sections) };
			this.#signal("have-local-offer");
		}
	}

	async setRemoteDescription(
		description: RTCSessionDescriptionInit,
	): Promise<void> {
		await Promise.resolve();
		this.#open();
		const remote = parseFakeSdp(description.sdp ?? "");
		this.remoteDescription = description;
		if (description.type === "offer") {
			if (this.#signalingState !== "stable") {
				throw invalidState(`offer in ${this.#signalingState}`);
			}
			remote.sections.forEach((section, index) => {
				if (this.#transceivers[index] === undefined) {
					this.#transceivers.push(
						this.#transceiver(section.kind, "recvonly", null),
					);
				}
			});
			this.#signal("have-remote-offer");
			return;
		}
		if (this.#signalingState !== "have-local-offer") {
			throw invalidState(`answer in ${this.#signalingState}`);
		}
		remote.sections.forEach((section, index) => {
			const transceiver = this.#transceivers[index];
			if (transceiver !== undefined) {
				transceiver.currentDirection = reversed(section.direction);
			}
		});
		this.#signal("stable");
	}

	close(): void {
		this.closed = true;
		this.#signalingState = "closed";
		this.connectionState = "closed";
	}

	setConnection(state: RTCPeerConnectionState): void {
		this.connectionState = state;
		this.dispatchEvent(new Event("connectionstatechange"));
	}

	#transceiver(
		kind: "audio" | "video",
		direction: RTCRtpTransceiverDirection = "sendrecv",
		track: MediaStreamTrack | null,
	): FakeTransceiver {
		return new FakeTransceiver(kind, direction, track, () => this.#changed());
	}

	/** As in the browser, the event fires before the promise of the description resolves. */
	#signal(state: RTCSignalingState): void {
		this.#signalingState = state;
		this.dispatchEvent(new Event("signalingstatechange"));
		if (state === "stable") this.#announce();
	}

	#changed(): void {
		if (this.closed) return;
		this.#needed = true;
		this.#announce();
	}

	/** One `negotiationneeded` per change, in `stable` only, after the current task. */
	#announce(): void {
		if (this.#announcing) return;
		this.#announcing = true;
		queueMicrotask(() => {
			this.#announcing = false;
			if (this.#needed && this.#signalingState === "stable" && !this.closed) {
				this.dispatchEvent(new Event("negotiationneeded"));
			}
		});
	}

	#open(): void {
		if (this.closed) throw invalidState("closed");
	}
}

function sdp(type: "offer" | "answer", sections: readonly Section[]): string {
	return JSON.stringify({ type, sections } satisfies FakeSdp);
}

export const asConnection = (pc: FakePeerConnection): RTCPeerConnection =>
	pc as unknown as RTCPeerConnection;

function described(pc: FakePeerConnection): RTCSessionDescriptionInit {
	if (pc.localDescription === null) throw invalidState("no local description");
	return pc.localDescription;
}

/**
 * The table's connection between two pages, as Trystero renegotiates it: each `negotiationneeded` gives one
 * offer/answer round over the data channel, one round at a time, so no offers collide. The real collision rule is
 * covered with Trystero itself (tests/browser/call-peer-link.test.ts).
 */
export class FakeTrysteroPair {
	readonly a = new FakePeerConnection();
	readonly b = new FakePeerConnection();
	/** The offering side of each round, in order. */
	readonly offers: ("a" | "b")[] = [];
	/** The errors of failed rounds; later rounds still run. */
	readonly errors: unknown[] = [];
	#rounds: Promise<void> = Promise.resolve();

	constructor() {
		this.a.addEventListener("negotiationneeded", () => this.#round("a"));
		this.b.addEventListener("negotiationneeded", () => this.#round("b"));
	}

	connect(): void {
		this.a.setConnection("connected");
		this.b.setConnection("connected");
	}

	#round(side: "a" | "b"): void {
		const [offerer, answerer] =
			side === "a" ? [this.a, this.b] : [this.b, this.a];
		this.#rounds = this.#rounds
			.then(async () => {
				if (!offerer.negotiationNeeded || offerer.closed || answerer.closed)
					return;
				this.offers.push(side);
				await offerer.setLocalDescription();
				await answerer.setRemoteDescription(described(offerer));
				await answerer.setLocalDescription();
				await offerer.setRemoteDescription(described(answerer));
			})
			.catch((error: unknown) => {
				this.errors.push(error);
			});
	}
}
