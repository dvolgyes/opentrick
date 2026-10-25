import { describe, expect, it } from "vitest";
import { checkKeyInModelOrder, type KeyCheck } from "../../src/bot/key-check";

/** A check that fails each model in `failing` with its reason and passes the others; it records the order. */
function fakeCheck(failing: Readonly<Record<string, string>>) {
	const asked: string[] = [];
	const check = async (model: string): Promise<KeyCheck> => {
		asked.push(model);
		const reason = failing[model];
		return reason === undefined ? { ok: true } : { ok: false, reason };
	};
	return { asked, check };
}

describe("checkKeyInModelOrder", () => {
	it("stops at the first model that works", async () => {
		const { asked, check } = fakeCheck({});
		expect(await checkKeyInModelOrder(["a/1", "b/2"], check)).toEqual({
			ok: true,
			model: "a/1",
		});
		expect(asked).toEqual(["a/1"]);
	});

	it("tries the next model after any failure of the one before", async () => {
		const { asked, check } = fakeCheck({
			"a/1": "OpenRouter rejected the API key (401).",
			"b/2": "The OpenRouter request timed out.",
		});
		expect(await checkKeyInModelOrder(["a/1", "b/2", "c/3"], check)).toEqual({
			ok: true,
			model: "c/3",
		});
		expect(asked).toEqual(["a/1", "b/2", "c/3"]);
	});

	it("gives the reason of each model when all models fail", async () => {
		const { asked, check } = fakeCheck({ "a/1": "one.", "b/2": "two." });
		expect(await checkKeyInModelOrder(["a/1", "b/2"], check)).toEqual({
			ok: false,
			failures: [
				{ model: "a/1", reason: "one." },
				{ model: "b/2", reason: "two." },
			],
		});
		expect(asked).toEqual(["a/1", "b/2"]);
	});

	it("asks each model once, also when the order names it twice", async () => {
		const { asked, check } = fakeCheck({ "a/1": "one." });
		await checkKeyInModelOrder(["a/1", "a/1", "b/2"], check);
		expect(asked).toEqual(["a/1", "b/2"]);
	});

	it("asks no further model after the caller stops", async () => {
		const { asked, check } = fakeCheck({ "a/1": "one.", "b/2": "two." });
		let stopped = false;
		const result = await checkKeyInModelOrder(
			["a/1", "b/2"],
			async (model) => {
				const answer = await check(model);
				stopped = true;
				return answer;
			},
			() => stopped,
		);
		expect(asked).toEqual(["a/1"]);
		expect(result).toEqual({
			ok: false,
			failures: [{ model: "a/1", reason: "one." }],
		});
	});

	it("refuses an empty model order", async () => {
		await expect(checkKeyInModelOrder([], fakeCheck({}).check)).rejects.toThrow(
			"no model",
		);
	});
});
