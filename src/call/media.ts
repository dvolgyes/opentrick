import type { Medium } from "./policy";

/**
 * The local microphone and, on desktop, the camera (call/layout plan §4.5). A capture starts only while the local
 * user is in the call with the matching Send switch on; the caller checks the device class. Every request has a
 * token: a result that arrives after the switch changed is stopped at once and never attached.
 */

/** `denied`: the browser or the user refused the permission; `failed`: no usable device, or the track ended. */
export type CaptureState = "off" | "pending" | "on" | "denied" | "failed";

export type GetUserMedia = (
	constraints: MediaStreamConstraints,
) => Promise<MediaStream>;

export const VIDEO_QUALITIES = ["low", "normal", "high"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];
export const DEFAULT_VIDEO_QUALITY: VideoQuality = "low";

const SHORT_EDGE: Readonly<Record<VideoQuality, number>> = {
	low: 360,
	normal: 480,
	high: 720,
};

const NATIVE_FRAMES = { exact: "none" } as const;

/** Opens a full-frame source without setting dimensions that could cause software cropping. */
export async function openCamera(
	getUserMedia: GetUserMedia,
	deviceId: string | undefined,
	isCurrent: () => boolean,
): Promise<MediaStream> {
	const supported =
		globalThis.navigator?.mediaDevices?.getSupportedConstraints?.();
	const video = {
		frameRate: 15,
		...(deviceId === undefined ? {} : { deviceId: { exact: deviceId } }),
	};
	if (supported && "resizeMode" in supported && supported.resizeMode === true) {
		try {
			const native = { ...video, resizeMode: NATIVE_FRAMES };
			return await getUserMedia({ audio: false, video: native });
		} catch (error) {
			if (
				!isCurrent() ||
				!(error instanceof DOMException) ||
				error.name !== "OverconstrainedError"
			)
				throw error;
		}
	}
	return getUserMedia({ audio: false, video });
}

/** Selects a native camera mode, preserving its orientation and full frame. */
export async function fitCamera(
	track: MediaStreamTrack,
	quality: VideoQuality,
): Promise<void> {
	const settings = track.getSettings();
	if (!("resizeMode" in settings) || settings.resizeMode !== "none") return;
	const { width, height } = settings;
	if (!width || !height) return;
	const edge = width < height ? "width" : "height";
	const target = SHORT_EDGE[quality];
	const native = { frameRate: 15, resizeMode: NATIVE_FRAMES };
	const minimum = track.getCapabilities?.()[edge]?.min ?? 1;
	const smallest = { ...native, [edge]: { ideal: minimum } };
	const wanted = {
		...native,
		[edge]:
			quality === "normal" ? { ideal: target, max: target } : { ideal: target },
	};
	try {
		await track.applyConstraints(quality === "low" ? smallest : wanted);
	} catch (error) {
		if (
			quality !== "normal" ||
			track.readyState !== "live" ||
			!(error instanceof DOMException) ||
			error.name !== "OverconstrainedError"
		)
			return;
		await track.applyConstraints(smallest).catch(() => undefined);
	}
}

/** Sender scaling is relative to the current source, not to the nominal camera preset. */
export function videoDownscale(
	track: MediaStreamTrack,
	quality: VideoQuality,
): number {
	const { width = 0, height = 0 } = track.getSettings();
	return Math.max(1, Math.min(width, height) / SHORT_EDGE[quality]);
}

function refusal(error: unknown): CaptureState {
	const name = error instanceof DOMException ? error.name : "";
	return name === "NotAllowedError" || name === "SecurityError"
		? "denied"
		: "failed";
}

/** One capture device: at most one live track of its kind. */
class Capture {
	readonly #medium: Medium;
	readonly #getUserMedia: GetUserMedia;
	readonly #onChange: () => void;
	readonly #videoDeviceId: () => string | undefined;
	readonly #videoQuality: () => VideoQuality;
	#fit: Promise<void> = Promise.resolve();
	#pendingTrack: MediaStreamTrack | undefined;
	#state: CaptureState = "off";
	#track: MediaStreamTrack | undefined;
	#prepared: MediaStreamTrack | undefined;
	#request = 0;

	constructor(
		medium: Medium,
		getUserMedia: GetUserMedia,
		onChange: () => void,
		videoDeviceId: () => string | undefined,
		videoQuality: () => VideoQuality,
	) {
		this.#medium = medium;
		this.#getUserMedia = getUserMedia;
		this.#onChange = onChange;
		this.#videoDeviceId = videoDeviceId;
		this.#videoQuality = videoQuality;
	}

	get state(): CaptureState {
		return this.#state;
	}

	get track(): MediaStreamTrack | undefined {
		return this.#track;
	}

	set(on: boolean): void {
		if (!on) {
			this.stop();
			return;
		}
		if (this.#state === "on" || this.#state === "pending") return;
		if (this.#prepared !== undefined) {
			const track = this.#prepared;
			this.#prepared = undefined;
			this.#capturedTrack(track);
			return;
		}
		const token = ++this.#request;
		this.#state = "pending";
		this.#onChange();
		const capture =
			this.#medium === "video"
				? openCamera(
						this.#getUserMedia,
						this.#videoDeviceId(),
						() => token === this.#request,
					)
				: this.#getUserMedia({ audio: true, video: false });
		void capture.then(
			(stream) => void this.#captured(token, stream),
			(error: unknown) => {
				if (token !== this.#request) return;
				this.#state = refusal(error);
				this.#onChange();
			},
		);
	}

	stop(): void {
		this.#request++;
		this.#stopPending();
		const track = this.#track;
		const prepared = this.#prepared;
		const changed = this.#state !== "off" || prepared !== undefined;
		this.#prepared = undefined;
		this.#track = undefined;
		this.#state = "off";
		track?.stop();
		prepared?.stop();
		if (changed) this.#onChange();
	}

	prepare(track: MediaStreamTrack): boolean {
		if (this.#medium !== "video" || track.kind !== "video") return false;
		if (track.readyState !== "live") return false;
		this.#request++;
		this.#stopPending();
		this.#track?.stop();
		this.#track = undefined;
		this.#state = "off";
		this.#prepared?.stop();
		this.#prepared = track;
		return true;
	}

	hasPrepared(): boolean {
		return this.#prepared !== undefined;
	}

	#stopPending(): void {
		this.#pendingTrack?.stop();
		this.#pendingTrack = undefined;
	}

	refitVideo(): Promise<void> {
		const track = this.#track ?? this.#prepared;
		const quality = this.#videoQuality();
		this.#fit = this.#fit.then(async () => {
			if (
				track === undefined ||
				(track !== this.#track && track !== this.#prepared) ||
				quality !== this.#videoQuality()
			)
				return;
			await fitCamera(track, quality);
		});
		return this.#fit;
	}

	async #captured(token: number, stream: MediaStream): Promise<void> {
		const [audio, video] = [stream.getAudioTracks(), stream.getVideoTracks()];
		const [track, ...extra] = this.#medium === "audio" ? audio : video;
		const others = this.#medium === "audio" ? video : audio;
		for (const other of [...extra, ...others]) other.stop();
		if (token !== this.#request) {
			track?.stop();
			return;
		}
		if (track === undefined) {
			this.#state = "failed";
			this.#onChange();
			return;
		}
		if (this.#medium === "video") {
			this.#pendingTrack = track;
			let quality: VideoQuality;
			do {
				quality = this.#videoQuality();
				await fitCamera(track, quality);
				if (token !== this.#request) return;
			} while (track.readyState === "live" && quality !== this.#videoQuality());
			this.#pendingTrack = undefined;
		}
		this.#capturedTrack(track);
	}

	#capturedTrack(track: MediaStreamTrack): void {
		if (track.readyState !== "live") {
			this.#state = "failed";
			this.#onChange();
			return;
		}
		// `ended` fires when the device goes away or the permission is revoked, never after our own stop().
		track.addEventListener("ended", () => {
			if (this.#track !== track) return;
			this.#track = undefined;
			this.#state = "failed";
			this.#onChange();
		});
		this.#track = track;
		this.#state = "on";
		this.#onChange();
	}
}

export class LocalMedia {
	readonly #captures: Readonly<Record<Medium, Capture>>;
	#videoDeviceId: string | undefined;
	#videoQuality = DEFAULT_VIDEO_QUALITY;

	/** `onChange` names the medium whose state or track changed. */
	constructor(getUserMedia: GetUserMedia, onChange: (medium: Medium) => void) {
		this.#captures = {
			audio: new Capture(
				"audio",
				getUserMedia,
				() => onChange("audio"),
				() => undefined,
				() => DEFAULT_VIDEO_QUALITY,
			),
			video: new Capture(
				"video",
				getUserMedia,
				() => onChange("video"),
				() => this.#videoDeviceId,
				() => this.#videoQuality,
			),
		};
	}

	selectVideoDevice(deviceId: string | undefined): void {
		this.#videoDeviceId = deviceId;
	}

	get videoQuality(): VideoQuality {
		return this.#videoQuality;
	}

	setVideoQuality(quality: VideoQuality): Promise<void> {
		if (this.#videoQuality === quality) return Promise.resolve();
		this.#videoQuality = quality;
		return this.#captures.video.refitVideo();
	}

	state(medium: Medium): CaptureState {
		return this.#captures[medium].state;
	}

	/** The live track of the medium, if any. */
	track(medium: Medium): MediaStreamTrack | undefined {
		return this.#captures[medium].track;
	}

	/** Starts or stops one device to match the local Send switch of its medium. */
	set(medium: Medium, on: boolean): void {
		this.#captures[medium].set(on);
	}

	prepareVideo(track: MediaStreamTrack): boolean {
		return this.#captures.video.prepare(track);
	}

	hasPreparedVideo(): boolean {
		return this.#captures.video.hasPrepared();
	}

	/** Stops both devices and drops every pending request. */
	stop(): void {
		this.#captures.audio.stop();
		this.#captures.video.stop();
	}
}
