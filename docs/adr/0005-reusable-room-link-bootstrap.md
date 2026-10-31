# ADR 0005: Reusable room links bootstrap an expired room

Status: accepted (2026-10-20). Amended 2026-10-27: the seat parameter is `pl`, the shared link carries no `pl`, and a page without `pl` reopens the remembered seat. Earlier link names (`selected_player`, `none`, long seat names, `host`, `bot_seats`, `bot_bidder`) are no longer read.
The page that seeds is amended by [ADR 0007](0007-host-priority-by-link-seat.md) (2026-10-25).

## Context

ADR 0004 stores table state in each player's browser and expires an idle table after 8 hours (24 hours until 2026-10-25).
The room URL already carries the four player names, the host seat, and the room key.
The player-specific URL carries `pl` with the player's seat, while the shared URL carries no `pl`.
The host needs to reopen a weekly room even when its local copy has expired or is missing.

## Decision

A complete room setup in the URL allows the page to clear its local expiry tombstone when it has no local replica.
The page shows all four seats from the URL while no host lobby is available.
The URL only finds the host: the host's lobby says which seats are free.
So the page offers the URL's seats only when it finds no host: after `NOBODY_MS` (10 s) with nobody, or 10 s of waiting for a host.
Before that, the URL's seats are disabled and say "waiting for the host".
Until 2026-10-26, the page offered the URL's seats at once, and a person could take a seat that the host had given to a bot.
A seated page seeds the local replica from the URL setup and starts hosting.
Until 2026-10-25, only the configured host seat seeded.
Now any seated page of the setup link can seed, but only the page first in the order of priority from the host seat (ADR 0007, election rule 14).
It seeds only after `SEED_WAIT_MS` (30 s) online without a host, and only `SEED_WAIT_MS` after the last host lobby and the last beat that shows the table (src/p2p/table.ts `#seedWhenAlone`).
A beat shows the table when it comes from a host or a claimer, when its page has entries, or when it reports a host seen within `HOST_LOST_MS` (20 s).
An older report does not show the table, because the only replica can be gone.
Since 2026-10-31, at the owner's request, a solo link seeds at once: when the link gives every other seat to a bot, no page on another seat can host the table.
It still does not seed while a host lobby or a beat shows the table.
So a page whose peers with the table all left does not wait for a host until a reload.
Until then, the seat waits for a host like any other seat.
Since 2026-10-31, at the owner's request, a browser keeps a host record for each table that it hosted, except a community table: the seat from which it hosted last, for 365 days (src/session.ts `HOST_MEMORY_TTL_MS`).
Expiry keeps the record.
When a page of this browser follows a host of another browser, the page removes the record; a host in another tab of this browser keeps it.
A page on the seat of the record seeds after `HOSTED_SEED_WAIT_MS` (5 s) online without a host, not after `SEED_WAIT_MS`.
The other conditions stay: no seed while a host lobby or a beat shows the table, and only the page first in the order of priority seeds (rule 14).
The owner proposed that the older table wins the merge.
The election keeps rule 13 instead: a fresh table has fewer entries than a running one, so the running table survives, and the clocks of two devices do not give a reliable order.
Other pages can select seats and wait for that host.
The table link carries no `pl`; a player's own URL keeps the player's seat for reload.
Without `pl`, a page reopens the seat that this browser remembers, so a shared link restores a player's seat after the tab closes. The earlier `selected_player=none` shared link is no longer read.
Since 2026-10-31, at the owner's request, a page without `pl` and without a remembered seat opens the only seat of a solo link, because nobody else can play it.
So a solo link that expired starts at once, although the expiry made the browser forget its seat.
Before the solo seat, such a page opens the seat of this browser's host record, so the browser that hosted a shared link gets its seat back after expiry.
A seat without a name (`player` or empty) stays free, so that the player gives a name when they take it.
Until 2026-10-26, it also did not take the last free seat.
Now, at the owner's request, it takes the only free seat of the host's lobby by itself, unless the lobby shows that this browser held that seat.
Before the host's lobby arrives, a page without `pl` waits for the lobby before it takes a free seat by itself.
The seat page lists all four seats.
A seat that the page cannot take is disabled and says why: the host's seat, a bot's seat, a seat in another tab of this browser, or a taken seat.
The seat page writes `pl`; the shared link never carries it. A seat-holding browser that opens the shared link therefore reopens its own seat, not the seat it was shared for (accepted 2026-10-27, to keep the shared link short).

## Consequences

The same room URL can start a fresh session after local expiry or data loss.
The fresh session loses the old board, scores, and seat claims.
The expired screen offers **Create new game**, and also **Restart this game** when the URL contains a complete room setup.
Restart reloads the same URL and uses the normal room discovery and bootstrap process for both solo and multiplayer games.
Bootstrap creates the configured local bot seat claims together with the human host, as the new-table form does.
The room key remains a bearer capability, so anyone with the link can select the host seat and bootstrap the room.
The existing trusted-player model and host-election tie-break govern simultaneous host attempts.
The host bootstrap requires persistent browser storage.

### Residual risk: a host-seat page that finds nobody in 30 s seeds a second table

History: on 2026-10-23 the owner, David Völgyes, accepted that a page on the setup's host seat seeded a fresh term-1 room at once, before the mesh opened.
On 2026-10-25 the owner reported a lost session: a new browser took the departed host's seat from the table link and seeded a second table.
In a reproduction (tests/e2e/host-seat-new-browser.spec.ts), the other three pages showed "superseded" within 10 s.
The seed now waits as the Decision describes.

A page that does not reach the other pages within `SEED_WAIT_MS` still seeds a second table.
A page whose peers with the table were silent for `SEED_WAIT_MS` also seeds one, and those peers can come back with the table.
A solo link on a second device of the same player seeds at once, so it seeds a second table when the first device still hosts and the two pages have not found each other yet.
Since 2026-10-31, this also applies to a solo link without `pl`, as on any browser that opens a shared solo link.
Such a page that loses the merge finds its seat taken and stays as a visitor.
Since 2026-10-31, a page on the seat of its host record seeds after 5 s, so it seeds a second table when its links come later.
The first links of a page can take about 20 s (src/p2p/limits.ts `SEED_WAIT_MS`).
The running table has more entries, so it survives, and the page loses only the entries of its fresh table (tests/unit/p2p-table-sim.test.ts).
Two browsers with a host record for the same table that have not found each other can both seed after 5 s, and the merge keeps one of the two fresh tables.
A user can write a host record into their own browser to get the 5 s wait, but the room key already lets anyone with the link seed the table.
The host records keep the ids of the hosted tables in localStorage for a year; `SeatMemory.prune` removes older records.
A table id is a hash of the room key, so a record does not give access to the table.
In a local reproduction, the second device found the host within 5 s, did not seed, and the first device kept hosting.
When the links of the two hosts name the same host seat, the table with more entries survives, then the table of the seat with the higher priority (ADR 0007, election rule 13).
Otherwise the election compares the two authorities (src/p2p/authority.ts `compareAuthority`): a higher term wins, and in term 1 the lower tag wins.
The group that loses can lose its entries since the split, as ADR 0004 describes for split groups.
The room key remains a bearer capability, so a player who wants to seed a second table can still do so.
A full fix would need a host proof, for example a host-only secret in the creator's link, and a security review before code.
This remaining risk has not been reviewed by the owner yet.
Review this decision if the trusted-player model changes or if a player reports a lost session after a setup link again.

## Alternatives Considered

- Keep expired rooms permanently expired and require a new room key each week.
  This preserves separation between sessions but requires the host to create and redistribute a new link.
- Keep a create screen without a room key as the reusable link.
  This avoids room revival but does not let players join the same waiting room from that link.
