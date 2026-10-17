# Live acceptance criteria (pre-registered before the single new disposable is dispatched)

Subject: the Rule Authoring tool contract and error recovery (durable rejection envelope, framework-level capture, intent-based
resolution, digest refreshed inside the provider-retry loop, `get_rule_authoring_status`, ordered telemetry).

What the deterministic suite does and does not prove. It drives the real Agent stack with scripted models that make many kinds of
mistake and still reach a real Rule validator PASS and a submission. It cannot prove that the live model uses the feedback. The live run
is the only test of that, and exactly one is authorized. Verdicts are fixed here and are not reinterpreted afterwards.

## Route policy (decided from a fresh probe, not assumed)

The disposable runs under an acceptance-only `LCSP_MODEL_ROUTES_FILE` derived from `PROVIDER_READINESS_final.json`: only routes that are
reachable, have at least one healthy credential slot and pass the tool-contract conformance probe are approved; `google_genai/gemini-3.5-flash-lite`
is excluded by policy (it carried every completion of both earlier live runs); fallback exists but only inside the approved set. If no route is
approved, or the probe is older than 45 minutes at dispatch, the run is NOT dispatched and the allowance stays unused
(`LIVE_ACCEPTANCE_PROVIDER_ROUTE = NOT_READY`). A completion on any route outside the approved set is a `ROUTE_POLICY_VIOLATION` and the run is NOT_ACCEPTED.

## Verdicts

| Observation | Verdict |
|---|---|
| Discovery 11/11 units reviewed, zero pending/blocked/inReview; applicability claims present; inventory validation PASS; exactly one frozen revision; Requirements > 0 and AssessmentRules > 0 authored; at least one `RULE_VALIDATION_STARTED` and a `RULE_VALIDATION_PASSED`; explicit submit; Completion Gate ACCEPTED; Rule Set persisted; Preparation SUCCEEDED; semantic review 19/19; every rejected authoring call has a durable envelope and a recorded fate (`AUTHORING_OBSERVABILITY = PASS`); every completion on an approved route | ACCEPTED |
| Everything above, with rejected authoring calls that the Agent corrected from the digest | ACCEPTED, recorded as "rejection retained and recovered" (success does not require zero tool mistakes) |
| Everything above but a rejection has no envelope or no recorded fate | NOT_ACCEPTED, boundary AUTHORING_OBSERVABILITY, even though the run succeeded |
| Mechanical success but semantic review below 19/19 | NOT_ACCEPTED, boundary SEMANTIC_FIDELITY. Mechanical success is not acceptance |
| Requirements authored but the run ends on stagnation (identical rejected mutation, unchanged draft) while the digest carried the rejection | NOT_ACCEPTED, boundary REQUIREMENT_AUTHORING (model behavior). `DETERMINISTIC_COVERAGE = INADEQUATE` only if a provider-free test of that failing state should have caught it |
| The Agent never authors a Requirement, or a read repeats without new information | NOT_ACCEPTED, boundary REQUIREMENT_AUTHORING or CLAIM_INVENTORY respectively |
| Real Rule validator runs and fails in a way the Agent cannot repair | NOT_ACCEPTED, boundary RULE_VALIDATION. The validator is not weakened |
| Provider failure that ends the run (every approved route refused) | NOT_ACCEPTED, boundary PROVIDER_RUNTIME |
| Any other terminal failure | NOT_ACCEPTED with exactly one boundary from: CLAIM_DISCOVERY, CLAIM_INVENTORY, REQUIREMENT_AUTHORING, ASSESSMENT_RULE_AUTHORING, RULE_VALIDATION, SUBMISSION, COMPLETION_GATE, SEMANTIC_FIDELITY, PROVIDER_RUNTIME, OTHER (AUTHORING_OBSERVABILITY failure is recorded under OTHER) |

Counting rules. Rule validator attempts are `RULE_VALIDATION_STARTED` events only. A rejected authoring call (`RULE_AUTHORING_TOOL_REJECTED`) is never
a validator attempt. Ordering is by `event_sequence`, never by wall-clock time. The per-rejection table comes from `authoring-rejection-report.py`
(durable events only, no hidden reasoning); the per-phase model table comes from `model-route-report.py`.

No second disposable, no retry, no patch-and-retry, no preliminary diagnostic run, in any case. A NOT_ACCEPTED verdict ends the task.
The production full corpus (Legal Source Version `80bcda31-d0a7-4463-9f6e-41bd6da6ff12`) is not started by this task.
