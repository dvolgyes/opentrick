# ADR 0005: Reusable room links bootstrap an expired room

Status: accepted (2026-10-20).

## Context

ADR 0004 stores table state in each player's browser and expires an idle table after 8 hours (24 hours until 2026-10-25).
The room URL already carries the four player names, the host seat, and the room key.
The player-specific URL carries `selected_player` with the player's seat, while the shared URL carries `selected_player=none`.
The host needs to reopen a weekly room even when its local copy has expired or is missing.

## Decision

A complete room setup in the URL allows the page to clear its local expiry tombstone when it has no local replica.
The page shows all four seats while no host lobby is available.
When a page selects the configured host seat, it seeds the local replica from the URL setup and starts hosting.
It seeds only after `SEED_WAIT_MS` (30 s) online without a host, and only `SEED_WAIT_MS` after the last beat with an authority or with entries and the last host lobby (src/p2p/table.ts `#seedWhenAlone`).
So a page whose peers with the table all left does not wait for a host until a reload.
Until then, the seat waits for a host like any other seat.
Other pages can select seats and wait for that host.
The table link carries `selected_player=none`; a player's own URL keeps the player's seat for reload.
With `none`, a page takes no seat by itself: it does not reopen a seat that the browser remembers, and it does not take the last free seat.
Without `selected_player`, a page reopens the remembered seat of this browser.

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
The election then compares the two authorities (src/p2p/authority.ts `compareAuthority`): a higher term wins, and in term 1 the lower tag wins.
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
