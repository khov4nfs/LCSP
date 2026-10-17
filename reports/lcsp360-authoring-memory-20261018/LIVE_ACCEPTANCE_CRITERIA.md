# Live acceptance criteria (pre-registered before the single new disposable is dispatched)

Subject: Rule Authoring model-facing memory (working set, runtime digest, normalized read pagination, phase-aware compaction).
The deterministic suite drives the real DraftHistoryMiddleware with a model that only sees what the middleware shows it, so it proves the
information the model needs is present in every request. It cannot prove that the live model USES it: the scripted probe is a
deterministic policy, the live model is not. The live run is the only test of that behavior and only one run is authorized.
Verdicts are fixed here, before dispatch, and are not reinterpreted afterwards.

| Observation | Verdict |
|---|---|
| Discovery 11/11 units reviewed, zero pending/blocked/inReview; applicability claims present; finalization PASS; exactly one frozen revision; inventory reads converge (no reread loop, no NoProgressDetected); LegalRequirement > 0 and AssessmentRule > 0; at least one RULE_VALIDATION_STARTED and a RULE_VALIDATION_PASSED; explicit submit; Completion Gate ACCEPTED; Rule Set persisted; Preparation SUCCEEDED; semantic review 19/19 | ACCEPTED |
| Everything above, but one or more rejected authoring/read calls that the Agent then corrected using the RULE AUTHORING STATE digest (OUTSTANDING PROBLEM cleared by a corrected call) | ACCEPTED, recorded as "rejection retained and recovered": the fix working as designed |
| Mechanical success but semantic review below 19/19 | NOT_ACCEPTED. Mechanical success is not acceptance. Boundary SEMANTIC_FIDELITY |
| Frozen inventory, then the Agent never authors a Requirement (reread loop, NoProgressDetected, or no `author_*` call) while the digest was present in its requests | NOT_ACCEPTED. Boundary AUTHORING_MEMORY if the digest/view lacked something the Agent needed, otherwise RULE_AUTHORING (model reasoning). DETERMINISTIC_COVERAGE = INADEQUATE only if a provider-free test should have caught the failing state |
| Navigation failure: a read repeats with no new information, or paging never reaches the end | NOT_ACCEPTED. Boundary INVENTORY_NAVIGATION |
| Real Rule Validator runs (RULE_VALIDATION_STARTED > 0) and fails the Agent cannot repair | NOT_ACCEPTED. Boundary RULE_VALIDATION. The validator is not weakened |
| Provider/gateway failure (empty tool arguments, upstream error, rate limit, model route unavailable) | NOT_ACCEPTED. Boundary PROVIDER_RUNTIME |
| Any other terminal failure | NOT_ACCEPTED with exactly one boundary from: AUTHORING_MEMORY, INVENTORY_NAVIGATION, RULE_AUTHORING, RULE_VALIDATION, SEMANTIC_FIDELITY, PROVIDER_RUNTIME, OTHER |

Counting rules: Rule Validator attempts = RULE_VALIDATION_STARTED events. Tool rejections (CLAIM_DISCOVERY_TOOL_REJECTED,
CLAIM_INVENTORY_READ_REJECTED, RULE_AUTHORING_TOOL_REJECTED) are reported separately and are never validator attempts. Authoring-memory
telemetry (RULE_AUTHORING_CONTEXT: frozenInventoryRevision, authoringContextRevision, inventoryPagesSurfaced, unreadClaimCount,
outstandingRejectionCode, authoredRequirements, authoredAssessmentRules, digestBytes) is evidence only, never an acceptance input.

No second disposable, no retry, no patch-and-retry, no preliminary diagnostic run in any case. A NOT_ACCEPTED verdict ends the task.
Production full corpus (Legal Source Version 80bcda31-d0a7-4463-9f6e-41bd6da6ff12) is not started by this task.
