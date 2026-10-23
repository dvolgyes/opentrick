# Test results

Dates: 2026-10-19 (runs full1 to full5) and 2026-10-23 (runs full6 to full9).
This file records the tests of the peer-to-peer version (plan increments P0–P11, commits 1969c9e and later).

## Environment

| Item | Value |
| --- | --- |
| OS | Linux 7.2.10 (liquorix, amd64), one machine; Linux 7.2.11 for full6 to full9 |
| Browser | Google Chrome 155.0.8059.79, headless, through the Playwright `chrome` channel; Chrome 156.0.8078.47 for full6 to full9 |
| Test tools | Playwright 1.64.1 (one worker, no retries, traces off), Vitest 5.0.5, Node.js 22.22.1 |
| Site | Production build (`vite build`, Vite 8.3.4), served by `vite preview` on `http://localhost:4173`; the test harness page on `http://localhost:4174`; full6 used ports 4273 and 4274, and full7 to full9 ports 4373 and 4374 (`E2E_PORT`, `E2E_HARNESS_PORT`) |
| Discovery | Trystero 0.26.0 through the three default public WebTorrent trackers: `wss://tracker.openwebtorrent.com`, `wss://tracker.webtorrent.dev` and `wss://open.ftorrent.com`; from 718b51a, `@trystero-p2p/core` 0.26.0 with a copy of its torrent strategy in `src/p2p/torrent.ts` |
| STUN | The default `stun:stun.cloudflare.com:3478`; no TURN |
| Call media | Chrome's generated test devices (`--use-fake-device-for-media-stream`): a tone and a moving picture; each context gets only the permissions that its test needs |
| Machine load | Other jobs ran on the same machine; the load average was about 36 during the earlier runs, and about 2.4 at the end of run full4 |

Each simulated person has a separate browser context, so each has its own IndexedDB, localStorage and holder.
No browser test uses a fake network, a mock or a fake server for the table or the call (owner instruction, 2026-10-19).
Every browser test of the table and the call goes through the public trackers and real WebRTC links.
Two exceptions concern other services:

- `host-bots`, `mobile-controls`, `openrouter-key` and `phone` answer the bots' OpenRouter requests in the test (`page.route`), so no paid model runs; the table traffic of these specs is real.
- `mobile-layout` checks the compact auction style on markup that the test writes into the page, not on the page that the app renders.

## Browser suites

| Spec | Tests | What it checks |
| --- | --- | --- |
| `smoke` | 1 | One browser with four tabs: create, three seats from one link, ordered messages |
| `p2p-mesh` | 12 | Four pages form the full mesh, take seats and replicate commands; the table survives the host and three players leaving; a network change; a visitor whose first links fail; a latecomer whose first offers reach no page that answers; the presence rule; call signaling only from bound seats; the call status after a network change and a reload; a wrong key; the receive cap; an active sibling tab cannot be displaced; a failed seat claim |
| `acceptance` | 13 | One link; the lobby offers only free seats; ordered messages; a reload; an active seat cannot be taken from another tab; release of a silent seat; reopening the link; a host crash with a waiting message; all four browsers quit and reopen; a lost result is stored once; a second game |
| `seat-timeout` | 3 | A frozen player and a frozen host show offline, their seats free after the timeout, and the thawed tabs are superseded |
| `election` | 8 | The button at 10 s and the witness rule; a lone seat volunteers when a witness comes after 30 s; the automatic volunteer; two clicks in the same millisecond give one host; a reloading host resumes; a thawed old host steps down; a sibling tab cannot take the host's active seat |
| `resilience` | 6 | A tracker outage; a browser that blocks site data; a link of another version; a damaged key; expiry after 24 h |
| `reconnect` | 7 | Plan §12 R1 and R4 through the UI: crash and reload of a follower, a host crash mid-auction, dummy away during the play and a next board that waits for dummy, three players away while one stays, a frozen player |
| `bridge` | 7 | The six bridge flows; forced actions come from a modified tab |
| `call-audio` | 15 | Joining, the switches, Leave, cut links, the keyboard, reloads, four seats at once, a seat that stops hearing, a late microphone, rapid toggles, a vanished tab |
| `call-video` | 9 | The desktop and phone choosers, the camera preview, the tile states, a blocked camera and Cancel in its preview, video only where both sides agree, See cameras off, a phone next to camera senders, a desktop that becomes compact, the phone leaves |
| `call-lifecycle` | 9 | Forged call frames from a modified client and from a page without a seat, a holder change after a release, one player leaves, leaving the room during the call, a browser limited to relays, no address in any page or console message |
| `call-recovery` | 5 | Plan §12 R2: after a crash, a host change and a lost microphone permission, the call comes back with the same status |
| `layout` | 4 | The scaled Full HD room on desktop viewports, the compact table on phone viewports and in a narrow desktop window, the play controls of each seat, and the names and states of the call controls |
| `auto-seat` | 2 | The page that opens the link takes the last free seat, and the first board is dealt |
| `bookmark` | 5 | A saved room link prefills the create screen, seats the host, offers the other seats, and seats the host again after a reload |
| `host-bots` | 4 | Host bots play two boards from the auction to the last trick; the create page stores a key also without bot seats; a bot bids when the site is served below a path, as on GitHub Pages; a bidder switched to a bot acts at once |
| `mobile-controls` | 1 | On a phone, the host pauses the bots and changes the API key |
| `mobile-layout` | 1 | The compact auction fits the visible width |
| `openrouter-key` | 3 | Create and Save key check the key with one bid of the first model; a rejected key keeps the player on the create page, and a key without balance keeps the dialog open; without a key, no request is sent |
| `phone` | 2 | At 390×844 and at 360×800, the host plays West from a phone against three bots: the compact table has no horizontal scroll, every card of the own hand and of dummy has a width, and the phone declares a board through the bid box and plays its 13 cards and dummy's 13 cards |

Fourteen specs also check that no page reported an uncaught error; `layout`, `host-bots`, `mobile-controls`, `mobile-layout`, `openrouter-key` and `phone` do not.
In runs full1 to full5, the same specs also checked that no page sent a request to the old server-based backend; commit 3f1b07b removed that backend's code and this check.

### Runs

The P10 gate is two consecutive green runs of the full suite.
The suite had 100 tests up to commit 66b124b; commit 0e26b05 adds the `p2p-mesh` latecomer test, so runs full3 and later have 101.

| Run | Result | Duration |
| --- | --- | --- |
| full1 | Failed: 99 of 100 passed; the `p2p-mesh` call-status test expected a stored call record without its holder (a test defect, below) | 17.1 min |
| full2 | Failed: 95 passed, 2 failed, 3 did not run; `call-recovery` test 3 and the `seat-timeout` frozen-host test failed because a new page had no link for more than 45 s (a defect, fixed in 0e26b05, below); the later tests of those two serial specs did not run | 28.1 min |
| full3 | 101 of 101 passed, at commit 0e26b05 | 17.4 min |
| full4 | 101 of 101 passed, at commit 0e26b05 | 15.8 min |
| full5 | 101 of 101 passed, at commit e47be4b | 16.0 min |

Runs full3 and full4 meet the P10 gate.
Run full5 repeats the suite after the browser-test changes T1 to T4.
Its app code differs from 0e26b05 only by one comment and one `export` in `src/call/device-class.ts`.
In both runs, the `p2p-mesh` latecomer reached the lobby after 10.96 s with one rejoin, and the visitor whose first links fail after 31.1 s with two rejoins.
A scan of both run logs found no table key, no session description, no ICE candidate and no IP address.

The P9 gate was two consecutive green runs of the game specs (58 tests: `smoke`, `p2p-mesh`, `acceptance`, `seat-timeout`, `election`, `resilience`, `reconnect` and `bridge`):

| Run | Result | Duration |
| --- | --- | --- |
| gs1 | Failed: `bridge` test 2 (a test defect, below) and the `seat-timeout` frozen-host test | — |
| gs2 | Failed: `bridge` test 2 (the same test defect) | — |
| gs3 | 58 of 58 passed | 11.3 min |
| gs4 | 58 of 58 passed | 10.9 min |

On 2026-10-23, after the Supabase cleanup, the app fixes and the spec corrections below, the suite had 18 specs and 110 tests:

| Run | Result | Duration |
| --- | --- | --- |
| full6 | 110 of 110 passed, at commit 816eea7 | 20.1 min |
| full7 | 110 of 110 passed, at commit 39320dc (the Trystero app ID `github.com/dvolgyes/opentrick`) | 20.5 min |

Before full6, the specs that had changed passed alone: `call-video` 9 of 9 and `layout` 4 of 4.
Between full6 and full7, three full runs were stopped before their end, on the owner's request, because of a network issue and a collision with other processes on the machine; they are not counted.

After the compact phone table (fd42dcb), the suite has 19 specs and 112 tests:

| Run | Result | Duration |
| --- | --- | --- |
| full8 | Failed: 103 passed, 1 failed, 8 did not run, at commit 20b4409; `call-video` test 1 still expected the phone's video switches, which the compact call row does not have (a test defect, fixed in cf1fc36, below); the later tests of that serial spec did not run | 18.7 min |
| full9 | 112 of 112 passed, at commit cf1fc36 | 19.9 min |

Before full8, the specs that had changed passed alone: `phone` 2 of 2, `layout` 4 of 4, `mobile-controls` 1 of 1, `mobile-layout` 1 of 1 and `host-bots` 2 of 2.
`call-video` was not run alone before full8; after the fix in cf1fc36 it passed 9 of 9 alone.

During P10, each call and layout spec passed alone before the full runs: `call-audio` 15 of 15 (1.8 min), `call-video` 9 of 9 (1.5 min), `call-lifecycle` 9 of 9, `call-recovery` 5 of 5 and `layout` 4 of 4.

### Measurements

The owner asked on 2026-10-19 for a sender-side check of the pause: when a receiver turns off a medium, the partner's sender for that pair must stop, and its sender to a third seat must go on.
The probe measures the bytes that each sender sent in 2 s and maps each sender to its pair through the stream number (SSRC) that the receiving tab reports.
The figures are from run full1:

| Check | Paused pair | Other pairs |
| --- | --- | --- |
| `call-audio` test 10: South turns Hear others off | West's audio sender to South: no track, 0 bytes | West's senders to North and East: a track each, 5997 bytes each |
| `call-video` test 5: East turns See cameras off | North's video sender to East: no track, 0 bytes | North's video sender to West: a track, 35 551 bytes |

The tests assert the paused sender and one other sender; the table shows all measured senders.
In both tests the paused sender sends again after the receiver turns the switch on again.

In `call-audio` test 6 (run full1), the call came back 3816 ms after East's trackers returned.

## Fault injection

All faults are real events in real Chrome on the real network.
No test replaces a network, a server or a browser API with a stand-in.

- A crash: `page.close({ runBeforeUnload: false })`, so no unload handler runs; IndexedDB and localStorage stay.
- A frozen page: a CDP `Debugger.pause`.
  Headless Chrome reports every page as visible and ignores `Page.setWebLifecycleState` frozen (measured: a 200 ms timer kept firing), so the plan's freeze method (plan §9) was replaced.
- A tracker outage: the page's tracker WebSockets are closed and new ones are refused.
- A network change: the harness closes all WebRTC links and the tracker sockets of a page; Trystero opens the sockets again, and the page keeps its peer identifier.
- Cut game links: the game connections of one page are closed and its trackers are blocked for longer than 10 s; its call connections stay open.
- A failed first link: for a time, each new `RTCPeerConnection` of the page may use only relay candidates; there is no TURN server, so its ICE fails.
- Withheld offers: for 8 s after the first tracker socket of a browser context opens, its announces reach the trackers without their WebRTC offers, and the offers and answers that the trackers relay to it are dropped.
  This is a message filter on the real tracker sockets; it reads only which fields a message has, never a session description.
  It has the effect of offers that reach only pages that cannot answer, such as a frozen tab or a tab that left the table but keeps its tracker sockets.
- A relay-only call: the same limit for the call's connections only, so the game links stay direct.
- A late call answer: the probe delays the page's call messages by 4 s.
- Forged call frames: a harness page holds a seat and sends raw `opentrick-call` frames past the call signaling.
- A modified tab: the test enables a disabled control in the DOM and clicks it, so the page's own handler sends an action that the host must refuse.
- A browser that blocks site data: a Chrome profile with "Don't allow sites to save data".
- An old table: the stored table record is aged by 25 h.
  The plan moved the browser clock instead; aging the record tests the same expiry path.
- A lost microphone permission: `context.clearPermissions()`, then a reload, then `grantPermissions`.

## Defects found by these tests

| Commit | Defect | Evidence |
| --- | --- | --- |
| 68f2247 | The host engine never counted a quiet player as seen, and a page that became host mid-session saw every other seat as offline | The new presence checks (unit tests and `p2p-mesh`) |
| 82fb7e4 | A frozen page keeps its WebRTC link, so the roster listed it as present while the host refused its seat | Before the fix, a paused North stayed online for 15 s (run st3); after it, `seat-timeout` 3 of 3 and `acceptance` 13 of 13 passed |
| 95477c2 | A page without peers whose first WebRTC exchange failed stayed alone until the next tracker announce, up to 120 s | 2 of 11 failures in `smoke` and `p2p-mesh` after P8b; the new `p2p-mesh` case with `failLinksFor` passes |
| ef97574 | In a browser that blocks site data, `navigator.locks.query()` rejects with a `SecurityError`, and the page stayed at "Connecting" with a page error | `resilience` failed in run rs1 and passed 7 of 7 in run rs2 |
| 738caba | A denied microphone was announced as "Audio only" instead of "Mic off" | `call-audio` test 4 |
| 0e26b05 | A new page could stay without any link for more than 45 s: in `seat-timeout`, the latecomer's first offers went only to pages that cannot answer, and the trackers' next announce comes only after 120 s; in `call-recovery` test 3, the two pages of a seat pair kept their two-page rooms open at different times, because one side's retry wait continued after the other seat got a new page; the fix makes a page without links join the table room again after 10 s alone (then 20 s, 40 s, at most 60 s), and starts a seat pair again without a wait when the other seat has a new page | The two failures of run full2; the new `p2p-mesh` latecomer test failed 3 of 3 on the code before the fix (66b124b), each time with 3 trackers open and no link, and passed 3 of 3 with it, with the lobby after about 11.0 s and one rejoin; with the fix, `call-recovery`, `p2p-mesh` and `seat-timeout` passed 19 of 19, and `call-recovery` 15 of 15 (three repeats) |

The app defects below were found on 2026-10-23, when the specs were brought up to the current app:

| Commit | Defect | Evidence |
| --- | --- | --- |
| 6c8b272 | On desktop, dummy's cards in the top place did not take the declarer's click | A browser test in `tests/browser/table-mobile-play.test.ts` clicks dummy's card |
| cd27954 | A page that reopened at once after a crash was refused as superseded while the host still counted the crashed page | Unit tests of the follower, the host engine and the wire format; `acceptance` and `reconnect` close pages without unload handlers and open them again |
| 599f086 | A browser that reopened the table link waited for the seat grace time before it got its own seat back | Unit tests of the host engine, a browser test of the seat memory; `acceptance` (reopening the link) |
| c677977 | A page that hosted its own reopened seat later reported the seat as taken by another page (a regression from 599f086) | `seat-timeout` |
| fa962c8 | A joiner that took the host seat of the room setup seeded a second table although a host had answered, so the room split in two | `seat-timeout` test 2 |
| a0cd362 | After a reload outside the call, the call kept the old link and showed the seat as in the call | Unit tests of the call mesh; `call-audio` tests 8 and 13 (reloads) |
| 718b51a | One tracker announce carried one offer, so it could reach only one other seat; a page that left kept its stale offers at the trackers; a tracker message that was not JSON threw in the socket handler | `tests/unit/p2p-torrent.test.ts` and `tests/unit/p2p-mesh.test.ts`; the full runs |
| 592f14a | After a table expired, a browser kept its seat, so the room link seeded the table from that seat instead of offering the four seats | A browser test in `tests/browser/session.test.ts` ("forgets both seats of one room only") |
| 7a2a237 | Join with the camera switch on and a confirmed preview stayed outside the call without a message | A unit test in `tests/unit/call-controller.test.ts` failed before the fix and passes with it; `call-video` |
| 11ad1bf | Cancel in the camera preview left the player outside the call, so a player with a blocked camera had to change the switches and press Join again; Cancel now joins with the other switches | A browser test in `tests/browser/camera-setup.test.ts`; `call-video` test 3 failed at the Leave button before the change and passed with it (9 of 9) |
| 5601b41 | The create page stored the OpenRouter key only when a seat was a bot, so a key entered for later was lost | The new `host-bots` test failed before the fix (no stored key) and passed with it |
| 18c8506 | The bots loaded their prompts from the site root, so on GitHub Pages (`/opentrick/`) the prompt requests got 404 and no hosted bot could act | The new `host-bots` test that serves the site below a path failed before the fix and passed with it |
| fd42dcb | A phone showed the room as the scaled Full HD canvas; when the compact table was turned on, it rendered 19 px wide, the trump cards had no width, the language control covered its top bar, and the start page was 409 px wide in a 360 px window | The new `phone` spec failed before the fix (the hidden trump cards at 390×844; the start page at 360×800) and passed 2 of 2 with it; `layout` 4 of 4 |

## Test corrections and acceptance changes

Each change is recorded in its commit message.

- `p2p-mesh` (66b124b): since 12f49ce, the host stores the seat holder with each call record, but the call-status test still expected the record without it.
  The spec had not run since the P9 gate, so the stale expectation showed only in run full1.
  The test now expects East's own holder, which the harness reads from East's browser, in every replica and after East's reload.
- `bridge` (808d7d9): the reload check took its "before" snapshot while a page still waited for the previous seat's new page; it now waits until the roster shows four seats online.
  This was the `bridge` test 2 failure in gs1 and gs2.
- `bridge` (65c3b53): a forced revoke and a forced play of dummy's card come from the page itself; the reload check ignores the page's own notes of refused actions, because the host does not store a refused command.
- `election` (53cc409): the lone-seat case is now two cases, because the page volunteers as soon as a witness comes (rule 8).
- `resilience` (ef97574): the damaged-key case changes the first key character; the last one holds only 4 key bits, so changing it made the link invalid instead of naming another table.
- `reconnect` (b9b032c): a forced deal while a player is away stays waiting, as the presence rule specifies, instead of being refused.
- `smoke` (95477c2): the waits use the 45 s connection budget instead of 20 s.
- `call-audio` (8b525b9): the stored media records replace the database rows; a reload joins the call again from the stored status (plan §12 R2); with cut links, the call comes back when the links return, because the transport has no "lost" state.
- `call-video` (dcc15f7): the late answer comes from the probe's send delay instead of a delayed database request.
- `call-lifecycle` (14e8e6b): forged frames reach the browsers, and the receivers refuse them.
  A frame for another table or with its own sender seat cannot be sent, because the mesh stamps the table and the receiver takes the seat from the sender's binding.
  Back in the room after a navigation, the player rejoins the call with the stored status.
- `layout` (0e1f78d): the creator's default name is "player4", and a deal waits for all four seats.

Corrections of 2026-10-23, for an app that changed after the 2026-10-19 runs:

- All specs (abf3d06): calls go through the bid box, the first deal is automatic, a link with the room setup offers its four seats (ADR 0005), and the ports come from `E2E_PORT` and `E2E_HARNESS_PORT`.
  `mobile-controls` no longer checks the removed phone layout.
- `seat-timeout` (37868c9): a seat whose holder is offline frees after about 20 s (`SEAT_GRACE_MS`), not 3 min; the owner accepted the 20 s behavior.
- `bridge` and `reconnect` (416fc3a): the specs read the current table (the turn in the tab title, the contract in the sidebar, the scoring line and the statistics table) and use the desktop controls.
  Board 1 is dealt automatically, so the old `reconnect` test of a forced deal while a player is away has no control to click; its check that the deal waits for the absent player moved into the dummy test.
- `call-video` (816eea7): the tests confirm the camera preview; a blocked camera shows in the preview, which keeps "Send camera" disabled.
  Outside the call the switches are enabled and choose what Join starts with; a phone shows its video switches off and disabled.
- `layout` (816eea7): only the declarer on turn may claim, and only a seat that played a card may ask to undo; the card-label check scales the font metrics with the room canvas; the checks wait until the canvas scale follows a new viewport size.
- `call-video` (11ad1bf): in test 3, Cancel in the camera preview joins the call, so the test expects Leave instead of a second Join.
- `layout` and `mobile-controls` (fd42dcb): an acceptance change that the owner authorized on 2026-10-23, when the owner chose the compact table for phones.
  Before, a phone and a narrow desktop window had to show the scaled Full HD canvas.
  Now they must show the compact table without horizontal scroll, with the own hand, dummy and the bid box inside the window.
  The canvas fit is checked on four desktop viewports (1440×1080, 1920×1080, 2560×1080 and 1080×1920) instead of the phone viewports.
  The compact call row has no video switches, so the phone's camera switches are expected to be absent instead of disabled.
- `call-video` (cf1fc36): the same acceptance change.
  Test 1 expects the phone's audio switches and no video switches.
  Test 7 expects no video switches while the desktop window is 800 px wide; its checks that the camera stops within 1 s, that the audio goes on and that the video switches are off at 1280 px stay.
- `host-bots` (the commit that adds `openrouter-key`): Create now checks a saved key with one OpenRouter request.
  The test "the create page stores the OpenRouter key also when no seat is a bot" refused every OpenRouter request, so the check failed and Create stayed on the page.
  The test now answers that request with a valid bid; its checks of the stored key and of the key dialog stay.

## Unit tests

`npm test` (Vitest, also part of `pre-commit run --all`): 1231 of 1231 tests passed in 45 files, at commit e47be4b, 1351 of 1351 in 57 files, at commit 816eea7, and 1353 of 1353 in 58 files, at commit fd42dcb.

The unit tests check pure functions with real inputs: the link and identifier derivation, the validators, the election rules with a seeded simulation, the presence rule, the bridge rules and the view models.
Some older unit suites use in-memory stand-ins:

- `tests/unit/fake-mesh.ts`, an in-memory mesh, in the host-engine, follower, outbox, sync and replication-simulation tests;
- `tests/unit/call-fakes.ts` (call links) and `tests/unit/call-rtc-fakes.ts` (peer connections, tracks, transceivers and session descriptions) in the call peer, controller and mesh tests;
- a transport stand-in in `call-signaling.test.ts`.

They check logic only and are not evidence of network behavior.
No new test uses a stand-in.
On 2026-10-19 the owner asked to replace these suites with real browser and network tests.
Later that day the owner decided that these suites can stay if the software is shown to work on the real network.
The end-to-end suite gives this evidence (runs full3 to full5), within the limits in "Limits of this evidence" below, so the replacement stopped.
Replaced before that decision: the storage contract, the local log and the expiry failure now run in headless Chrome on its IndexedDB (`tests/browser`, Vitest browser mode).
The seat memory and the seat locks run on Chrome's `sessionStorage`, `localStorage` and `navigator.locks`.
Their faults are real: a cross-origin frame's storage gives `SecurityError`, a full `localStorage` gives `QuotaExceededError`, and another request steals a lock.
In Chrome, no fault was found that makes a Web Storage read fail in the page's own realm, so the read guards of `guardedStorage` are not tested.
The device class reads Chrome's window: the viewport changes the width, and DevTools emulation gives a mobile user agent and a touch-only pointer.
Chrome cannot turn its touch emulation off again, so this test file runs in a browser of its own (Vitest project `browser-touch`).
The local capture runs on Chrome's test microphone and camera.
A withdrawn permission ends the live track, and a refused permission gives "denied".
A Chrome without a test camera (Vitest project `browser-no-camera`) gives "failed".
The capture test passes each request to Chrome unchanged and keeps its promise, so it can check that a track that arrives too late is stopped.
The call controls hold real tracks from the test devices.
Chrome returns exactly one track of the requested kind, so the code that stops extra tracks and the failure for a stream without a track (`#captured` in `src/call/media.ts`) are not tested.
No trigger was found for a `SecurityError` from `getUserMedia` either.

## Limits of this evidence

- All browsers run on one machine, so the WebRTC links use host candidates, and STUN and NAT traversal are not exercised.
  The cross-network evidence is the discovery spike (ADR 0004; its code is no longer kept): an Android phone on 4G connected directly to a desktop, without TURN.
- No test switches a device from Wi-Fi to a cellular network.
  The network change in `p2p-mesh` closes the links and the tracker sockets of a page; a real switch also changes the IP address.
- Only headless Chrome on Linux was tested; there is no run with Firefox, Safari or a real phone for this version.
  The compact layout is tested with phone-size viewports, touch input and Chrome's mobile viewport emulation.
- A frozen page is simulated with a debugger pause, not with the freeze of a background tab or the suspension of an Android app.
- The call media are generated test devices.
- The public trackers are third-party services, so every run depends on them.
  No gate failure was traced to a tracker.
- The `seat-timeout` frozen-host test failed in gs1 and full2: the latecomer saw "Nobody is at this table right now" for 45 s.
  In full2, the page had all three trackers open, no link and no failed WebRTC exchange, so its offers had reached no page that answered; commit 0e26b05 fixes this case.
  The gs1 failure had the same symptom; its log does not show the cause.
- In `call-recovery` test 3 of full2, South and the new West page still had no link when the test's wait ended.
  Their seat-pair rooms were open at different times, which commit 0e26b05 fixes.
  The log does not show why the two-page room named by their peer identifiers did not connect them either.
  The Network panel now also counts the two-page rooms that connected a peer that the table room did not take, so a repeat would show this case.
- A rejoin drops the handshakes in progress in the room that the page leaves.
  So the `p2p-mesh` visitor whose first links fail now connects after 31.1 s through the rejoin instead of 25.1 s through a two-page room; the budget is 45 s.
- The address scan (`call-lifecycle` test 8) checks the text, the attributes, the field values and the console messages of the pages in that spec.
- Each run used one worker on a loaded machine; the durations are not performance measurements.
- The `phone` spec is unstable on a loaded machine.
  On 2026-10-23, at a load average of about 4, it failed 7 of 20 times at 18c8506, before the key check, and 6 of 20 times with the key check.
  Each failure counted 12 dummy cards and 14 own cards, although the board was complete.
  The cause is not yet found.
  Earlier that day, at a lower load, it failed once in about 23 runs and then passed 20 of 20.
