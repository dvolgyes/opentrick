# OpenTrick

OpenTrick is a free, four-player contract bridge game for your browser.
Play on a computer or phone; no account is required.

**[Play OpenTrick](https://dvolgyes.github.io/opentrick/)**

![The OpenTrick opening page, with options to play with bots, invite friends, or find online players.](docs/images/home.png)

## Start a game

Enter an optional display name, then choose how to play:

- **Play with bots** starts a solo game with three bots.
- **Invite friends** lets you choose seats and fill the remaining seats with friends, bots, or online players.
  Create the table and send the invitation link to your friends.
- **Find online players** matches you with other people waiting for a game.

To join a friend's table, open the invitation link they send you.
The full link contains the key to the table, so share it only with people you want to invite.

## At the table

OpenTrick deals the cards, guides bidding and play, and keeps duplicate scores.
It supports undo requests, claims, and autoplay for a player who needs a break.
In solo games, select **Next board** when you are ready, or enable automatic advance in Settings.
On a phone or tablet, tap each bidding control once.
Select **Confirm** if your bidding settings require it.

![A bridge table on desktop during play, showing the hands, a played card, contract, and trick count.](docs/images/gameplay-desktop.jpg)

<img src="docs/images/gameplay-mobile.png" width="320" alt="The compact phone table during an auction, showing the bidding history, bid box, and player's hand.">

Private games support optional audio and video calls.
Select **Join call** to review what you send and receive, then confirm.
The same dialog opens when another player invites you.
The browser requests access only for devices you choose to send; listening does not require microphone access.
If you select the camera, review its preview and select **Send camera** to share it.
If access is denied, you can join without that device or allow it in this site's browser settings.
**Tap to hear the call** cannot grant microphone or camera access.
If the browser blocks incoming sound, select **Tap to hear the call** once for all callers.
To disconnect, confirm **Leave call**; **Stay in call** leaves the call unchanged.
Muting your last device does not hang up, and reloading the game does not restart capture without confirmation.
If you reload with all four switches off, **Rejoin the call** lets you choose which media to enable.
The camera preview and player tiles fit the whole video frame without stretching it.
Use **Settings → Network → Outgoing video quality** to save a quality level for this browser.
**Low** (the default) asks for the lowest available full-frame resolution; **Normal** targets up to 480p, and **High** targets 720p.
The camera and connection can limit the actual resolution.
The call closes after five minutes without another participant, even if other players are at the table.
Calls are currently disabled in community games.
Network quality bars appear inside each opponent’s tile, above the name.
All participants must take a seat; there is no spectator mode.

## Settings and bots

Use **Settings** to change the language, appearance, card sizes, bidding confirmation, animations, and bot timing.
You can also choose the displayed hand point count and the bot bidding engine.
Select **Save settings** to apply changes during a game and keep them for the next visit in the same browser.
Select **Cancel** to discard edits before saving.
If the browser cannot save a change, Settings stays open and shows an error.
On a phone or tablet, one tap plays a legal card without a card flight.
Trick collection has a separate animation setting.
Under **Settings → Gameplay → Browser reduced motion request**, the status shows what the browser requests, not which animations you have enabled.
**Requested** appears in red; **not requested** appears in green, including when the browser does not support the preference.
With **respected** (the default), a request keeps played cards, completed tricks, and the bot picture still.
With **override**, the game ignores the request and uses your individual animation settings.
The bot engine shown at a table is shared.
Only the host can change it from Settings.
The bidding reference is a guide for players; it does not explain every call made by a learned bot.

Bots run in the browser without an account or API key.
Their bidding policies and card-play engine are described in the [bidding engine guide](docs/bidding-engine.md) and [card engine guide](docs/card-engine.md).

## Connections and privacy

OpenTrick is a static site with no game server or database.
Browsers use public discovery services to find one another and exchange game data over WebRTC.
Game state is stored in the players' browsers, and reopening a link in the same browser can restore a session.
Clearing site data removes locally saved recovery information.

Each seated browser receives the full bridge state, so the game is not cheat-resistant.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=dvolgyes/opentrick&type=Date)](https://star-history.com/#dvolgyes/opentrick&Date)

## License

OpenTrick is all rights reserved, with free access to the hosted game.
The source code and original assets are not licensed for reuse or independent hosting; see [LICENSE](LICENSE).
Third-party components retain their own licenses, listed in the [component inventory](public/licenses/components.json).
