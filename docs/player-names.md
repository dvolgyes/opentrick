# Player names and reconnect updates

Seats remain North, East, South, and West throughout a game.
A display name does not identify a browser, grant a seat, or enable a bot.

## Creation and joining

The creation and seating screens use a compass layout.
South is the default host for new games; an explicit host in a setup link takes precedence.
The creator supplies their own name.
Other names can be preassigned, left blank, or set to `player`.
Blank names and the exact word `player`, without regard to case or surrounding spaces, select self-naming on entry.
`player1` is an ordinary assigned name.

An entrant supplies a name before claiming a self-naming seat.
The form suggests the personal name stored under `opentrick.player-name` and lets the person edit it.
This preference has no application expiry.
Browser storage policies and clearing site data still apply.
The host's edits to room labels do not change another browser's personal preference.
Preassigned names are used directly.
A reconnect with an existing holder and generation resumes without another naming prompt.

## Host controls

Host controls contains a Player names editor.
The host can change a displayed name and choose whether each new occupant must supply a name.
The self-naming policy remains enabled after an occupant joins until the host changes it.
An exclusive bot seat also offers Open seat for a new player.
This sets the name to `player` before disabling the bot, so an arriving person must supply a name.
Autoplay for an existing human keeps that human's ownership and name.

Each edit carries the seat generation and name revision shown by the editor.
An intervening edit or replacement causes a refusal instead of overwriting a new occupant's name.

## Replication

The initial room configuration supplies initial labels.
Player profiles are projected from seat log entries and stored with the table record.
Profiles contain the name, the self-naming policy, and the revision of their last change.
A claim commits the supplied name and ownership in one entry.
A rename retains the holder, generation, and bridge state.
Releases clear self-naming labels back to `player`.
Snapshot replay reconstructs the profiles before a new host continues.

The controller supplies current labels to the UI, call participants, and game context.
New chat events capture the current author name; existing chat events keep their recorded author name.
Newly copied room links retain current fixed names and use `player` for self-naming seats.
Scores remain attached to their existing seats and partnerships.

Names are normalized to NFC, trimmed, and limited to 40 Unicode code points.
Control characters are refused.
Names reach text nodes and input values, never HTML sinks.

## Reconnect updates

Each new peer connection, including a reconnection, exchanges a `build-date` control message.
Its date is the Git committer date embedded by the build.
Only this date orders releases; the owner maintains time order on `main`.
Equal dates continue, while the older browser reloads itself from the current website.
The rule applies to hosts and guests.
It does not compare hashes, infer ancestry, or use browser clocks.

Before navigation the page stops its room, retains its seat identity, and drains pending command and log writes.
The cache-busting `update_to` parameter records the date requested, while the room key stays in the URL fragment.
The parameter is excluded from shared links.
If the website still serves an older build after the reload, the page offers a manual retry instead of looping.

## Verification

Unit checks cover ownership-preserving rename and replay, stale edits and claims, supplied and preassigned names, Unicode limits, personal preference persistence, date comparison, and pending outbox writes.
Browser checks cover explicit and automatic seating, editable name suggestions, reconnects, host renaming, bot replacement during an auction, phone layouts, and older hosts and guests reloading themselves.
Existing gameplay and theme tests use explicitly named West-host fixtures where those scenarios require West.
