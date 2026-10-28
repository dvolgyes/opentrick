import { expect, it, vi } from "vitest";
import { Discovery } from "../../src/community/discovery";
import {
	type ChannelHandlers,
	type CommunityChannel,
	DISCOVERY_ROOM,
	type OpenCommunity,
} from "../../src/community/transport";

it("hands the existing connection to matchmaking and closes it once", async () => {
	let callbacks: ChannelHandlers | undefined;
	const peers = ["other"];
	const leave = vi.fn(async () => {});
	const send = vi.fn();
	const channel: CommunityChannel = {
		self: "self",
		peers: () => peers,
		send,
		leave,
	};
	const open = vi.fn<OpenCommunity>((_room, _key, handlers) => {
		callbacks = handlers;
		return channel;
	});
	const discovery = new Discovery(open);
	const changed = vi.fn();
	discovery.subscribe(changed);
	discovery.start();
	expect(discovery.count).toBe(1);
	const handlers: ChannelHandlers = {
		message: vi.fn(),
		join: vi.fn(),
		leave: vi.fn(),
		problem: vi.fn(),
	};
	const session = discovery.open(DISCOVERY_ROOM, undefined, handlers);
	await Promise.resolve();
	expect(open).toHaveBeenCalledTimes(1);
	expect(handlers.join).toHaveBeenCalledWith("other");
	callbacks?.message("other", { k: "offer" });
	expect(handlers.message).toHaveBeenCalledWith("other", { k: "offer" });
	peers.length = 0;
	callbacks?.leave("other");
	expect(discovery.count).toBe(0);
	expect(changed).toHaveBeenCalledTimes(2);
	await session.leave();
	await discovery.stop();
	expect(leave).toHaveBeenCalledTimes(1);
	expect(discovery.count).toBeUndefined();
});

it("reports a discovery failure to a session that joins later", async () => {
	let callbacks: ChannelHandlers | undefined;
	const channel: CommunityChannel = {
		self: "self",
		peers: () => [],
		send: () => {},
		leave: async () => {},
	};
	const discovery = new Discovery((_room, _key, handlers) => {
		callbacks = handlers;
		return channel;
	});
	discovery.start();
	callbacks?.problem();
	expect(discovery.count).toBeUndefined();
	const handlers: ChannelHandlers = {
		message: vi.fn(),
		join: vi.fn(),
		leave: vi.fn(),
		problem: vi.fn(),
	};
	discovery.open(DISCOVERY_ROOM, undefined, handlers);
	await Promise.resolve();
	expect(handlers.problem).toHaveBeenCalledOnce();
	await discovery.stop();
});
