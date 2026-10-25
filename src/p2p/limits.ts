/** Every timer and cap of the peer-to-peer table (plan §5). In-page timers use `performance.now()`. */

// Election (plan §4.4).
/** Every page sends a beat this often; a host, or a seat's peer, is offline after HOST_LOST_MS without one. */
export const BEAT_MS = 10_000;
export const HOST_LOST_MS = 20_000;
/**
 * A seat whose holder has been offline this long is free for any other browser (plan §4.6). A fixed limit, not a
 * setting. Covers a short WebRTC drop: Trystero reports a leave only after its 5 s disconnect timer, and a page that
 * returns is found again by re-announcement. A holder that stays connected but goes silent is offline after
 * HOST_LOST_MS, so its seat is free after about 20 s.
 */
export const SEAT_GRACE_MS = 15_000;
/**
 * A page whose seat the host still binds to an earlier page of this browser (a crashed or closed tab that the host
 * has not seen leave) says hello again this often, and for this long, before it counts as superseded. Trystero
 * reports a leave after its 5 s disconnect timer, once WebRTC sees the link down.
 */
export const HELLO_RETRY_MS = 2_000;
export const BUSY_WAIT_MS = 30_000;
export const BUTTON_MS = 10_000;
export const VOLUNTEER_MS = 30_000;
export const STAGGER_MS = 1_500;
export const CLAIM_PULL_MS = 3_000;
export const RESUME_ONLINE_MS = 3_000;
/** A timer tick this late means the tab was frozen; the absence clock starts again. */
export const LATE_TICK_MS = 5_000;
/** The controller steps the election at least this often. */
export const TICK_MS = 500;

// Connection checks and failure states (plan §4.9).
export const PING_COUNT = 3;
export const PING_TIMEOUT_MS = 5_000;
/** The host pings a player page that had no ping this long (src/p2p/round-trips.ts). */
export const ROUND_TRIP_IDLE_MS = 10_000;
/** Open pings of one page; a new ping drops the oldest. */
export const MAX_OPEN_PINGS = 16;
/** The longest round trip that a report carries. */
export const MAX_ROUND_TRIP_MS = 60_000;
export const NOBODY_MS = 10_000;
export const CONNECTION_FAILED_MS = 20_000;
export const MAX_PEERS = 12;

// Mesh repair (src/p2p/rendezvous.ts). Trackers re-announce a room only every 120 s, so a missing link is
// repaired in a two-page room, which connects during Trystero's first announces.
/** Each page sends its peer list this often, and at once when the list changes. */
export const LINKS_MS = 5_000;
/** A peer that a neighbour listed stays a repair target this long without a new list. */
export const LINK_TARGET_MS = 30_000;
/**
 * With the frequent connection checks (a setting), a visible and online page closes a link that sent nothing this
 * long (src/p2p/mesh.ts). Every page sends its peer list at least each LINKS_MS, so a working link is never silent
 * this long.
 */
export const SILENT_LINK_MS = 15_000;
/** The debug export keeps this many of the latest silent-link closes. */
export const MAX_SILENT_CLOSES = 16;
export const MAX_PAIR_ROOMS = 4;
export const PAIR_TIMEOUT_MS = 30_000;
export const PAIR_RETRY_MS = 30_000;
export const PAIR_RETRY_MAX_MS = 120_000;
/**
 * A page without links leaves and joins the table room again after this long alone, for a new offer and
 * Trystero's first announces: 10 s, doubling, at most 60 s. Each tracker sends an offer to a few peers only, and
 * they can be frozen pages or pages that left the room.
 */
export const REJOIN_MS = 10_000;
export const REJOIN_MAX_MS = 60_000;
/**
 * After a network change, a page alone joins the table room again as soon as a relay is open, until this long after
 * the change. Its old offers carry the addresses of the old network, and a broken data channel can take about 30 s
 * to close.
 */
export const NETWORK_REJOIN_MS = 60_000;
/**
 * A page shown again after this long hidden counts as a network change (src/p2p/network-watch.ts): the device can
 * sleep or change its network in that time. A shorter switch to another tab does not replace the relay sockets.
 */
export const RESUME_HIDDEN_MS = 30_000;
/** The browser can report one resume with several events; a resume within this time of the last one is the same. */
export const RESUME_COALESCE_MS = 5_000;
/**
 * An open tracker socket that sends nothing for this long is replaced: after a network change, a socket can look open
 * and never deliver again. The trackers asked for an announce every 120 s to 180 s in a live check (October 2026).
 */
export const RELAY_SILENT_MS = 240_000;
/**
 * An open Nostr relay socket that sends nothing for this long is replaced. A Nostr relay answers each announcement,
 * every 60 s. A relay that rests the page after a rate limit gets no announcement, so its silence does not count.
 */
export const NOSTR_SILENT_MS = 90_000;
/**
 * With the frequent relay checks on (Settings), a Nostr relay that sends nothing for this long gets a check
 * (src/p2p/relay-check.ts), and a relay that does not answer in RELAY_CHECK_ANSWER_MS is replaced.
 */
export const RELAY_CHECK_MS = 30_000;
export const RELAY_CHECK_ANSWER_MS = 10_000;
/**
 * Offers in each announce of the table room (src/p2p/torrent.ts). A tracker gives each offer to one peer, so a page
 * of a four-seat table reaches the other three in one announce, not one of them every 10 s. A pair room has two
 * pages and keeps Trystero's one offer.
 */
export const TABLE_OFFERS = 3;

// Discovery evidence (src/p2p/stun-probe.ts).
/** A STUN server that gave no public address in this time counts as not answering. */
export const STUN_PROBE_MS = 5_000;
/** A page without links asks the STUN servers again this often. */
export const STUN_RECHECK_MS = 60_000;

// Replication (plan §4.5).
export const ACK_DEBOUNCE_MS = 1_000;
export const GAP_WAIT_MS = 1_500;
export const SYNC_TIMEOUT_MS = 5_000;
export const ROSTER_COALESCE_MS = 1_000;
/** Visitors get the lobby again this often, because seats time out without a message. */
export const LOBBY_REFRESH_MS = 5_000;
export const RESULT_TIMEOUT_MS = 10_000;
/** A command that waits for absent players goes again this often, so it lands soon after they come back. */
export const WAITING_RETRY_MS = 2_000;
export const EARLY_ENTRIES = 64;

// Expiry (plan §4.7).
export const TABLE_IDLE_MS = 24 * 60 * 60 * 1_000;
export const CLEANUP_MS = 60_000;
export const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1_000;

// Trystero receive caps, checked before a message is buffered (plan §4.2).
export const MAX_RECEIVE_BYTES = 1024 * 1024;
export const CTL_BYTES = 8 * 1024;
export const LOG_BYTES = 256 * 1024;
export const CALL_BYTES = 64 * 1024;
export const MESH_BYTES = 2 * 1024;

// Field caps (plan §5). MAX_PAGE_BYTES bounds a whole sync page, including the state on its last page, so a page
// fits in LOG_BYTES; an entry message (payload, event and state) fits as well.
export const MAX_PAYLOAD_BYTES = 4_096;
export const MAX_EVENT_BYTES = 16 * 1024;
export const MAX_STATE_BYTES = 128 * 1024;
export const MAX_PAGE_ENTRIES = 200;
export const MAX_PAGE_BYTES = 192 * 1024;
export const MAX_REASON_LENGTH = 200;
/** The detail of a player's report; the whole report fits in CTL_BYTES. */
export const MAX_REPORT_BYTES = 6 * 1024;
export const MAX_PENDING_PER_SEAT = 50;
export const MAX_OUTBOX = 50;
export const MAX_LOG_ENTRIES = 20_000;
export const MAX_TERM = 2 ** 31 - 1;
/** Nesting depth of a payload, event or state; the bridge state uses about 6. */
export const MAX_JSON_DEPTH = 32;

// Rate limits (plan §5).
export const CTL_PER_SECOND = 50;
