/*
 * The torrent tracker strategy of Trystero 0.26.0, copied from @trystero-p2p/torrent (src/index.ts in its
 * source map). Merge Trystero's changes by hand on an upgrade of @trystero-p2p/core. The changes from upstream:
 *
 * - This is an adapter of the combined strategy (`signaling.ts`), not a strategy of its own, so a page that meets
 *   a peer through a tracker and through a Nostr relay keeps one connection to it.
 * - `init` takes the tracker URLs; there is no default list and no redundancy count.
 * - The sockets come from `relay-socket.ts`, which can reconnect at once (`reconnectTracker`).
 * - `offersPerAnnounce` in the room config sets the number of offers in each announce (upstream: always 1). A
 *   tracker sends each offer to one peer, so one offer reaches one other page per announce.
 * - Leaving a room sends a "stopped" announce, so the tracker removes this page from the swarm at once and does
 *   not give its stale offers to other pages.
 * - A tracker message that is not valid JSON, or whose fields have the wrong types, is ignored. Upstream throws
 *   in the socket handler, or passes a non-string SDP on to WebRTC.
 * - The trackers take turns (`nextSlotMs`): with n trackers, each one gets an announce every n × 10 s (10 s to
 *   120 s), 10 s after the tracker before it. Upstream announces to all trackers at the same time, at the interval
 *   that each tracker asks for; here that interval sets only the period of the passive announces.
 *
 * Copyright (c) 2021 Dan Motzenbecker
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */

import {
	createRelayManager,
	entries,
	fromJson,
	genId,
	type JoinRoomConfig,
	keys,
	libName,
	type OfferRecord,
	type SocketClient,
	type StrategyAdapter,
	selfId,
	sha1,
	toJson,
} from "@trystero-p2p/core";
import { type RelayClient, relaySocket } from "./relay-socket";

const relayManager = createRelayManager<RelayClient>((client) => client.socket);
const clients: Record<string, RelayClient> = {};
/** The place of each tracker URL in the list of the page, for its announce slot. */
const announceSlots: Record<string, AnnounceSlot> = {};
const topicToInfoHash: Record<string, string> = {};
const infoHashToTopic: Record<string, string> = {};
type TopicState = {
	announce: () => void | Promise<void>;
	announceMs: number;
	handler: (data: TrackerMessage) => void;
	isActive: boolean;
	startPassiveAnnouncements: () => void;
	stopPassiveAnnouncements: () => void;
	token: symbol;
};

/** Tracker `index` of `count` trackers; the slots of the trackers count from `originMs`. */
type AnnounceSlot = {
	index: number;
	count: number;
	originMs: number;
};

const handledSignals: Record<string, number> = {};
const topicStates = relayManager.scoped<TopicState>();
const roomOutstandingOffers: Record<
	string,
	Record<string, OfferRecord & { createdAt: number }>
> = {};
const roomOfferGenerationPromises: Record<string, Promise<void> | undefined> =
	{};
const roomSubscriberCounts: Record<string, number> = {};
const trackerAction = "announce";
const hashLimit = 20;
const defaultOffersPerAnnounce = 1;
const requestedPeers = 3;
const defaultAnnounceMs = 10_000;
const dormantAnnounceMs = 120_000;
const offerRetentionMs = 120_000;
const announceTurnMs = 10_000;
const minSlotWaitMs = 1_000;
const signalDedupeWindowMs = 4_000;

export type TorrentRoomConfig = JoinRoomConfig & {
	/** Offers in each announce, a positive integer; 1 when absent. */
	readonly offersPerAnnounce?: number;
};

type TrackerMessage = {
	offer?: {
		type: "offer";
		sdp: string;
	};
	answer?: {
		type: "answer";
		sdp: string;
	};
	offer_id?: string;
	peer_id?: string;
	info_hash?: string;
	interval?: number;
	"failure reason"?: string;
	"warning message"?: string;
};

const TRACKER_STRINGS = [
	"info_hash",
	"offer_id",
	"peer_id",
	"failure reason",
	"warning message",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isSignal = (value: unknown, type: "offer" | "answer"): boolean =>
	isRecord(value) && value.type === type && typeof value.sdp === "string";

/** A tracker message, or undefined for text that is not JSON or has a field of the wrong type. */
const parseTrackerMessage = (raw: string): TrackerMessage | undefined => {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(data)) return undefined;
	for (const field of TRACKER_STRINGS) {
		if (data[field] !== undefined && typeof data[field] !== "string") {
			return undefined;
		}
	}
	const { interval, offer, answer } = data;
	if (
		interval !== undefined &&
		!(typeof interval === "number" && Number.isFinite(interval) && interval > 0)
	) {
		return undefined;
	}
	if (offer !== undefined && !isSignal(offer, "offer")) return undefined;
	if (answer !== undefined && !isSignal(answer, "answer")) return undefined;
	return data as TrackerMessage;
};

const getInfoHash = async (topic: string): Promise<string> => {
	if (topicToInfoHash[topic]) {
		return topicToInfoHash[topic];
	}

	const hash = (await sha1(topic)).slice(0, hashLimit);
	topicToInfoHash[topic] = hash;
	infoHashToTopic[hash] = topic;

	return hash;
};

const send = async (
	client: SocketClient,
	topic: string,
	payload: Record<string, unknown>,
): Promise<void> =>
	client.send(
		toJson({
			action: trackerAction,
			info_hash: await getInfoHash(topic),
			peer_id: selfId,
			...payload,
		}),
	);

const warn = (url: string, msg: string, didFail = false): void =>
	console.warn(
		`${libName}: torrent tracker ${didFail ? "failure" : "warning"} from ${url} - ${msg}`,
	);

const getRoomOutstandingOffers = (
	rootTopic: string,
): Record<string, OfferRecord & { createdAt: number }> =>
	(roomOutstandingOffers[rootTopic] ??= {});

const deleteRoomOfferBookkeeping = (rootTopic: string): void => {
	delete roomOutstandingOffers[rootTopic];
	delete roomOfferGenerationPromises[rootTopic];
};

const takeOutstandingOffer = (
	rootTopic: string,
	offerId: string,
	action: "claim" | "reclaim",
): OfferRecord | undefined => {
	const outstandingOffers = roomOutstandingOffers[rootTopic];
	const offer = outstandingOffers?.[offerId];

	if (!offer) {
		return;
	}

	delete outstandingOffers[offerId];
	offer[action]?.();

	if (!keys(outstandingOffers).length && !roomSubscriberCounts[rootTopic]) {
		deleteRoomOfferBookkeeping(rootTopic);
	}

	return offer;
};

const reclaimAllOutstandingOffers = (rootTopic: string): void => {
	keys(getRoomOutstandingOffers(rootTopic)).forEach((offerId) => {
		takeOutstandingOffer(rootTopic, offerId, "reclaim");
	});
	deleteRoomOfferBookkeeping(rootTopic);
};

const pruneOutstandingOffers = (rootTopic: string): void => {
	const now = Date.now();

	entries(getRoomOutstandingOffers(rootTopic)).forEach(([offerId, offer]) => {
		if (now - offer.createdAt > offerRetentionMs) {
			takeOutstandingOffer(rootTopic, offerId, "reclaim");
		}
	});
};

const ensureOutstandingOffers = async (
	rootTopic: string,
	getOffers: (n: number) => Promise<OfferRecord[]>,
	offersWanted: number,
): Promise<Record<string, OfferRecord & { createdAt: number }>> => {
	while (roomOfferGenerationPromises[rootTopic]) {
		await roomOfferGenerationPromises[rootTopic];
	}

	const nextPromise = (async () => {
		pruneOutstandingOffers(rootTopic);

		const outstandingOffers = getRoomOutstandingOffers(rootTopic);
		const outstandingCount = keys(outstandingOffers).length;
		const missingOffers = Math.max(0, offersWanted - outstandingCount);

		if (missingOffers > 0) {
			(await getOffers(missingOffers)).forEach((peerAndOffer) => {
				outstandingOffers[genId(hashLimit)] = {
					...peerAndOffer,
					createdAt: Date.now(),
				};
			});
		}
	})().finally(() => {
		if (roomOfferGenerationPromises[rootTopic] === nextPromise) {
			delete roomOfferGenerationPromises[rootTopic];
		}
	});

	roomOfferGenerationPromises[rootTopic] = nextPromise;
	await nextPromise;

	return getRoomOutstandingOffers(rootTopic);
};

type TrackerAdapter = Omit<
	StrategyAdapter<RelayClient, TorrentRoomConfig>,
	"init" | "deactivate"
> & {
	init: (
		urls: readonly string[],
		config: TorrentRoomConfig,
	) => Promise<RelayClient>[];
	deactivate: NonNullable<
		StrategyAdapter<RelayClient, TorrentRoomConfig>["deactivate"]
	>;
};

/**
 * The wait until the next announce slot of a tracker, at least `minSlotWaitMs`. The trackers take turns, so a peer
 * that one tracker misses waits for the next tracker, not for a whole period.
 */
const nextSlotMs = (slot: AnnounceSlot, nowMs: number): number => {
	const periodMs = Math.min(
		Math.max(slot.count * announceTurnMs, defaultAnnounceMs),
		offerRetentionMs,
	);
	const phaseMs = slot.originMs + (slot.index * periodMs) / slot.count;
	const periods = Math.ceil((nowMs + minSlotWaitMs - phaseMs) / periodMs);
	return Math.round(phaseMs + periods * periodMs - nowMs);
};

/** The tracker relays of the combined strategy (`signaling.ts`), one client for each URL in the page. */
export const torrentAdapter: TrackerAdapter = {
	init: (
		urls: readonly string[],
		config: TorrentRoomConfig,
	): Promise<RelayClient>[] => {
		const originMs = Date.now();
		return urls.map((rawUrl, index) => {
			announceSlots[rawUrl] = { index, count: urls.length, originMs };
			const client = relayManager.register(rawUrl, () =>
				relaySocket(
					rawUrl,
					(rawData) => {
						const data = parseTrackerMessage(rawData);
						if (data === undefined) {
							return;
						}
						const errMsg = data["failure reason"];
						const warnMsg = data["warning message"];
						const { interval } = data;
						const topic =
							data.info_hash && Object.hasOwn(infoHashToTopic, data.info_hash)
								? infoHashToTopic[data.info_hash]
								: undefined;

						if (errMsg) {
							if (config.relayConfig?.warnOnRelayFailure !== false) {
								warn(client.url, errMsg, true);
							}

							return;
						}

						if (warnMsg && config.relayConfig?.warnOnRelayFailure !== false) {
							warn(client.url, warnMsg);
						}

						const state = topic ? topicStates.forKey(rawUrl)[topic] : undefined;

						if (interval && state) {
							state.announceMs = Math.min(
								Math.max(interval * 1000, defaultAnnounceMs),
								offerRetentionMs,
							);
						}

						if ((data.offer || data.answer) && topic && data.offer_id) {
							if (data.peer_id === selfId) {
								return;
							}

							const signalType = data.offer ? "offer" : "answer";
							const signalKey = `${topic}:${signalType}:${data.offer_id}:${data.peer_id ?? ""}`;
							const nowMs = Date.now();
							const lastHandledMs = handledSignals[signalKey];

							if (
								typeof lastHandledMs === "number" &&
								nowMs - lastHandledMs < signalDedupeWindowMs
							) {
								return;
							}

							handledSignals[signalKey] = nowMs;

							entries(handledSignals).forEach(([key, handledAtMs]) => {
								if (nowMs - handledAtMs > signalDedupeWindowMs * 6) {
									delete handledSignals[key];
								}
							});

							state?.handler(data);
						}
					},
					() =>
						Object.values(topicStates.forKey(rawUrl)).forEach(
							(state) => void state.announce(),
						),
				),
			);
			clients[rawUrl] = client;

			return client.ready;
		});
	},

	subscribe: (client, rootTopic, _, onMessage, getOffers, context) => {
		const states = topicStates.forRelay(client);
		const subscriptionToken = Symbol(rootTopic);

		roomSubscriberCounts[rootTopic] =
			(roomSubscriberCounts[rootTopic] ?? 0) + 1;

		let passiveAnnounceTimeout: ReturnType<typeof setTimeout> | undefined;
		const stopPassiveAnnouncements = (): void => {
			clearTimeout(passiveAnnounceTimeout);
			passiveAnnounceTimeout = undefined;
		};
		const topicState: TopicState = {
			announce: async () => {
				if (states[rootTopic]?.token !== subscriptionToken) {
					return;
				}

				if (!topicState.isActive) {
					void send(client, rootTopic, {
						left: 0,
						numwant: requestedPeers,
						offers: [],
					});
					return;
				}

				let outstandingOffers: Record<
					string,
					OfferRecord & { createdAt: number }
				>;

				try {
					outstandingOffers = await ensureOutstandingOffers(
						rootTopic,
						getOffers,
						context?.config.offersPerAnnounce ?? defaultOffersPerAnnounce,
					);
				} catch (error) {
					if (states[rootTopic]?.token !== subscriptionToken) {
						return;
					}

					throw error;
				}

				if (
					states[rootTopic]?.token !== subscriptionToken ||
					!topicState.isActive
				) {
					return;
				}

				const offers = entries(outstandingOffers).map(([id, { offer }]) => ({
					offer_id: id,
					offer: { type: "offer", sdp: offer },
				}));

				void send(client, rootTopic, {
					numwant: requestedPeers,
					offers,
				});
			},
			announceMs: defaultAnnounceMs,
			handler: (data: TrackerMessage): void => {
				if (data.offer && data.peer_id && data.offer_id) {
					void onMessage(
						rootTopic,
						{
							offer: data.offer.sdp,
							offerId: data.offer_id,
							peerId: data.peer_id,
						},
						(_, signal) =>
							void send(client, rootTopic, {
								answer: {
									type: "answer",
									sdp: fromJson<{ answer: string }>(signal).answer,
								},
								offer_id: data.offer_id,
								to_peer_id: data.peer_id,
							}),
					);
				} else if (data.answer && data.offer_id && data.peer_id) {
					const offer = takeOutstandingOffer(rootTopic, data.offer_id, "claim");

					if (offer) {
						void onMessage(
							rootTopic,
							{
								answer: data.answer.sdp,
								offerId: data.offer_id,
								peerId: data.peer_id,
								peer: offer.peer,
							},
							() => {},
						);
						void topicState.announce();
					}
				}
			},
			isActive: !context?.isPassive,
			startPassiveAnnouncements: (): void => {
				stopPassiveAnnouncements();

				if (
					states[rootTopic]?.token !== subscriptionToken ||
					topicState.isActive
				) {
					return;
				}

				void topicState.announce();
				passiveAnnounceTimeout = setTimeout(
					topicState.startPassiveAnnouncements,
					Math.max(topicState.announceMs, dormantAnnounceMs),
				);
			},
			stopPassiveAnnouncements,
			token: subscriptionToken,
		};

		states[rootTopic] = topicState;

		if (!topicState.isActive) {
			topicState.startPassiveAnnouncements();
		}

		return () => {
			topicState.stopPassiveAnnouncements();
			roomSubscriberCounts[rootTopic] = Math.max(
				0,
				(roomSubscriberCounts[rootTopic] ?? 1) - 1,
			);

			if (!roomSubscriberCounts[rootTopic]) {
				delete roomSubscriberCounts[rootTopic];
				reclaimAllOutstandingOffers(rootTopic);
			}

			if (states[rootTopic]?.token === subscriptionToken) {
				void send(client, rootTopic, { event: "stopped", numwant: 0 });
				delete states[rootTopic];
			}
		};
	},

	announce: async (client, rootTopic) => {
		const state = topicStates.forRelay(client)[rootTopic];

		if (state) {
			state.stopPassiveAnnouncements();
			state.isActive = true;
			await state.announce();
		}

		const slot = announceSlots[client.url];
		return slot ? nextSlotMs(slot, Date.now()) : defaultAnnounceMs;
	},

	deactivate: (client, rootTopic) => {
		const state = topicStates.forRelay(client)[rootTopic];

		if (state) {
			state.isActive = false;
		}

		reclaimAllOutstandingOffers(rootTopic);

		state?.startPassiveAnnouncements();
	},
};

/** The tracker sockets by URL, for the evidence that each tracker is alive. */
export const getTrackerSockets = relayManager.getSockets;

/** Replaces the socket to a tracker now, after a network change or a long silence. */
export const reconnectTracker = (url: string): void =>
	clients[url]?.reconnect();
