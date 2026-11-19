# Four-proposal opening leads: preregistration

Pinned incumbent: `b2858bff0de6c3509e527f5aadfed7a34c2c3aa3`.
Use the same `competitiveDeal` fixture throughout, alternating notrump and suit games by board number, with the sole known human-seat HCP opening bid as public evidence and no inference from unknown (including unprovenanced bot) calls.
At opening only, each DDS unit draws four IID legal layouts, picks one in proportion to its exact incumbent weight, and aggregates the DDS result using the arithmetic mean of the four weights.
Use the pinned incumbent unchanged after the opening and when the sampler is unique, exact enumeration is in progress, or no informative weight function exists.
An equal-weight sampled pool selects its first layout and consumes no selection draw.

## Fixed DDS comparisons

Opening accuracy uses all 48 boards starting at fixture seed 10700000 and each arm uses eight DDS queries on each of four independent repeats, sharing the first IID draw between arms via common random numbers without sharing reference streams.
Reference is 128 independent IID weighted DDS samples per board, reported as two independent halves of 64 and reconstructed by pooling the weighted totals.
Measure card-level utility squared error against the pooled reference, first averaged within each repeat and then within each board, and report the independent-half disagreement and both arms against each half.
Report lead choice and reference regret, but treat regret as exploratory due to the maximum over noisy reference card utilities.
A separate single DDS query per actual concealed deal measures oracle lead regret without entering the policies or the reference.

Paired full games use all 96 independent boards from fixture seed 10800000 at eight DDS queries per nonforced nonunique decision, using identical public hints and the same per-ply, per-seat random streams in both tables.
Compare signed defensive IMPs with the board as the unit, include all ties, and alternate control-first and candidate-first in both phases by board index.
Report board-bootstrap 95% one-sided lower bounds (10,000 resamples, fixed seed) for relative MSE reduction, candidate-minus-incumbent ESS, and candidate-minus-incumbent IMPs.
Report DDS calls, layout proposals and elapsed work for each arm and stage, plus opening choice changes and complete paired scores.

The candidate only earns a follow-up if relative opening MSE improves by at least 5% with lower bound above zero, the ESS gain is at least 0.5 of eight with lower bound above zero, and paired mean improves by at least 0.10 IMP with lower bound above zero.
All gates are conjunctive; a failed gate means no promotion, not an equivalence claim.
If all pass, run an independent 96-pair holdout from seed 10900000 with the pinned engine's default deadline (not a DDS cap), the same fixtures and common continuation streams, recording opening elapsed time, queried layouts and proposals.
Realistic holdout requires at least +0.10 mean IMP with lower bound above zero and no more than 10% increase in median opening elapsed time before asking Main about promotion.
No fixed-DDS result alone changes the default.
