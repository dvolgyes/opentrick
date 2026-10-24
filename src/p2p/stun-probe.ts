import { STUN_PROBE_MS, STUN_RECHECK_MS } from "./limits";

/**
 * Evidence that each configured STUN server is alive, for the connecting notice (ADR 0004). A probe asks one server
 * through a peer connection of its own: a server-reflexive candidate is the server's answer. The page reads only
 * the candidate type, never the address, and closes the connection.
 */

export type StunAnswer = "answered" | "no-answer";
export type ProbeStun = (url: string) => Promise<StunAnswer>;

export interface StunStatus {
	readonly url: string;
	readonly state: "checking" | StunAnswer;
}

/** A probe over the given WebRTC implementation; a failure of the connection counts as no answer. */
export function stunProbe(
	Rtc: typeof RTCPeerConnection,
	timeoutMs = STUN_PROBE_MS,
): ProbeStun {
	return (url) =>
		new Promise((resolve) => {
			const connection = new Rtc({ iceServers: [{ urls: url }] });
			let done = false;
			const finish = (answer: StunAnswer) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				connection.onicecandidate = null;
				connection.close();
				resolve(answer);
			};
			const timer = setTimeout(() => finish("no-answer"), timeoutMs);
			connection.onicecandidate = ({ candidate }) => {
				// A null candidate ends the gathering.
				if (candidate === null) finish("no-answer");
				else if (/ typ srflx( |$)/.test(candidate.candidate))
					finish("answered");
			};
			// An offer with a data channel starts the gathering without media.
			connection.createDataChannel("stun");
			connection
				.createOffer()
				.then((offer) => connection.setLocalDescription(offer))
				.catch(() => finish("no-answer"));
		});
}

/** The STUN servers' states: all are asked at the start, and again every STUN_RECHECK_MS while the page is alone. */
export class StunChecks {
	readonly #probe: ProbeStun;
	readonly #states: Map<string, StunStatus["state"]>;
	readonly #pending = new Set<string>();
	readonly #change: () => void;
	#askedAt = Number.NEGATIVE_INFINITY;
	#closed = false;

	constructor(urls: readonly string[], probe: ProbeStun, change: () => void) {
		this.#probe = probe;
		this.#states = new Map(urls.map((url) => [url, "checking"]));
		this.#change = change;
	}

	statuses(): StunStatus[] {
		return [...this.#states].map(([url, state]) => ({ url, state }));
	}

	tick(now: number, alone: boolean): void {
		if (this.#closed) return;
		const first = this.#askedAt === Number.NEGATIVE_INFINITY;
		if (!first && (!alone || now - this.#askedAt < STUN_RECHECK_MS)) return;
		this.#askedAt = now;
		for (const url of this.#states.keys()) this.#ask(url);
	}

	close(): void {
		this.#closed = true;
	}

	/** A recheck keeps the last answer on view until the new one comes. */
	#ask(url: string): void {
		if (this.#pending.has(url)) return;
		this.#pending.add(url);
		this.#probe(url)
			.catch((): StunAnswer => "no-answer")
			.then((answer) => {
				this.#pending.delete(url);
				if (this.#closed || this.#states.get(url) === answer) return;
				this.#states.set(url, answer);
				this.#change();
			});
	}
}
