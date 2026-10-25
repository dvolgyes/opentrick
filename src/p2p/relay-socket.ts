/*
 * The relay WebSocket of the tracker and Nostr strategies, after `makeSocket` of Trystero 0.26.0
 * (@trystero-p2p/core, src/utils.ts in its source map). The changes from upstream:
 *
 * - `reconnect()` replaces the socket at once and starts the retry wait again. A page that moves from Wi-Fi to a
 *   mobile network can keep a socket that looks open and never delivers again; upstream can only wait for its
 *   close, and then for a retry wait of up to 60 s.
 * - The retry wait belongs to the client, not to a table of all URLs in the module.
 * - The core's offline pause does not apply; the mesh calls `reconnect()` when the network comes back.
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

import type { SocketClient } from "@trystero-p2p/core";

const FIRST_RETRY_MS = 3_333;
const MAX_RETRY_MS = 60_000;
const OPEN = 1;

export interface RelayClient extends SocketClient {
	ready: Promise<RelayClient>;
	isClosed: boolean;
	close: () => void;
	/** Replaces the socket now; a closed client stays closed. */
	reconnect: () => void;
}

/**
 * A socket to `url` that opens again after each close, after a random wait below a period that doubles from
 * FIRST_RETRY_MS to MAX_RETRY_MS and starts again at each open. `onReconnect` runs at each open after the first.
 */
export function relaySocket(
	url: string,
	onMessage: (data: string) => void,
	onReconnect: () => void,
): RelayClient {
	let retryMs = FIRST_RETRY_MS;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let didOpen = false;
	let resolveReady: (client: RelayClient) => void = () => {};
	const ready = new Promise<RelayClient>((resolve) => {
		resolveReady = resolve;
	});

	const open = (): WebSocket => {
		retryTimer = undefined;
		const socket = new WebSocket(url);
		// A replaced socket's events reach nothing.
		socket.onclose = () => {
			if (client.isClosed || client.socket !== socket) return;
			retryTimer = setTimeout(() => {
				client.socket = open();
			}, Math.random() * retryMs);
			retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
		};
		socket.onmessage = (event) => {
			if (client.socket === socket) onMessage(String(event.data));
		};
		socket.onopen = () => {
			if (client.socket !== socket) return;
			retryMs = FIRST_RETRY_MS;
			const isReconnect = didOpen;
			didOpen = true;
			resolveReady(client);
			if (isReconnect) onReconnect();
		};
		return socket;
	};

	const client: RelayClient = {
		url,
		ready,
		isClosed: false,
		socket: undefined as unknown as WebSocket,
		send: (data) => {
			if (client.socket.readyState === OPEN) client.socket.send(data);
		},
		close: () => {
			client.isClosed = true;
			clearTimeout(retryTimer);
			retryTimer = undefined;
			client.socket.close();
		},
		reconnect: () => {
			if (client.isClosed) return;
			clearTimeout(retryTimer);
			const old = client.socket;
			retryMs = FIRST_RETRY_MS;
			client.socket = open();
			old.close();
		},
	};
	client.socket = open();
	return client;
}
