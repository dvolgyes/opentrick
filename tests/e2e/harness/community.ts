import {
	type CommunityChannel,
	communityTransport,
} from "../../../src/community/transport";

export interface CommunityHarness {
	open(name: string, key?: string): void;
	peers(name: string): number;
	send(name: string, value: string): void;
	leave(name: string): Promise<void>;
	received(name: string): readonly string[];
	problems(): number;
}

const rooms = new Map<string, CommunityChannel>();
const received = new Map<string, string[]>();
let problems = 0;
const open = communityTransport({
	trackers: ["wss://tracker.community.test"],
	nostrRelays: [],
	mqttBrokers: [],
	rtc: {},
});
const harness: CommunityHarness = {
	open: (name, key) => {
		const messages: string[] = [];
		received.set(name, messages);
		rooms.set(
			name,
			open(name, key, {
				message: (_peer, value) => {
					if (typeof value === "string") messages.push(value);
				},
				join: () => undefined,
				leave: () => undefined,
				problem: () => {
					problems++;
				},
			}),
		);
	},
	peers: (name) => rooms.get(name)?.peers().length ?? 0,
	send: (name, value) => rooms.get(name)?.send(value),
	leave: async (name) => {
		await rooms.get(name)?.leave();
	},
	received: (name) => received.get(name) ?? [],
	problems: () => problems,
};
declare global {
	interface Window {
		communityHarness: CommunityHarness;
	}
}
window.communityHarness = harness;
