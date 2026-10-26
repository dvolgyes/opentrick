import type { Page } from "@playwright/test";
import type { BidPosition } from "../../src/bot/bid-position";
import type { Call } from "../../src/bridge/rules";

/** Deterministic bidding for UI tests; local-bidding.spec.ts exercises the real neural worker. */
export async function mockBotBidding(
	page: Page,
	choose: (position: BidPosition) => Call = (position) =>
		position.calls.length === 0 ? "1NT" : "P",
	delayMs = 100,
): Promise<{ readonly positions: BidPosition[] }> {
	const positions: BidPosition[] = [];
	await page.route("**/__test_bid__", async (route) => {
		const position = route.request().postDataJSON() as BidPosition;
		positions.push(position);
		const call = choose(position);
		if (delayMs > 0)
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		await route.fulfill({ json: { call } });
	});
	await page.route(/\/bid-worker-[^/]+\.js$/, (route) =>
		route.fulfill({
			contentType: "text/javascript",
			body: `self.onmessage = async ({data}) => {
				const response = await fetch(new URL("/__test_bid__", self.location.href), {
					method: "POST", body: JSON.stringify(data.position)
				});
				const {call} = await response.json();
				self.postMessage({ok: true, analysis: {call, policy: data.policy, candidates: []}});
			};`,
		}),
	);
	return { positions };
}
