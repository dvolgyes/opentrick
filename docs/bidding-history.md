# Bidding history evidence

The auction uses the recorded bidding system for each call when the guide defines a meaning.
For selected uncontested natural suit auctions, it also shows a labeled common treatment when the guide is silent or when a two-over-one rebid depends on partnership agreements.
These references are explanations rather than rules for the bid recommender or the card sampler.
The actual partnership may use a different treatment.
Bot and unknown-origin calls have a separate warning because their agreement is not known.

The regression corpus in `tests/unit/tutorial-auctions.test.ts` contains 55 representative calls, checked under both HCP scales.
It inserts the opponents' passes and verifies that each full auction is legal before checking the meaning.
The sample covers opener rebids, responder rebids, two-over-one auctions, fourth-suit forcing, a game try, Stayman, and transfers.
The examples are selected teaching cases, not a random sample of games or a measure of overall bidding coverage.
The initial exploratory sample of 40 calls had 12 meanings in the original guide decoder.
The new corpus checks meanings and their qualifiers, but does not establish expert validation of the whole bidding system.

The following sources inform the common treatments:

- [Oren Lidor, Rebids](https://news.bridgebase.com/2022/10/14/rebids/) gives examples of minimum, invitational, game-going, and reverse rebids.
- [Karen Walker, Responding to an opening bid](https://www.kwbridge.com/responses.htm) describes responder rebids, preferences, raises, and notrump continuations.
- [Karen Walker, Responder's second bid](https://www.kwbridge.com/rebids2.htm) discusses fourth-suit forcing, opener rebids, and the difference between a preference and a fit.
- Richard Pavlicek's [opener rebids](https://rpbridge.net/2z29.htm) and [responder rebids](https://rpbridge.net/2z31.htm) describe natural continuations and treatment differences.
- The [Standard American Yellow Card booklet](https://www.fifthchar.ptbridge.net/pdfs/SAYC.pdf), pages 5–6, describes two-over-one continuations and answers to fourth-suit forcing.

The sources do not define identical systems or point ranges.
Common treatments therefore avoid exact point limits where they would imply an agreement not established by the auction.
The reference does not cover contested auctions, auctions with a previously passed responder, reverses followed by a responder rebid, or other unmodeled conventions.
An unsupported call remains without a common explanation instead of receiving a generic natural interpretation.
The app's explicit guide rules remain the basis for recommendations and card-play inference.
