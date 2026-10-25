# ADR 0004: Peer-to-peer table with an elected host

Status: accepted (2026-10-19).
Room URL setup and post-expiry bootstrap are amended by [ADR 0005](0005-reusable-room-link-bootstrap.md).
The host election is amended by [ADR 0007](0007-host-priority-by-link-seat.md): the host seat of the setup link orders the pages, and two tables of one link merge.

## Context

The owner decided on 2026-10-19 that the app has no server of ours: the players find each other through public services, and the game and the call go over WebRTC.
The owner set these targets:

- The creator gets one link, and all players use the same link.
- A person who opens the link takes a free seat.
- If no host is found in 10 s, the page shows a **Make me the host** button.
- If two hosts show up, a tiebreak picks one.
- If there is no host after 30 s, a player volunteers automatically.
- Connection loss and reconnection are tested; one remaining player is enough to restore the table, including the call status.
- Moves and settings are versioned, so a resend never doubles a move and nothing goes missing.
- A game action needs all players present; dummy may be away during the play, but a new deal waits for dummy.

The trust model: the players do not cheat, and the link is the only key.
The P2P handover permits public WebTorrent trackers and public STUN servers, and forbids our own server, TURN and paid relays.
On 2026-10-25 the owner added public Nostr relays as a second discovery path, and later on the same day public MQTT brokers as a third.
For MQTT, the owner chose the mqtt.js client, because a client that many projects use was more important than the size of the bundle or the number of dependencies.
The owner required one connection for each pair of pages, also when more than one path finds the pair, and a quick recovery after a network change (Wi-Fi to mobile data and back).

A discovery spike gave this evidence (its code is no longer kept):

- Cold discovery through the public trackers: 22 of 22 trials in less than 0.4 s.
- Rediscovery after a reload: 0.3–0.6 s.
- A wrong password does not connect.
- Established links survive a tracker outage.
- An Android phone on 4G connected directly to a desktop without TURN.

## Decision

Link and identity:

- The link is `<page>#v=p2p-v1&k=<K>`, where K is 32 bytes from the platform CSPRNG in base64url.
  The fragment never reaches the web server, and the code never logs K.
- The table identifier is the first 22 characters of base64url(SHA-256("opentrick|table|" + K)).
  SHA-256 derives identifiers only; there is no custom cryptography.
- Each browser has a random client identifier per table in localStorage.
  Only the host receives it, and the host derives the seat holder from it, so a player cannot copy another player's holder from the roster.

Transport:

- Trystero 0.26.0 (`@trystero-p2p/core`, pinned exactly) joins one room per table through the public WebTorrent trackers, the public Nostr relays and the public MQTT brokers, with K as the room password.
  One Trystero strategy (`src/p2p/signaling.ts`) uses all three kinds of relay.
  A strategy has one peer manager, so a pair of pages that more than one kind finds gets one connection; a strategy for each kind would give each pair one connection for each kind.
  The torrent part is a copy of `@trystero-p2p/torrent` 0.26.0 in `src/p2p/torrent.ts`, under its MIT notice.
  The copy sends three offers in each announce of the table room instead of one, sends a "stopped" announce when a page leaves a room, and ignores tracker messages that are not well-formed.
  The Nostr part is a copy of `@trystero-p2p/nostr` 0.26.0 in `src/p2p/nostr.ts`, under its MIT notice.
  The copy ignores relay messages that are not well-formed and signs with `@noble/secp256k1` 3.2.0 (pinned exactly).
  It does not check the signatures of received events: each page signs with a new key, so a signature proves no identity, and the room password authenticates the offers.
  Both copies use one socket manager (`src/p2p/relay-socket.ts`), which the mesh can tell to replace a socket.
  The MQTT part is a copy of `@trystero-p2p/mqtt` 0.26.0 in `src/p2p/mqtt.ts`, under its MIT notice, over mqtt.js 5.16.0 (pinned exactly).
  The client uses MQTT 3.1.1 at QoS 0 over the browser's WebSocket, also in Node (the bot), with a random client identifier and no credentials, and it keeps no session on the broker.
  The copy waits a random time below a period that doubles from 3.3 s to 60 s before it connects again, as the socket manager does, and the mesh can tell it to replace a socket.
  The Nostr and MQTT copies share the topic mapping of the core (`src/p2p/topic-mapping.ts`), which the core does not export.
  An upgrade of Trystero merges the upstream strategies into the copies by hand.
  The relays see only topic hashes that Trystero derives from the app name and the table identifier, the clients' IP addresses and encrypted session descriptions.
- The default relays (`src/p2p/config.ts`) are the servers that passed every live check: four trackers that relayed an offer between two sockets, five Nostr relays that passed an ephemeral event between two sockets, and three MQTT brokers.
  The owner asked for the three best free public MQTT brokers.
  The defaults are the free public brokers of three different operators (EMQX, HiveMQ and Coreflux), so that one operator's outage leaves two brokers.
  Each one passed a message between two mqtt.js clients in Node and answered a connect from Chrome, in 3 of 3 trials (October 2026).
  EMQX answered in about 0.4 s, Coreflux in about 0.1 s and HiveMQ in 1 s to 5 s.
  `broker-cn.emqx.io` and `mqtt-dashboard.com` also passed, but they belong to the same operators as two of the defaults.
  `test.mosquitto.org`, `mqtt.eclipseprojects.io`, `public.mqtthq.com` and `broker.mqttgo.io` did not connect, and other brokers needed credentials.
  Two Chrome pages that used only the EMQX and HiveMQ brokers connected in about 2 s, in 3 of 3 trials.
  `VITE_TRACKER_URLS`, `VITE_NOSTR_RELAY_URLS`, `VITE_MQTT_BROKER_URLS` and `VITE_STUN_URLS` replace a list, and the value `none` turns a list off, so a test can use one kind of relay only.
  A URL can be in one relay list only, and each list has at most 8 URLs.
  The mesh diagnostics record, for each relay and STUN server, whether it is open and when it last answered.
- The pages form a full mesh of WebRTC data channels.
  Four actions carry all traffic: `opentrick-ctl` (control, 8 KiB), `opentrick-log` (log replication, 256 KiB), `opentrick-call` (call signaling, 64 KiB) and `opentrick-mesh` (peer lists for the mesh repair, 2 KiB).
  Every received message passes a validator before any use.
- Mesh repair (a deviation from one room per page): a tracker sends each announce to a few peers and repeats it only every 120 s, so in a room of four pages a link can stay missing for minutes.
  Two pages that miss each other join a Trystero room for only the two of them, which connects during the first announces.
  The pair is named by two peer identifiers (a neighbour listed the other peer, or the first WebRTC exchange failed) or by two seats (a seated page misses the page of another held seat).
  The pair room name is a SHA-256 hash of K and the pair name, so only key holders can name it.
  Trystero shares one connection per peer between the rooms of a page, so the table room attaches to the new connection, and the page then leaves the pair room.
  A pair room without a link closes after 30 s, and the next one opens after 30 s, doubling up to 120 s.
  When the roster binds the other seat to a new page, the seat pair starts again without the wait, so both pages are in the room at the same time.
  No connection detail is stored.
- Rejoin (also a deviation): a page without any link has no neighbour list and, as a visitor, no seat pair.
  After 10 s alone with a relay open, it leaves the table room and joins it again with the same peer identifier, which makes a new offer and repeats Trystero's first announces; the wait doubles up to 60 s.
  The trackers send each offer to a few pages only, and they can be pages that cannot answer: a frozen tab, or a tab that left the room but keeps its tracker sockets.
  A rejoin drops the handshakes in progress in the room that the page leaves.
- Recovery after a network change: the mesh, not Trystero, reconnects the relays.
  When the browser reports a network change (the `online` event, or a change of the Network Information API), the page replaces every relay socket at once, without the reconnect wait.
  A resumed page counts as a network change too: a page shown again after 30 s or more hidden, a page restored from the back-forward cache, or a page resumed after a freeze, because a phone can sleep or change its network in that time.
  For the next 60 s, a page without links rejoins the table room as soon as a relay is open, without the 10 s wait, because its old offers carry the addresses of the old network.
  A relay socket that looks open but sends nothing for too long is replaced, because after a network change a socket can stay half-open.
  The limit is 90 s for a Nostr relay, which answers each announcement (every 60 s), and 240 s for a tracker, which asked for an announce every 120 s to 180 s in a live check (October 2026).
  The limit is 90 s for an MQTT broker too, which sends each announcement of the page back to it.
  mqtt.js also pings a broker that sent no answer for 30 s and closes the socket after 45 s without an answer, so a dead MQTT socket is usually replaced before that limit.
  A Nostr relay that rate-limits the page gets no announcement for a time, so its silence counts only from the end of that rest.
- Frequent relay checks (a setting, off by default, for an unstable network): every page, host or guest, checks each open Nostr relay that sent nothing for 30 s.
  The check asks for one event with a random ID, which cannot exist, so a live relay answers at once with EOSE; the page then closes the subscription.
  A relay that does not answer in 10 s, and sends nothing else in that time, gets a new socket, so a dead socket is found after about 40 s instead of 90 s.
  A relay that refuses a check (CLOSED) is not checked again while the page is open, and a relay that rests the page gets no check.
  Trackers get no check: the tracker protocol has no request that does not announce the page.
  MQTT brokers get no check, because the keepalive pings of mqtt.js already find a dead socket.
  In a live check (October 2026), the five default Nostr relays answered the check in 32–115 ms.
- Silent links (the same setting, owner decision, October 2026): any message from a peer shows that its link works, and every page sends its peer list to each peer every 5 s.
  A visible and online page closes the link of a peer that sent nothing for 15 s, and only that link.
  Both pages then see the peer leave, and the link repair connects them again; the dropped page also counts as away for the presence rule until then.
  After a tick 5 s late, the silence counts again from that tick, because this page was paused, not its peers.
  The debug export lists the latest 16 closes (`network.silentCloses`: the peer, the time, how long it was silent).
  With the setting off, only WebRTC and Trystero close a link (about 5 s after ICE reports it down), and a peer that stays connected but silent is offline after 20 s without a beat.
- The ICE servers are only the configured STUN servers (`VITE_STUN_URLS`); TURN URLs are refused.

State:

- Every seated browser keeps a full replica of the table in IndexedDB: the config, the log of entries, the latest state and the seats.
- The host orders the commands.
  Each log entry has a sequence number and the authority (term, tag, incarnation) of the host that wrote it.
  A follower applies only the next entry whose previous authority matches its own last entry, and fills a gap with a sync request, never with a resend.
- A guest command goes into the IndexedDB outbox before it is sent and keeps its identifier on every resend; the host deduplicates by that identifier.
- Each seat's call status (in the call, the four switches, the device form) is a versioned record in the replicated state.
  The page sends it as a command through the outbox, like a move; the host keeps it only when its version is higher than the stored one, and stores the seat holder with it.
  After a reload or a crash, a page restores only a record of its own holder, once.
  It joins the call on its own only when the browser already allows every device that the record sends; otherwise it offers "Rejoin the call".
- A table expires 8 hours after its last activity on each device; a tombstone keeps an expired link expired for 30 days.
  Until 2026-10-25 the limit was 24 hours; one session at a table is shorter than 8 hours.

Host election (a pure reducer, `src/p2p/election.ts`):

- Every page sends a beat every 10 s; a host counts as offline 20 s after its last beat.
- A follower's beat reports its host and how long ago it heard that host.
  A page counts such a report only while that time plus the age of the beat is less than 20 s.
  A page that hears its host sends its beat at once, so a report is at most about one beat period old.
- The button shows after 10 s without a host.
  It is enabled only when the page holds a seat, stores the table in IndexedDB, and a **witness** is connected: another browser at the table.
- At 30 s plus 1.5 s per rank, an eligible page with a witness volunteers automatically.
  The page with the best copy of the log has the first rank.
- A new host takes a term one above every term it knows, pulls a strictly better log from a connected peer first, and then stores its claim.
- Tiebreak: the higher term wins; for equal terms, the lower tag (holder and seat) wins; for equal tags, the higher incarnation wins.
  The entries of the losing host that the winner does not have are undone, and their senders see "Undone after a host change".
- The creator hosts term 1 at once, and a host that reloads resumes its own term without a witness.
- Between pages whose links name the same host seat, ADR 0007 adds rules before the tiebreak: the order of priority from that seat, the handover to a page with a higher priority (rule 12), the merge of two tables by entries and then priority (rule 13), and the page that seeds (rule 14).

Presence (owner requirement R4):

- A seat is present when its page is bound at the current seat generation, is connected to the host, and the host heard from it in the last 20 s, or when it is the host's own seat.
  The 20 s rule is necessary because a frozen page keeps its WebRTC link.
- The first deal needs all four seats (a bot seat is present).
  After it, a deal, a bid or a card needs no other seat: only the seat to act sends a bid or a card, so the others play on while a player who is not to act is away, and the game stops only while the seat to act is away (owner decision, October 2026; before it, a deal and a bid needed all four seats and a card all seats except dummy).
  The host checks the first deal in the bridge module and refuses with a reason such as "Waiting for South to come back"; the page disables the controls and shows the same text, and it shows that text too while the seat to act is away.
- A page that comes back gets every entry that it missed from the host's log (the welcome and the sync), so it shows the whole table again.

Call signaling:

- Call messages go over the `opentrick-call` data channel action to the peer bound to the target seat, never through a tracker or a database.
- The receiver takes the sender seat and generation from the host's roster binding of the sending peer, never from the message.
  A message from an unbound peer or an old generation is dropped.
- During a host change, the call keeps the last roster that it had, so the call between the remaining seats goes on.
- The consent rules of the call/layout handover apply: a receiver can ask its partner not to send video or audio, and the partner then sends no track for that pair.
- There is no call presence (a deliberate deviation from the call/layout handover).
  The `join` and `resync` messages give discovery, and a peer that stays offline at its generation leaves the call.
  Do not add call presence without a new decision.

## Consequences

- There is no server and no database: the app is a static site that needs only HTTPS hosting.
  No call message is stored anywhere.
- Every seated browser stores all four hands; a player can read them with the developer tools.
- Peers see each other's IP addresses (WebRTC), and the trackers, Nostr relays and MQTT brokers see the IP addresses of the clients that join.
- An outage of all trackers, all Nostr relays and all MQTT brokers blocks new joins; the connected pages continue.
  A network that blocks one or two kinds of relay leaves the other kinds.
- A relay can send forged Nostr events, MQTT messages or tracker messages; they cannot connect without the room password, but they can cost a page work.
- The browser bundle of mqtt.js (`dist/mqtt.esm.js`, with its own Buffer and stream code) adds about 100 KiB (gzip) to the main chunk of the page, from 188 KiB to 290 KiB (October 2026).
- A tracker that asks for an announce interval above 240 s gets its socket replaced once per silent period.
- With the frequent relay checks on, a page sends at most one extra request and one CLOSE to each Nostr relay per 30 s of silence; a relay that applies a stricter rate limit can refuse them, and the page then stops the checks of that relay.
- Without TURN, a player without a direct path to the host cannot act.
- Residual risks of the election, accepted by the owner as the default D1:
  - Two browsers cut off together, or one browser and a newcomer, can start a new term.
    When the groups meet again, the entries of the losing group since the split are undone.
    Few entries are at risk, because the deal and the auction need all four seats.
  - Peers more than two links apart can each see a different host, because host reports are not relayed.
- A browser that refuses to store data can take a seat and play with a memory replica, but it cannot create a table or become the host.
- After expiry or loss of every local replica, the room link can seed a fresh session from the setup values; the old game state is not restored (ADR 0005).
- A device clock change moves that device's local expiry.
- Updates of Trystero are manual.

## Alternatives Considered

- **A hosted realtime backend for discovery only.** Proven, but it keeps a hosted dependency, its quotas and stored call messages, which the owner wanted to avoid.
- **One Trystero room for each kind of relay.** Simple, but each strategy has its own peer manager, so a pair that more than one kind finds gets one connection for each kind, which an e2e mutation check showed.
- **The unchanged `@trystero-p2p/nostr` package.** It keeps its own sockets, which the mesh cannot replace after a network change, and it passes relay messages on without a shape check.
- **The unchanged `@trystero-p2p/mqtt` package.** It is a strategy of its own, so it gives each pair a second connection, and it connects again after a fixed second, also when a broker refuses the page.
- **An MQTT 3.1.1 client of our own over the WebSocket.** The page needs only a few packet types, and the bundle would be smaller, but the owner preferred mqtt.js, which many projects use.
- **Three private invite links and a fixed host (the handover's design).** No election, but the owner asked for one shared link and an automatic host.
- **A majority vote for a new host.** Safer against split groups, but a table with two connected players could never continue; the owner accepted one witness (D3).
- **Store the last connection's details and try them first after a reconnection.** Session descriptions and ICE candidates contain IP addresses, which the project does not store, and a network change makes them stale.
  The seat-pair rooms and the rejoin of a page without links reconnect pages during the first tracker announces, without stored details.
- **Seat-specific projections of the state.** They would hide the other hands, but every seated browser must hold the full state to become the host.
