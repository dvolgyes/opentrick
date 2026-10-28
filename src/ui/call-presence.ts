/** Ends an active call after a continuous absence of other human participants. */
export class CallPresenceTimeout {
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly endCall: () => void) {}

	update(hasOtherHuman: boolean, inCall: boolean): void {
		if (hasOtherHuman || !inCall) {
			this.stop();
			return;
		}
		if (this.#timer !== undefined) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.endCall();
		}, 15_000);
	}

	stop(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}
}
