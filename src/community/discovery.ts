import {
	type ChannelHandlers,
	type CommunityChannel,
	DISCOVERY_ROOM,
	type OpenCommunity,
} from "./transport";

/** Owns the discovery connection while setup hands it to a matchmaking session. */
export class Discovery {
	readonly #open: OpenCommunity;
	readonly #listeners = new Set<() => void>();
	#channel: CommunityChannel | undefined;
	#handlers: ChannelHandlers | undefined;
	#failed = false;

	constructor(open: OpenCommunity) {
		this.#open = open;
	}
	get count(): number | undefined {
		return this.#failed || !this.#channel
			? undefined
			: this.#channel.peers().length;
	}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	#changed(): void {
		for (const listener of this.#listeners) listener();
	}
	start(): void {
		if (this.#channel || this.#failed) return;
		this.#channel = this.#open(DISCOVERY_ROOM, undefined, {
			message: (peer, value) => this.#handlers?.message(peer, value),
			join: (peer) => {
				this.#changed();
				this.#handlers?.join(peer);
			},
			leave: (peer) => {
				this.#changed();
				this.#handlers?.leave(peer);
			},
			problem: () => {
				this.#failed = true;
				this.#changed();
				this.#handlers?.problem();
			},
		});
		this.#changed();
	}
	open: OpenCommunity = (name, key, handlers) => {
		if (name !== DISCOVERY_ROOM || key !== undefined)
			return this.#open(name, key, handlers);
		this.start();
		const channel = this.#channel;
		if (!channel) throw new Error("Discovery is unavailable");
		this.#handlers = handlers;
		if (this.#failed) queueMicrotask(() => handlers.problem());
		else
			queueMicrotask(() => {
				if (this.#handlers === handlers)
					for (const peer of channel.peers()) handlers.join(peer);
			});
		return {
			self: channel.self,
			peers: () => channel.peers(),
			send: (message, to) => channel.send(message, to),
			leave: async () => {
				if (this.#handlers === handlers) await this.stop();
			},
		};
	};
	async stop(): Promise<void> {
		const channel = this.#channel;
		this.#channel = undefined;
		this.#handlers = undefined;
		this.#failed = false;
		this.#changed();
		await channel?.leave();
	}
}
