# Bidding guide reference: sources, example hands, and open questions

This document compares the in-game bidding guide (`src/guides/milton_en.txt` and `milton_corrected_en.txt`) with published Standard American material.
It collects example hands with the calls that the sources recommend and the calls that the guide engine (`conventionCalls` in `src/bridge/conventions.ts`) gives.
The examples can become unit tests for the convention checker and material for tutorial games.
The guide was not changed for this document.
The open questions at the end need a decision before any rule changes.

State of the guide: the working tree on 2026-10-31, which includes the new responses to [1NT] (transfers, Stayman, [2S] minor transfer, notrump raises).

## Sources

| Key | Source | Kind |
| --- | --- | --- |
| SAYC | ACBL SAYC System Booklet ([ACBL copy](https://web2.acbl.org/documentLibrary/play/sayc_book.pdf), read from the [copy at bridge-tips.co.il](https://bridge-tips.co.il/wp-content/uploads/2012/05/Standard-American-Yellow-Card-SAYC.pdf), which has no revision date) | System definition |
| SAYC-1988 | ACBL SAYC booklet, revised September 1988, [copy at sao.ru](https://www.sao.ru/hq/dim/bridge/biddings/natural/bridgebsysyellowcard.html). | Older system definition |
| LC-1NT | Larry Cohen, [1NT](https://www.larryco.com/bridge-articles/1nt). | Expert article |
| LC-JT | Larry Cohen, [Jacoby transfer](https://www.larryco.com/bridge-articles/jacoby-transfer). | Expert article with hands |
| LC-MIN | Larry Cohen, [Showing a minor after partner's 1NT](https://larryco.com/bridge-articles/showing-a-minor-after-partners-1nt). | Expert article with hands |
| LC-MT | Larry Cohen, [Should I transfer (with a minor)?](https://www.larryco.com/bridge-articles/should-i-transfer-with-a-minor). | Expert article with hands |
| BB-ST | BridgeBum, [Stayman](https://www.bridgebum.com/stayman.php). | Convention reference with deals |
| BB-JT | BridgeBum, [Jacoby transfers](https://www.bridgebum.com/jacoby_transfers.php). | Convention reference with deals |
| BB-MST | BridgeBum, [Minor suit transfers](https://www.bridgebum.com/minor_suit_transfers.php). | Convention reference |

Larry Cohen's articles are the main expert teaching source here.
BridgeBum is a widely used reference, but it is not a system authority.
The examples marked "constructed" are hands that I made to test one SAYC rule; the call comes from the SAYC text, not from a published hand.

The sources disagree with each other on the minor-suit responses to [1NT]:
SAYC uses [2S] as a relay to [3C] for a weak hand with a long minor.
Cohen and BridgeBum use [2S] as a transfer to clubs and [2NT] as a transfer to diamonds.
The guide follows the SAYC relay.

## How to read the examples

A hand is written as `spades.hearts.diamonds.clubs` with `T` for the ten and `-` for a void, as the `hand()` helper in `tests/unit/conventions.test.ts` reads it.
An auction lists the calls before the bidder's call, starting with the dealer; for example `1NT P` means that partner opened [1NT] and the right-hand opponent passed.
"HCP" and "corrected" are the two point systems of the guide; each column shows the points and the guide's calls.
When the guide gives two or more calls, all of them fit the hand.

Verdicts:

- AGREE: the guide gives the source's call.
- SAME CONTRACT: the guide uses another route to the same final contract, because it uses other conventions.
- DIFFERENT: the guide gives another call.
- MISSING: the guide does not describe the position.

## Rules compared

### Opening bids

| Topic | Guide | Sources | Verdict |
| --- | --- | --- | --- |
| Five-card majors, higher of two five-card suits | Yes | SAYC: yes | AGREE |
| Minor with 4-4 / 3-3 | [1D] with 4-4, [1C] with 3-3 | SAYC: same; 4-4-3-2 with both majors opens [1D] | AGREE |
| One of a suit, points | 12–21 | SAYC: no explicit minimum; opener's rebid ranges start at 13 | Question Q11 |
| [1NT] | 15–17, at most one doubleton | SAYC: 15–17 HCP, may hold a five-card major or minor | AGREE |
| [2NT], [3NT] | 20–21, 25–27 | SAYC: same | AGREE |
| [2C] | 22 or more; [2NT] rebid with 22–24 balanced | SAYC: 22+ or the playing equivalent; [2NT] rebid 22–24 | AGREE |
| Weak two | 5–11, six-card suit with two of A K Q or three of A K Q J T, no four-card side major | SAYC: 5–11 HCP, six-card suit of reasonable quality, normally no four-card side major | AGREE; the guide is stricter on suit quality |
| Preempt at three | 5–10, seven-card suit | SAYC: no explicit range | AGREE |

### Responses to one of a suit

| Topic | Guide | Sources | Verdict |
| --- | --- | --- | --- |
| Single major raise | 6–9, three cards | SAYC: 6–10 dummy points, three cards | Small range difference (Q8) |
| Limit raise | 10–12, three cards | SAYC: 10–12 dummy points, three cards | AGREE |
| [1NT] response | 6–9 | SAYC: 6–10, not forcing | DIFFERENT (Q8) |
| New suit at two | 10 or more | SAYC: 11 or more, four or more cards | DIFFERENT (Q8) |
| Minor raises | Not described | SAYC: four cards to raise [1D], five to raise [1C]; limit raise | MISSING (Q9) |
| Jacoby [2NT] over a major | Not described | SAYC: game-forcing raise, 13+ dummy points | MISSING (Q10) |
| [2NT] / [3NT] over a minor | Not described | SAYC: 13–15 game forcing / 16–17 | MISSING (Q10) |
| [3NT] over a major | Not described | SAYC: 15–17 balanced, two-card support | MISSING (Q10) |
| Preemptive raise to four of a major | Not described | SAYC: usually 5+ trumps, a singleton or void, fewer than 10 HCP | MISSING (Q10) |
| Jump shift | Not described | SAYC: strong, invites slam | MISSING (Q10) |

### Opener's rebid

| Topic | Guide | Sources | Verdict |
| --- | --- | --- | --- |
| Ranges | 12–14 / 15–17 / 18–21 | SAYC: 13–16 / 17–18 / 19–22 | DIFFERENT (Q11) |
| Game try after a single raise | [3H] with 15–17 | SAYC: not described; a jump raise is 17–18 | DIFFERENT range |
| Reverse | Not described | SAYC: a reverse shows a medium hand (17–18) | MISSING |

### Responses to [1NT]

| Topic | Guide | Sources | Verdict |
| --- | --- | --- | --- |
| Transfers [2D] / [2H] | Five or more cards, any points | SAYC, LC-JT: same; LC-JT: with 0 points too | AGREE |
| Transfer with 5-4 in the majors | Transfer first ("A transfer comes before Stayman") | SAYC: with exactly four cards in the other major, use Stayman, not a transfer; LC-JT and BB-JT: Stayman with game-invitational or better values | DIFFERENT (Q2) |
| 5-5 in the majors | Transfer to spades with equal length | LC-JT: game-forcing 5-5 transfers to spades, then bids [3H]; BB-JT and SAYC: invitational 5-5 transfers to hearts, then bids [2S] (not forcing) | AGREE for game force, DIFFERENT for invitation (Q3) |
| Super-accept | Not described | SAYC: jump to three of the major with 17 points and four-card support; BB-JT: same | MISSING (Q4) |
| Stayman | 8 or more with a four-card major | SAYC: usually 8+ HCP; also a weak hand that passes any answer, such as 4-4-4-1 with a club singleton; BB-ST: usually not with 4333 | AGREE in the main case; garbage Stayman and the 4333 exception MISSING (Q5) |
| Answers to Stayman | [2D] none, [2H] four hearts (maybe four spades), [2S] four spades | SAYC, BB-ST: same | AGREE |
| [2S] | Relay to [3C], 0–7 with five or more cards in a minor | SAYC: relay to [3C] for a club or diamond "bust", length not stated; LC-MIN and LC-MT: transfer only with six or more cards, pass a weak 5-3-3-2 | DIFFERENT on length (Q1) |
| [2NT] | 8–9, no four-card major, invitational | SAYC: does not list a direct [2NT]; LC-MIN: invite in notrump with a five-card minor, but many partnerships use [2NT] as a transfer to diamonds | AGREE |
| [3NT] | 10–15, no four-card major | SAYC: to play; LC-MT: also with a long minor that you do not want as trumps | AGREE |
| [4NT] | 16–17, invites [6NT] | SAYC: "A direct raise of 1NT to 4NT is natural and invites 6NT." | AGREE |
| [6NT] / [7NT] | 18–21 / 22+ | Partnership targets 33 / 37 | AGREE |
| [3C] / [3D] | Not described | SAYC: invitational to [3NT] with six or more cards | MISSING (Q6) |
| [3H] / [3S] | Not described | SAYC: six or more cards and slam interest | MISSING (Q6) |
| [4C] Gerber | Not described | SAYC: Gerber over any [1NT] or [2NT] | MISSING (Q6) |
| Responder's second call after a transfer or Stayman | Not described | SAYC, LC-JT, BB-ST, BB-JT: Pass, [2NT] / three of the major invitational, new suit game forcing, [3NT] choice of games, four of the major to play | MISSING (Q5) |
| After a double of [1NT] | The same responses | SAYC: "If the opponents double, all conventional responses are on." | AGREE |
| After an overcall of [1NT] | Not described | SAYC: Stayman and transfers are off; a cuebid replaces Stayman | AGREE that the transfers are off; natural bids MISSING |

### Other positions

| Topic | Guide | Sources | Verdict |
| --- | --- | --- | --- |
| Responses to [2C] | [2D] waiting 0–7; suit 8+ with a good five-card suit; [2NT] 8+ balanced | SAYC: [2D] artificial, can be waiting with a good hand; suit 8+ game forcing; [2NT] balanced 8 HCP | AGREE |
| [2NT] over a weak two | 15 or more, asks | SAYC: forcing; opener rebids the suit with 5–8, shows a feature (A or K) with a maximum, or bids [3NT] without one | Opener's answer MISSING (Q7) |
| Raise of a weak two | To make the auction harder | SAYC: to play, can be preemptive | AGREE |
| New suit over a weak two | Not described | SAYC: forcing one round, five or more cards | MISSING (Q7) |
| Overcalls | One level 8–16; two level 10–16 | SAYC: 8–16 | AGREE |
| [1NT] overcall | 15–18, stopper | SAYC: 15–18, preferably a stopper | AGREE |
| Takeout double | 12+, short, support; or 17+ | SAYC: takeout up to [4D]; responses described | AGREE; advancer MISSING |
| Negative double | Not described | SAYC: through [2S], four cards in an unbid major | MISSING (Q10) |
| Michaels, unusual [2NT] | Not described | SAYC: both are part of the system | MISSING |
| Redouble | 10 or more | SAYC: 10+ | AGREE |
| Blackwood | [5C] 0 or 4, [5D] 1, [5H] 2, [5S] 3 | SAYC: same | AGREE |

## Example hands

Each row was run through `conventionCalls` with the guide in the working tree.

### Responses to [1NT], published hands

| ID | Hand | Auction | Source call | HCP | Corrected | Verdict | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | `542.J4.J65.J8764` | `1NT P` | P ("never" transfer with a flat 5-3-3-2) | 3: 2S | 2: 2S | DIFFERENT (Q1) | LC-MIN |
| C2 | `32.2.J765432.652` | `1NT P` | Transfer to diamonds, then play [3D] | 1: 2S | 1: 2S | SAME CONTRACT | LC-MIN |
| C3 | `KT76.43.2.AQJ765` | `1NT P` | 2C (Stayman), then [3C] if no spade fit | 10: 2C | 11: 2C | AGREE | LC-MIN |
| C4 | `J4.Q7.AQT765.J32` | `1NT P` | 3NT | 10: 3NT | 10: 3NT | AGREE | LC-MIN |
| C5 | `K32.K2.KQJT9.654` | `1NT P` | 3NT | 12: 3NT | 13: 3NT | AGREE | LC-MIN |
| C6 | `Q6.J76.765.Q8765` | `1NT P` | P | 5: 2S | 5: 2S | DIFFERENT (Q1) | LC-MT |
| C7 | `KJ.542.AQ875.Q54` | `1NT P` | 3NT | 12: 3NT | 11: 3NT | AGREE | LC-MT |
| C8 | `J4.J3.K32.KQJ765` | `1NT P` | 3NT | 11: 3NT | 10: 3NT | AGREE | LC-MT |
| C9 | `3.654.QJT965.543` | `1NT P` | Transfer to diamonds, play [3D] | 3: 2S | 4: 2S | SAME CONTRACT | LC-MT |
| C10 | `6.765.43.J765432` | `1NT P` | Transfer to clubs, play [3C] | 1: 2S | 1: 2S | SAME CONTRACT | LC-MT |
| C11 | `K2.AJ7.KJ9765.K3` | `1NT P` | Transfer to diamonds, then [3NT] (mild slam interest) | 15: 3NT | 15: 3NT | DIFFERENT (Q6) | LC-MT |
| C12 | `Q5.KQ8.K2.AJT765` | `1NT P` | Transfer to clubs, then [3NT] (mild slam interest) | 15: 3NT | 16: 4NT | DIFFERENT (Q6) | LC-MT |
| C13 | `54.32.65.AKJ9765` | `1NT P` | 3NT (do not transfer) | 8: 2NT | 9: 2NT | DIFFERENT | LC-MT |
| C14 | `-.J6.QT76.AKJ7654` | `1NT P` | Transfer to clubs, then show the shortness | 11: 3NT | 11: 3NT | DIFFERENT (Q6) | LC-MT |
| C15 | `K42.5.AJ9654.A93` | `1NT P` | Transfer to diamonds, then show the shortness | 12: 3NT | 12: 3NT | DIFFERENT (Q6) | LC-MT |
| J1 | `987643.43.97.982` | `1NT P` | 2H (transfer with 0 points) | 0: 2H | 0: 2H | AGREE | LC-JT |
| J2 | `5432.5432.65432.-` | `1NT P` | 2C (weak Stayman, pass any answer) | 0: 2S | 3: 2S | DIFFERENT (Q5) | LC-JT |
| S1R | `AJ5.QT52.A5.9763` | `1NT P` | 2C, then [4H] over [2H] | 11: 2C | 11: 2C | AGREE | BB-ST |
| S2R | `AJ85.Q5.Q652.976` | `1NT P` | 2C, then [2NT] over [2H] | 9: 2C | 9: 2C | AGREE | BB-ST |
| S3R | `Q965.AK543.Q6.T9` | `1NT P` | 2C, then [3H] over [2D] (5-4, game forcing) | 11: 2D | 13: 2D | DIFFERENT (Q2) | BB-ST |
| S4R | `Q9.KT.QT9.AKT982` | `1NT P` | 2C, then [3C] over [2H] (six clubs, game forcing) | 14: 3NT | 15: 3NT | DIFFERENT (Q6) | BB-ST |
| T1R | `972.QJ932.K5.654` | `1NT P` | 2D, then pass | 6: 2D | 6: 2D | AGREE | BB-JT |
| T2R | `KQ832.Q8.T875.92` | `1NT P` | 2H, then [4S] after the super-accept | 7: 2H | 9: 2H | AGREE on the first call | BB-JT |
| T3R | `AJT52.QT954.9.76` | `1NT P` | 2D, then [2S] (5-5, invitational) | 7: 2H | 11: 2H | DIFFERENT (Q3) | BB-JT |
| T4R | `J9543.J754.A3.QJ` | `1NT P` | 2C, then [2S] over [2D] (5-4, invitational) | 9: 2H | 10: 2H | DIFFERENT (Q2) | BB-JT |

### The [1NT] opener's answers, published hands

| ID | Hand | Auction | Source call | HCP | Corrected | Verdict | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1O | `KT93.AKJ3.J8.A52` | `1NT P 2C P` | 2H (both majors) | 16: 2H | 15: 2H | AGREE | BB-ST |
| S3O | `KJ2.QT7.AK97.A64` | `1NT P 2C P` | 2D | 17: 2D | 16: 2D | AGREE | BB-ST |
| S4O | `K52.AQ97.AK54.76` | `1NT P 2C P` | 2H | 16: 2H | 16: 2H | AGREE | BB-ST |
| T1O | `AJT.K76.QT74.AK3` | `1NT P 2D P` | 2H | 17: 2H | 16: 2H | AGREE | BB-JT |
| T2O | `AJT5.K432.A9.AJ7` | `1NT P 2H P` | 3S (super-accept: 17 points, four spades) | 17: 2S | 17: 2S | DIFFERENT (Q4) | BB-JT |

The source deals pair these hands: S1O with S1R, S3O with S3R, S4O with S4R, T1O with T1R, and T2O with T2R.
The sources give two hands of each deal; a tutorial game needs the two opponents' hands as well.

### Constructed hands for other SAYC rules

| ID | Hand | Auction | SAYC call | HCP | Corrected | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| O1 | `K4.AQJ63.K72.Q85` | (opening) | 1NT or 1H (1NT may hold a five-card major) | 15: 1NT | 16: 1NT | AGREE |
| O2 | `K5.Q43.AJ63.KJ84` | (opening) | 1D (4-4 minors) | 14: 1D | 14: 1D | AGREE |
| O3 | `AJ74.KQ63.K52.83` | (opening) | 1D (4-4-3-2) | 13: 1D | 13: 1D | AGREE |
| O4 | `AJ74.K863.Q5.KJ3` | (opening) | 1C (3-3 or longer clubs) | 14: 1C | 14: 1C | AGREE |
| O5 | `AQ874.KQ853.5.32` | (opening) | No SAYC minimum; many teachers open 1S | 11: P | 14: 1S | Q11 |
| O6 | `KQJ974.85.762.83` | (opening) | 2S | 6: P, 2S | 7: P, 2S | AGREE (Pass also fits) |
| O7 | `AQJ974.8532.6.83` | (opening) | No weak two with a four-card side major | 7: P | 8: P | AGREE |
| O8 | `AK75.AQ4.AKJ3.K2` | (opening) | 2C, then [2NT] (22–24) | 24: 2C | 24: 2C | AGREE |
| O9 | `KQ4.AJ5.Q862.K73` | (opening) | 1NT (15 HCP) | 15: 1NT | 14: 1D | AGREE in HCP; corrected counts −1 for 4333 by design |
| O10 | `AQ4.KJ5.AQ62.KQ3` | (opening) | 2NT | 21: 2NT | 20: 2NT | AGREE |
| O11 | `AKQ5.AK4.AQ63.K2` | (opening) | 3NT (25–27) | 25: 3NT | 25: 3NT | AGREE |
| R1 | `85.K74.Q9632.J84` | `1H P` | 2H | 6: 2H | 6: 2H | AGREE |
| R2 | `K5.Q74.A9632.J84` | `1H P` | 3H (limit raise; 2H also fits 6–10) | 10: 2D, 3H | 10: 2D, 3H | AGREE; 2D needs 11 in SAYC |
| R3 | `Q5.74.K9632.AJ43` | `1H P` | 1NT (6–10; a two-level suit needs 11) | 10: 2C, 2D | 12: 2C, 2D | DIFFERENT in HCP (Q8) |
| R4 | `K5.Q74.AJ63.9842` | `1D P` | 3D (limit raise, four diamonds) | 10: 2C | 10: 2C | DIFFERENT (Q9) |
| R5 | `K5.Q74.A63.98642` | `1C P` | 2C (five clubs, 6–10) | 9: 1NT | 9: 1NT | DIFFERENT (Q9) |
| R6 | `K5.KQ74.A963.J84` | `1H P` | 2NT (Jacoby, 13+) | 13: 2D | 13: 2D | DIFFERENT (Q10) |
| R7 | `5.KJ754.Q9632.84` | `1H P` | 4H (preemptive raise) | 6: 2H | 9: 2H | DIFFERENT (Q10) |
| R8 | `KJ5.Q74.A96.K842` | `1D P` | 2NT (13–15, game forcing) | 13: 2C | 12: 2C | DIFFERENT (Q10) |
| R9 | `85.KJ74.Q963.K84` | `1C 1S` | X (negative double, four hearts) | 9: not described | 9: not described | MISSING (Q10) |
| OR1 | `KJ5.Q74.AQ63.874` | `1D P 1S P` | 1NT (minimum, balanced) | 12: 1NT | 11: not described | AGREE in HCP; the corrected count would not open this hand |
| OR2 | `AQ5.KQJ74.K63.84` | `1H P 2H P` | No SAYC game try rule; 15 is a SAYC minimum | 15: 3H | 16: 3H | Q11 |
| OR3 | `AQ5.KQJ74.K63.84` | `1H P 1NT P` | P (minimum) | 15: P | 16: P | AGREE |
| W1 | `A85.KJ74.AQ63.K4` | `2S P` | 2NT ask, or a raise | 17: 2NT, 3S, 4S | 17: 2NT, 3S, 4S | AGREE |
| W2 | `87.K6.KQT743.JT8` | `2D P 2NT P` | 3H (maximum, heart feature) | 9: not described | 10: not described | MISSING (Q7) |
| G1 | `KQ5.AJ74.KJ6.A84` | `1NT P` | 2C | 18: 2C | 17: 2C | AGREE |
| G2 | `K5.AJ7.KQ6.AJ842` | `1NT P` | 6NT (33+ together) | 18: 6NT | 18: 6NT | AGREE |
| I1 | `KJ854.Q74.A63.84` | `1NT 2H` | Natural bids; transfers off | not described | not described | AGREE that no transfer applies |
| I2 | `KJ854.Q74.A63.84` | `1NT X` | 2H (systems on) | 10: 2H | 10: 2H | AGREE |

W2 is the hand from the ACBL article [Weak can be strong, part 2](https://acbl.org/weak-can-be-strong-part-2/), as a search result quoted it; I did not read the article itself, so the [3H] answer is the SAYC rule, not the article's answer.

## Open questions

Each question names the examples that it affects.
None of these is changed yet.

- **Q1. [2S] with a five-card minor (C1, C6, J2).**
  The guide sends a 0–7 hand with five or more cards in a minor to [2S], as requested.
  Cohen passes a weak 5-3-3-2 hand with a five-card minor and transfers only with six or more cards, because the three level is too high for a five-card suit.
  SAYC does not state the length.
  Options: keep five cards; require six cards; or allow five cards only in an unbalanced hand.
- **Q2. 5-4 in the majors (S3R, T4R).**
  The guide transfers first.
  SAYC says not to transfer with exactly four cards in the other major, and to use Stayman.
  Cohen and BridgeBum use Stayman with an invitational or stronger hand, and a transfer with a weak hand.
  Options: keep the transfer; use Stayman with 8 or more points and the transfer below 8.
- **Q3. Invitational 5-5 in the majors (T3R).**
  The guide transfers to spades with equal length.
  SAYC and BridgeBum transfer to hearts and then bid [2S], which is invitational and not forcing.
  This needs responder's second call (Q5).
- **Q4. Super-accept (T2O).**
  SAYC lets opener jump to three of the major with 17 points and four-card support.
  Options: add it; keep the plain acceptance.
- **Q5. Responder's second call and weak Stayman (J2, S1R, S2R, T1R, T2R).**
  The guide stops after opener's answer.
  The sources define Pass, [2NT], three of the major, a new suit, [3NT] and four of the major after a transfer, and [2NT], [3NT], raises and the other major after Stayman.
  SAYC also allows Stayman with a weak hand that passes any answer, such as 4-4-4-1 or 4-4-5-0 short in clubs.
  Options: add the SAYC continuations; leave them out.
- **Q6. Direct three-level responses and Gerber (C11, C12, C14, C15, S4R).**
  SAYC has [3C]/[3D] as a six-card invitation, [3H]/[3S] as six cards with slam interest, and [4C] as Gerber.
  The guide sends these hands to [3NT] or [4NT].
  Options: add the SAYC meanings; keep the simpler notrump raises.
- **Q7. The answer to the [2NT] ask over a weak two (W2).**
  SAYC: rebid the suit with 5–8, show an ace or king feature with a maximum, or bid [3NT] without a feature.
- **Q8. Response ranges (R2, R3).**
  The guide has a [1NT] response of 6–9 and a two-level new suit from 10.
  SAYC has 6–10 and 11 or more.
- **Q9. Raises of a minor (R4, R5).**
  SAYC raises [1D] with four cards and [1C] with five, with the same ranges as a major raise.
  The guide has no minor raise.
- **Q10. Other missing responses (R6, R7, R8, R9).**
  Jacoby [2NT], the preemptive raise to four of a major, [2NT]/[3NT] over a minor, jump shifts, and the negative double are part of SAYC but not of the guide.
- **Q11. Opening minimum and opener's ranges (O5, OR2).**
  The guide opens from 12 and uses 12–14 / 15–17 / 18–21 for the rebid.
  SAYC states no opening minimum and uses 13–16 / 17–18 / 19–22.
  The guide's ranges fit a 15–17 [1NT] and a 12–14 [1NT] rebid, so this may be a deliberate choice.

## Limits

- The ACBL server refused the download (HTTP 403), so the comparison uses a third-party copy that I could not compare with the ACBL file; the suit symbols were lost in the text extraction, so suits were read from the context.
- Cohen's and BridgeBum's minor-suit methods differ from SAYC; where the guide follows SAYC, a different source call is not an error in the guide.
- Only the uncontested auctions and the double of [1NT] were checked against the engine; the competitive rules were compared as text only.
- The constructed hands test one rule each; they are not published examples.
