import { expect, it } from "vitest";
import {
	type CommunitySaved,
	CommunitySession,
	type GameStart,
} from "../../src/community/session";
import type {
	ChannelHandlers,
	OpenCommunity,
} from "../../src/community/transport";

class Network {
	now = 0;
	sequence = 0;
	readonly queue: (() => void)[] = [];
	readonly rooms = new Map<string, Map<string, ChannelHandlers>>();
	readonly sessions: CommunitySession[] = [];
	readonly games: { self: string; key: string; start: GameStart }[] = [];
	readonly stores = new Map<number, Map<string, string>>();
	drop: (from: string, to: string, value: unknown) => boolean = () => false;
	open(self: string): OpenCommunity {
		return (room, _key, handlers) => {
			const peers = this.rooms.get(room) ?? new Map<string, ChannelHandlers>();
			this.rooms.set(room, peers);
			for (const [peer, other] of peers)
				this.queue.push(() => {
					other.join(self);
					handlers.join(peer);
				});
			peers.set(self, handlers);
			let left = false;
			return {
				self,
				peers: () =>
					left ? [] : [...peers.keys()].filter((peer) => peer !== self),
				send: (value, targets) => {
					if (left) return;
					for (const [peer, other] of peers)
						if (peer !== self && (!targets || targets.includes(peer)))
							this.queue.push(() => {
								if (peers.get(peer) === other && !this.drop(self, peer, value))
									other.message(self, structuredClone(value));
							});
				},
				leave: async () => {
					if (left) return;
					left = true;
					peers.delete(self);
					for (const other of peers.values())
						this.queue.push(() => other.leave(self));
				},
			};
		};
	}
	async add(
		index: number,
		overrides: Partial<CommunitySaved> = {},
	): Promise<CommunitySession> {
		const data = this.stores.get(index) ?? new Map<string, string>();
		this.stores.set(index, data);
		const self = `member_${index}`;
		const saved: CommunitySaved = {
			self,
			owner: self,
			name: `Player ${index}`,
			key: `${String.fromCharCode(65 + index)}${"A".repeat(21)}`,
			expected: ["N"],
			ready: true,
			allowBots: false,
			waitMs: 60_000,
			waitedMs: 0,
			...overrides,
		};
		const session = new CommunitySession(
			{
				store: {
					getItem: (key) => data.get(key) ?? null,
					setItem: (key, value) => {
						data.set(key, value);
					},
				},
				open: this.open(`browser_${index}`),
				now: () => this.now,
				id: () => `decision_${++this.sequence}`,
				random: () => 0,
				identity: async (key) => ({
					tableId: `group_${key[0]}0`,
					holder: self.padEnd(16, "x"),
				}),
				change: () => undefined,
				play: async (key, start, self) => {
					this.games.push({ key, start, self });
					await new Promise<void>(() => undefined);
				},
			},
			saved,
		);
		this.sessions.push(session);
		await session.start();
		return session;
	}
	async flush(): Promise<void> {
		for (let step = 0; step < 5000; step++) {
			const run = this.queue.shift();
			if (run) run();
			await Promise.resolve();
			if (!run && this.queue.length === 0) return;
		}
		throw new Error("formation generated an unbounded message loop");
	}
	async advance(ms: number, accept = true): Promise<void> {
		for (let elapsed = 0; elapsed < ms; elapsed += 500) {
			this.now += 500;
			for (const session of this.sessions) {
				if (accept && session.proposal && !session.accepted) session.accept();
				session.tick();
			}
			await this.flush();
		}
	}
}

it("merges four solos into one game, with partners preserved and no duplicate seats", async () => {
	const net = new Network();
	for (let index = 0; index < 4; index++) await net.add(index);
	await net.advance(60_000);
	expect(net.sessions.map((session) => session.problem)).toEqual([
		undefined,
		undefined,
		undefined,
		undefined,
	]);
	expect(net.games).toHaveLength(4);
	expect(new Set(net.games.map((game) => game.key)).size).toBe(1);
	for (const game of net.games) {
		expect(game.start.group.members).toHaveLength(4);
		expect(
			new Set(game.start.group.members.map((member) => member.seat)).size,
		).toBe(4);
		expect(game.start.config.botSetup?.seats).toEqual([]);
	}
});

it("retransmits start votes while the game waits for a participant that missed a vote", async () => {
	const net = new Network();
	const a = await net.add(0, {
		expected: ["N", "S"],
		allowBots: true,
		waitMs: 0,
	});
	await net.add(1, {
		key: a.saved.key,
		owner: a.saved.self,
		expected: ["N", "S"],
		allowBots: true,
		waitMs: 0,
	});
	net.drop = (from, _to, value) =>
		from === "browser_1" && (value as { k: string }).k === "start-vote";
	await net.advance(10_000);
	expect(net.games).toHaveLength(1);
	net.drop = () => false;
	await net.advance(10_000);
	expect(net.games).toHaveLength(2);
});

it("a frozen party member cannot consent to a new bot start through stale presence", async () => {
	const net = new Network();
	const a = await net.add(0, { expected: ["N", "S"] });
	await net.add(1, {
		key: a.saved.key,
		owner: a.saved.self,
		expected: ["N", "S"],
		allowBots: true,
		waitMs: 0,
	});
	await net.advance(10_000);
	net.drop = (from) => from === "browser_1";
	await net.advance(25_000);
	a.setPreferences(true, true, 0);
	await net.advance(5_000);
	expect(a.searching).toBe(false);
	expect(a.saved.start).toBeUndefined();
	expect(net.games).toHaveLength(0);
});

it("does not publish an incomplete party and does not spend its search timer waiting for friends", async () => {
	const net = new Network();
	const session = await net.add(0, { expected: ["N", "S"] });
	await net.advance(120_000);
	expect(session.searching).toBe(false);
	expect(session.saved.waitedMs).toBe(0);
	expect(net.rooms.has("waiting-v1")).toBe(false);
});

it("one refusal prevents bot fallback; changing it permits unanimous start after both waits", async () => {
	const net = new Network();
	await net.add(0, { allowBots: true });
	await net.add(1);
	await net.advance(90_000);
	expect(net.games).toEqual([]);
	const second = net.sessions[1];
	if (!second) throw new Error("missing second player");
	second.setPreferences(true, true, 120_000);
	await net.advance(20_000);
	expect(net.games).toEqual([]);
	await net.advance(40_000);
	expect(net.sessions.map((session) => session.problem)).toEqual([
		undefined,
		undefined,
	]);
	expect(net.games).toHaveLength(2);
	expect(net.games[0]?.start.config.botSetup?.seats).toHaveLength(2);
});

it("recovers a durable prepare after all tabs reload without returning to matchmaking", async () => {
	const net = new Network();
	net.drop = (_from, _to, value) =>
		["vote", "commit"].includes((value as { k: string }).k);
	const a = await net.add(0);
	const b = await net.add(1);
	await net.advance(20_000);
	expect(a.prepared).toBe(true);
	expect(b.prepared).toBe(true);
	const saved = [a.saved, b.saved];
	a.stop();
	b.stop();
	await net.flush();
	net.drop = () => false;
	const restoredA = await net.add(0, saved[0]);
	const restoredB = await net.add(1, saved[1]);
	await net.advance(20_000);
	expect(restoredA.problem).toBeUndefined();
	expect(restoredB.problem).toBeUndefined();
	expect(restoredA.prepared).toBe(false);
	expect(restoredB.prepared).toBe(false);
	expect(restoredA.saved.group).toEqual(restoredB.saved.group);
	expect(restoredA.saved.group?.members).toHaveLength(2);
});

it("keeps an absent friend's reservation and resumes when the party host reloads", async () => {
	const net = new Network();
	const a = await net.add(0, { expected: ["N", "S"] });
	const b = await net.add(1, {
		key: a.saved.key,
		owner: a.saved.self,
		expected: ["N", "S"],
	});
	await net.advance(10_000);
	const before = a.saved;
	a.stop();
	await net.advance(30_000);
	expect(b.searching).toBe(false);
	expect(b.saved.group?.members).toHaveLength(2);
	const restored = await net.add(0, before);
	await net.advance(10_000);
	expect(restored.searching).toBe(true);
	expect(b.searching).toBe(true);
	expect(b.saved.group).toEqual(before.group);
});
