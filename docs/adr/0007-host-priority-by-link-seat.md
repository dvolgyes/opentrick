# ADR 0007: Host priority by the link's host seat, and the merge of two tables

Status: accepted (2026-10-25).
Amends the host election of [ADR 0004](0004-p2p-table-elected-host.md) and the seed of [ADR 0005](0005-reusable-room-link-bootstrap.md).

## Context

Under ADR 0004 and ADR 0005, two groups of pages that do not see each other can each have a table.
For example, East and West form one table, and North and South form another.
When the groups meet, the authority tiebreak (higher term, then lower tag) chose the surviving table.
So a table with a real game could lose to a table with no entries, and the entries of the losing group were undone.
The owner asked on 2026-10-25 whether two tables can always become one.

Every setup link names a host seat (`h=` in the query, ADR 0005).
The owner proposed that this seat sets an order of priority, clockwise:

> If S is the host in the link, and W and N find each other, then W becomes the host.
> When S also joins, S becomes the host.

The owner made these choices on 2026-10-25:

- The surviving table of a merge: the table with more entries, then the table of the seat with the higher priority.
- The handover to a page with a higher priority: at once when it joins.
- The page that seeds a table that nobody has: the page with the highest priority.
- When the links name different host seats, the earlier rules apply.

## Decision

The order of priority starts at the link's host seat and goes clockwise in the order N, E, S, W.
With `h=S`, the order is S, W, N, E (`priorityOrder` in `src/p2p/election.ts`).
Each beat carries the host seat of its page's link (`pref`).
The rules below apply only between pages whose links name the same host seat.
A page whose link names another host seat, or none, follows the rules of ADR 0004.

- Volunteers: at an equal log position, the page with the higher priority has the better rank.
- Handover (election rule 12): a page that follows a host with a lower priority claims at once with a new term.
  It does so only when its replica has every entry that the host's beat shows on the same log line, and it pulls from that host first.
  A page whose replica is behind follows the host until it is synced.
- Merge (election rule 13): when two hosts have diverged logs, the table with more entries survives.
  At an equal number of entries, the table of the seat with the higher priority survives.
  The page of the surviving table claims a new term, and the pages of the other table replace their logs with its log.
- Seats after a merge: a host whose table does not bind a page's seat answers "unseated" when the seat is free, or when another browser holds it offline past `SEAT_GRACE_MS`.
  The page then claims its seat again as a visitor.
- Seed (election rule 14, `seedsFirst`): of the seated pages without a table, only the page with the highest priority seeds, after `SEED_WAIT_MS` without a host (ADR 0005).
  Such a page says `elig: true` in its beats while it has no entries and a persistent, writable replica, so that the pages after it wait.
  A page whose link names no host seat never seeds.
- A beat holds the seed back when it comes from a host or a claimer, when its page has entries, or when it reports a host seen within `HOST_LOST_MS`.
  An older report holds nothing back, because the only replica can be gone.

## Consequences

- Two tables of one setup link become one table when their pages meet, and a table with a real game survives a table with fewer entries.
- The entries of the smaller table since the split are undone, as before; its pages show "Undone after a host change".
- A player at a seat with a higher priority takes the host role when the player joins, also during a deal.
  The pages keep the log; only the host changes.
- Rule 14 needs that the pages see each other before `SEED_WAIT_MS`.
  A network split during that time can give two seeded tables, which rule 13 merges later.
- A merge needs a direct beat between the two hosts' groups, because host reports are not relayed (ADR 0004).
- Links that name different host seats get no handover and no merge by entries.
  The authority tiebreak of ADR 0004 then chooses the table, and a game can lose to a table with fewer entries.
- The four-controller simulation (`tests/unit/p2p-table-sim.test.ts`) and the election simulation (`tests/unit/p2p-election-sim.test.ts`) check these rules.
  An end-to-end test checks the owner's example (`tests/e2e/election.spec.ts`).

## Alternatives Considered

- **Keep the authority tiebreak for a merge.** It needs no new rule, but a table with a real game can lose to a table with no entries.
- **Merge by priority only.** It is simple, but a page at the host seat with an empty table would undo a game of the other group.
- **Hand over only between deals.** It avoids a host change during a deal, but the owner chose a handover at once.
- **Seed only from the link's host seat (the earlier ADR 0005 rule).** If that player did not come, nobody could start the table.
- **Count the follower beats without entries in `seedsFirst`.** It needs no new beat field, but a page that cannot seed (for example with memory storage only) would hold the seed back for ever.
