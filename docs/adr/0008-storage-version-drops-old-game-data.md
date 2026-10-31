# ADR 0008: A storage version drops the game data of an older build

Status: accepted (2026-10-31).

## Context

The stored tables carry `PROTOCOL_VERSION` in their state, and the messages carry `WIRE_VERSION`.
An older page reloads when a peer reports a newer build (src/p2p/table.ts, `build-date`).
But the page checks only the structure of a stored table when it loads it (src/p2p/storage.ts `parseReplica`), not the version of its state.
After a raise of `PROTOCOL_VERSION`, a stored table of the older build stays, and the new build rejects every command on it ("room state is not a bridge table", src/game/bridge.ts) until the table expires.
On 2026-10-31, the owner asked for a version in local storage: when the stored version is not the version of the page, the page drops the local data and stores the new version.

The owner made these choices on 2026-10-31:

- The page drops only the game data, and keeps the name, the language and the settings.
- A browser without a stored version keeps its data at the first rollout.
- Each raise of the version ends the running tables. They cannot continue across the versions.

## Decision

`STORAGE_VERSION` (src/p2p/storage.ts) is the version of the stored game data, and also the IndexedDB version.
Raise it when a build cannot use the stored data of the build before.
At the start, the page compares the version in localStorage (`opentrick.storage-version`) with `STORAGE_VERSION` (src/storage-version.ts `dropOldGameData`).
A missing version counts as 1, the version of all builds before the key.
An unreadable version counts as older.
When the stored version is lower, the page removes the game data from localStorage and sessionStorage: the client ids, the seat memory, the host records, the tab seats, and the community rooms and transfers.
Then it stores `STORAGE_VERSION`.
A stored version that is higher stays, and the page removes nothing.
When the page opens IndexedDB at a higher version, the upgrade deletes the stores of the older version and creates them again.

## Consequences

The first page of a new storage version in a browser starts without tables, tombstones, seats or community progress.
The pages of a running table reload to the new build within seconds, so a raise ends the running tables.
A setup link starts its room again (ADR 0005); the game progress is lost.
An open page of the older build loses its IndexedDB connection on the version change, and it cannot open the database again (`VersionError`), so it cannot store old tables after the drop.
It can still write small localStorage records, such as a seat; their readers validate them.
Because a higher stored version stays, two tabs of different builds, or a rollback, do not drop the data again and again.
A rollback to an older storage version finds IndexedDB at a higher version (`VersionError`), so its pages keep their tables only in memory until the browser data is cleared (src/main.ts `openStorage`).

## Alternatives Considered

- Drop all local data, as first proposed.
  This also removes the name, the language and the settings, which do not depend on the protocol.
- Drop when the versions are not equal.
  Two tabs of different builds, or a rollback, would drop each other's data at each load.
- Treat a missing version as older.
  The first rollout would end every running table, although the stored data of today is version 1.
- Check the version of each stored table state and drop only the tables that do not match.
  This keeps the other data, but each stored format needs its own check, and the old pages can still write old tables.
