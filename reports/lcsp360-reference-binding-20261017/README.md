# LCSP-360 reference binding contract

## Root cause

At `12ef8f347128e40daef612580fdc3faa8d254245`, the retained live diagnostic authored and persisted relation `f3fc3ad96649631e04ad6ee72a1eafd738fb74f93184842d16811d05dd47fabc`: Article 4 SCOPE `065019d9…` → Article 4 CROSS_REFERENCE `45111c70…`, carrying reference `8ea2cefb…` whose resolved target is Article 6 `7bce0586…`. Tool authoring and COMPLETE checked identity/ownership but deferred structural endpoint validation to inventory integrity. Repair also required copying generated relation IDs into a separate accounting mutation.

`LIVE_REFERENCE_BAD_STATE_REPRODUCED = YES`: the permanent retained-payload regression failed before implementation because the old tool returned PASSED and generated that exact bad relation ID. The pre-fix receipt is `before-fix.log`.

## Fix and responsibilities

For structural reference A → B, a bound relation's source claim must have an anchor equal to or within A, and its target claim must have an anchor equal to or within B, in the same pinned source/materialization. Endpoints must exist and differ; material references must resolve; relation kinds must be supported. Containment compares document identity and complete structural-path segments.

The Agent decides materiality, semantic endpoints, legal relation kind and direction. Runtime validates structural binding, generates canonical IDs, owns relation/reference bookkeeping, derives material accounting, persists review ownership and provides idempotency. No legal meaning is inferred from source prose.

The authoritative TypeScript helper `semantic-reference-binding.ts` is shared by COMPLETE and final integrity. Python `reference_binding.py` performs preflight and projection. The retained fixture and generic direction/subtree matrix execute both runtimes and assert parity. COMPLETE checks bindings before persistence and before idempotent replay. Inventory validation checks durable evidence before comparing the candidate projection, preserving actionable repair of legacy invalid evidence.

Normal material path: `inspect_semantic_reference_binding` → `bind_semantic_reference` → `complete_source_review`. Inspection is bounded/paginated and exposes target readiness and exact candidate IDs. A target needing review uses the existing block/expand/requeue protocol. Binding atomically creates a canonical relation owned by the active source review and derives all material accounting. Non-material references use `mark_reference_non_material(reference_id, reason)`; existing bindings reject a contradictory decision. The legacy reference-accounting wrapper remains available for existing callers/tests and is absent from the Managed Agent tool set.

A source-side CROSS_REFERENCE claim cannot replace a resolved target claim. No redundant CROSS_REFERENCE claim is required merely because a structural reference exists.

Unlink and claim deletion recompute accounting from remaining valid relations. Removing the last binding leaves the reference unaccounted unless explicitly declared non-material. Restore loads persisted claims/relations/ownership and recomputes the same projection. Stable claim identity, frontier scheduling, frozen revisions, legal interpretation and provider governance are preserved. No schema migration is introduced.

## Regression coverage

- Exact retained Article 4/Article 6 claim IDs and bad relation: rejected before mutation; inspection exposes definition `12ff1db191f504d0aaca9f8fc0cd7088e2c3b2973aa8ec26b5726901e30b188a`; valid binding derives accounting.
- Every retained structural edge: forward passes; reverse, same-side and unrelated endpoint mutations fail. Both source and target descendants use the same containment predicate.
- COMPLETE rejects the retained bad payload without a write, including historical replay. Final integrity uses the identical authoritative rule.
- Non-material decisions, contradictory decisions, multiple bindings, unlink and claim removal, and stale material projections are covered.
- Real PostgreSQL replay starts with all six reviews complete and legacy bad evidence; inventory identifies the defect, Article 4 reopens once, the reviewed target is reused, binding/completion/duplicate completion pass, a fresh context restores ownership/accounting, and inventory freezes without duplicate claims. Each database replay gets a new run and its required canonical claim IDs; the retained source/reference IDs, claims and direction stay exact. The separate authoring/API regressions use the original live claim IDs.
- The real Managed Deep Agent harness with a scripted model exercises target scheduling, readiness inspection, atomic binding and inventory freeze, both for a direct target and Article 6 / Paragraph 2. No provider is invoked.

## Claim-discovery ID audit

| ID transfer | Responsibility | Result |
|---|---|---|
| Relation ID → reference accounting | Infrastructure bookkeeping | Eliminated from normal Managed Agent path; derived internally |
| Source/review/lease/revision identity → completion | Infrastructure bookkeeping | Existing frontier wrapper supplies these internally; claim IDs default to all owned claims |
| Claim identity → chosen relation endpoint | Semantic decision | Retained; bounded inspection supplies exact candidates |
| Claim identity → Requirement role | Semantic decision | Retained; declares which semantic claim has each legal role |
| Requirement identity → AssessmentRule parents | Semantic decision | Retained; selects legal authority |
| Relation identity → explicit removal | Semantic decision | Retained for correcting a particular existing dependency; inspection supplies its identity |
| Inventory revision/fingerprint → downstream binding | Infrastructure bookkeeping | Existing inventory/container code supplies this internally |

## Delivery and execution boundary

Only task-owned files are staged. Unrelated assessment UI WIP and prior reports remain untouched. Deployment is Git-first, fast-forward only, with API/Agent restarts after idle gates and provider-free deployed acceptance. Web is unaffected. The final report and machine receipts record actual results; this implementation document does not claim live semantic acceptance.

No production Preparation, authority change, Assessment repinning, production database patch, VPS source editing or production full-source run is authorized by this implementation. Exactly one isolated full semantic disposable is permitted only after all deterministic and deployed provider-free gates pass; failure ends that execution authority.
