import type { MaybeStorage } from "../session";

/** Discards credentials and model preferences from the retired remote bot integration. */
export function discardLegacyBotSettings(storage: MaybeStorage): boolean {
	for (const key of [
		"opentrick.openrouter-api-key",
		"opentrick.openrouter-spend-usd",
		"opentrick.settings.custom-model",
		"opentrick.settings.model-order",
	]) {
		try {
			storage?.removeItem(key);
		} catch {
			// A browser that denies storage can still join a table as a guest.
			return false;
		}
	}
	return true;
}
