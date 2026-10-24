/** A held screen lock: the browser can release it at any time, for example when the page is hidden. */
export interface WakeLockHandle {
	released(): boolean;
	release(): void;
}

/** The browser's Screen Wake Lock API, or a fake in tests. */
export interface WakeLockPort {
	visible(): boolean;
	/** Resolves to undefined when the browser has no wake lock or refuses it. */
	request(): Promise<WakeLockHandle | undefined>;
}

/** The screen lock of this page. The table works without it, so a refusal (low battery, no support) is not an error. */
export const screenWakeLock: WakeLockPort = {
	visible: () => document.visibilityState === "visible",
	request: async () => {
		if (!("wakeLock" in navigator)) return undefined;
		const sentinel = await navigator.wakeLock
			.request("screen")
			.catch(() => undefined);
		return sentinel === undefined
			? undefined
			: {
					released: () => sentinel.released,
					release: () => {
						void sentinel.release().catch(() => undefined);
					},
				};
	},
};

/**
 * Keeps the screen of a phone or tablet on while a game is active, so the device does not sleep and drop the
 * connection. The browser releases the lock when the page is hidden, so the policy asks again when it is shown. After a
 * refusal it waits for the next time the page is shown or the game starts, so a render does not ask again.
 */
export class WakeLockPolicy {
	readonly #port: WakeLockPort;
	#active = false;
	#lock: WakeLockHandle | undefined;
	#pending = false;

	constructor(port: WakeLockPort) {
		this.#port = port;
	}

	/** Active: the bidding or the play of a board is on the table. */
	update(active: boolean): void {
		if (active === this.#active) return;
		this.#active = active;
		if (active) this.#acquire();
		else {
			this.#lock?.release();
			this.#lock = undefined;
		}
	}

	/** Call when the page becomes visible again. */
	pageShown(): void {
		if (this.#active) this.#acquire();
	}

	#acquire(): void {
		if (this.#pending || !this.#port.visible()) return;
		if (this.#lock !== undefined && !this.#lock.released()) return;
		this.#pending = true;
		void this.#port.request().then((lock) => {
			this.#pending = false;
			if (lock === undefined) return;
			if (this.#active) this.#lock = lock;
			else lock.release();
		});
	}
}
