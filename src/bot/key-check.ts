import { dealCards } from "../bridge/deal";
import { createBoard, legalActions } from "../bridge/engine";
import type { BotModel } from "../protocol";
import {
	BrowserOpenRouterStrategy,
	OpenRouterRequestError,
} from "./browser-openrouter";
import { loadBrowserPromptTemplates } from "./browser-prompts";
import { decisionState, renderBidPrompt } from "./strategy";

export type KeyCheck =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string };

function failureReason(error: unknown): string {
	if (error instanceof OpenRouterRequestError) {
		switch (error.status) {
			case 401:
				return "OpenRouter rejected the API key (401).";
			case 402:
				return "The OpenRouter account has insufficient balance (402).";
			case 403:
				return "OpenRouter denied access to this model (403).";
			case 404:
				return "OpenRouter could not find this model (404).";
			case 429:
				return "OpenRouter rate limited the request (429). Wait, then try again.";
			default:
				return `OpenRouter returned HTTP ${error.status}.`;
		}
	}
	if (error instanceof Error && error.name === "AbortError")
		return "The OpenRouter request timed out.";
	if (error instanceof TypeError)
		return "The browser could not reach OpenRouter.";
	if (error instanceof Error && error.message.startsWith("OpenRouter "))
		return `The model returned an unusable answer: ${error.message}.`;
	return error instanceof Error ? error.message : String(error);
}

/**
 * Asks the model for one opening bid, through the same prompt and request as a bot seat, so a failure shows the
 * reason that would stop the bots. A fixed deal keeps the request the same each time. No retry.
 */
export async function checkOpenRouterKey(
	apiKey: string,
	model: BotModel,
): Promise<KeyCheck> {
	const board = createBoard(
		1,
		dealCards(() => 0),
	);
	const seat = board.dealer;
	const legal = legalActions(board, seat);
	const strategy = new BrowserOpenRouterStrategy(
		apiKey,
		{
			model,
			fallbackModel: model,
			modelOrder: [model],
			retries: 0,
			retryDelayMs: 0,
		},
		new AbortController().signal,
	);
	try {
		const templates = await loadBrowserPromptTemplates();
		await strategy.choose(
			"call",
			renderBidPrompt(board, seat, legal, templates, {}),
			legal,
			decisionState(board, seat, "call", templates, {}),
		);
		return { ok: true };
	} catch (error) {
		return { ok: false, reason: failureReason(error) };
	}
}
