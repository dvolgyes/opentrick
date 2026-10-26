export const DEFAULT_PLAY_TIME_MS = 5_000;

export function isPlayTimeMs(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 60_000
	);
}

/** A shared boundary for worker requests, persisted preferences, and the local core. */
export function playTimeMs(value = DEFAULT_PLAY_TIME_MS): number {
	if (!isPlayTimeMs(value))
		throw new Error(
			"play time must be an integer from 1 to 60000 milliseconds",
		);
	return value;
}
