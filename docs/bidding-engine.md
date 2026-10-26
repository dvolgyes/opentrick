# Local bidding engine

Select a **Local** option in **Bidding engine** when creating a table.
The host bids with TypeScript in a Web Worker and plays cards with the existing DDS engine.
The game needs no Python runtime, model API, or additional server.
OpenRouter remains the default for existing room links.

## Options researched

| Engine | Browser fit | License and trade-off |
| --- | --- | --- |
| [BRL](https://github.com/harukaki/brl) | Small feed-forward policies can run directly in TypeScript | Apache-2.0; pretrained WBridge5 imitation and learned RL/FSP partnerships; chosen here |
| [BEN](https://github.com/lorserker/ben) | Python/TensorFlow as shipped; would need a model/runtime port | GPL-3.0; a larger bridge engine with bidding and sampling |
| [SAYCBridge](https://github.com/eseidel/saycbridge) | Python rules and Z3; would need a port | BSD-3-Clause; explicit SAYC rules, but its README says it is unmaintained |
| [BBA / EPBot](https://github.com/EdwardPiwowar/BBA) | Distributes WASM among other binaries | Redistribution terms need confirmation from its owner before integration |
| [Pons](https://docs.rs/pons/latest/pons/) | Rust rules and search; would need a WASM adapter | Apache-2.0; an alternative for explicit 2/1 agreements |

BRL was selected because its published network is straightforward to reproduce in the existing static application.
It does not require a new inference library or Python service.
[Nickel Bridge](https://github.com/brannondorsey/nickel-bridge) demonstrates the same general approach and distributes converted BRL weights.
OpenTrick uses that numeric data, with an independent inference implementation; it incorporates none of Nickel Bridge's application code.

## Policies and partnership agreements

**Local · WBridge5 imitation** uses BRL's supervised policy (`sl`).
**Local · RL/FSP learned system** uses its reinforcement-learning policy (`rl-fsp`).
All host-managed bots at a table use the selected policy.
The selection is retained in room links as `bot_bidder`.

Neither policy is advertised as a strict implementation of OpenTrick's standard bidding guide.
The RL policy can use artificial or weak openings that need its learned partner's interpretation.
For that reason, local bot seats use the **other** system designation: the table does not attach incorrect standard-guide meanings, and the card sampler does not impose those meanings on local bids.
Human partnership compatibility and expert strength remain unverified.
Prefer a matched bot partnership when evaluating the learned system.

## Architecture and assets

`bidPosition` projects only the bidder's 13 cards, seat, dealer, vulnerability, public calls, and authoritative legal calls.
It rejects an off-turn request.
`encodeBidPosition` reproduces [PGX 1.4.0's 480-bit observation](https://github.com/sotetsuk/pgx/blob/v1.4.0/pgx/bridge_bidding.py): vulnerability, relative-seat auction history, and own cards.
`BidNetwork` implements BRL's four 1024-wide ReLU layers and 38-action policy head.
It masks illegal calls before choosing the highest policy score.
It does not add rule overrides to the pretrained policy.

The browser downloads the selected policy from its own static origin on first use in a worker.
Each policy is 14,725,276 bytes of little-endian float32 data; both together are about 29.5 MB.
The files are ignored by Git and prepared by `npm run prepare:bidder`, which also runs before builds and unit tests.
Preparation downloads missing assets from an immutable GitHub commit and validates their size and finite numerical values.
Subsequent builds use the local assets.
First preparation requires network access; the deployed site serves the prepared weights itself.
No training code or pickle loader is included in the browser.

The original BRL revision is `fdd958ff8adcb44844d70ea2e233bed18d5a7b70`.
The converted-data revision is `92a81b5e81cb7aac2eabc147e82f18e0040b512e` of Nickel Bridge.
Both converted files were compared byte for byte against the original tensors after reordering the original weight/bias payloads.
The original pickle payloads were inspected as data with `pickletools`, without executing their contents.
License texts and attribution ship under `public/licenses/`.
[The component inventory](../public/licenses/components.json) records source revisions, modifications, and relative notice paths for a future licenses page.
It also records DDS and the existing vendored Trystero adapters.
Normal npm dependency metadata remains in `package-lock.json`; the inventory is not a complete transitive npm license report.

## Verification and evaluation

Unit checks compare all 38 logits for both policies across 12 positions with independent NumPy matrix products.
The absolute tolerance is 0.0001, and the selected legal calls and encoded active features agree.
These fixtures check numerical fidelity, not bidding quality.
Other checks cover hidden-hand invariance, invalid models and hands, auction encoding, room-link round trips, legal output enforcement, cancellation, and deadlines.
Production-build Chrome tests complete an auction and all 52 card plays with each policy while blocking and counting OpenRouter requests.
They also check hosting below a path and a previously saved API key.

The [paired bidding run](benchmarks/bidding.jsonl) uses 16 fresh seeded deals with the dealer/vulnerability cycle.
Each deal is bid twice, with SL and RL/FSP partnerships exchanging the North–South and East–West orientations.
DDS scores the final contracts under perfect play; the bidder never receives the actual other hands.
All 32 auctions terminated legally, with 347 calls.
RL/FSP scored a net +32 IMPs, or +2.00 IMPs per paired deal, against SL in this sample.
The per-deal differences range from −10 to +14 IMPs.
This small sample does not establish general superiority or strength against humans.
It evaluates auctions with a double-dummy scoring model, rather than actual single-dummy play.
Mean core inference was 2.58 ms per call on Node 22.22.1, Linux x64, AMD Ryzen 7 4800H, during this run.
That mean includes startup inference and is not a browser latency guarantee.
No policy, rule, or hyperparameter was tuned on these deals.

```sh
npm run prepare:bidder
npm run --silent benchmark:bidding
npm run demo:bot -- --local
npm run demo:bot -- --local-rl
```

The demo opens a visible Chrome window at `http://localhost:5178`, temporarily enables West's autoplay to verify a full board, then returns West to human control.
The other three bots stay active.
Close the browser to stop the demo server.
The standalone Node bot also recognizes the local policy in a room link; an explicit `--model` selects OpenRouter instead.

Python is only an optional numerical reference generator for developers.
To regenerate the reference from the fixture positions:

```sh
node --input-type=module -e 'import fs from "node:fs"; const x=JSON.parse(fs.readFileSync("tests/unit/fixtures/bid-model.json","utf8")); console.log(JSON.stringify(x.fixtures.map(f=>f.position)))' > /tmp/bid-inputs.json
uv run --python 3.12 scripts/reference-bidder.py -i /tmp/bid-inputs.json -m public/bot-models -o /tmp/bid-reference.json
```

## Security, errors, and recovery

The added boundaries are third-party numeric data into the worker and a proposed call back into the host.
The worker accepts only the two policy identifiers and same-origin model URLs with their fixed file names.
Its stream parser bounds model size, and its float parser rejects non-finite weights.
It never executes model bytes.
The browser terminates stalled loading or inference after 60 seconds and supports immediate abort.
The worker receives no API key or other player's hand.
The browser rejects calls outside the supplied legal list; the existing host rechecks the current position, active seat, pending votes, and action authorization before delivery.

Spoofing and privilege elevation remain subject to the existing host controls.
Tampering cannot turn a proposed bid into an unauthorized game action; model replacement could still degrade bidding quality.
Information disclosure is limited by the own-hand projection and verified key-free local workflow.
Denial of service is bounded by one worker, fixed-size assets, deadlines, and termination.
Actions remain in the existing room log, so no new repudiation mechanism is introduced.
Pinned HTTPS sources and numerical validation reduce supply-chain ambiguity, but do not constitute an independent security audit of model quality or the existing application.
No cryptographic scheme or secret lifecycle changes.
The user owns residual bidding-quality and third-party availability risks.
Keep prepared assets with a deployment; if preparation fails, the build reports the error.
An engine failure visibly stops affected bots so the host can retry or take manual control.
To recover the earlier bidding behavior, create a table with **OpenRouter** or revert this change.
No stored-board migration is required.
