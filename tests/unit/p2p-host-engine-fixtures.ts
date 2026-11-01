import { chatModule, chatPayload } from "../../src/game/chat";
import type { GameModule } from "../../src/game/module";
import type { Authority } from "../../src/p2p/authority";
import { HostEngine, type HostStop } from "../../src/p2p/host-engine";
import { deriveHolder, makeTag } from "../../src/p2p/keys";
import { LINK_VERSION } from "../../src/p2p/link";
import { creationCommit, LocalLog } from "../../src/p2p/log";
import type {
	AutoplayStatus,
	CtlMessage,
	EntryMessage,
} from "../../src/p2p/wire";
import type { JsonObject, RoomConfig, Seat } from "../../src/protocol";
import {
	overTheWire,
	peerId,
	Recorder,
	settle,
	TestStorage,
	VirtualClock,
} from "./fake-mesh";
import { CONFIG, commandId, TABLE } from "./p2p-fixtures";

export const HOST = peerId("host");
export const EAST = peerId("east");
export const EAST2 = peerId("east2");
export const SOUTH = peerId("south");
export const CLIENT_N = "clientN-0123456789abcd";
export const CLIENT_E = "clientE-0123456789abcd";
export const CLIENT_S = "clientS-0123456789abcd";

export class Rig {
	readonly clock = new VirtualClock();
	readonly storage = new TestStorage();
	readonly sent = new Recorder(TABLE);
	readonly stops: HostStop[] = [];
	readonly log = new LocalLog(this.storage, TABLE, "N");
	auth: Authority = { term: 1, tag: "", inc: 1 };
	engine: HostEngine | null = null;
	autoplay: (seat: Seat, enabled: boolean) => Promise<AutoplayStatus> =
		async () => "unavailable";
	autoplayRequests: { seat: Seat; enabled: boolean }[] = [];
	reportChanges = 0;
	#next = 100;
	constructor(readonly module: GameModule = chatModule) {}

	async create(
		config: RoomConfig = CONFIG,
		state: JsonObject = this.module.initialState(TABLE, config),
	): Promise<this> {
		const holder = await deriveHolder(TABLE, CLIENT_N);
		this.auth = { term: 1, tag: makeTag(holder, "N"), inc: 1 };
		const written = await this.log.write(() =>
			creationCommit({
				tableId: TABLE,
				seat: "N",
				holder,
				config,
				state,
				auth: this.auth,
				id: commandId(1),
				now: this.clock.wall(),
			}),
		);
		if (!written.ok) throw new Error(written.detail);
		this.start();
		return this;
	}

	/** A new engine on the same log, as after a host reload. */
	start(): HostEngine {
		this.engine = new HostEngine({
			log: this.log,
			auth: this.auth,
			self: HOST,
			module: this.module,
			send: this.sent,
			clock: this.clock,
			newId: () => commandId(this.#next++),
			autoplay: async (seat, enabled) => {
				this.autoplayRequests.push({ seat, enabled });
				return this.autoplay(seat, enabled);
			},
			onStop: (reason) => this.stops.push(reason),
			onReport: () => {
				this.reportChanges += 1;
			},
		});
		return this.engine;
	}

	get host(): HostEngine {
		if (!this.engine) throw new Error("no engine");
		return this.engine;
	}

	/** Delivers a message from `peer` as it arrives over the wire, and lets the engine finish. */
	async from(peer: string, message: CtlMessage): Promise<void> {
		this.host.receive(peer, overTheWire(TABLE, "ctl", message));
		await settle();
	}

	async hello(
		peer: string,
		client: string,
		bound: { seat: Seat; gen: number } | null = null,
		features?: string[],
	): Promise<void> {
		this.host.join(peer);
		await this.from(peer, {
			k: "hello",
			b: LINK_VERSION,
			client,
			...(bound ?? {}),
			...(features === undefined ? {} : { features }),
		});
	}

	/** A visitor says hello and claims `seat`; returns its generation. */
	async seat(
		peer: string,
		client: string,
		seat: Seat,
		features?: string[],
		name?: string,
	): Promise<number> {
		await this.hello(peer, client, null, features);
		const lobby = this.to(peer).find((message) => message.k === "lobby");
		const row =
			lobby?.k === "lobby"
				? lobby.seats.find((item) => item.seat === seat)
				: undefined;
		await this.from(peer, {
			k: "claim-seat",
			req: 1,
			seat,
			...(row?.gen === undefined ? {} : { gen: row.gen }),
			...(row?.nameRevision === undefined
				? {}
				: { nameRevision: row.nameRevision }),
			...(name === undefined ? {} : { name }),
		});
		const result = this.to(peer).find((message) => message.k === "seat-result");
		if (result?.k !== "seat-result" || !result.ok)
			throw new Error(`no seat: ${JSON.stringify(result)}`);
		return result.gen;
	}

	async command(
		peer: string,
		n: number,
		gen: number,
		text = `message ${n}`,
	): Promise<void> {
		await this.from(peer, {
			k: "cmd",
			id: commandId(n),
			gen,
			payload: chatPayload(TABLE, text),
		});
	}

	/** Messages sent to `peer` (null: to everyone) since the last call, in order. */
	to(peer: string | null): CtlMessage[] {
		const all = this.sent.take();
		this.sent.sent = all.filter((item) => item.to !== peer);
		return all
			.filter((item) => item.to === peer && item.channel === "ctl")
			.map((item) => item.message as CtlMessage);
	}

	/** Entries broadcast since the last call. */
	entries(): EntryMessage[] {
		const all = this.sent.take();
		this.sent.sent = all.filter((item) => item.message.k !== "entry");
		return all
			.filter((item) => item.to === null && item.message.k === "entry")
			.map((item) => item.message as EntryMessage);
	}

	row(seat: Seat) {
		return this.log.table?.seats.find((row) => row.seat === seat);
	}
}
