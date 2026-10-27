import { MAX_OPEN_PINGS, PING_TIMEOUT_MS, ROUND_TRIP_IDLE_MS } from "./limits";
import type { Ping } from "./wire";

/**
 * Each page measures its direct peers independently. A peer with no ping for ROUND_TRIP_IDLE_MS gets a new
 * probe; every page answers a ping with an echo at once.
 */

/** The latest round trip of a page; `lower`: a ping had no echo within PING_TIMEOUT_MS, so it is at least `ms`. */
export interface RoundTrip {
	readonly ms: number;
	readonly lower: boolean;
}

export interface RoundTripDeps {
	/** Monotonic milliseconds. */
	readonly now: () => number;
	readonly nonce: () => string;
	readonly ping: (peer: string, message: Ping) => void;
}

interface Track {
	/** Nonce to send time, oldest first. */
	readonly open: Map<string, number>;
	lastSent: number;
	result: RoundTrip | null;
}

export class RoundTripProbes {
	readonly #deps: RoundTripDeps;
	readonly #tracks = new Map<string, Track>();

	constructor(deps: RoundTripDeps) {
		this.#deps = deps;
	}

	probe(peer: string): void {
		const now = this.#deps.now();
		let track = this.#tracks.get(peer);
		if (!track) {
			track = { open: new Map(), lastSent: now, result: null };
			this.#tracks.set(peer, track);
		}
		const n = this.#deps.nonce();
		track.open.set(n, now);
		track.lastSent = now;
		if (track.open.size > MAX_OPEN_PINGS) {
			const oldest = track.open.keys().next().value;
			if (oldest !== undefined) track.open.delete(oldest);
		}
		this.#deps.ping(peer, { k: "ping", n });
	}

	/** True when the echo answers an open ping of the peer: the peer has a new round trip. */
	echo(peer: string, n: string): boolean {
		const track = this.#tracks.get(peer);
		const sentAt = track?.open.get(n);
		if (!track || sentAt === undefined) return false;
		// An older ping without an echo is lost or late; this answer is the newer evidence.
		for (const [nonce, at] of track.open)
			if (at <= sentAt) track.open.delete(nonce);
		const elapsed = this.#deps.now() - sentAt;
		// A suspended page can receive its queued echo before the timeout timer runs.
		track.result =
			elapsed >= PING_TIMEOUT_MS
				? { ms: PING_TIMEOUT_MS, lower: true }
				: { ms: Math.round(elapsed), lower: false };
		return true;
	}

	/**
	 * Closes the pings without an echo for PING_TIMEOUT_MS, then pings each of `peers` that had no ping for
	 * ROUND_TRIP_IDLE_MS. True when a round trip changed.
	 */
	tick(peers: Iterable<string>): boolean {
		const now = this.#deps.now();
		let changed = false;
		for (const track of this.#tracks.values()) {
			let late = false;
			for (const [nonce, at] of track.open) {
				if (now - at < PING_TIMEOUT_MS) continue;
				track.open.delete(nonce);
				late = true;
			}
			if (late && track.result?.lower !== true) {
				track.result = { ms: PING_TIMEOUT_MS, lower: true };
				changed = true;
			}
		}
		for (const peer of peers) {
			const track = this.#tracks.get(peer);
			if (!track || now - track.lastSent >= ROUND_TRIP_IDLE_MS)
				this.probe(peer);
		}
		return changed;
	}

	get(peer: string): RoundTrip | null {
		return this.#tracks.get(peer)?.result ?? null;
	}

	/** True when the peer had a round trip. */
	forget(peer: string): boolean {
		const had = this.get(peer) !== null;
		this.#tracks.delete(peer);
		return had;
	}
}
