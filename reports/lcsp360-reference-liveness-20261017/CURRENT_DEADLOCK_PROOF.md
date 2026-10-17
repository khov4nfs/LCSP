# Current deadlock proof — 94773fa8

REFERENCE_READINESS_ROOT_CAUSE = REVIEW_COMPLETION_AND_ENDPOINT_AVAILABILITY_CONFLATED

REFERENCE_DEPENDENCY_ROOT_CAUSE = PROVEN

Evidence: retained Preparation `94773fa8-3784-44bf-8929-3961d2a429e9`, exact candidate `39a728b7dcb1d303d997b5cb6d7482f6f3e885e5`. Final state is eight REVIEWED_WITH_CLAIMS, three BLOCKED_REFERENCE, zero PENDING/REOPENED and zero IN_REVIEW. This is a two-node SCC plus one inbound dependent, not a three-node cycle. No IDs or legal claims are synthesized. All 35 retained claim IDs were independently recomputed from run, revision, anchors and normalized identity key.

## Exact wait graph

Review A: `fa2bb68bf14595206c1a5b3ceda69a2f2b9a5cec537fc5403e724f2c319b7767`

- Path: `/document/synthetic-legal-graph-instrument-test-material-only/chapter/i/article/2/paragraph/2`
- State: `BLOCKED_REFERENCE`
- Durable claims: 3
- Source version: `85d19123-6aff-4929-b0b0-b9cf57244b98`
- Materialization: `30ff86636fca4fcffd01afa28b57434971ee9ca0247afcde25e9149d7a68ca75`
- Inventory revision: 1

- Canonical PROHIBITION: `2e79a3919a0d85e1f5f70f32de9a3249f9ccc869fb0fc6b193db1e482e4c41e6` — The operator must not impose commercial charges or technical obstacles intended to prevent a customer moving their customer-created records to another service.

- Canonical EXCEPTION: `4d5f9ad1b604a54c8111f62d2e7760726728c7efd12f6db3d3638cb4a7ae4f3b` — The prohibition is subject to the limited exception in Article 3(2).

- Canonical QUALIFIER: `9e1f04565c807db3cabb1c2f2cced3111f5b45959eec2c38f2868cf9b7e4964d` — For both charges and obstacles, this prohibition is limited to those intended to prevent that portability; it does not prohibit charges generally.

- Waits on `3ea006f00e3985b661955f9bb8914497a131432397b425576e436007426d36fe` through RESOLVED reference `21d7381c3a65863959507b7b3cf56d6f329681a7819fe1bce82509cdc973b7f9` (from `fa2bb68bf14595206c1a5b3ceda69a2f2b9a5cec537fc5403e724f2c319b7767`).

Review B: `3ea006f00e3985b661955f9bb8914497a131432397b425576e436007426d36fe`

- Path: `/document/synthetic-legal-graph-instrument-test-material-only/chapter/i/article/3/paragraph/2`
- State: `BLOCKED_REFERENCE`
- Durable claims: 2
- Source version: `85d19123-6aff-4929-b0b0-b9cf57244b98`
- Materialization: `30ff86636fca4fcffd01afa28b57434971ee9ca0247afcde25e9149d7a68ca75`
- Inventory revision: 1

- Canonical QUALIFIER: `65d39c969d2edd2d8503029906281f845410be6f4b6df43d51d6b5dc34617563` — The block must be proportionate to that threat and end when the threat ends.

- Canonical PERMISSION: `859d04eca448d5911539c5851e1aef09e3c616e0430cfc71a9599799239a3102` — As an exception to Article 2(2), the operator may temporarily block a transfer only while a documented, specific security threat makes that transfer unsafe.

- Waits on `fa2bb68bf14595206c1a5b3ceda69a2f2b9a5cec537fc5403e724f2c319b7767` through RESOLVED reference `c25a3e7fdb6859559131bf2a1af5178492afb970403d9df37e7248f354cc3023` (from `3ea006f00e3985b661955f9bb8914497a131432397b425576e436007426d36fe`).

Review C: `7b38fc244cab6ffe1ee73d80cd6b7f9f86852715177b919de9dd95b077957f5b`

- Path: `/document/synthetic-legal-graph-instrument-test-material-only/chapter/ii/article/4`
- State: `BLOCKED_REFERENCE`
- Durable claims: 3
- Source version: `85d19123-6aff-4929-b0b0-b9cf57244b98`
- Materialization: `30ff86636fca4fcffd01afa28b57434971ee9ca0247afcde25e9149d7a68ca75`
- Inventory revision: 1

- Canonical TEMPORAL_RULE: `91798df829b67716fb0ef447066946438d02360c88fa7e2cc57ae839953db81e` — This instrument takes effect on 1 January 2026.

- Canonical TEMPORAL_RULE: `b3808f99a6bd238f3945fc94e15774a412f4130f8be42ec9390424d8070ef5cb` — For covered services first operating on or after 1 January 2026, those duties apply immediately on first operation.

- Canonical TEMPORAL_RULE: `c4ad3f4ac9800807b9f6b20cf4f33277e60973cfb11e5217938b9d8b27105be9` — For covered services already operating before 1 January 2026, the duties in Article 2(1) and Article 2(2) become applicable on 1 July 2026 after a six-month transition.

- Waits on `fa2bb68bf14595206c1a5b3ceda69a2f2b9a5cec537fc5403e724f2c319b7767` through RESOLVED reference `24869d17954fb3e0aaa907aa95d5523694fb62a774053b44ba6f0c328128723f` (from `7b38fc244cab6ffe1ee73d80cd6b7f9f86852715177b919de9dd95b077957f5b`).


```text
A = Article 2(2), fa2bb68b... : 3 durable canonical claims, BLOCKED_REFERENCE
B = Article 3(2), 3ea006f0... : 2 durable canonical claims, BLOCKED_REFERENCE
C = Article 4,    7b38fc24... : 3 durable canonical claims, BLOCKED_REFERENCE

A --21d7381c...--> B
B --c25a3e7f...--> A
C --24869d17...--> A
```

## Code path at the current SHA

1. `ReviewFrontier.complete` persists the unit payload through API COMPLETE even for REQUIRES_REFERENCE_RESOLUTION, but only completed dispositions enter Python `sourceAccounting` (review_frontier.py:153-164). `restore` loads blocked claims and identities, so these are present after restart (lines 39-58).
2. `claim_tools.py:82-89` nevertheless rejects an external relation endpoint unless its owner appears in completed `sourceAccounting`. Thus durable blocked claims are rejected because their review is incomplete.
3. `SourceReviewHandler` COMPLETE reads external endpoints from `completedReviewStates` only (source-review.handler.ts:596-607). `completedReviewStates` contains only REVIEWED_WITH_CLAIMS and REVIEWED_NO_CLAIMS (source-review-frontier.ts:65-68). Python-only removal of its guard cannot solve the authoritative persistence rule.
4. Inspection PROGRESS returns `reviewReady` only when all target subtree reviews are complete (handler.ts:477-539). The Python inspection aliases that result to target readiness (claim_tools.py:120-150), despite showing durable target claims.
5. `wakeBlocked` is called only after a non-blocked completion (handler.ts:1289), and itself requires completed target subtree reviews (lines 346-455). Publishing claims through BLOCKED_REFERENCE never wakes an existing dependent.
6. NEXT, with no pending/reopened item, returns blockedUnits and no work (lines 655-697). It has no fixed-point reevaluation of durable endpoints. REOPENED is counted as pending; IN_REVIEW is leased; BLOCKED_REFERENCE is a durable committed disposition. None of the three remaining blocked units has a live lease.
7. No-progress detection correctly observes the unchanged frontier fingerprint (claim_inventory.py:133-175); model retries cannot change this deterministic refusal. It is not a provider/runtime failure.

## Why the previous tests missed it

The prior readiness regression explicitly rejects a target claim until the target review is completed. Scripted scheduling covers an unavailable target followed by a fully completed target, and the retained Article4/Article6 repair starts with the target already complete. None covers a durable target claim published in a blocked review, a mutual dependency SCC, or target semantic change after an early binding. The fixture has these real mutual references; the deterministic state-space model was missing.

## Correct model to implement

REVIEW_COMPLETE answers whether the unit has accounted for all content and references. CLAIM_ENDPOINT_READY answers whether an individual canonical claim is authoritative in a committed payload in this exact run/source/materialization/inventory revision. They are independent.

A committed blocked payload can supply endpoint-ready claims. A blocked label alone cannot. Empty, malformed, wrong-version, stale-revision, invalid-identity or invalid-anchor claims are unavailable. Uncommitted cross-unit Agent drafts are unavailable. Reopening invalidates dependent authority until repaired; semantic changes or removal require durable dependent reevaluation without silently retargeting the Agent's semantic decision.

Use the existing run-row transaction lock and durable review payloads for publication, dependency fingerprints, targeted wake and invalidation. A fixed-point reconciliation must recover already-published blocked states on NEXT after restart. Structural direction and material accounting rules from the preceding fix remain authoritative. No migration is yet justified.

Implementation has not started at the time this proof is written. Baseline production is unchanged and idle, API/Web/Agent healthy; no provider call or new Preparation has been made.
