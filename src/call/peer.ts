import type { CallLink, LinkOptions } from "./mesh";
import { MEDIA, type Medium, mediaPlan, type Party } from "./policy";

/**
 * The call media to one remote seat, on the table's WebRTC connection to that seat (ADR 0009, call/layout plan
 * §4.4–4.5). The link puts its sections on that connection and sets their directions and tracks; Trystero
 * negotiates each change over the table's data channel. Only the impolite side adds sections, so a pair has one
 * section per medium. Both sides set directions: on a change, when a remote offer arrives (the answer then carries
 * them), and when a negotiation ends. The link never closes the connection: the table owns it.
 */

/** A link whose audio section is not negotiated this long after it starts (or after Retry, or a new connection) is unavailable. */
export const CONNECT_TIMEOUT_MS = 20_000;

export type LinkState =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "unavailable";

export type LocalTracks = Readonly<Record<Medium, MediaStreamTrack | null>>;

export interface PeerLinkOptions extends LinkOptions {
	/** The table's current connection to the remote seat, or undefined while it has none. */
	readonly connection: () => RTCPeerConnection | undefined;
	/** The live microphone and camera tracks, or null. */
	readonly tracks: LocalTracks;
}

/**
 * An offer on a connected connection that has no answer after this long is lost, and the link rolls it back.
 * Trystero drops a signal from a peer whose handshake it has not finished, so the first offer on a new table
 * connection can be lost, and Trystero never sends it again. After the rollback the link fires
 * `negotiationneeded`, and Trystero offers again. An answer is not lost so, because the side that got the offer
 * has finished the handshake. Local answers take under 0.1 s; an answer that arrives after the rollback makes
 * Trystero close the peer, and the table reconnects.
 */
export const OFFER_TIMEOUT_MS = 5_000;

/** How often the link looks for frames on a muted video receiver that the section lets receive. */
const FRAME_POLL_MS = 500;

/** A video receiver whose last frame is older than this gives no picture. */
const FRAME_AGE_MS = 1000;

/** Audio goes first when the network is poor (call/layout plan §4.5). Chrome's default is "low" for both. */
const PRIORITY: Readonly<Record<Medium, RTCPriorityType>> = {
	audio: "high",
	video: "low",
};

function mediumOf(transceiver: RTCRtpTransceiver): Medium {
	return transceiver.receiver.track.kind === "video" ? "video" : "audio";
}

function section(
	pc: RTCPeerConnection,
	medium: Medium,
): RTCRtpTransceiver | undefined {
	return pc
		.getTransceivers()
		.find(
			(transceiver) =>
				mediumOf(transceiver) === medium &&
				transceiver.currentDirection !== "stopped",
		);
}

function receives(transceiver: RTCRtpTransceiver | undefined): boolean {
	const current = transceiver?.currentDirection;
	return current === "sendrecv" || current === "recvonly";
}

/** Whether a frame arrived at `receiver` recently. The timestamps share the page's wall clock (probe, Chrome 155). */
function framesArrive(receiver: RTCRtpReceiver): boolean {
	const now = performance.timeOrigin + performance.now();
	return receiver
		.getSynchronizationSources()
		.some((source) => now - source.timestamp < FRAME_AGE_MS);
}

export class PeerLink implements CallLink {
	readonly #connection: () => RTCPeerConnection | undefined;
	readonly #polite: boolean;
	readonly #onState: () => void;
	#local: Party;
	#remote: Party;
	#tracks: LocalTracks;
	#pc: RTCPeerConnection | undefined;
	/** Removes the listeners of the current connection. */
	#listeners: AbortController | undefined;
	#queue: Promise<void> = Promise.resolve();
	#closed = false;
	#connectTimer: ReturnType<typeof setTimeout> | undefined;
	#offerTimer: ReturnType<typeof setTimeout> | undefined;
	#frameTimer: ReturnType<typeof setInterval> | undefined;
	/** The connect window ended before the link connected; it shows unavailable until it connects. */
	#timedOut = false;
	/** The error name of a refused change; the link shows unavailable until Retry or a new connection. */
	#fault: string | undefined;
	#state: LinkState = "connecting";
	#remoteAudio: MediaStreamTrack | undefined;
	#remoteVideo: MediaStreamTrack | undefined;
	/** Receiver tracks whose mute changes refresh the link. */
	#watched = new Set<MediaStreamTrack>();

	constructor(options: PeerLinkOptions) {
		this.#connection = options.connection;
		this.#polite = options.polite;
		this.#onState = options.onState;
		this.#local = options.local;
		this.#remote = options.remote;
		this.#tracks = options.tracks;
		this.#bind(this.#connection());
		this.#state = this.#derive();
	}

	get state(): LinkState {
		return this.#state;
	}

	get connected(): boolean {
		return this.#state === "connected";
	}

	/** The receiver track of the audio section, once the section is negotiated. */
	get remoteAudio(): MediaStreamTrack | undefined {
		return this.#remoteAudio;
	}

	/** The receiver track of the video section, once the section is negotiated and frames arrive. */
	get remoteVideo(): MediaStreamTrack | undefined {
		return this.#remoteVideo;
	}

	/** The name of the error that made this link unavailable (never a message: it can quote the SDP). */
	get fault(): string | undefined {
		return this.#fault;
	}

	update(local: Party, remote: Party): void {
		this.#local = local;
		this.#remote = remote;
		this.#enqueue((pc) => this.#apply(pc));
	}

	/** A local device changed: sends its track where the plan allows, or stops sending that medium. */
	setTrack(medium: Medium, track: MediaStreamTrack | null): void {
		this.#tracks = { ...this.#tracks, [medium]: track };
		this.#enqueue((pc) => this.#applyTracks(pc));
	}

	renew(): void {
		if (this.#closed) return;
		this.#timedOut = false;
		this.#fault = undefined;
		this.#armConnect();
		this.#enqueue((pc) => this.#apply(pc));
		this.#refresh();
	}

	/** The table's connection to the seat may have changed (a reconnect): the link moves to the current one. */
	rebind(): void {
		if (this.#closed) return;
		const pc = this.#connection();
		if (pc === this.#pc) return;
		this.#bind(pc);
		this.#refresh();
	}

	/** Stops the media to this seat: every section goes inactive and sends nothing. The connection stays open. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		clearTimeout(this.#connectTimer);
		clearTimeout(this.#offerTimer);
		this.#pollFrames(false);
		this.#listeners?.abort();
		this.#release(this.#pc);
	}

	/** Every section of `pc` goes inactive and sends nothing; the connection stays open. */
	#release(pc: RTCPeerConnection | undefined): void {
		if (pc === undefined || pc.signalingState === "closed") return;
		for (const transceiver of pc.getTransceivers()) {
			if (transceiver.currentDirection === "stopped") continue;
			transceiver.direction = "inactive";
			void transceiver.sender.replaceTrack(null);
		}
	}

	#bind(pc: RTCPeerConnection | undefined): void {
		this.#listeners?.abort();
		// Trystero can keep the old connection open after the page left the table, so the media must not stay on it.
		this.#release(this.#pc);
		this.#pc = pc;
		this.#watched = new Set();
		clearTimeout(this.#offerTimer);
		if (pc === undefined) {
			clearTimeout(this.#connectTimer);
			return;
		}
		const listeners = new AbortController();
		this.#listeners = listeners;
		const { signal } = listeners;
		pc.addEventListener("connectionstatechange", () => this.#refresh(), {
			signal,
		});
		pc.addEventListener("signalingstatechange", () => this.#negotiated(pc), {
			signal,
		});
		this.#timedOut = false;
		this.#fault = undefined;
		this.#armConnect();
		this.#armOffer(pc);
		this.#enqueue((current) => this.#apply(current));
	}

	/** While `pc` waits for the answer to its offer, rolls the offer back after OFFER_TIMEOUT_MS on a connected connection. */
	#armOffer(pc: RTCPeerConnection): void {
		clearTimeout(this.#offerTimer);
		if (pc.signalingState !== "have-local-offer") return;
		this.#offerTimer = setTimeout(() => {
			this.#offerTimer = undefined;
			if (this.#closed || this.#pc !== pc) return;
			if (pc.connectionState !== "connected") {
				this.#armOffer(pc);
				return;
			}
			this.#enqueue(async (current) => {
				if (current !== pc || pc.signalingState !== "have-local-offer") return;
				await pc.setLocalDescription({ type: "rollback" });
				// Chrome fires no new negotiationneeded after the rollback (browser test). Trystero offers on this
				// event, and ignores it while it makes an offer or the state is not stable (peer.mjs createOffer).
				pc.dispatchEvent(new Event("negotiationneeded"));
			});
		}, OFFER_TIMEOUT_MS);
	}

	#negotiated(pc: RTCPeerConnection): void {
		this.#armOffer(pc);
		if (pc.signalingState === "have-remote-offer") {
			// This handler runs before Trystero creates the answer, so the answer carries the plan's directions.
			this.#setDirections(pc);
			this.#enqueue((current) => this.#applyTracks(current));
		} else if (pc.signalingState === "stable") {
			this.#enqueue(async (current) => {
				await this.#apply(current);
				await this.#tune(current);
			});
		}
		this.#refresh();
	}

	/** Runs `task` on the current connection after the earlier tasks; a failed task makes the link unavailable. */
	#enqueue(task: (pc: RTCPeerConnection) => Promise<void>): void {
		this.#queue = this.#queue
			.then(() => {
				const pc = this.#pc;
				if (this.#closed || pc === undefined || pc.signalingState === "closed")
					return;
				return task(pc);
			})
			.catch((error: unknown) => {
				if (this.#closed) return;
				this.#fault = error instanceof Error ? error.name : "Error";
				this.#refresh();
			});
	}

	async #apply(pc: RTCPeerConnection): Promise<void> {
		if (!this.#polite) this.#addSections(pc);
		this.#setDirections(pc);
		await this.#applyTracks(pc);
		this.#refresh();
	}

	/**
	 * Impolite side only: an audio section from the start, and a video section once the plan first sends or
	 * receives video. A pair of two compact devices therefore never has one. A section is never removed; it goes
	 * inactive, and a later link on the same connection uses it again.
	 */
	#addSections(pc: RTCPeerConnection): void {
		const plan = mediaPlan(this.#local, this.#remote);
		for (const medium of MEDIA) {
			const { send, direction } = plan[medium];
			if (
				section(pc, medium) !== undefined ||
				(medium === "video" && direction === "inactive")
			)
				continue;
			// No stream: Trystero passes only tracks with a stream to the rooms.
			pc.addTransceiver((send ? this.#tracks[medium] : null) ?? medium, {
				direction,
			});
		}
	}

	/**
	 * Puts the plan's directions on the sections. A change starts a negotiation (Trystero answers
	 * `negotiationneeded`). A video section that the plan does not allow, for example one between two compact
	 * devices, goes inactive.
	 */
	#setDirections(pc: RTCPeerConnection): void {
		if (this.#closed) return;
		const plan = mediaPlan(this.#local, this.#remote);
		for (const medium of MEDIA) {
			const transceiver = section(pc, medium);
			const { direction } = plan[medium];
			if (transceiver !== undefined && transceiver.direction !== direction)
				transceiver.direction = direction;
		}
	}

	/** Puts the plan's tracks on the senders; a medium that the plan does not send gets no track. */
	async #applyTracks(pc: RTCPeerConnection): Promise<void> {
		const plan = mediaPlan(this.#local, this.#remote);
		for (const medium of MEDIA) {
			const transceiver = section(pc, medium);
			const track = plan[medium].send ? this.#tracks[medium] : null;
			if (transceiver === undefined || transceiver.sender.track === track)
				continue;
			await transceiver.sender.replaceTrack(track);
			if (this.#closed || this.#pc !== pc) return;
		}
	}

	/**
	 * Audio first on a poor network (call/layout plan §4.5): on a connection with video, audio senders get a high
	 * priority, and video senders a low one and keep their frame rate. Runs after each negotiation; a sender without
	 * encodings sends nothing yet and is tuned after a later one. Chrome keeps the values over renegotiation and
	 * replaceTrack (probe, Chrome 155).
	 */
	async #tune(pc: RTCPeerConnection): Promise<void> {
		if (section(pc, "video") === undefined) return;
		for (const medium of MEDIA) {
			const transceiver = section(pc, medium);
			if (transceiver === undefined) continue;
			const priority = PRIORITY[medium];
			// getParameters and setParameters must run in the same task.
			const parameters = transceiver.sender.getParameters();
			const tuned =
				parameters.encodings.every(
					(encoding) =>
						encoding.priority === priority &&
						encoding.networkPriority === priority,
				) &&
				(medium === "audio" ||
					parameters.degradationPreference === "maintain-framerate");
			if (parameters.encodings.length === 0 || tuned) continue;
			for (const encoding of parameters.encodings) {
				encoding.priority = priority;
				encoding.networkPriority = priority;
			}
			if (medium === "video")
				parameters.degradationPreference = "maintain-framerate";
			await transceiver.sender.setParameters(parameters);
			if (this.#closed || this.#pc !== pc) return;
		}
	}

	#armConnect(): void {
		clearTimeout(this.#connectTimer);
		this.#connectTimer = setTimeout(() => {
			this.#connectTimer = undefined;
			if (this.#closed || this.#derive() === "connected") return;
			this.#timedOut = true;
			this.#refresh();
		}, CONNECT_TIMEOUT_MS);
	}

	#derive(): LinkState {
		if (this.#fault !== undefined) return "unavailable";
		const state = this.#connectionState();
		return this.#timedOut && state !== "connected" ? "unavailable" : state;
	}

	#connectionState(): LinkState {
		const pc = this.#pc;
		// Without a connection, or with a lost one, the table reconnects and the link moves to the new connection.
		if (pc === undefined) return "reconnecting";
		switch (pc.connectionState) {
			case "connected":
				return section(pc, "audio")?.currentDirection == null
					? "connecting"
					: "connected";
			case "disconnected":
			case "failed":
			case "closed":
				return "reconnecting";
			default:
				return "connecting";
		}
	}

	/** Tells the owner when the state or a remote track changed. */
	#refresh(): void {
		if (this.#closed) return;
		const state = this.#derive();
		if (state === "connected") {
			clearTimeout(this.#connectTimer);
			this.#timedOut = false;
		}
		const remoteAudio = this.#receiverTrack("audio");
		const remoteVideo = this.#receiverTrack("video");
		const video =
			this.#pc === undefined ? undefined : section(this.#pc, "video");
		this.#pollFrames(receives(video) && video?.receiver.track.muted === true);
		if (
			state === this.#state &&
			remoteAudio === this.#remoteAudio &&
			remoteVideo === this.#remoteVideo
		)
			return;
		this.#state = state;
		this.#remoteAudio = remoteAudio;
		this.#remoteVideo = remoteVideo;
		this.#onState();
	}

	/** Refreshes the link every FRAME_POLL_MS while `on`: a muted video receiver gives no mute event when frames start. */
	#pollFrames(on: boolean): void {
		if (on && this.#frameTimer === undefined)
			this.#frameTimer = setInterval(() => this.#refresh(), FRAME_POLL_MS);
		else if (!on) {
			clearInterval(this.#frameTimer);
			this.#frameTimer = undefined;
		}
	}

	/**
	 * A video receiver track stays muted while no frames arrive, for example while the peer's camera is blocked or
	 * the peer sends no video: it gives no picture then, so no tile shows an empty video. After a rolled-back offer
	 * that added the section, Chrome keeps the track muted while frames arrive (probe, Chrome 155), so recent frames
	 * also count.
	 */
	#receiverTrack(medium: Medium): MediaStreamTrack | undefined {
		const pc = this.#pc;
		const transceiver = pc === undefined ? undefined : section(pc, medium);
		if (transceiver?.currentDirection == null) return undefined;
		const track = transceiver.receiver.track;
		if (medium === "audio") return track;
		// Chrome can keep the track unmuted after the section stops receiving.
		if (!receives(transceiver)) return undefined;
		if (!this.#watched.has(track)) {
			this.#watched.add(track);
			const signal = this.#listeners?.signal;
			track.addEventListener("mute", () => this.#refresh(), { signal });
			track.addEventListener("unmute", () => this.#refresh(), { signal });
		}
		return !track.muted || framesArrive(transceiver.receiver)
			? track
			: undefined;
	}
}
