/** Ends an active call after five continuous minutes without another participant. */
export class CallPresenceTimeout {
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly endCall: () => void) {}

	update(hasOtherParticipant: boolean, inCall: boolean): void {
		if (hasOtherParticipant || !inCall) {
			this.stop();
			return;
		}
		if (this.#timer !== undefined) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.endCall();
		}, 300_000);
	}

	stop(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}
}
