import type { Page } from "@playwright/test";

/**
 * Answers the OpenRouter responses endpoint with the HTTP status that the test sets, and with a pass on 200. It
 * records the model and the authorization header of each request.
 */
export interface OpenRouterMock {
	status: number;
	readonly requests: { readonly model: string; readonly key: string }[];
}

export async function mockOpenRouter(page: Page): Promise<OpenRouterMock> {
	const mock: OpenRouterMock = { status: 200, requests: [] };
	await page.route("https://openrouter.ai/api/v1/responses", async (route) => {
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
		if (mock.status !== 200) {
			await route.fulfill({
				status: mock.status,
				headers: { "access-control-allow-origin": "*" },
				body: "",
			});
			return;
		}
		await route.fulfill({
			status: 200,
			headers: { "access-control-allow-origin": "*" },
			contentType: "application/json",
			body: JSON.stringify({
				output: [
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: '{"call":"P"}' }],
					},
				],
			}),
		});
	});
	return mock;
}
