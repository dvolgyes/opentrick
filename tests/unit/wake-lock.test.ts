import { describe, expect, it } from "vitest";
import {
	type WakeLockHandle,
	WakeLockPolicy,
	type WakeLockPort,
} from "../../src/ui/wake-lock";

/** A fake screen lock: each request waits until the test grants or refuses it. */
class FakePort implements WakeLockPort {
	shown = true;
	readonly requests: ((lock: WakeLockHandle | undefined) => void)[] = [];
	readonly locks: { released: boolean }[] = [];

	visible(): boolean {
		return this.shown;
	}

	request(): Promise<WakeLockHandle | undefined> {
		return new Promise((resolve) => this.requests.push(resolve));
	}

	/** Grants the oldest open request with a new lock. */
	async grant(): Promise<{ released: boolean }> {
		const state = { released: false };
		this.locks.push(state);
		this.requests.shift()?.({
			released: () => state.released,
			release: () => {
				state.released = true;
			},
		});
		await Promise.resolve();
		return state;
	}

	async refuse(): Promise<void> {
		this.requests.shift()?.(undefined);
		await Promise.resolve();
	}
}

describe("WakeLockPolicy", () => {
	it("asks for the lock while the game is active, and releases it after", async () => {
		const port = new FakePort();
		const policy = new WakeLockPolicy(port);
		policy.update(false);
		expect(port.requests).toHaveLength(0);
		policy.update(true);
		policy.update(true);
		expect(port.requests).toHaveLength(1);
		const lock = await port.grant();
		policy.update(true);
		expect(port.requests).toHaveLength(0);
		policy.update(false);
		expect(lock.released).toBe(true);
	});

	it("releases a lock that arrives after the game stopped", async () => {
		const port = new FakePort();
		const policy = new WakeLockPolicy(port);
		policy.update(true);
		policy.update(false);
		const lock = await port.grant();
		expect(lock.released).toBe(true);
	});

	it("waits until the page is shown, and asks again after the browser released the lock", async () => {
		const port = new FakePort();
		port.shown = false;
		const policy = new WakeLockPolicy(port);
		policy.update(true);
		expect(port.requests).toHaveLength(0);
		port.shown = true;
		policy.pageShown();
		const lock = await port.grant();
		// A hidden page loses the lock; the browser releases it, not the policy.
		lock.released = true;
		policy.pageShown();
		expect(port.requests).toHaveLength(1);
		await port.grant();
		policy.pageShown();
		expect(port.requests).toHaveLength(0);
	});

	it("does not ask again after a refusal until the page is shown again", async () => {
		const port = new FakePort();
		const policy = new WakeLockPolicy(port);
		policy.update(true);
		await port.refuse();
		policy.update(true);
		expect(port.requests).toHaveLength(0);
		policy.pageShown();
		expect(port.requests).toHaveLength(1);
	});

	it("does not ask while the game is not active", () => {
		const port = new FakePort();
		const policy = new WakeLockPolicy(port);
		policy.pageShown();
		expect(port.requests).toHaveLength(0);
	});
});
