import { afterEach, describe, expect, it, vi } from "vitest";
import { STUN_PROBE_MS, STUN_RECHECK_MS } from "../../src/p2p/limits";
import {
	type StunAnswer,
	StunChecks,
	stunProbe,
} from "../../src/p2p/stun-probe";

/** A peer connection that gathers the candidates the test gives it, and records its configuration and close. */
class FakeConnection {
	static last: FakeConnection | undefined;
	static gather: (connection: FakeConnection) => void = () => {};
	readonly config: RTCConfiguration;
	onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
	closed = false;
	constructor(config: RTCConfiguration) {
		this.config = config;
		FakeConnection.last = this;
	}
	createDataChannel(): void {}
	async createOffer(): Promise<object> {
		return {};
	}
	async setLocalDescription(): Promise<void> {
		FakeConnection.gather(this);
	}
	candidate(text: string | null): void {
		this.onicecandidate?.({
			candidate: text === null ? null : { candidate: text },
		});
	}
	close(): void {
		this.closed = true;
	}
}

const probe = stunProbe(FakeConnection as unknown as typeof RTCPeerConnection);
const HOST =
	"candidate:1 1 udp 2122260223 abc.local 50000 typ host generation 0";
const SRFLX =
	"candidate:2 1 udp 1686052607 203.0.113.7 4242 typ srflx raddr 0.0.0.0 rport 0 generation 0";

afterEach(() => {
	vi.useRealTimers();
	FakeConnection.gather = () => {};
});

describe("stunProbe", () => {
	it("asks only the given server, and counts its public address as the answer", async () => {
		FakeConnection.gather = (connection) => {
			connection.candidate(HOST);
			connection.candidate(SRFLX);
		};
		await expect(probe("stun:a.test:3478")).resolves.toBe("answered");
		expect(FakeConnection.last?.config).toEqual({
			iceServers: [{ urls: "stun:a.test:3478" }],
		});
		expect(FakeConnection.last?.closed).toBe(true);
	});

	it("counts a gathering that ends without a public address as no answer", async () => {
		FakeConnection.gather = (connection) => {
			connection.candidate(HOST);
			connection.candidate(null);
		};
		await expect(probe("stun:a.test")).resolves.toBe("no-answer");
		expect(FakeConnection.last?.closed).toBe(true);
	});

	it("gives up after STUN_PROBE_MS", async () => {
		vi.useFakeTimers();
		const answer = probe("stun:a.test");
		await vi.advanceTimersByTimeAsync(STUN_PROBE_MS);
		await expect(answer).resolves.toBe("no-answer");
		expect(FakeConnection.last?.closed).toBe(true);
	});
});

describe("StunChecks", () => {
	/** Checks whose probe answers when the test resolves it. */
	function checks(urls: readonly string[]) {
		const asked: { url: string; answer: (a: StunAnswer) => void }[] = [];
		const changes = { count: 0 };
		const stun = new StunChecks(
			urls,
			(url) =>
				new Promise((resolve) => {
					asked.push({ url, answer: resolve });
				}),
			() => changes.count++,
		);
		return { stun, asked, changes };
	}

	it("asks again after STUN_RECHECK_MS only while the page is alone", async () => {
		const { stun, asked } = checks(["stun:a.test"]);
		stun.tick(0, false);
		expect(asked).toHaveLength(1);
		asked[0]?.answer("answered");
		await expect.poll(() => stun.statuses()[0]?.state).toBe("answered");
		stun.tick(STUN_RECHECK_MS, false);
		expect(asked).toHaveLength(1);
		stun.tick(STUN_RECHECK_MS - 1, true);
		expect(asked).toHaveLength(1);
		stun.tick(STUN_RECHECK_MS, true);
		expect(asked).toHaveLength(2);
	});

	it("keeps the last answer during a recheck, and reports a changed answer", async () => {
		const { stun, asked, changes } = checks(["stun:a.test"]);
		stun.tick(0, true);
		asked[0]?.answer("answered");
		await expect
			.poll(() => stun.statuses())
			.toEqual([{ url: "stun:a.test", state: "answered" }]);
		expect(changes.count).toBe(1);
		stun.tick(STUN_RECHECK_MS, true);
		expect(stun.statuses()).toEqual([
			{ url: "stun:a.test", state: "answered" },
		]);
		asked[1]?.answer("no-answer");
		await expect.poll(() => changes.count).toBe(2);
		expect(stun.statuses()).toEqual([
			{ url: "stun:a.test", state: "no-answer" },
		]);
	});

	it("counts a failed probe as no answer, and reports nothing after close", async () => {
		const failing = new StunChecks(
			["stun:a.test"],
			() => Promise.reject(new Error("no WebRTC")),
			() => {},
		);
		failing.tick(0, true);
		await expect.poll(() => failing.statuses()[0]?.state).toBe("no-answer");

		const { stun, asked, changes } = checks(["stun:a.test"]);
		stun.tick(0, true);
		stun.close();
		asked[0]?.answer("answered");
		await Promise.resolve();
		expect(changes.count).toBe(0);
		expect(stun.statuses()[0]?.state).toBe("checking");
	});
});
