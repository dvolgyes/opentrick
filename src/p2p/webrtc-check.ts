import { WEBRTC_CHECK_MS } from "./limits";

/**
 * What this browser's WebRTC can do, for the Network panel: a browser can turn WebRTC off (an iPhone in Lockdown
 * Mode), hide its local addresses, or allow only some connections. The check connects two peer connections inside
 * the page, over the configured STUN servers, and sends one message over a data channel. It keeps the type,
 * protocol and address family of each local candidate, never the address.
 */
export type WebRtcReport =
	| { readonly kind: "missing" }
	| {
			readonly kind: "checked";
			/** Distinct labels such as "host IPv4", "host mDNS", "srflx IPv6" or "host IPv4 TCP", sorted. */
			readonly candidates: readonly string[];
			/** Whether the message crossed the data channel between the two connections. */
			readonly channel: "open" | "failed";
	  };

export type CheckWebRtc = () => Promise<WebRtcReport>;

/**
 * A check over the given WebRTC implementation, or undefined when the browser has none. It ends when the message
 * arrives and the first connection has gathered all its candidates, or after `timeoutMs`.
 */
export function webRtcCheck(
	Rtc: typeof RTCPeerConnection | undefined,
	configuration: RTCConfiguration,
	timeoutMs = WEBRTC_CHECK_MS,
): CheckWebRtc {
	return () => {
		if (typeof Rtc !== "function") return Promise.resolve({ kind: "missing" });
		return new Promise((resolve) => {
			const candidates = new Set<string>();
			const a = new Rtc(configuration);
			const b = new Rtc(configuration);
			let channel: "open" | "failed" = "failed";
			let gathered = false;
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				a.onicecandidate = null;
				b.onicecandidate = null;
				b.ondatachannel = null;
				a.close();
				b.close();
				resolve({
					kind: "checked",
					candidates: [...candidates].sort(),
					channel,
				});
			};
			const timer = setTimeout(finish, timeoutMs);
			const settled = () => {
				if (gathered && channel === "open") finish();
			};
			a.onicecandidate = ({ candidate }) => {
				if (candidate === null) {
					gathered = true;
					settled();
					return;
				}
				const label = candidateLabel(candidate.candidate);
				if (label !== undefined) candidates.add(label);
				b.addIceCandidate(candidate).catch(() => undefined);
			};
			b.onicecandidate = ({ candidate }) => {
				if (candidate !== null)
					a.addIceCandidate(candidate).catch(() => undefined);
			};
			b.ondatachannel = ({ channel: incoming }) => {
				incoming.onmessage = () => {
					channel = "open";
					settled();
				};
			};
			const outgoing = a.createDataChannel("check");
			outgoing.onopen = () => outgoing.send("check");
			void (async () => {
				const offer = await a.createOffer();
				await a.setLocalDescription(offer);
				await b.setRemoteDescription(offer);
				const answer = await b.createAnswer();
				await b.setLocalDescription(answer);
				await a.setRemoteDescription(answer);
			})().catch(finish);
		});
	};
}

/**
 * "host IPv4", "srflx IPv6", "host mDNS" or "relay IPv4 TCP" for one candidate line; the address only gives its
 * family. Undefined for a line in another form, such as the empty end-of-candidates line.
 */
export function candidateLabel(line: string): string | undefined {
	// candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> …
	const fields = line.replace(/^a=/, "").split(" ");
	const protocol = fields[2]?.toLowerCase();
	const address = fields[4];
	const type = fields[6] === "typ" ? fields[7] : undefined;
	if (protocol === undefined || address === undefined || type === undefined)
		return undefined;
	const family = address.endsWith(".local")
		? "mDNS"
		: address.includes(":")
			? "IPv6"
			: "IPv4";
	return `${type} ${family}${protocol === "tcp" ? " TCP" : ""}`;
}
