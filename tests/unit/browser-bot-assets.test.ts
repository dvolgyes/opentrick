import { afterEach, describe, expect, it, vi } from "vitest";
import { BID_MODEL_BYTES } from "../../src/bot/bid-network";
import { BrowserBotAssets } from "../../src/bot/browser-assets";

afterEach(() => vi.unstubAllGlobals());

describe("retained bot resources", () => {
	it("shares the selected model and retains it after the connection fails", async () => {
		vi.stubGlobal("document", { baseURI: "https://example.com/game/" });
		vi.stubGlobal("location", { origin: "https://example.com" });
		const fetchModel = vi
			.fn()
			.mockResolvedValueOnce(new Response(new Uint8Array(BID_MODEL_BYTES)));
		vi.stubGlobal("fetch", fetchModel);
		const assets = new BrowserBotAssets();
		const [first, second] = await Promise.all([
			assets.model("sl"),
			assets.model("sl"),
		]);
		expect(first).toBe(second);
		expect(first.byteLength).toBe(BID_MODEL_BYTES);
		fetchModel.mockRejectedValue(new Error("offline"));
		expect(await assets.model("sl")).toBe(first);
		expect(fetchModel).toHaveBeenCalledOnce();
		assets.dispose();
	});

	it("rejects incomplete weights and retries a failed download", async () => {
		vi.stubGlobal("document", { baseURI: "https://example.com/game/" });
		vi.stubGlobal("location", { origin: "https://example.com" });
		const fetchModel = vi
			.fn()
			.mockResolvedValueOnce(new Response(new Uint8Array(8)))
			.mockResolvedValueOnce(new Response(new Uint8Array(BID_MODEL_BYTES)));
		vi.stubGlobal("fetch", fetchModel);
		const assets = new BrowserBotAssets();
		await expect(assets.model("sl")).rejects.toThrow(/incomplete/);
		await expect(assets.model("sl")).resolves.toHaveProperty(
			"byteLength",
			BID_MODEL_BYTES,
		);
		expect(fetchModel).toHaveBeenCalledTimes(2);
		assets.dispose();
	});

	it("rejects oversized weights and foreign model locations", async () => {
		vi.stubGlobal("document", { baseURI: "https://example.com/game/" });
		vi.stubGlobal("location", { origin: "https://example.com" });
		const fetchModel = vi
			.fn()
			.mockResolvedValue(new Response(new Uint8Array(BID_MODEL_BYTES + 1)));
		vi.stubGlobal("fetch", fetchModel);
		const assets = new BrowserBotAssets();
		await expect(assets.model("sl")).rejects.toThrow(/oversized/);
		vi.stubGlobal("document", { baseURI: "https://other.example/game/" });
		await expect(assets.model("sl")).rejects.toThrow(/location/);
		expect(fetchModel).toHaveBeenCalledOnce();
		assets.dispose();
	});
});
