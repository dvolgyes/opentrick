import { RELAY_CHECK_MS } from "./limits";

/**
 * Frequent checks of the Nostr relays, which the player can turn on in Settings for an unstable network (ADR 0004).
 * A check asks a relay for an event that cannot exist (src/p2p/nostr.ts); a live relay answers at once. A socket
 * whose relay does not answer in RELAY_CHECK_ANSWER_MS, and sends nothing else either, is replaced: about 40 s after
 * the relay went silent, not NOSTR_SILENT_MS. Only a relay that sent nothing for RELAY_CHECK_MS is checked, so a busy
 * relay gets few checks.
 */

/** "not-sent": the relay rests the page, its socket is not open, or the page does not know it. */
export type RelayCheckAnswer = "answered" | "refused" | "silent" | "not-sent";
export type CheckRelay = (url: string) => Promise<RelayCheckAnswer>;

/** The checks of the Nostr relays, by URL. A relay that refuses a check is not checked again. */
export class RelayChecks {
	readonly #check: CheckRelay;
	readonly #pending = new Set<string>();
	/** When each check that got no answer was sent. */
	readonly #unanswered = new Map<string, number>();
	readonly #refused = new Set<string>();

	constructor(check: CheckRelay) {
		this.#check = check;
	}

	/**
	 * Checks the relay when it has been silent since `silentSince` for RELAY_CHECK_MS. True: a check got no answer,
	 * and the relay sent nothing after it, so the mesh replaces the socket.
	 */
	tick(url: string, now: number, silentSince: number, on: boolean): boolean {
		const unanswered = this.#unanswered.get(url);
		if (unanswered !== undefined) {
			this.#unanswered.delete(url);
			if (silentSince <= unanswered) return true;
		}
		if (
			!on ||
			now - silentSince < RELAY_CHECK_MS ||
			this.#pending.has(url) ||
			this.#refused.has(url)
		)
			return false;
		this.#pending.add(url);
		void this.#check(url).then((answer) => {
			this.#pending.delete(url);
			if (answer === "refused") this.#refused.add(url);
			if (answer === "silent") this.#unanswered.set(url, now);
		});
		return false;
	}
}
