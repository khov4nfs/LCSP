# LCSP-360 reference dependency state model

## Root cause and scope

The prerequisite proof is [CURRENT_DEADLOCK_PROOF.md](CURRENT_DEADLOCK_PROOF.md). At baseline `39a728b7dcb1d303d997b5cb6d7482f6f3e885e5`, completion-only endpoint filtering and completion-only wakeup produce a false internal wait for the exact retained Article 2(2) ↔ Article 3(2) SCC and its Article 4 dependent. The direction invariant and atomic relation/accounting projection from the previous change remain intact.

## Independent authorities

**REVIEW_COMPLETE** means REVIEWED_WITH_CLAIMS or REVIEWED_NO_CLAIMS: all semantic content and assigned references are accounted for. Only these rows count toward final source accounting and inventory freeze.

**CLAIM_ENDPOINT_READY** is a predicate over an individual claim in committed persistence. `referenceDependencyView` checks the exact run, inventory revision, source version and materialization; a published payload certificate; payload schema; normalized canonical claim identity; row ownership; source anchors; and duplicate ownership. The review's completed state is not a condition. BLOCKED_REFERENCE can publish eligible claims, and endogenous REOPENED/IN_REVIEW repair retains the last committed publication. An uncommitted Agent draft never supplies cross-review authority.

The existing `completionFingerprint` field serves as the committed-publication certificate for both complete and blocked payloads. Its non-null value does not imply REVIEW_COMPLETE. An **explicit semantic REOPEN** withdraws that publication certificate until the owner republishes; its previous fingerprint is preserved in the frontier's SOURCE_REOPEN record. This distinguishes intentional semantic reconsideration from automatic dependency wake. A lease change or timestamp never withdraws publication or changes a claim's semantic fingerprint. Republication through BLOCKED_REFERENCE restores eligible claims without requiring review completion.

Inspection returns `targetReviewState`, `targetClaimAvailability`, `targetReviewComplete`, `bindingCanProceed`, bounded target candidates and a required action. A completed or blocked review with no eligible claims remains NOT_AVAILABLE. Structural resolution, scope and endpoint availability are reported separately; the runtime does not choose which candidate is legally correct.

## Durable transitions

| Transition | Persisted effect |
|---|---|
| PENDING/REOPENED → IN_REVIEW | Acquire operation ID and finite lease under the run lock |
| IN_REVIEW → BLOCKED_REFERENCE | Commit canonical claims, valid bindings, accounting, missing-reference IDs and endpoint snapshots; release lease |
| IN_REVIEW → REVIEWED_WITH_CLAIMS / REVIEWED_NO_CLAIMS | Commit full review evidence, publish endpoints, release lease |
| BLOCKED_REFERENCE → REOPENED | A blocked reference gains or changes eligible endpoints; preserve its published claims |
| Complete/blocked → explicit REOPENED | Record semantic reconsideration; withdraw publication until republished |
| Any dependent with a changed/deleted endpoint → REOPENED | Preserve its original relation as invalidated repair evidence; withdraw material accounting for that relation; revoke stale lease |
| IN_REVIEW with an expired lease → reacquired IN_REVIEW | Fence the prior operation; reconstruct committed evidence and discard an obsolete local draft |

All authoritative operations use the existing RuleSetPreparationRun row lock, also used by inventory freeze. There is no new table, schema migration, in-memory dependency authority or SCC persistence layer.

## Publication and fixed-point scheduling

Each blocked reference records a deterministic fingerprint of its eligible target claim IDs and semantic fingerprints. Publication, including a BLOCKED_REFERENCE publication, reevaluates affected blocked decisions. A newly available or semantically changed target causes a durable REOPENED transition. Replaying that publication cannot duplicate rows or repeatedly wake an unchanged blocked row. A reference whose endpoints are already available cannot be listed as an unavailable blocker; the Agent must bind a candidate or explicitly reopen a target requiring semantic correction.

NEXT and PROGRESS also reconcile durable blocked evidence. This recovers a restart or a legacy snapshot that already contains endpoint-ready blocked claims. A review with all its blocked references available is requeued even if its old snapshot incorrectly said available. No model retry is required to discover the wake transition.

Fresh PENDING units are scheduled before eligible repairs so they can publish their endpoints. Among eligible REOPENED repairs, completed targets are only a preference; they are never an eligibility requirement. This permits the deterministic A-publishes, B-publishes, C-binds-A, B-binds-C, A-binds-B three-node sequence while allowing a two-node cycle's second unit to consume the first unit's blocked publication.

Before returning an idle blocked frontier, the runtime classifies each blocked reference: structural unresolved/ambiguous, target outside scope, target claims unavailable, or target claims available. Tarjan SCC analysis identifies internal cyclic waits. The returned diagnostic is bounded. An idle frontier with a remaining eligible publication wake is FALSE_DEADLOCK and raises a deterministic invariant failure instead of reporting an external wait.

For a finite fixed source and stable semantic claims, publication increases endpoint information. Eligible repair removes a false blocker; it cannot be refused merely because its target review remains incomplete. The worklist is not a topological sort. Under the stated preconditions—resolved in-scope targets, sufficient canonical endpoints, no genuine missing semantic prerequisite and no active lease—an idle internal ready wait is reconciled to runnable work. Semantic authoring and target choice remain the Agent's responsibility. An unresolved reference or genuinely absent compatible semantic claim remains a truthful prerequisite; the runtime does not fabricate a relation or change materiality.

## Semantic invalidation

`claimEndpointFingerprint` covers canonical ID, source version, type, normalized statement, actor/modality/action, anchors, relevance state and non-operative reason. It excludes leases, DB timestamps and review completion state. Python and API use the same normalization definition. Binding captures the current committed foreign endpoint fingerprints internally; the Agent never copies them.

COMPLETE compares those snapshots to current authoritative endpoints while holding the run lock. A stale client cannot complete using changed meaning under a stable canonical claim ID. On target publication, changed or removed claim IDs locate dependent persisted relations. Each affected review is durably REOPENED, stale leases are revoked, relation IDs are marked invalidated, and material accounting is recomputed without them. The relation object is retained as repair evidence. The runtime never chooses a replacement claim or silently changes the Agent's semantic direction/kind.

Restoration excludes invalidated relations from the authoritative draft and exposes them in the owning unit's `invalidatedRelations`. The Agent must explicitly rebind or remove a mistaken/stale decision with a reason. Completion cannot hide an unaddressed invalidation. If no replacement endpoint exists yet, a blocked publication may retain an unchanged, previously invalidated relation as quarantined evidence while publishing its own claims. The API verifies that the quarantine already exists and that the retained object is identical; it cannot be used to smuggle a new bad relation past direction validation. Such a row is incomplete and cannot freeze inventory.

## Safety, concurrency and restart

Publication, wake, invalidation, lease fencing and counters/fingerprints commit in one serialized transaction. Competing inspections observe either the before or after committed view. A target semantic commit racing a dependent completion either invalidates the completed dependent afterward or makes its stale endpoint snapshot fail before completion. Double wake and completion replay preserve canonical relation IDs and counters.

All reconstruction inputs are in review rows and the pinned structural graph: claims/identities, publication certificate, relation ownership, dependency snapshots, blocked endpoint snapshots and invalidation metadata. A fresh Agent context restores these after every tested publication stage. An expired lease cannot promote a crashed uncommitted draft to authority. Real semantic state changes alter the frontier/effective fingerprint; unchanged validation still triggers the existing NoProgressDetected behavior. No model-call budget or retry-count workaround was introduced.

## Verification and limits

The compact model enumerates every directed simple graph for N=1..4: 4,165 topologies, 1,085,691 reachable states and 1,486,154 transitions in the initial exhaustive receipt. The model enumerates acquisition orders rather than assuming one convenient traversal. Fixed claim semantics permit compact state equivalence; edge bindings and blockers remain part of the state key. It uses the actual domain endpoint/wake functions, verifies binding safety and terminal canonical-graph independence, and prints graph, unit/edge availability and transition sequence on a false deadlock. Fault injection of the old completion-only rule yields that witness. Separate cases cover parallel references, self references, mixed materiality and genuine unresolved prerequisites.

Real API/PostgreSQL/native-tool tests cover the exact retained 8-reviewed/3-blocked snapshot through 11 reviewed and frozen inventory; chains, diamonds, 2/3/4-node SCCs, tails, inbound/outbound edges and independent SCCs; every-commit restart; target update/deletion; publication/inspection/block races; two dependents; duplicate wake/completion; explicit reopen races; stale completion; lease expiry; and missing replacement endpoints. The real Managed Deep Agent harness uses a scripted model for three-node cycle convergence and inventory freeze.

These are bounded model checks plus transactional regressions, not an assertion that arbitrary Agent legal interpretation is correct. Full suites, deployment replay and the one live full semantic disposable are separate gates recorded in the final report. No live provider call is permitted until every pre-live gate passes.
