import type { Page } from "@playwright/test";

const RESPONSES = "https://openrouter.ai/api/v1/responses";
const DECISIONS = "https://openrouter.ai/api/alpha/decisions";

/**
 * Answers the OpenRouter responses and decisions endpoints with the HTTP status that the test sets for the model,
 * else with `status`, and with a pass on 200. It records the model and the authorization header of each request.
 * Any other OpenRouter request fails, so no test request reaches the real service.
 */
export interface OpenRouterMock {
	status: number;
	readonly modelStatus: Record<string, number>;
	readonly requests: { readonly model: string; readonly key: string }[];
}

export async function mockOpenRouter(page: Page): Promise<OpenRouterMock> {
	const mock: OpenRouterMock = { status: 200, modelStatus: {}, requests: [] };
	await page.route("https://openrouter.ai/**", async (route) => {
		const url = route.request().url();
		if (url !== RESPONSES && url !== DECISIONS) {
			await route.abort();
			return;
		}
		if (route.request().method() === "OPTIONS") {
			await route.fulfill({
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-methods": "POST, OPTIONS",
					"access-control-allow-headers": "authorization,content-type",
				},
			});
			return;
		}
		const body = route.request().postDataJSON();
		mock.requests.push({
			model: body.model,
			key: (await route.request().headerValue("authorization")) ?? "",
		});
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
	return mock;
}
