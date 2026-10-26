import "./ui/style.css";
import type { BuildInfo } from "./build";
import { parseStunUrls, rtcConfiguration } from "./call/ice";
import { detectLocale, translator } from "./i18n";
import { readMeshConfig } from "./p2p/config";
import type { Clock } from "./p2p/ports";
import {
	MemoryStorage,
	openIndexedDbStorage,
	type TableStorage,
} from "./p2p/storage";
import { trysteroMesh } from "./p2p/trystero";
import { guardedStorage, SeatMemory, webSeatLocks } from "./session";
import { startApp } from "./ui/app";
import type { CallSupport } from "./ui/deps";
import { readSettings } from "./ui/settings";
import { applyTheme } from "./ui/theme";

/** Set by vite.config.ts at build time. */
declare const __OPENTRICK_BUILD__: BuildInfo;

const LOCALE_STORAGE_KEY = "opentrick.locale";
const browser = guardedStorage(() => window.localStorage);
const detectedLocale = detectLocale(navigator.languages, navigator.language);
const storedLocale = browser?.getItem(LOCALE_STORAGE_KEY);
const savedLocale =
	storedLocale === "en" ||
	storedLocale === "de" ||
	storedLocale === "hu" ||
	storedLocale === "no" ||
	storedLocale === "es" ||
	storedLocale === "pt" ||
	storedLocale === "fr" ||
	storedLocale === "it" ||
	storedLocale === "nl"
		? storedLocale
		: undefined;
const locale = savedLocale ?? detectedLocale;
const t = translator(locale);
document.documentElement.lang = locale;
applyTheme(document.documentElement, readSettings(browser).theme);

const root = document.getElementById("app");
if (!root) throw new Error("index.html must contain #app");

/**
 * Calls need WebRTC. Without the capture API (for example on a page that is not a secure context) Listen only
 * still works: a microphone request then fails, which the call shows as "No working microphone".
 */
function callSupport(stunList: string | undefined): CallSupport {
	const stun = parseStunUrls(stunList);
	if (!stun.ok)
		return { available: false, reason: configErrorText(stun.error) };
	if (typeof RTCPeerConnection !== "function") {
		return { available: false, reason: t("This browser cannot make calls.") };
	}
	const configuration = rtcConfiguration(stun.urls);
	const devices = navigator.mediaDevices as MediaDevices | undefined;
	return {
		available: true,
		getUserMedia: (constraints) =>
			devices === undefined
				? Promise.reject(
						new DOMException("No capture API", "NotSupportedError"),
					)
				: devices.getUserMedia(constraints),
		cameras: {
			enumerate: () =>
				devices === undefined
					? Promise.resolve([])
					: typeof devices.enumerateDevices !== "function"
						? Promise.resolve(undefined)
						: devices.enumerateDevices().then((listed) =>
								listed
									.filter((device) => device.kind === "videoinput")
									.map((device) => ({
										deviceId: device.deviceId,
										label: device.label,
									})),
							),
			subscribe: (listener) => {
				if (devices === undefined) return () => {};
				devices.addEventListener("devicechange", listener);
				return () => devices.removeEventListener("devicechange", listener);
			},
		},
		createConnection: () => new RTCPeerConnection(configuration),
		newSession: () => crypto.randomUUID(),
		granted: (medium) => granted(medium === "audio" ? "microphone" : "camera"),
	};
}

function configErrorText(message: string): string {
	const trackerCount =
		/^At most (\d+) tracker URLs are allowed \(VITE_TRACKER_URLS\)\.$/.exec(
			message,
		);
	if (trackerCount)
		return t("At most {count} tracker URLs are allowed (VITE_TRACKER_URLS).", {
			count: trackerCount[1] as string,
		});
	const badTracker =
		/^Not a valid wss: tracker URL in VITE_TRACKER_URLS: (.+)$/.exec(message);
	if (badTracker)
		return t("Not a valid wss: tracker URL in VITE_TRACKER_URLS: {url}", {
			url: badTracker[1] as string,
		});
	const nostrCount =
		/^At most (\d+) Nostr relay URLs are allowed \(VITE_NOSTR_RELAY_URLS\)\.$/.exec(
			message,
		);
	if (nostrCount)
		return t(
			"At most {count} Nostr relay URLs are allowed (VITE_NOSTR_RELAY_URLS).",
			{ count: nostrCount[1] as string },
		);
	const badNostr =
		/^Not a valid wss: Nostr relay URL in VITE_NOSTR_RELAY_URLS: (.+)$/.exec(
			message,
		);
	if (badNostr)
		return t(
			"Not a valid wss: Nostr relay URL in VITE_NOSTR_RELAY_URLS: {url}",
			{ url: badNostr[1] as string },
		);
	const both = /^A URL cannot be both a tracker and a Nostr relay: (.+)$/.exec(
		message,
	);
	if (both)
		return t("A URL cannot be both a tracker and a Nostr relay: {url}", {
			url: both[1] as string,
		});
	const mqttCount =
		/^At most (\d+) MQTT broker URLs are allowed \(VITE_MQTT_BROKER_URLS\)\.$/.exec(
			message,
		);
	if (mqttCount)
		return t(
			"At most {count} MQTT broker URLs are allowed (VITE_MQTT_BROKER_URLS).",
			{ count: mqttCount[1] as string },
		);
	const badMqtt =
		/^Not a valid wss: MQTT broker URL in VITE_MQTT_BROKER_URLS: (.+)$/.exec(
			message,
		);
	if (badMqtt)
		return t(
			"Not a valid wss: MQTT broker URL in VITE_MQTT_BROKER_URLS: {url}",
			{ url: badMqtt[1] as string },
		);
	const mqttShared =
		/^A URL cannot be both an MQTT broker and a tracker or Nostr relay: (.+)$/.exec(
			message,
		);
	if (mqttShared)
		return t(
			"A URL cannot be both an MQTT broker and a tracker or Nostr relay: {url}",
			{ url: mqttShared[1] as string },
		);
	const stunCount =
		/^At most (\d+) STUN URLs are allowed \(VITE_STUN_URLS\)\.$/.exec(message);
	if (stunCount)
		return t("At most {count} STUN URLs are allowed (VITE_STUN_URLS).", {
			count: stunCount[1] as string,
		});
	const badStun =
		/^Not a valid stun: or stuns: URL in VITE_STUN_URLS: (.+)$/.exec(message);
	if (badStun)
		return t("Not a valid stun: or stuns: URL in VITE_STUN_URLS: {url}", {
			url: badStun[1] as string,
		});
	return t(message);
}

/** The browser's stored answer for a capture permission; a browser that cannot tell counts as not granted. */
function granted(name: "microphone" | "camera"): Promise<boolean> {
	const permissions = navigator.permissions as Permissions | undefined;
	if (permissions === undefined) return Promise.resolve(false);
	return permissions.query({ name }).then(
		(status) => status.state === "granted",
		// Some browsers do not know this permission name: the page asks the user instead.
		() => false,
	);
}

/** IndexedDB, or a memory store with the reason when this browser does not allow storing data (plan §4.3). */
async function openStorage(): Promise<{
	storage: TableStorage;
	problem: string | undefined;
}> {
	const api =
		typeof indexedDB === "undefined"
			? undefined
			: { factory: indexedDB, keyRange: IDBKeyRange };
	const opened = await openIndexedDbStorage(api, (record) =>
		console.error(`Ignored a damaged stored ${record} record.`),
	);
	return opened.ok
		? { storage: opened.value, problem: undefined }
		: { storage: new MemoryStorage(), problem: opened.detail };
}

/**
 * Web Locks, or none when this browser refuses them (blocked site data): only the host then gives a seat back, to
 * this browser once no page of the seat is connected, or to another browser after SEAT_GRACE_MS offline (plan §4.6).
 */
async function usableLocks(): Promise<LockManager | undefined> {
	const locks = navigator.locks as LockManager | undefined;
	if (locks === undefined) return undefined;
	return locks.query().then(
		() => locks,
		() => undefined,
	);
}

/** Best effort: a browser without the API, or one that refuses, can still clear the stored tables later. */
function askPersistence(): Promise<boolean> {
	const manager = navigator.storage as StorageManager | undefined;
	if (typeof manager?.persist !== "function") return Promise.resolve(false);
	return manager.persist().catch(() => false);
}

async function main(root: HTMLElement): Promise<void> {
	// Trystero and the table identifiers need Web Crypto, which only a secure context has (plan §4.1).
	if (!window.isSecureContext) {
		root.textContent = t("Open this page over HTTPS.");
		return;
	}
	// The table reaches the other pages over WebRTC data channels only. Lockdown Mode on an iPhone turns WebRTC off.
	if (typeof RTCPeerConnection !== "function") {
		root.textContent = t(
			"This browser has WebRTC turned off, so this page cannot reach the other players. On an iPhone or iPad, Lockdown Mode turns WebRTC off: turn it off for this website in the website settings of Safari, or use another device.",
		);
		return;
	}
	const mesh = readMeshConfig(import.meta.env);
	if (!mesh.ok) {
		root.textContent = configErrorText(mesh.error);
		return;
	}
	const { config } = mesh;
	const clock: Clock = {
		monotonic: () => performance.now(),
		wall: () => Date.now(),
	};
	const memory = new SeatMemory(
		guardedStorage(() => window.sessionStorage),
		browser,
		clock.wall,
	);
	memory.prune();
	const { storage, problem } = await openStorage();
	let persisted: Promise<boolean> | undefined;
	startApp(root, {
		build: __OPENTRICK_BUILD__,
		locale,
		detectedLocale,
		savedLocale,
		t,
		storage,
		storageProblem: problem,
		locks: webSeatLocks(await usableLocks()),
		memory,
		browser,
		clock,
		openMesh: (tableId, key) =>
			trysteroMesh(tableId, key, config, clock, {
				relayChecks: () => readSettings(browser).relayChecks,
			}),
		call: callSupport(import.meta.env.VITE_STUN_URLS),
		pageUrl: () => location.href,
		persist: () => {
			persisted ??= askPersistence();
			return persisted;
		},
	});
}

void main(root);
