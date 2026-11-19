# Standard partner-major lead confirmation

The exploratory holdouts identified the fixed `standard` convention with a 1 estimated-IMP margin as a candidate for confirmation.
This study uses neither those boards nor the two-stream consensus boards.
It makes no production change.

## Frozen design

- Stage 1 (**screen**): use consecutive seeds 1510000000–1510000127, with the opening optimizer's fixture rotation and board numbering.
  Use 32 boards each of competitive notrump, competitive major, partscore weak leader, and partscore stronger leader, without replacements or stratification by observed outcome.
- Each board gets one uninterrupted 5000 ms `analyzePlay` opening, with no sample cap.
  Both arms use the same public hints, layout draws, world weights and estimated scores.
  The incumbent takes the engine's selected lead.
  The candidate uses `partnerOpening("standard", ...)` for partner's explicitly shown natural major, and changes the lead only if its estimated utility is within 1 IMP of the incumbent.
  Actual hidden cards do not enter that choice.
- If the leads differ, complete both tables, alternating table order by board index and coupling the arena's seeded per-ply and per-seat random streams.
  Stage 1 uses eight sampled layouts per searched continuation unless the layout is unique.
  Identical leads skip both tables: under a common continuation they tie by identity, with a raw difference and IMP difference of exactly zero.
  No table scores are imputed.
  Changed leads retain both the defender score and the NS score for each played table.
  Convert the candidate-minus-incumbent defender difference to IMPs once per board.
- **Stage 1 gate:** require all 128 valid rows, at least 24 non-tied IMP results, one-sided exact sign-test p < .025, and a one-sided 97.5% stratified board-bootstrap lower bound > +.05 IMP per board.
  Resample 32 boards with replacement within each fixture in each of 10,000 replicates (seed `0x51f15eed`); use the 250th sorted replicate.
  Identity ties enter the mean and bootstrap, but not the sign test.
- Stage 2 (**live**) starts automatically only if Stage 1 passes.
  Use independent consecutive seeds 1520000000–1520000127, the same fixture rotation and one 5000 ms opening search.
  Identical leads still tie by identity without a replay.
  For different leads, use `obviousPlay`, then `analyzePlay` with its default exact limit and the host's default budget: 5000 ms, or 2000 ms for the last three cards per player.
  There is no fixed sample cap or shared timed-search cache; common per-position seeds do not force equal layout counts or elapsed times.
  The timing excludes browser presentation delays.
  Stage 2 uses the same statistical gate on its own 128 boards.
  Neither gate deploys a policy.

## Frozen run and recovery

Version 1 uses the engine at `b2858bff0de6c3509e527f5aadfed7a34c2c3aa3`.
Export `src`, `scripts/self-play`, `package.json`, and `tsconfig.json` from that commit to a private `source` directory.
Use `scripts/self-play/arena.ts` from `cddf8cefc1e7384737d6fd4624a1259eac80e4f0` for the `playTable` export.
Copy in the two runner files and write the baseline commit to `source/REVISION`.
Copy the installed `bridge-dds`, `tsx`, `esbuild`, `@esbuild`, and `@bridge-tools` packages into `source/node_modules`; do not symlink them or borrow dependencies from the live checkout.
Make the snapshot read-only and use a separate mode-0700 `checkpoint` directory.
The protocol binds the source files, loader, DDS binary, Node version, platform and architecture.
A fingerprint mismatch prevents resume.

The executing snapshot is version 1, fingerprint `ec0a55f77ca883a29f147f5b1ffacc20dfa6a265654bacf8e021db43e49b359d`, on Node v22.22.1.
It predates checkout-only formatting, CLI type narrowing and explicit bootstrap-index guards.
Inspect or resume that cohort with its exact snapshot; do not copy the checkout files over it.
On the first durable row (1510000000), the opening used 268 layouts in 5004.95 ms and the defender scores were −490 (incumbent) and −430 (standard), or +2 IMPs.
This verifies the paired scoring path, not the effectiveness of the rule.
The worker was detached with `setsid`, nice +10 on CPU 14:

```sh
base="$HOME/.local/state/opentrick/standard-confirm-1510000000-v1"
cd "$base/source"
umask 077
setsid -f bash -c '
  echo $$ > "$1/pid"
  exec env -u NODE_OPTIONS -u NODE_PATH taskset -c 14 nice -n 10 node --import tsx scripts/self-play/standard-confirm.ts "$1/checkpoint"
' standard-confirm "$base" </dev/null >>"$base/events.jsonl" 2>>"$base/errors.log"
```

Send `SIGTERM` to the worker PID after verifying it still names that worker.
An orderly stop finishes the current board; a hard interruption can leave a temporary file but no partial evidence.
An OS directory lock excludes another writer.
Completed rows are synced and published atomically before their `board` event, with checksum, source identity, fixture, seed and deal identity.
Resume validates the contiguous prefix, never replaces a completed row, and treats a durable `invalid.json` from a board error as terminal.
Append `--doctor` to the direct Node command for read-only validation and summaries, or inspect `events.jsonl`.
During an active run the doctor sees only a published prefix.
Do not delete data to resume.

Summaries report elapsed count, sum and range for boards, roots, tables and timed decisions; actual root and timed sample counts; fixed DDS calls; and lead changes, identity ties and positive, negative and zero IMP results by fixture.
An incomplete stage reports no gate result.
