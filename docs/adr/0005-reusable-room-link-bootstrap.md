# ADR 0005: Reusable room links bootstrap an expired room

Status: accepted (2026-10-20).

## Context

ADR 0004 stores table state in each player's browser and expires an idle table after 24 hours.
The room URL already carries the four player names, the host seat, and the room key.
The player-specific URL carries `selected_player` with the player's seat, while the shared URL carries `selected_player=none`.
The host needs to reopen a weekly room even when its local copy has expired or is missing.

## Decision

A complete room setup in the URL allows the page to clear its local expiry tombstone when it has no local replica.
The page shows all four seats while no host lobby is available.
When a page selects the configured host seat, it seeds the local replica from the URL setup and starts hosting.
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

### Accepted residual risk: a start link can seed the host seat early

Status: accepted (2026-10-23) by the owner, David Völgyes, who owns this risk.

A player URL whose `selected_player` is the host seat passes that seat as `preferredSeat` (src/ui/join.ts `claimHint` and `open`).
On a device without a local replica of the room, `TableController.start` seeds a fresh term-1 room before the mesh opens (src/p2p/table.ts `start` and `#seedHost`).
The page does not wait for a lobby from a host that already runs the room on another device.
The election then compares the two authorities (src/p2p/authority.ts `compareAuthority`): a higher term wins, and in term 1 the lower tag wins.
Inference, not tested: when the running room is still in term 1 and the seeded page wins the tag comparison, the running group can lose its entries since the split, as ADR 0004 describes for split groups.
The owner chose no code change, because the room key is already a bearer capability and the players are trusted (see Consequences above).
A fix would need a host proof, for example a host-only secret in the creator's link, and a security review before code.
Review this decision if the trusted-player model changes or if a player reports a lost session after a start link.

## Alternatives Considered

- Keep expired rooms permanently expired and require a new room key each week.
  This preserves separation between sessions but requires the host to create and redistribute a new link.
- Keep a create screen without a room key as the reusable link.
  This avoids room revival but does not let players join the same waiting room from that link.
