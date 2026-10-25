import type { BotMessage } from "./browser-openrouter";

const KEY_URL = "https://openrouter.ai/api/v1/key";
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const TIMEOUT_MS = 15_000;

/** A key is accepted when its balance is above this amount. */
export const MIN_KEY_BALANCE_USD = 0.1;

/** The balance in USD, or undefined when OpenRouter accepts the key but reports no amount. */
export type OpenRouterBalance =
	| { readonly ok: true; readonly balanceUsd: number | undefined }
	| { readonly ok: false; readonly message: BotMessage };

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export const formatUsd = (amount: number): string => `$${amount.toFixed(2)}`;

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

async function data(response: Response): Promise<Record<string, unknown>> {
	const body: unknown = await response.json().catch(() => undefined);
	const value =
		typeof body === "object" && body !== null && "data" in body
			? body.data
			: undefined;
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

/**
 * Reads the balance of the key: the credits of the account less their usage, and not more than the remaining limit
 * of the key. The key endpoint decides whether OpenRouter accepts the key; the credits endpoint only adds the amount.
 */
export async function readOpenRouterBalance(
	apiKey: string,
	fetchFn: Fetch = fetch,
): Promise<OpenRouterBalance> {
	const init: RequestInit = {
		headers: { Authorization: `Bearer ${apiKey}` },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	};
	const [key, credits] = await Promise.allSettled([
		fetchFn(KEY_URL, init),
		fetchFn(CREDITS_URL, init),
	]);
	if (key.status === "rejected") {
		const error: unknown = key.reason;
		return {
			ok: false,
			message: {
				text:
					error instanceof Error && error.name === "TimeoutError"
						? "The OpenRouter key check timed out."
						: "The browser could not reach OpenRouter.",
			},
		};
	}
	if (key.value.status === 401)
		return {
			ok: false,
			message: { text: "OpenRouter rejected the API key (401)." },
		};
	if (!key.value.ok)
		return {
			ok: false,
			message: {
				text: "OpenRouter returned HTTP {status} for the key check.",
				values: { status: key.value.status },
			},
		};
	const amounts: number[] = [];
	const keyData = await data(key.value);
	if (keyData.limit !== null && finite(keyData.limit_remaining))
		amounts.push(keyData.limit_remaining);
	if (credits.status === "fulfilled" && credits.value.ok) {
		const { total_credits: total, total_usage: usage } = await data(
			credits.value,
		);
		if (finite(total) && finite(usage)) amounts.push(total - usage);
	}
	return {
		ok: true,
		balanceUsd: amounts.length > 0 ? Math.min(...amounts) : undefined,
	};
}

/**
 * Accepts a key that OpenRouter accepts when its balance is above $0.10, or unknown: without an amount the bots find
 * out at their first request.
 */
export async function checkOpenRouterKey(
	apiKey: string,
	fetchFn: Fetch = fetch,
): Promise<OpenRouterBalance> {
	const result = await readOpenRouterBalance(apiKey, fetchFn);
	if (
		result.ok &&
		result.balanceUsd !== undefined &&
		!(result.balanceUsd > MIN_KEY_BALANCE_USD)
	)
		return {
			ok: false,
			message: {
				text: "The OpenRouter balance is {balance}. A key needs more than {minimum}.",
				values: {
					balance: formatUsd(result.balanceUsd),
					minimum: formatUsd(MIN_KEY_BALANCE_USD),
				},
			},
		};
	return result;
}
