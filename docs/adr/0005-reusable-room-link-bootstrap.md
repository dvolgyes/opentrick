# ADR 0005: Reusable room links bootstrap an expired room

Status: accepted (2026-10-20). Amended 2026-10-27: the seat parameter is `pl`, and a URL without `pl` takes no seat.
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
So a page whose peers with the table all left does not wait for a host until a reload.
Until then, the seat waits for a host like any other seat.
Other pages can select seats and wait for that host.
The table link carries no `pl`; a player's own URL keeps the player's seat for reload.
Without `pl`, a page does not reopen a seat that the browser remembers. This replaces the earlier rule, in which an absent `selected_player` reopened the remembered seat (amended 2026-10-27).
Until 2026-10-26, it also did not take the last free seat.
Now, at the owner's request, it takes the only free seat of the host's lobby by itself, unless the lobby shows that this browser held that seat.
Before the host's lobby arrives, a page without `pl` takes no seat by itself.
The seat page lists all four seats.
A seat that the page cannot take is disabled and says why: the host's seat, a bot's seat, a seat in another tab of this browser, or a taken seat.
The shared link and the seat page are the only places that set or clear `pl`; the seat of a page is never restored from the remembered seat by a missing `pl`.

## Consequences

The same room URL can start a fresh session after local expiry or data loss.
The fresh session loses the old board, scores, and seat claims.
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
