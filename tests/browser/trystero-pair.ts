import { expect } from "vitest";
// @ts-expect-error: Trystero does not export its peer module; the call relies on its renegotiation.
import createPeer from "../../node_modules/@trystero-p2p/core/dist/peer.mjs";

// Two real Trystero peers in Chrome, wired to each other in the page as the room's `@_signal` action wires them.
// The call puts its media sections on this connection and lets Trystero renegotiate them.

interface Signal {
	readonly type: string;
	readonly sdp: string;
}

export interface TrysteroPeer {
	readonly connection: RTCPeerConnection;
	readonly channel: RTCDataChannel | null;
	signal(signal: Signal): Promise<unknown>;
	/** Trystero accepts only binary messages; any other message closes the peer. */
	sendData(data: Uint8Array): void;
	setHandlers(handlers: {
		signal?: (signal: Signal) => void;
		connect?: () => void;
		close?: () => void;
		error?: (error: Error) => void;
		data?: (data: ArrayBuffer) => void;
	}): void;
	destroy(): void;
}

const makePeer = createPeer as (
	initiator: boolean,
	config: { trickleIce: boolean; rtcConfig: RTCConfiguration },
) => TrysteroPeer;

/** A small seeded generator, so a failing run can be repeated. */
export function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Pair {
	readonly a: TrysteroPeer;
	readonly b: TrysteroPeer;
	readonly errors: string[];
	readonly closes: string[];
	/** The text messages that each side received on the data channel. */
	readonly received: Readonly<Record<"a" | "b", string[]>>;
	/** Offers and answers sent, from both sides. */
	descriptions: number;
	/**
	 * How many of each side's next signals are lost on the way, as a Trystero room drops a signal from a peer
	 * that it has not activated yet (`@_signal` has no `receiveWhilePending`, room.mjs).
	 */
	readonly lost: Record<"a" | "b", number>;
}

const pairs: Pair[] = [];

/** Destroys every pair made since the last call (for `afterEach`). */
export function destroyPairs(): void {
	for (const pair of pairs.splice(0)) {
		pair.a.destroy();
		pair.b.destroy();
	}
}

/** The initiator `a` and `b`, connected by a data channel; each signal arrives in order after 0–`delayMs` ms. */
export async function connectedPair(
	next: () => number,
	delayMs: number,
): Promise<Pair> {
	const config = { trickleIce: false, rtcConfig: { iceServers: [] } };
	const a = makePeer(true, config);
	const b = makePeer(false, config);
	const pair: Pair = {
		a,
		b,
		errors: [],
		closes: [],
		received: { a: [], b: [] },
		descriptions: 0,
		lost: { a: 0, b: 0 },
	};
	pairs.push(pair);
	const route = (from: "a" | "b", to: TrysteroPeer) => {
		let line = Promise.resolve();
		return (signal: Signal) => {
			pair.descriptions++;
			if (pair.lost[from] > 0) {
				pair.lost[from]--;
				return;
			}
			const delay = Math.floor(next() * delayMs);
			line = line.then(async () => {
				await wait(delay);
				await to.signal(signal);
			});
		};
	};
	let open = 0;
	for (const [name, peer, other] of [
		["a", a, b],
		["b", b, a],
	] as const) {
		peer.setHandlers({
			signal: route(name, other),
			connect: () => open++,
			close: () => pair.closes.push(name),
			error: (error) => pair.errors.push(`${name}: ${error.message}`),
			data: (data) => pair.received[name].push(new TextDecoder().decode(data)),
		});
	}
	await expect.poll(() => open, { timeout: 10_000 }).toBe(2);
	return pair;
}
