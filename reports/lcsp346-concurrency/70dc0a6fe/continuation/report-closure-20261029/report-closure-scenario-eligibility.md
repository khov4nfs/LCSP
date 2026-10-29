# Fresh report scenario eligibility — LCSP-346

Implementation inspected: `44dba336f332d566d3fee9fc0d32642a402d024e`.

## Decision

**No eligible new production Assessment has been established. Zero new Assessments, Root executions, provider requests or reports were created in this closure phase.** The existing third-party benchmark unknowns remain unchanged. A hypothetical deployment was not supplied as a confirmed production fact.

This is a pre-execution eligibility blocker, not a failed production Assessment. No new Assessment ID, Root ID, artifact ID, generation timestamp, checksum, rendering screenshot, download receipt or cross-account denial exists for a fresh report in this phase.

## What the current production workflow supports

1. The customer creates an Assessment; creation pins the active authoritative Rule Set.
2. Supported repository setup creates the genuine snapshot, commit pin and source view, then dispatches the native Root through the outbox/broker.
3. The Root investigates source, accepts evidence-cited technical facts, and requests operational facts through native human resolution where needed.
4. A known customer answer is stored verbatim as an accepted `HUMAN_PROVIDED` fact. An unknown answer stays OPEN and creates no fact or case revision.
5. Every one of the 243 pinned rules must have current, source-justified accepted coverage with matching versions/revisions/pins and valid evidence/fact references. Unknown applicability cannot be converted into a final verdict.
6. The Completion Gate requires valid pins and coverage, no open human blocker, an active eligible execution and the existing lifecycle/control invariants.
7. Supported finalization enters FINALIZING. Native report submission must cover the frozen decisions exactly, pass report/schema/integrity checks, write verified immutable bytes, activate the artifact and complete the lifecycle.
8. Acceptance then verifies the newly generated artifact timestamp/hash, customer rendering, successful download, foreign-account denial and usage/cost attribution.

These are conditions to attempt the workflow, not a guarantee that any given facts will make all legal questions resolvable. The Root and Completion Gate determine the outcome.

## Why a labelled hypothetical is not an eligible substitute

The current fact authority set is only `EVIDENCE_CITED` and `HUMAN_PROVIDED`. Fact, Root context and final report contracts have no controlled-test/hypothetical scenario discriminator. Root context projects pins, facts/evidence and open human request IDs; it does not project the Assessment name/description as a frozen scenario boundary.

The final report can retain labels in narrative or referenced fact statements, but no mandatory whole-report field or validation binds it to a hypothetical test world. A name/description or a free-text `SYNTHETIC` prefix would therefore be an unenforced convention. Inspection did not establish a supported safe scenario mode. No text-based workaround, direct evidence insertion, fixture API, direct report generation, manual decision/status update, custom Rule Set or scope reduction was used.

This limitation is supported by the pinned source inventory and provider-free contract shape probe. It is not a new semantic regression, and no feature was added to PR #440 to address it.

## A legitimate controlled deployment can use the normal workflow

The authorized project owner may provide an actual controlled use/deployment they own, with:

- A real repository/pinned commit and a deployment or execution record matching that source.
- A responsible operator who is authorized to attest to the actual use; do not substitute the LCSP benchmark tester for an unknown upstream operator.
- Verifiable actual purpose, deployment state/jurisdiction, data subjects/data and use of model outputs. State agency/regulated-sector/security-critical roles require their own facts; a repository title does not prove them.
- Actual data-sharing/processor/cross-border arrangements and external safeguards, where those facts are material. Verified absence can be supplied; missing evidence remains unknown.
- Clear separation of synthetic input records used in a real controlled execution from a hypothetical deployment assertion. No claim about unrelated public deployments follows from this controlled use.

An operator attestation can be supplied through supported HITL; source/operational observations must be attributable and independently inspectable. Unknowns remain unknown. No rule verdict, guaranteed report outcome or predetermined NOT_APPLICABLE answer should be supplied.

No such verified owned-deployment context has been supplied as of this checkpoint. A question requesting it is pending with the user. Elapsed time is not authorization or a factual answer.

## Formal project-owner acceptance decision, if no eligible case is available

The current requirement stays BLOCKED unless the owner explicitly chooses one of these paths:

1. **Retain the fresh-report condition** and provide verified context for an actual owned controlled deployment. Authorize one necessary production end-to-end run after refreshed resource/provider preflight; retain its outcome even if it legitimately pauses/fails.
2. **Formally accept specified alternative evidence for LCSP-346**: native exact-build concurrency/control proof, real API/DB/native scripted report contract tests, and unchanged existing-report read/download/access-control proof. The decision must state that fresh actual production Root completion/report generation remains unproven, identify the residual risk and acceptance rationale, and be attributed/dated in Jira and PR #440 before any gate disposition changes.

This document requests a decision; it does not grant an alternative acceptance or waive independent reviewer approval. No owner acceptance was inferred from the task, previous unknown answers, time passing or green CI.

## Production resource and cost disposition

At the fresh preflight: disk 2,132,709,376 bytes free (95% used); memory 4,903,325,696 bytes available; seven persistent repository sandboxes running with configured 2 GiB limits; zero active Assessment leases, no running native transport runs and Root broker ready/unacked zero. All 11 Docker images were in active use; no image, sandbox, checkpoint, record or artifact was deleted. Active/idle client database connections were 4 of the configured 100 maximum (plus five PostgreSQL background processes).

The first read-only preflight incorrectly looked for admission tables in the usage-only journal and stopped with `no such table: inference_attempts`. The corrected observation explicitly records that this journal does not establish paid-admission readiness. No provider credential/readiness call or new admission was invoked because no eligible run was established. Existing settled/unavailable records are unchanged. One global quarantined usage row predates deployment (October 23) and is outside the LCSP-346 recovery cases; it was preserved.

Additional metered execution in this closure phase: **0 provider calls / 0 tokens / $0 added usage**. This is not a claim that unknown cost on the earlier failed provider attempt became zero. Its existing partial reference-cost disposition is unchanged.
