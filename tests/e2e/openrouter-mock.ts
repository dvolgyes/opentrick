import type { Page, Route } from "@playwright/test";

const RESPONSES = "https://openrouter.ai/api/v1/responses";
const DECISIONS = "https://openrouter.ai/api/alpha/decisions";
const KEY = "https://openrouter.ai/api/v1/key";
const CREDITS = "https://openrouter.ai/api/v1/credits";

/**
 * The key endpoint answers with `keyStatus` and the credits endpoint with `creditsStatus`, both with the amounts of
 * `balance`; the key endpoint records the authorization header in `keyChecks`.
 */
export interface OpenRouterKeyMock {
	keyStatus: number;
	creditsStatus: number;
	/** The remaining limit of the key (null: no limit), and the credits and usage of the account, in USD. */
	balance: { limitRemaining: number | null; credits: number; usage: number };
	readonly keyChecks: string[];
}

/**
 * Also answers the OpenRouter responses and decisions endpoints with the HTTP status that the test sets for the
 * model, else with `status`, and with a pass on 200. It records the model and the authorization header of each
 * request. Any other OpenRouter request fails, so no test request reaches the real service.
 */
export interface OpenRouterMock extends OpenRouterKeyMock {
	status: number;
	readonly modelStatus: Record<string, number>;
	readonly requests: { readonly model: string; readonly key: string }[];
}

async function answerPreflight(route: Route): Promise<boolean> {
	if (route.request().method() !== "OPTIONS") return false;
	await route.fulfill({
		status: 204,
		headers: {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET, POST, OPTIONS",
			"access-control-allow-headers": "authorization,content-type",
		},
	});
	return true;
}

/** Answers the key check of the page, for a test that answers the model requests itself. */
export async function mockOpenRouterKey(
	page: Page,
	mock: OpenRouterKeyMock = {
		keyStatus: 200,
		creditsStatus: 200,
		balance: { limitRemaining: null, credits: 10, usage: 0 },
		keyChecks: [],
	},
): Promise<OpenRouterKeyMock> {
	await page.route(
		(url) => url.href === KEY || url.href === CREDITS,
		async (route) => {
			if (await answerPreflight(route)) return;
			const url = route.request().url();
			if (url === KEY)
				mock.keyChecks.push(
					(await route.request().headerValue("authorization")) ?? "",
				);
			const { limitRemaining, credits, usage } = mock.balance;
			const status = url === KEY ? mock.keyStatus : mock.creditsStatus;
			await route.fulfill({
				status,
				headers: { "access-control-allow-origin": "*" },
				contentType: "application/json",
				body: JSON.stringify(
					status !== 200
						? { error: { code: status, message: "User not found." } }
						: url === KEY
							? {
									data: {
										limit: limitRemaining === null ? null : limitRemaining + 1,
										limit_remaining: limitRemaining,
										usage: 1,
									},
								}
							: { data: { total_credits: credits, total_usage: usage } },
				),
			});
		},
	);
	return mock;
}

export async function mockOpenRouter(page: Page): Promise<OpenRouterMock> {
	const mock: OpenRouterMock = {
		status: 200,
		keyStatus: 200,
		creditsStatus: 200,
		balance: { limitRemaining: null, credits: 10, usage: 0 },
		modelStatus: {},
		requests: [],
		keyChecks: [],
	};
	await page.route("https://openrouter.ai/**", async (route) => {
		const url = route.request().url();
		if (url !== RESPONSES && url !== DECISIONS) {
			await route.abort();
			return;
		}
		if (await answerPreflight(route)) return;
		const key = (await route.request().headerValue("authorization")) ?? "";
		const body = route.request().postDataJSON();
		mock.requests.push({ model: body.model, key });
		const status = mock.modelStatus[body.model] ?? mock.status;
		if (status !== 200) {
			await route.fulfill({
				status,
				headers: { "access-control-allow-origin": "*" },
				body: "",
			});
			return;
		}
		await route.fulfill({
			status: 200,
			headers: { "access-control-allow-origin": "*" },
			contentType: "application/json",
			body: JSON.stringify(
				url === DECISIONS
					? { answers: { bridge_action: { type: "choice", choice: "P" } } }
					: {
							output: [
								{
									type: "message",
									role: "assistant",
									content: [{ type: "output_text", text: '{"call":"P"}' }],
								},
							],
						},
			),
		});
	});
	// Registered last, so Playwright asks these routes before the route above.
	await mockOpenRouterKey(page, mock);
	return mock;
}
