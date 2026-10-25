import { describe, expect, it } from "vitest";
import {
	DEFAULT_MQTT_BROKER_URLS,
	DEFAULT_NOSTR_RELAY_URLS,
	DEFAULT_TRACKER_URLS,
	parseMqttBrokerUrls,
	parseNostrRelayUrls,
	parseTrackerUrls,
	readMeshConfig,
} from "../../src/p2p/config";
import { classifyJoinError } from "../../src/p2p/mesh";

describe("parseTrackerUrls", () => {
	it.each([
		["absent", undefined],
		["empty", ""],
		["blank", "  ,  "],
	])("gives the four default trackers when %s", (_name, value) => {
		expect(parseTrackerUrls(value)).toEqual({
			ok: true,
			urls: DEFAULT_TRACKER_URLS,
		});
		expect(DEFAULT_TRACKER_URLS).toEqual([
			"wss://tracker.openwebtorrent.com",
			"wss://tracker.webtorrent.dev",
			"wss://open.ftorrent.com",
			"wss://tracker.novage.com.ua",
		]);
	});

	it.each(["none", " None "])("turns the trackers off with %j", (value) => {
		expect(parseTrackerUrls(value)).toEqual({ ok: true, urls: [] });
	});

	it("refuses none together with a URL", () => {
		expect(parseTrackerUrls("wss://a.example none")).toEqual({
			ok: false,
			error: "Not a valid wss: tracker URL in VITE_TRACKER_URLS: none",
		});
	});

	it("accepts wss: URLs separated by commas or spaces and removes duplicates", () => {
		expect(
			parseTrackerUrls(
				"wss://a.example, wss://b.example:8443/announce wss://a.example",
			),
		).toEqual({
			ok: true,
			urls: ["wss://a.example", "wss://b.example:8443/announce"],
		});
	});

	it.each([
		["plain ws", "ws://tracker.example"],
		["https", "https://tracker.example"],
		["credentials", "wss://user:secret@tracker.example"],
		["a query", "wss://tracker.example/?token=1"],
		["a fragment", "wss://tracker.example/#k"],
		["not a URL", "tracker.example"],
	])("refuses %s", (_name, url) => {
		const result = parseTrackerUrls(`wss://good.example ${url}`);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error).toContain("VITE_TRACKER_URLS");
	});

	it("refuses more than eight URLs", () => {
		const urls = Array.from(
			{ length: 9 },
			(_, index) => `wss://t${index}.example`,
		);
		expect(parseTrackerUrls(urls.join(","))).toEqual({
			ok: false,
			error: "At most 8 tracker URLs are allowed (VITE_TRACKER_URLS).",
		});
	});
});

describe("parseNostrRelayUrls", () => {
	it("gives the five default relays when absent", () => {
		expect(parseNostrRelayUrls(undefined)).toEqual({
			ok: true,
			urls: DEFAULT_NOSTR_RELAY_URLS,
		});
		expect(DEFAULT_NOSTR_RELAY_URLS).toEqual([
			"wss://nos.lol",
			"wss://relay.primal.net",
			"wss://relay.snort.social",
			"wss://nostr.mom",
			"wss://offchain.pub",
		]);
	});

	it("turns the Nostr relays off with none", () => {
		expect(parseNostrRelayUrls("none")).toEqual({ ok: true, urls: [] });
	});

	it("names its own variable in its errors", () => {
		expect(parseNostrRelayUrls("wss://a.example ws://b.example")).toEqual({
			ok: false,
			error:
				"Not a valid wss: Nostr relay URL in VITE_NOSTR_RELAY_URLS: ws://b.example",
		});
		const urls = Array.from(
			{ length: 9 },
			(_, index) => `wss://r${index}.example`,
		);
		expect(parseNostrRelayUrls(urls.join(" "))).toEqual({
			ok: false,
			error: "At most 8 Nostr relay URLs are allowed (VITE_NOSTR_RELAY_URLS).",
		});
	});
});

describe("parseMqttBrokerUrls", () => {
	it("gives the two default brokers when absent", () => {
		expect(parseMqttBrokerUrls(undefined)).toEqual({
			ok: true,
			urls: DEFAULT_MQTT_BROKER_URLS,
		});
		expect(DEFAULT_MQTT_BROKER_URLS).toEqual([
			"wss://broker.emqx.io:8084/mqtt",
			"wss://broker.hivemq.com:8884/mqtt",
		]);
	});

	it("turns the MQTT brokers off with none", () => {
		expect(parseMqttBrokerUrls("none")).toEqual({ ok: true, urls: [] });
	});

	it("names its own variable in its errors", () => {
		expect(
			parseMqttBrokerUrls("wss://a.example/mqtt ws://b.example/mqtt"),
		).toEqual({
			ok: false,
			error:
				"Not a valid wss: MQTT broker URL in VITE_MQTT_BROKER_URLS: ws://b.example/mqtt",
		});
		const urls = Array.from(
			{ length: 9 },
			(_, index) => `wss://m${index}.example/mqtt`,
		);
		expect(parseMqttBrokerUrls(urls.join(" "))).toEqual({
			ok: false,
			error: "At most 8 MQTT broker URLs are allowed (VITE_MQTT_BROKER_URLS).",
		});
	});

	it("refuses credentials in the URL, so no broker account is used", () => {
		const result = parseMqttBrokerUrls(
			"wss://public:public@broker.example/mqtt",
		);
		expect(!result.ok && result.error).toContain("VITE_MQTT_BROKER_URLS");
	});
});

describe("readMeshConfig", () => {
	it("combines the tracker list with the STUN list", () => {
		expect(
			readMeshConfig({
				VITE_TRACKER_URLS: "wss://tracker.example",
				VITE_STUN_URLS: "stun:stun.example:3478",
			}),
		).toEqual({
			ok: true,
			config: {
				trackers: ["wss://tracker.example"],
				nostrRelays: DEFAULT_NOSTR_RELAY_URLS,
				mqttBrokers: DEFAULT_MQTT_BROKER_URLS,
				rtc: { iceServers: [{ urls: ["stun:stun.example:3478"] }] },
			},
		});
	});

	it("turns trackers, Nostr relays and STUN off independently", () => {
		expect(
			readMeshConfig({ VITE_TRACKER_URLS: "none", VITE_STUN_URLS: "none" }),
		).toEqual({
			ok: true,
			config: {
				trackers: [],
				nostrRelays: DEFAULT_NOSTR_RELAY_URLS,
				mqttBrokers: DEFAULT_MQTT_BROKER_URLS,
				rtc: { iceServers: [] },
			},
		});
		expect(
			readMeshConfig({
				VITE_NOSTR_RELAY_URLS: "none",
				VITE_TRACKER_URLS: "wss://tracker.example",
			}),
		).toEqual({
			ok: true,
			config: {
				trackers: ["wss://tracker.example"],
				nostrRelays: [],
				mqttBrokers: DEFAULT_MQTT_BROKER_URLS,
				rtc: expect.anything(),
			},
		});
		expect(
			readMeshConfig({
				VITE_MQTT_BROKER_URLS: "none",
				VITE_NOSTR_RELAY_URLS: "none",
				VITE_TRACKER_URLS: "none",
			}),
		).toEqual({
			ok: true,
			config: {
				trackers: [],
				nostrRelays: [],
				mqttBrokers: [],
				rtc: expect.anything(),
			},
		});
	});

	it.each([
		["a tracker", "VITE_TRACKER_URLS"],
		["a Nostr relay", "VITE_NOSTR_RELAY_URLS"],
	])("refuses a URL that is both an MQTT broker and %s", (_name, variable) => {
		expect(
			readMeshConfig({
				[variable]: "wss://both.example/mqtt",
				VITE_MQTT_BROKER_URLS: "wss://both.example/mqtt",
			}),
		).toEqual({
			ok: false,
			error:
				"A URL cannot be both an MQTT broker and a tracker or Nostr relay: wss://both.example/mqtt",
		});
	});

	it("gives the MQTT broker error before the STUN error", () => {
		const result = readMeshConfig({
			VITE_MQTT_BROKER_URLS: "mqtt://broker.example",
			VITE_STUN_URLS: "turn:relay.example",
		});
		expect(!result.ok && result.error).toContain("VITE_MQTT_BROKER_URLS");
	});

	it("refuses a URL that is both a tracker and a Nostr relay", () => {
		expect(
			readMeshConfig({
				VITE_TRACKER_URLS: "wss://both.example",
				VITE_NOSTR_RELAY_URLS: "wss://both.example",
			}),
		).toEqual({
			ok: false,
			error:
				"A URL cannot be both a tracker and a Nostr relay: wss://both.example",
		});
	});

	it("gives the tracker error before the STUN error", () => {
		const result = readMeshConfig({
			VITE_TRACKER_URLS: "ws://tracker.example",
			VITE_STUN_URLS: "turn:relay.example",
		});
		expect(!result.ok && result.error).toContain("VITE_TRACKER_URLS");
	});

	it("refuses a TURN server, so no relay service is used", () => {
		const result = readMeshConfig({ VITE_STUN_URLS: "turn:relay.example" });
		expect(!result.ok && result.error).toContain("TURN URLs are not supported");
	});
});

describe("classifyJoinError", () => {
	// The texts of @trystero-p2p/core 0.26.0 (dist/signal-handler.mjs).
	it.each([
		["incorrect room password when decrypting offer", "wrong-key"],
		["incorrect room password when decrypting answer", "wrong-key"],
		["incorrect password", "wrong-key"],
		[
			"could not connect to peer abc after exchanging SDP; configure TURN servers with turnConfig or rtcConfig.iceServers",
			"unreachable",
		],
		["peer connection closed", "other"],
		["", "other"],
	])("classifies %j as %s", (error, expected) => {
		expect(classifyJoinError(error)).toBe(expected);
	});
});
