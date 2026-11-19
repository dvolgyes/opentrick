# Auction-weight preparation

## Protocol and acceptance (set before measuring)

Keep the original auction likelihood and accumulation order; do not change the sample stream.
Test 48 independently seeded deals and random legal continuations, one fixed position per deal.
Compare the fixed-sample output (excluding elapsed time) and scored-world stream bit-for-bit against historical `analyzePlay` at `eb18b5e565`, using current DDS for both.
Exercise real Milton and corrected Milton auction meanings, injected feasible ranges on every point scale, and ignored visible-seat/dummy hints.
"Other", Vienna, Reith, and Four Aces have no machine-readable auction meanings in production; injected cases test the weighting interface, not the bidding guide.

Use a same-engine pre-change control for CPU timing with a fixed, cheap solver (to expose weighting rather than DDS variance).
Warm both variants.
Report all seven paired rounds per regime, alternating execution order, fixed inputs and seeds.
Retain only if all comparisons pass, the instrumented mixed hinted workload reduces history inspections by at least 90% and point counts by at least 30%, and the median paired hinted time falls at least 15% without a median no-hint regression above 5%.
The timed workload measures weighting within the play-analysis loop, not self-play speed.

## Reproduction

Use a clean archive of the historical revision, linked to the current checkout's dependencies:

```sh
baseline="$(mktemp -d)"
git archive eb18b5e565 | tar -x -C "$baseline"
ln -s "$PWD/node_modules" "$baseline/node_modules"
node --import tsx scripts/benchmark-auction-weight.ts "$baseline"
```

Add `--count-baseline` to run just the original work counter.
The run before changing the engine observed 102,912 public-play entries visited and 5,856 calls to `countHandPoints` over 1,536 scored worlds.
Those counts include repeated work; they do not count other history reads by the sampler or rank classes.

The host and CLI pass public bid history to `playPosition`; known seat-controlled calls take their declared system from that call's origin, while bot and unknown calls do not produce hints.
With no origin history, seat settings are used.
Consequently a later call by one seat is not assumed to use the same scale as an earlier one.
The candidate keeps the existing `countHandPoints` implementation, including corrected HCP's honour and distribution adjustments.

## Results

All 48 positions passed the historical DDS replay (32 IID draws each, 1,536 scored worlds), including equality after stripping the visible-seat hints.
The mixed hinted input uses 24 real `callMeaning` auctions and 24 injected sets of interleaved hidden-seat hints.
The candidate visited 647 public-play entries (99.37% fewer) and counted points 2,720 times (53.55% fewer).

Wall-clock milliseconds on Linux x64, Node 22.22.1, pinned to one logical CPU (`taskset -c 12`).
Each timed pass contains 36 runs over the 48 positions (55,296 scored worlds); each version had 12 warm-up runs per regime.
Odd rounds run control first; even rounds run candidate first.

First run:

| Round | Hinted control | Hinted candidate | No-hint control | No-hint candidate |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 806.631 | 431.345 | 169.140 | 168.097 |
| 2 | 718.043 | 406.230 | 169.994 | 170.892 |
| 3 | 722.853 | 399.211 | 179.191 | 169.760 |
| 4 | 716.990 | 403.237 | 168.904 | 167.943 |
| 5 | 750.499 | 433.732 | 168.692 | 167.984 |
| 6 | 708.722 | 397.831 | 169.722 | 167.571 |
| 7 | 709.221 | 395.065 | 170.576 | 169.030 |

The median of paired candidate/control ratios was 0.5613 hinted (43.9% less time) and 0.9938 without hints (no demonstrated regression).
The prespecified gates passed, so keep the optimization.
This measures play analysis with a fixed cheap solver; it does not establish a whole self-play speedup or quantify the frequency of hinted positions in live games.

Rerun after renaming the ordered factors and formatting the comparator:

| Round | Hinted control | Hinted candidate | No-hint control | No-hint candidate |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 807.910 | 419.165 | 172.659 | 172.143 |
| 2 | 702.502 | 391.667 | 171.279 | 172.152 |
| 3 | 704.317 | 387.841 | 179.466 | 171.331 |
| 4 | 701.006 | 390.124 | 171.038 | 169.854 |
| 5 | 726.512 | 423.566 | 170.089 | 170.455 |
| 6 | 695.893 | 387.041 | 171.550 | 170.482 |
| 7 | 727.249 | 416.467 | 172.620 | 171.736 |

The median paired ratios were 0.5565 hinted (44.3% less time) and 0.9949 without hints.
Work counts and differential results were unchanged.

Rerun with the prepared weight function and the integrated 256-layout default:

| Round | Hinted control | Hinted candidate | No-hint control | No-hint candidate |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 817.108 | 475.832 | 168.341 | 169.260 |
| 2 | 773.943 | 455.476 | 169.077 | 170.380 |
| 3 | 748.971 | 403.508 | 177.971 | 169.452 |
| 4 | 722.589 | 406.942 | 168.520 | 168.188 |
| 5 | 742.336 | 438.503 | 169.608 | 168.002 |
| 6 | 710.991 | 401.206 | 170.417 | 168.611 |
| 7 | 712.381 | 402.161 | 169.449 | 169.371 |

The integrated median paired ratios were 0.5645 hinted (43.5% less time) and 0.9980 without hints.
The work counts and DDS replay matched the earlier runs.
The fixed-sample benchmark continues to use IID sampling with the new default in place; it does not benchmark exact enumeration.
