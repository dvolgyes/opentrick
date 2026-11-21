import { afterEach, describe, expect, it, vi } from "vitest";
import { CallPresenceTimeout } from "../../src/ui/call-presence";

afterEach(() => vi.useRealTimers());

describe("call presence timeout", () => {
	it("ends an active call only after five continuous minutes without another participant", async () => {
		vi.useFakeTimers();
		const end = vi.fn();
		const timeout = new CallPresenceTimeout(end);
		timeout.update(false, true);
		await vi.advanceTimersByTimeAsync(120_000);
		timeout.update(false, true);
		await vi.advanceTimersByTimeAsync(179_999);
		expect(end).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(end).toHaveBeenCalledOnce();
		timeout.stop();
	});
	it("cancels the wait when someone joins or the call ends, and starts a fresh wait later", async () => {
		vi.useFakeTimers();
		const end = vi.fn();
		const timeout = new CallPresenceTimeout(end);
		timeout.update(false, true);
		await vi.advanceTimersByTimeAsync(299_999);
		timeout.update(true, true);
		await vi.advanceTimersByTimeAsync(300_000);
		expect(end).not.toHaveBeenCalled();
		timeout.update(false, true);
		await vi.advanceTimersByTimeAsync(299_999);
		timeout.update(false, false);
		await vi.advanceTimersByTimeAsync(300_000);
		expect(end).not.toHaveBeenCalled();
		timeout.update(false, true);
		await vi.advanceTimersByTimeAsync(299_999);
		expect(end).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(end).toHaveBeenCalledOnce();
		timeout.stop();
	});
	it("cancels pending work when stopped", async () => {
		vi.useFakeTimers();
		const end = vi.fn();
		const timeout = new CallPresenceTimeout(end);
		timeout.update(false, true);
		timeout.stop();
		await vi.advanceTimersByTimeAsync(300_000);
		expect(end).not.toHaveBeenCalled();
	});
});
