import type { Seat } from "../protocol";

/**
 * The voice box: the loudness of each remote voice, measured from its received audio track with the Web Audio API.
 * The table shows it as three columns of segments that light from their middle outwards.
 */

/** At this level and below the box is dark: room noise. */
const FLOOR_DB = -55;
/** At this level and above every segment is lit. */
const CEILING_DB = -15;
/** A falling level halves in this time, so the bars sink smoothly at any frame rate. */
const RELEASE_HALF_LIFE_MS = 80;
/** Below this level even the middle segment is dark. */
const SILENCE = 0.02;

/** The loudness of one block of samples from 0 to 1, on a decibel scale between the floor and the ceiling. */
export function voiceLevel(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	const rms = Math.sqrt(sum / samples.length);
	if (rms === 0) return 0;
	const decibels = 20 * Math.log10(rms);
	return Math.min(
		1,
		Math.max(0, (decibels - FLOOR_DB) / (CEILING_DB - FLOOR_DB)),
	);
}

/** A rise shows at once; a fall sinks by the time that passed since the last frame. */
export function nextShownLevel(
	shown: number,
	measured: number,
	elapsedMs: number,
): number {
	return Math.max(measured, shown * 0.5 ** (elapsedMs / RELEASE_HALF_LIFE_MS));
}

/**
 * Which of `total` segments are lit: from the middle outwards, as far as `level` of the half column. A shorter side
 * column lights fewer segments than the middle column at the same level.
 */
export function litSegments(level: number, total: number): boolean[] {
	const middle = (total - 1) / 2;
	const reach = level * middle;
	return Array.from(
		{ length: total },
		(_, index) => level >= SILENCE && Math.abs(index - middle) <= reach,
	);
}

export interface VoiceMeters {
	/** Measures this track for the seat; undefined stops measuring it. The same track keeps its measurement. */
	measure(seat: Seat, track: MediaStreamTrack | undefined): void;
	/** The loudness now, from 0 to 1; 0 for a seat without a measurement. */
	level(seat: Seat): number;
	/** A user gesture: start the measurements that the browser's autoplay rule held. */
	resume(): void;
	/** The room screen is gone: stop all measurements and free the audio processing. */
	stop(): void;
}

interface Meter {
	readonly track: MediaStreamTrack;
	readonly source: MediaStreamAudioSourceNode;
	readonly analyser: AnalyserNode;
	readonly samples: Float32Array<ArrayBuffer>;
}

/**
 * One audio context for all seats, made at the first measurement. A context made before any user gesture stays
 * suspended until `resume`, and its levels stay 0 until then.
 */
export function voiceMeters(): VoiceMeters {
	let context: AudioContext | undefined;
	const meters = new Map<Seat, Meter>();

	function release(seat: Seat): void {
		const meter = meters.get(seat);
		if (meter === undefined) return;
		meter.source.disconnect();
		meters.delete(seat);
	}

	function measure(seat: Seat, track: MediaStreamTrack | undefined): void {
		if (meters.get(seat)?.track === track) return;
		release(seat);
		if (track === undefined) return;
		context ??= new AudioContext();
		const source = context.createMediaStreamSource(new MediaStream([track]));
		const analyser = context.createAnalyser();
		analyser.fftSize = 1024;
		source.connect(analyser);
		meters.set(seat, {
			track,
			source,
			analyser,
			samples: new Float32Array(analyser.fftSize),
		});
	}

	function level(seat: Seat): number {
		const meter = meters.get(seat);
		if (meter === undefined) return 0;
		meter.analyser.getFloatTimeDomainData(meter.samples);
		return voiceLevel(meter.samples);
	}

	function resume(): void {
		if (context?.state === "suspended") void context.resume();
	}

	function stop(): void {
		for (const seat of [...meters.keys()]) release(seat);
		void context?.close();
		context = undefined;
	}

	return { measure, level, resume, stop };
}
