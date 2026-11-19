# Defensive advice as a search prior

## Sources and hypotheses

[Larry Cohen](https://www.larryco.com/bridge-articles/opening-leads) distinguishes the suit to lead from the rank to lead within it.
Leading partner's naturally bid suit does not generally mean playing one's highest card: for example, Cohen leads low from Qxx, but high from a doubleton.
[David Lindop](https://acblunit390.org/web_documents/Grant/38%20Leading%20Against%20Suit%20Contracts.pdf) describes fourth-best as a rank choice in a selected long suit against suit contracts, with exceptions for touching honors and aces.
That is not an instruction to lead the fourth-highest *trump*.
Lindop also discourages a singleton lead when long trumps make a ruff unattractive.
[Richard Pavlicek](https://www.rpbridge.net/4l00.htm) explains why second hand usually plays low against a spot lead and gives counterexamples: splitting honors and covering an unsupported honor led from dummy.
These authors propose plays; they supply no evidence about this engine's scoring performance.

## Frozen protocol

Use the engine at `64ebc9c0d7` as the incumbent.
Run six alternatives in three separate families; each candidate plays a full board twice with its partnership swapped relative to the incumbent.
Each policy sees only the acting player's permitted position and the same public auction hints.
Use the same seeded per-action stream in both rooms and use each layout for every legal card.
Do not bias the hidden-card sampler toward the proposed play.
Instead, accept a legal suggested card only when its estimated mean IMP utility is within 1.0 of the incumbent's best card, inclusive.
Abstention, a forced play or a larger estimated loss preserves the incumbent decision.
An illegal suggestion is an error, not an abstention.
Count offers, unchanged suggestions, utility vetoes, actual changed decisions and sampled DDS layouts.

| Family | Treatments | Full-board population | First screening seed | First holdout seed |
| --- | --- | --- | ---: | ---: |
| Second seat | Low on a spot lead; low with contextual honor exceptions | Mixed game contracts, all five strains | 8400000 | 8500000 |
| Partner's suit | Highest; holding-specific rank | Competitive natural five-card-major opening, partner on lead against 3NT or four of the other major | 8600000 | 8700000 |
| Suit-contract lead | Fourth best with honor exceptions; a guarded side-suit singleton | Suit games, rotating through four suits | 8800000 | 8900000 |

Use 40 screening boards at four layouts per searched decision and 96 fresh holdout boards at eight layouts, for **both arms in every family regardless of screening sign**.
The shared board, board number, dealer, vulnerability and search-seed derivation do not depend on the arm's performance.
A unique layout takes one solve and a forced card takes zero.
Retain every board; a generation, search or adjudication failure invalidates that comparison.
No tuning between phases.
Report signed paired IMPs, wins/losses/ties and the one-sided paired-board bootstrap lower bound.
For a policy to qualify for a separate live-budget confirmation, require positive screening IMPs, at least 20 non-tied holdout boards, a holdout lower bound greater than +0.05 IMP per board and a one-sided exact sign-test probability below 0.05/6.
This accounts for the six tested variants; do not treat a positive point estimate as proof.
Only a qualifier can enter a further, prespecified 160-board confirmation at the deployed 5,000 ms budget on disjoint seeds, with the same strength gates.
Reserve 9100000–9100159 for second seat, 9200000–9200159 for partner's suit, and 9300000–9300159 for the suit-contract lead.
Without successful confirmation, do not change what live bots play.
The small-layout matches measure these heuristics in the specified populations, not all defense or play against humans.

## What the suggestions can see

The second-seat rule requires one opposing lead and a legal follower of that suit.
The simple variant plays low on 2–8; the contextual variant distinguishes a dummy honor supported by the immediately lower rank from an unsupported one.
It can split three honors with a touching pair, but does not guess the contents of declarer's concealed hand to decide whether an honor is supported.
Neither variant instructs a defender to discard or ruff.

Against a suit contract, the fourth-best variant keeps the side suit selected by search and changes only the rank.
It does not underlead an ace; touching honors take precedence.
The singleton variant requires a unique non-ace side singleton, one to three trumps, and fewer than two of the four top trump honors.
It also declines a singleton in a suit the opponents have publicly shown length in.

The partner-suit experiment tests a natural major actually bid by the opening leader's partner.
Each side gets the same published meaning, not the partner's hidden cards.
An artificial bid, a support-only call or a bid with an unknown meaning is not evidence for the treatment.
The synthetic deal generator uses original hands only to construct a plausible auction; it does not pass them to either policy.
The opener has 12–14 high-card points and a five-card or longer major.
In no-trump the overcaller has a balanced 15–18 with a stopper, opposite 10–12 without a four-card major or six-card minor.
In a suit contract the overcaller has 14–16 and a good five-card or longer other major, opposite 10–11 and three-card or longer support.
The declaring side has at least 25 points: the opening leader therefore has at most **three**.
This is a test of a weak partner of a natural major opener, not representative of every auction or every holding such as AKx.
Before scoring, fixture preflight found that two holdout deals needed more than 100,000 proposals.
Raising the generation limit to 500,000 left every seed, card sequence and eligibility condition unchanged; all 136 fixtures completed, with a maximum of 195,261 proposals.

## Replay control

Within one board, both rooms reset the search stream by ply and seat.
The harness can reuse a completed fixed-budget analysis when the same actor sees the same card history on that board.
The cache is discarded before the next deal and never shared across budgets or auctions.
On twelve separate development deals, a cached and an uncached second-seat match gave identical complete card traces and scores in both rooms, including six changed decisions.
The cached trial made 1,603 DDS calls rather than 2,541.

Reproduce a phase with `node --import tsx scripts/defensive-study.ts partner holdout`; substitute `second` or `trump` and `screen` as required.

## Results

All 816 paired matches finished (1,632 rooms; 408 distinct boards because the two variants in a family share deals).
Every pair is retained in the [board-level scores and decision counts](defensive-priors.jsonl).
Positive IMPs favor the treatment; a win means a higher duplicate score after conversion to IMPs.
The holdout lower bound is in IMPs **per board**, not total IMPs.

| Advice | Screen IMPs (40) | Holdout IMPs (96) | Holdout W/L/ties | Lower 95% | Sign p | Holdout offers / changed / vetoed |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| Second low on spots | −3 | +7 | 7 / 8 / 81 | −0.167 | 0.6964 | 182 / 33 / 8 |
| Second low with honor exceptions | −5 | +6 | 6 / 7 / 83 | −0.167 | 0.7095 | 190 / 45 / 9 |
| Highest in partner's natural major | +8 | +44 | 20 / 9 / 67 | −0.135 | 0.0307 | 96 / 71 / 19 |
| Holding-specific rank in partner's natural major | +1 | +20 | 16 / 10 / 70 | −0.417 | 0.1635 | 96 / 60 / 20 |
| Fourth best in the selected side suit | +3 | −3 | 0 / 1 / 95 | −0.094 | 1.0000 | 25 / 19 / 0 |
| Guarded side singleton | 0 | +2 | 1 / 0 / 95 | 0.000 | 0.5000 | 8 / 3 / 1 |

No variant qualified for the live-budget test, so no playing default changed.
Leading highest in partner's suit had the strongest result here, but a negative lower bound and sign-test probability above 0.00833 do not establish a gain.
Both partner-suit treatments can change **which suit** search leads; their gains against the incumbent do not isolate the value of a high card in that suit.
Second-hand low frequently agreed with search, and most fourth-best substitutions did not change the duplicate result.
The singleton evidence consists of three changed holdout leads and should not be read as a general verdict on singleton leads.
The [separate 128-deal partscore comparison](partscore-leads.md) isolates suit preference from rank choice and includes opening leaders with 4–7 points.
