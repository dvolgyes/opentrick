/** The browser's Fullscreen API, or a fake in tests. */
export interface FullscreenPort {
	enabled(): boolean;
	active(): boolean;
	/** Works only during a user gesture: the browser refuses it otherwise. */
	enter(): void;
	exit(): void;
}

/** The page element in full screen, so that the language selector and the dialogs stay visible. */
export const documentFullscreen: FullscreenPort = {
	enabled: () => document.fullscreenEnabled,
	active: () => document.fullscreenElement !== null,
	// The browser can refuse, for example after the player pressed Escape; the table works without full screen.
	enter: () => {
		void document.documentElement
			.requestFullscreen({ navigationUI: "hide" })
			.catch(() => undefined);
	},
	exit: () => {
		void document.exitFullscreen().catch(() => undefined);
	},
};

/**
 * A desktop table goes to full screen when the game begins with all four seats taken, and leaves it when a seat
 * becomes empty. A message from the network cannot start full screen, so the page waits for the player's next
 * gesture. Each page decides from the same replicated roster, so every player follows the same rule.
 */
export class FullscreenPolicy {
	readonly #port: FullscreenPort;
	#complete = false;
	#armed = false;

	constructor(port: FullscreenPort) {
		this.#port = port;
	}

	/** Complete: a desktop table whose game began and whose four seats are taken by players or bots. */
	update(complete: boolean): void {
		if (complete === this.#complete) return;
		this.#complete = complete;
		this.#armed = complete && this.#port.enabled();
		if (!complete && this.#port.active()) this.#port.exit();
	}

	/** Call from a pointerdown or keydown listener. Asks once per begin, so a player who leaves full screen stays out. */
	gesture(): void {
		if (!this.#armed) return;
		this.#armed = false;
		if (!this.#port.active()) this.#port.enter();
	}
}
