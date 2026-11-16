# PR #498 groundcheck remediation

The 2026-11-16 groundcheck found production wiring gaps despite closed implementation tickets. This follow-up repairs those paths and distinguishes local verification from remote CI and product enablement.

## Root cause

- Applicability logic existed in validator tests but was absent from source-authoring, persistence and the production validation context.
- Completion accepted dependency-verified historical decisions while report and tracking readers still required the latest revision.
- Explicit free-text uncertainty bypassed guards for ordinary factual questions.
- Report ingress retained the default 1 MB body limit, and the working-context policy was only attached manually by tests.
- Same-assessment support foreign keys checked cascading deletion in an order that rejected authorized erasure. The canonical deletion fixture reproduced `AssessmentDecisionEvidenceDependency_evidence_fkey`.
- Latest-command eligibility used a correlated outbox anti-join per pending command. The 10,001-command case varied from milliseconds to tens of seconds with changing planner statistics and expired admission/telemetry transactions.
- The route allowlist, invalidation fixture and report UTF-8 boundary test were stale. Report contract tests were not selected by CI.
- #476 was marked complete while its GitHub App ADR and subsequent approval/implementation phases remained pending.

## Fix

- Add optional, source-authored version-1 ALL/ANY applicability logic with bounded material indices, carry it through direct authoring, immutable packet persistence/readback and decision context, and expose it in source guidance. Historical packets remain unchanged. Without known logic, unresolved conditions cannot establish a verdict; the runtime does not guess a connector.
- Preserve historical decision bytes and include the completion gate's exact dependency revalidation in V3 reports. SQL and per-assessment tracking verify the same complete evidence/fact edge sets before accepting an older revision. Future revisions, incomplete or mismatched dependencies still fail closed.
- Keep explicit EN/VI uncertainty as an OPEN request with a non-authoritative proposal and the original customer text. Typed normalization does not turn uncertainty into a fact.
- Use the shared bounded report byte limit only on final-report ingress, install the context policy in the shared governed summary constructor, and run report contract/readers in CI.
- Defer same-assessment support foreign-key checks to transaction commit. Both ends disappear during authorized assessment erasure; deleting referenced support independently remains prohibited. Do not disable constraints or change shared legal-source ownership.
- Materialize latest Root commands once (or for the exact point lookup) before applying the existing fairness and eligibility guards. Keep the transaction deadlines and 10,001-command backlog; do not hide the failure by increasing timeouts.
- Update the reviewed route surface and fixtures. GitHub App remains disabled pending its documented approval phases; issue closure and PR prose are corrected rather than represented as delivered onboarding.

## Verified locally

All integration execution uses newly created loopback PostgreSQL test containers. No shared/production database or paid provider is used.

- API and runtime-package build, TypeScript check, import/contract policies and business documentation checks pass.
- Focused API regressions: 145 tests pass.
- Shared contracts: 157 tests pass; all 27 V3 report contract/reader tests pass, including the historical-dependency regression.
- Full Python suite: 3,091 tests pass, 27 skipped and 9 subtests pass.
- Real PostgreSQL loader-to-validator tests cover persisted ALL/ANY/unknown connectors. Activation persistence retains the authored logic.
- Real PostgreSQL tracking preserves a historical accepted decision after unrelated revision advancement, then rejects it after a dependency edge is removed.
- Canonical API/PostgreSQL/native Python vertical: 228 checks pass, including PDF download and authorized deletion, native checkpoint/sandbox erasure, detached accounting and another tenant's byte-identical survivor state. The deletion fixture also checks the new support/discovery/proposal tables.
- Full available capacity integration: 52 tests pass; the broker-specific case requires its separate RabbitMQ fixture. The 10,001-command scenario passes after the query repair; this alone does not replace the failed remote receipt.

The final delivery records exact commit and final suite totals in the PR. A successful local run is not remote CI, production acceptance, legal-semantic approval or permission to enable GitHub App onboarding. Paid A/B benchmarks, external GitHub App installation, production rollout and the broader deferred Wave 2 packages remain outside this correction.
