import { describe, expect, it } from "vitest";
import {
	checkOpenRouterKey,
	readOpenRouterBalance,
} from "../../src/bot/openrouter-balance";

const KEY_URL = "https://openrouter.ai/api/v1/key";
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";

type Answer = Response | Error;

/** A fetch that answers each OpenRouter URL with its answer and records the URL and the authorization header. */
function fakeFetch(answers: Readonly<Record<string, Answer>>) {
	const requests: { url: string; authorization: string | null }[] = [];
	const fetchFn = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = String(input);
		requests.push({
			url,
			authorization: new Headers(init?.headers).get("Authorization"),
		});
		const answer = answers[url];
		if (answer === undefined) throw new Error(`no answer for ${url}`);
		if (answer instanceof Error) throw answer;
		return answer;
	};
	return { requests, fetchFn };
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const keyBody = (limit: number | null, limitRemaining: number | null) => ({
	data: { label: "test", limit, limit_remaining: limitRemaining, usage: 1 },
});

const credits = (total: number, usage: number) =>
	json({ data: { total_credits: total, total_usage: usage } });

describe("readOpenRouterBalance", () => {
	it("is the credits of the account less their usage, for a key without a limit", async () => {
		const { requests, fetchFn } = fakeFetch({
			[KEY_URL]: json(keyBody(null, null)),
			[CREDITS_URL]: credits(20, 7.5),
		});
		expect(await readOpenRouterBalance("sk-test", fetchFn)).toEqual({
			ok: true,
			balanceUsd: 12.5,
		});
		expect(requests).toEqual([
			{ url: KEY_URL, authorization: "Bearer sk-test" },
			{ url: CREDITS_URL, authorization: "Bearer sk-test" },
		]);
	});

	it("is the smaller of the account balance and the remaining limit of the key", async () => {
		const limited = fakeFetch({
			[KEY_URL]: json(keyBody(5, 3)),
			[CREDITS_URL]: credits(20, 7.5),
		});
		expect(await readOpenRouterBalance("k", limited.fetchFn)).toEqual({
			ok: true,
			balanceUsd: 3,
		});
		const poor = fakeFetch({
			[KEY_URL]: json(keyBody(5, 3)),
			[CREDITS_URL]: credits(1, 0.75),
		});
		expect(await readOpenRouterBalance("k", poor.fetchFn)).toEqual({
			ok: true,
			balanceUsd: 0.25,
		});
	});

	it("uses the remaining limit of the key when the credits cannot be read", async () => {
		const { fetchFn } = fakeFetch({
			[KEY_URL]: json(keyBody(5, 3)),
			[CREDITS_URL]: json({ error: "forbidden" }, 403),
		});
		expect(await readOpenRouterBalance("k", fetchFn)).toEqual({
			ok: true,
			balanceUsd: 3,
		});
	});

	it("accepts the key with an unknown balance when OpenRouter reports no amount", async () => {
		const { fetchFn } = fakeFetch({
			[KEY_URL]: json(keyBody(null, null)),
			[CREDITS_URL]: new TypeError("Failed to fetch"),
		});
		expect(await readOpenRouterBalance("k", fetchFn)).toEqual({
			ok: true,
			balanceUsd: undefined,
		});
	});

	it("gives the reason when OpenRouter rejects the key, or cannot be reached", async () => {
		const rejected = fakeFetch({
			[KEY_URL]: json({ error: { message: "User not found." } }, 401),
			[CREDITS_URL]: json({ error: "User not found." }, 401),
		});
		expect(await readOpenRouterBalance("bad", rejected.fetchFn)).toEqual({
			ok: false,
			message: { text: "OpenRouter rejected the API key (401)." },
		});
		const failing = fakeFetch({
			[KEY_URL]: json({}, 503),
			[CREDITS_URL]: json({}, 503),
		});
		expect(await readOpenRouterBalance("k", failing.fetchFn)).toEqual({
			ok: false,
			message: {
				text: "OpenRouter returned HTTP {status} for the key check.",
				values: { status: 503 },
			},
		});
		const offline = fakeFetch({
			[KEY_URL]: new TypeError("Failed to fetch"),
			[CREDITS_URL]: new TypeError("Failed to fetch"),
		});
		expect(await readOpenRouterBalance("k", offline.fetchFn)).toEqual({
			ok: false,
			message: { text: "The browser could not reach OpenRouter." },
		});
	});
});

describe("checkOpenRouterKey", () => {
	it("accepts a key whose balance is above $0.10, and one whose balance is unknown", async () => {
		const funded = fakeFetch({
			[KEY_URL]: json(keyBody(null, null)),
			[CREDITS_URL]: credits(1, 0.89),
		});
		expect(await checkOpenRouterKey("k", funded.fetchFn)).toEqual({
			ok: true,
			balanceUsd: expect.closeTo(0.11, 10),
		});
		const unknown = fakeFetch({
			[KEY_URL]: json(keyBody(null, null)),
			[CREDITS_URL]: json({}, 500),
		});
		expect(await checkOpenRouterKey("k", unknown.fetchFn)).toEqual({
			ok: true,
			balanceUsd: undefined,
		});
	});

	it("refuses a key whose balance is $0.10 or less, with the balance", async () => {
		for (const [limitRemaining, shown] of [
			[0.1, "$0.10"],
			[0.04, "$0.04"],
			[0, "$0.00"],
		] as const) {
			const { fetchFn } = fakeFetch({
				[KEY_URL]: json(keyBody(5, limitRemaining)),
				[CREDITS_URL]: credits(20, 1),
			});
			expect(await checkOpenRouterKey("k", fetchFn)).toEqual({
				ok: false,
				message: {
					text: "The OpenRouter balance is {balance}. A key needs more than {minimum}.",
					values: { balance: shown, minimum: "$0.10" },
				},
			});
		}
	});

	it("refuses a key that OpenRouter rejects", async () => {
		const { fetchFn } = fakeFetch({
			[KEY_URL]: json({}, 401),
			[CREDITS_URL]: json({}, 401),
		});
		expect(await checkOpenRouterKey("bad", fetchFn)).toEqual({
			ok: false,
			message: { text: "OpenRouter rejected the API key (401)." },
		});
	});
});
