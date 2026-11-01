# ADR 0009: The call media goes over the table's WebRTC connection

Status: accepted (2026-11-01).

## Context

Each page of a table has one WebRTC connection to each other page, with one data channel (Trystero, ADR 0004).
Before this decision, the call made a second `RTCPeerConnection` for each pair of seats in the call, with its own ICE, offers, answers and candidates.
The call messages carried them over the `opentrick-call` action.
A pair could have an open table channel while its call showed "Direct connection unavailable": the second connection needed its own ICE path, and on some networks it did not find one.
The owner asked on 2026-11-01 to move the media onto the table's connection.

The owner set these constraints on 2026-11-01:

- A community table still has no call.
- A room call that the host starts still invites every player.
- Each side chooses what it sends, independently of the other side: nothing, audio, video, or both.

These facts of Trystero 0.26 (`@trystero-p2p/core`) make the move possible:

- One connection per peer is shared by all rooms of a page, and `mesh.connection(peer)` gives it (src/p2p/mesh.ts).
- Trystero renegotiates by itself: on `negotiationneeded` it makes an offer, and the offer and the answer go over its own `@_signal` action on the data channel (`peer.mjs`, `room.mjs`).
  For colliding offers, the initiator ignores the other offer, and the other side rolls back its own.
- When Trystero cannot apply a description, the room closes that peer, so the game channel closes too.

## Decision

The call media goes over the table's connection to the seat's current holder (src/p2p/table.ts `callConnection`).
The call has no connection, ICE, offers, answers or candidates of its own; the call messages are only `join`, `resync`, `prefs` and `leave`.

- `PeerLink` (src/call/peer.ts) is the media of one remote seat on that connection.
  Only the impolite side adds the audio and video sections, so the two sides never add a section of the same kind.
  Both sides set the directions from the media plan of the pair (src/call/policy.ts `mediaPlan`), at the start, on each change, and when a remote offer arrives (`have-remote-offer`, before Trystero answers).
  A change of a direction fires `negotiationneeded`, and Trystero negotiates it.
- `close()` sets the sections inactive and removes the sender tracks, but keeps the connection, because it is the game link.
  The sections stay on the connection, and a later link to the same seat uses them again.
- A link belongs to the page (Trystero peer) that held the seat when the link started (src/call/call.ts `#createLink`).
  After a reconnection, the table has a new connection to that page, and `rebind()` moves the link to it.
  The link never moves to a later page at the seat, such as the page after a reload: that page did not join the call, and its browser would answer the media sections at once.
  Its own announcement starts a new link (a new session).
  Without a connection to its page, the link shows "reconnecting".
- When the link moves away from a connection, it releases that connection as `close()` does.
  Trystero keeps a connection open for about two minutes after the page leaves the room, and the media must not go on it.
- An offer of the link's connection that has no answer after 5 s on a connected connection is rolled back, and the link fires `negotiationneeded`, so Trystero offers again (src/call/peer.ts `OFFER_TIMEOUT_MS`).
  A Trystero room drops a signal from a peer whose handshake it has not finished (`@_signal` has no `receiveWhilePending`), so the first offer on a new table connection can be lost, and Trystero never sends it again.
  Chrome fires no new `negotiationneeded` after a rollback.
- The link is "connected" when the connection is connected and the audio section has a negotiated direction.
  A link that did not connect within the connect window shows "unavailable" until it connects.
  A refused change shows "unavailable" until Retry or a new connection.
- In Chrome, after a rolled-back offer that added video, the receiver track can stay muted while frames arrive.
  While the video receiver track is muted, the link reads the RTP timestamps of the receiver every 500 ms, and shows the picture when frames arrive.

## Consequences

- The call works whenever the game link works: it uses the same ICE path, and a call needs no new connection.
- The game data and the media share one transport.
  When the game link drops, the media stops too, and it comes back when the table reconnects and the link rebinds.
  When the mesh closes a silent game link (src/p2p/mesh.ts), the media of that pair also stops.
- A description that Trystero cannot apply closes the table peer, not only the call.
  An answer that arrives more than 5 s after its offer, or a lost answer, is such a description: after the rollback, the answer comes in `stable`, or the new offer has a new media ID that the other side refuses.
  An answer is not lost in the handshake race, because the side that got the offer has finished the handshake with the sender.
  The browser tests (tests/browser/call-peer-link.test.ts, tests/browser/call-shared-connection.test.ts) check that all 16 send combinations, and changes from both sides at the same time, negotiate on a real Trystero connection without an error.
- The polite side negotiates its own direction changes through Trystero; there is no rule that only one side offers.
- Our size limit for call descriptions no longer applies; Trystero's limit for its action payloads applies.
  The descriptions still travel only on the direct, DTLS-encrypted data channel of the bound peer, so the host cannot change them.
- A failed or lost connection shows "reconnecting", not "unavailable", because the table reconnects.
  The call has no ICE restart and no relay-only failure of its own.
- After a leave, an inactive section still has a negotiated direction, so the remote link of a lost `leave` message stays "connected" until the seat's call record or presence ends.
  Before, the closed connection made the remote link fail.
- A new link on a connection that already has an audio section is "connected" at once.
- The sections stay on a connection for its lifetime: at most one audio and one video section per pair.

## Alternatives Considered

- **Keep the separate call connection** (the state before).
  It keeps the media away from the game link, but it needs its own ICE path, and on some networks the call fails while the table works.
- **Open the separate call connection at once for each pair, and add the media later** (the owner's question of 2026-11-01).
  This hides the setup time, but the second ICE path can still fail, and every pair holds a second connection even without a call.
- **Trystero's `room.addTrack` and `room.removeTrack`.**
  They add and remove senders with `pc.addTrack` and `pc.removeTrack`, so each side adds its own sections, and the number of sections grows with each change.
  They give no control of the receiving direction, which a seat needs to stop the video or audio that it receives.
