export class BotRequestAbortedError extends Error {
	constructor() {
		super("bot request aborted");
		this.name = "AbortError";
	}
}
