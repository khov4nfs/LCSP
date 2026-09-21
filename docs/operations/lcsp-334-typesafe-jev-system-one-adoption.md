# LCSP-334 TypeSafe AI Jev System One adoption plan

## Status

PLANNED ARCHITECTURE CONTRACT - SHADOW-FIRST ONLY

This document defines the safe adoption plan for TypeSafe AI Jev as a
non-authoritative System One decision layer in LCSP. It is an implementation
planning artifact, not proof that Jev is enabled in production.

Jev may support only bounded typed decisions such as routing, triage, scoring,
confidence estimation and escalation. It must never replace Scanner/PGE
authority, EngineeringRule authority, deterministic legal/compliance gates,
EvidenceClaim validation, or the final legal/risk verdict.

## Authority Contract

Jev output is a decision signal. It is never evidence, never legal authority and
never a compliance/risk verdict.

The following LCSP boundaries remain authoritative:

- Scanner and Program Evidence Graph evidence;
- EngineeringRule preparation, activation and pinned rule identity;
- deterministic legal/compliance gates;
- EvidenceClaim validation and graph-topology checks;
- customer-confirmed Interview authority;
- final legal applicability, compliance, risk tier and review-readiness
  decisions.

Jev must not emit, approve, infer or activate any of the following authoritative
outcomes:

- `COMPLIANT`, `NON_COMPLIANT`, legal applicability or final risk tier;
- final review readiness;
- new or activated EngineeringRules;
- authoritative EvidenceClaims;
- proof of absence, proof of compliance, or legal sufficiency.

Confidence, probability and calibration metadata are operational signals only.
They are not proof.

## Target Architecture

```text
Authoritative LCSP state/evidence
        |
        v
bounded + redacted DecisionState
        |
        v
LCSP Decision Gateway
        |
        v
Jev Choice / Score / Noul
        |
        v
Decision Policy / confidence thresholds
   +----+---------------------------+
   |                                |
   v                                v
deterministic transition       existing GPT/Gemini reasoning
   +------------+-------------------+
                |
                v
Planner / Investigator / Interview
                |
                v
existing deterministic validators and gates
```

The LCSP Decision Gateway is deliberately independent from
`deepagents/model_policy.py`. Jev is not a LangChain chat model and must not be
accepted as a value of `LCSP_MODEL_PROVIDER`.

## Decision Gateway Contract

The gateway owns all interaction with Jev. Integrations call the gateway with a
closed decision type, a bounded `DecisionState`, an allowlist of choices or a
score rubric, and artifact/version references.

Required inputs:

- `decision_id`, generated before provider invocation;
- `decision_type`, from a closed contract value set;
- `mode`, defaulting to `SHADOW`;
- `state_schema_version`;
- `policy_version`;
- `assessment_id`, `run_id`, `head_sha` when available;
- artifact/version hashes instead of raw artifact bodies;
- allowed choices, score rubric, or Noul contract;
- deterministic fallback action.

Required gateway behavior:

- apply privacy redaction before any remote provider call;
- reject raw source, prompts, hidden reasoning, credentials, token-bearing URLs,
  private Customer context and secret environment values;
- enforce per-decision timeouts, bounded retries and fail-closed fallback;
- validate Jev output against the requested typed contract;
- apply deterministic confidence policy after provider output;
- persist semantic telemetry without raw prompt/source content;
- in `SHADOW`, return the existing LCSP behavior as the effective decision while
  recording Jev's candidate result separately.

Suggested package layout:

```text
deepagents/decision/
  __init__.py
  contracts.py
  gateway.py
  policy.py
  typesafe_client.py
  redaction.py
  telemetry.py
```

Suggested configuration:

```text
LCSP_DECISION_PROVIDER=jev
LCSP_DECISION_MODE=shadow
LCSP_DECISION_FALLBACK=existing
TYPESAFE_API_KEY=...
LCSP_JEV_TIMEOUT_MS=...
LCSP_JEV_CONFIDENCE_POLICY_VERSION=...
```

Provider configuration must be read only by the Jev adapter and secret-bearing
values must never be included in telemetry, errors, or runtime events.

## Privacy Contract

Remote payloads must be bounded, redacted and artifact/version referenced. Jev
payloads may include summarized, non-sensitive state needed to answer the exact
bounded question, but must not include:

- unrestricted repository source;
- raw system or developer prompts;
- hidden model reasoning or chain-of-thought;
- credentials, token-bearing URLs, API keys, passwords or secret environment
  values;
- unrestricted Customer context or private Interview store values;
- raw legal corpus text unless explicitly approved for a future decision type;
- unbounded tool output dumps or full PGE artifacts.

Payloads should use stable refs and hashes:

- PGE artifact version hash;
- EngineeringRule IDs and rule version refs, not rule bodies unless needed and
  separately redacted;
- scan coverage summaries and counts;
- customer-safe topic keys, not customer private text;
- existing runtime state summaries;
- candidate IDs with compact features, not raw source snippets.

Any redaction uncertainty falls back to existing LCSP behavior without calling
Jev.

## Telemetry Contract

Persist semantic decision telemetry. The telemetry must be enough to audit
calibration, fallback and cost without persisting sensitive content.

Minimum fields:

- provider;
- model/version;
- decision ID;
- decision type and question IDs;
- allowed choices or score rubric;
- selected result;
- probabilities;
- confidence;
- threshold and policy version;
- fallback action;
- latency and usage;
- assessment, run and head IDs;
- input artifact/version hashes;
- redaction version and redaction outcome;
- shadow/effective decision split.

Runtime event classes:

- `DECISION_MODEL_REQUEST`;
- `DECISION_MODEL_RESULT`;
- `DECISION_THRESHOLD_APPLIED`;
- `DECISION_FALLBACK`.

These classes are decision-model telemetry. They must not be treated as
EvidenceClaim, Scanner/PGE, EngineeringRule, legal or final-verdict events.

## Confidence Policy

Every decision type has an explicit policy row:

- allowed modes: `SHADOW`, `ASSIST`, `ACTIVE`;
- minimum confidence;
- maximum false-negative tolerance;
- fallback action;
- escalation action;
- safety-critical flag;
- activation owner;
- evaluation set requirement;
- policy version.

Low confidence, provider failure, invalid output, privacy-redaction uncertainty,
policy mismatch, unsupported decision type, expired model version, or timeout
always falls back to current LCSP behavior.

Initial production mode is `SHADOW`. `ACTIVE` is allowed only for an
allowlisted decision type after the evaluation gate in this document passes and
after a separate reviewed activation change updates the policy.

## Initial Decision Type Allowlist

### Phase B low-risk shadow decisions

`PR_REVIEW_TRIAGE`

- Purpose: route review-domain and risk-triage work.
- Jev may choose: bounded review bucket, escalation flag, confidence.
- Jev must not choose: final PR readiness, managed-sandbox readiness, legal
  sufficiency or release approval.
- Fallback: current review routing.

`ROOT_NON_DETERMINISTIC_NEXT_STAGE`

- Purpose: suggest root orchestration routing only where current state does not
  already force a deterministic transition.
- Jev may choose: one allowed next-stage candidate or fallback/escalate.
- Jev must not choose: bypass Interview, EngineeringRule readiness, deterministic
  gate status, or final assessment result.
- Fallback: current root orchestration behavior.

`INTERVIEW_TOPIC_ROUTING`

- Purpose: pick customer-safe uncertainty topic ownership and routing.
- Jev may choose: existing topic key, ask/clarify/escalate signal.
- Jev must not choose: Customer confirmation, legal applicability, or targeted
  continuation validity.
- Fallback: current Interview routing and API guards.

### Phase C tool-loop optimization decisions

`PLANNER_CANDIDATE_RANKING`

- Purpose: rank already-authorized graph candidates for Planner efficiency.
- Jev may choose: ordering or score over candidate IDs.
- Jev must not choose: active EngineeringRule set, criteria, legal relevance, or
  investigation closure.
- Fallback: current Planner ordering.

`INVESTIGATOR_NEXT_ACTION`

- Purpose: suggest next tool, continue, clarify or escalate in a bounded
  Investigator loop.
- Jev may choose: next action from a closed allowlist.
- Jev must not choose: EvidenceClaim content, claim closure, compliance,
  absence proof or final gate status.
- Fallback: current Investigator reasoning/tool path.

## Evaluation Gate

Active routing is blocked until an LCSP-specific labeled evaluation set
exists for the target decision type.

Measure at minimum:

- agreement with accepted LCSP outcomes;
- false-negative rate for safety-critical escalation;
- calibration by confidence bucket;
- fallback rate;
- invalid-output rate;
- redaction-rejection rate;
- p50 and p95 latency;
- provider cost;
- reasoning-token reduction in the existing GPT/Gemini path;
- drift by provider model/version;
- outcome parity in shadow mode.

Suggested activation thresholds for non-safety-critical decisions:

- zero observed boundary violations in the labeled eval set;
- false-negative rate at or below the policy row limit;
- p95 latency within the per-decision budget;
- invalid-output and timeout fallback rates within budget;
- calibrated confidence monotonicity across buckets;
- documented rollback path to `SHADOW`.

Safety-critical decisions remain `SHADOW` or `ASSIST` unless a separate
architecture review explicitly approves `ACTIVE` mode.

## Rollout Phases

### Phase A - Core

- introduce the LCSP Decision Gateway independent from `model_policy.py`;
- implement Jev adapter and typed Choice/Score/Noul contracts;
- implement privacy redaction and confidence policy;
- implement provider timeout, retry and fallback;
- persist semantic decision telemetry.

### Phase B - Low-risk shadow integrations

- PR review triage;
- root orchestration routing only for non-deterministic transitions;
- Interview routing/topic selection.

### Phase C - Tool-loop optimization

- Planner graph candidate ranking;
- Investigator next-tool, continue or clarify routing.

### Phase D - Evaluation and controlled activation

- build LCSP-specific labeled eval sets;
- measure agreement, false-negative rate, calibration, fallback, latency, cost
  and reasoning-token reduction;
- enable `ACTIVE` routing only per allowlisted decision type after thresholds
  are satisfied;
- preserve reasoning-model fallback for uncertain or safety-critical decisions.

## Sprint 12 Tracking Map

The Sprint 12 implementation issues already exist. The `S12-JEV-*` sections
below are conceptual checklist slices for this architecture plan, not new Jira
issues to create. Track implementation through the canonical Jira issues:

| Conceptual sections | Canonical Jira issue |
| --- | --- |
| `S12-JEV-01` through `S12-JEV-04` | LCSP-335 |
| `S12-JEV-05` and `S12-JEV-06` | LCSP-336 |
| `S12-JEV-07` | LCSP-337 |
| `S12-JEV-08` | LCSP-338 |

### S12-JEV-01 - Architecture contract and decision-type registry

Scope:

- add reviewed architecture docs and closed decision-type contracts;
- define allowed modes, fallback semantics and prohibited authority outputs;
- ensure Jev is not wired through `LCSP_MODEL_PROVIDER`.

Safety boundaries:

- Jev output is a signal only;
- no legal/compliance/risk verdict delegation;
- no EngineeringRule creation or activation;
- no EvidenceClaim authoring authority.

Regression expectations:

- tests or static checks reject unsupported decision types;
- tests reject attempts to configure Jev as a LangChain chat provider;
- documentation explicitly names Scanner/PGE, EngineeringRule, EvidenceClaim and
  deterministic gates as authority boundaries.

### S12-JEV-02 - Core Decision Gateway and typed contracts

Scope:

- implement `deepagents/decision/contracts.py`, `gateway.py` and `policy.py`;
- support typed Choice, Score and Noul responses;
- default to `SHADOW` with effective decision equal to existing behavior.

Safety boundaries:

- invalid output, policy mismatch, low confidence and provider failure all use
  fallback;
- no integration may consume raw provider output directly.

Regression expectations:

- unit tests cover valid choice, invalid choice, low confidence, timeout,
  provider error and fallback;
- shadow tests prove Jev candidate output cannot alter effective production
  outcome.

### S12-JEV-03 - Jev adapter, redaction and provider controls

Scope:

- implement `typesafe_client.py` and `redaction.py`;
- add timeout/retry controls and non-secret provider telemetry;
- redact or reject sensitive payload fields before remote calls.

Safety boundaries:

- no raw source, prompts, hidden reasoning, credentials, private Customer
  context or secret environment values leave LCSP;
- redaction uncertainty blocks the provider call.

Regression expectations:

- tests reject secret-like values and prompt/source/private-context field names;
- tests prove telemetry omits `TYPESAFE_API_KEY` and token-bearing URLs;
- tests cover timeout and bounded retry behavior.

### S12-JEV-04 - Semantic decision telemetry

Scope:

- persist decision telemetry and runtime events:
  `DECISION_MODEL_REQUEST`, `DECISION_MODEL_RESULT`,
  `DECISION_THRESHOLD_APPLIED`, `DECISION_FALLBACK`;
- store artifact/version hashes, policy version, latency and usage;
- expose shadow/effective split for observability.

Safety boundaries:

- runtime events do not persist raw prompt/source/customer content;
- decision telemetry is not evidence and cannot be read as a legal verdict.

Regression expectations:

- API/runtime-event tests verify new event classes and redaction;
- tests prove fallback events are emitted for low confidence and provider
  failure;
- snapshot or contract tests verify no authoritative verdict fields are present.

### S12-JEV-05 - Phase B shadow PR and root routing integrations

Scope:

- integrate `PR_REVIEW_TRIAGE` in shadow mode;
- integrate `ROOT_NON_DETERMINISTIC_NEXT_STAGE` only where current state has no
  deterministic transition;
- record Jev candidate decisions while preserving current outcomes.

Safety boundaries:

- no release readiness, managed-sandbox readiness, legal sufficiency or final
  assessment readiness may use Jev as authority;
- deterministic transitions bypass Jev entirely.

Regression expectations:

- tests prove deterministic transitions never call the gateway;
- tests prove PR/review decisions remain existing behavior in shadow;
- tests cover provider failure and low-confidence fallback.

### S12-JEV-06 - Phase B shadow Interview topic routing

Scope:

- integrate `INTERVIEW_TOPIC_ROUTING` for topic selection and escalation hints;
- use customer-safe topic keys and existing Interview guardrails;
- preserve API validation as the authority for Customer confirmation and
  targeted continuation.

Safety boundaries:

- Jev cannot confirm Customer context;
- Jev cannot validate targeted resume or continuation pins;
- Jev payloads exclude private Interview store internals.

Regression expectations:

- tests prove existing Interview API rejection paths remain authoritative;
- tests prove private context/checkpoint/thread internals are not sent;
- tests prove shadow mode cannot change active question outcome.

### S12-JEV-07 - Phase C Planner and Investigator tool-loop shadow routing

Scope:

- integrate `PLANNER_CANDIDATE_RANKING` over pre-authorized candidate IDs;
- integrate `INVESTIGATOR_NEXT_ACTION` over a closed next-action allowlist;
- record token/cost and latency effects against the existing reasoning path.

Safety boundaries:

- Jev cannot alter active EngineeringRule IDs, criteria or artifact pins;
- Jev cannot author EvidenceClaims, proof of absence, limitations or gate
  outcomes;
- Jev cannot widen the Investigator scope.

Regression expectations:

- tests prove candidate ranking does not add/drop candidate IDs;
- tests prove Investigator fallback preserves current reasoning/tool path;
- tests prove EvidenceClaim validation remains unchanged and authoritative.

### S12-JEV-08 - Phase D evaluation, activation policy and rollback

Scope:

- build labeled eval sets per decision type;
- compute agreement, false-negative rate, calibration, fallback, latency, cost
  and reasoning-token reduction;
- add activation and rollback runbook for allowlisted decision types.

Safety boundaries:

- no `ACTIVE` routing before the eval gate passes;
- safety-critical decision types require separate architecture review;
- rollback to `SHADOW` must be operationally simple.

Regression expectations:

- eval runner fails closed when labels or policy thresholds are missing;
- activation tests prove unsupported decision types cannot enter `ACTIVE`;
- runbook includes rollback verification and post-activation monitoring.

## Acceptance Criteria

- A reviewed architecture contract defines Jev as non-authoritative System One.
- Existing Scanner/PGE, EngineeringRule, deterministic legal/compliance gates,
  EvidenceClaim validation and final verdict boundaries are preserved.
- Core gateway, shadow integrations, tool-routing integrations and
  evaluation/observability are tracked by LCSP-335 through LCSP-338.
- Every implementation issue includes safety boundaries and regression
  expectations.
- Shadow mode is the default and cannot modify authoritative production
  outcomes.
- Provider failure, invalid output, redaction uncertainty or low confidence
  always falls back to existing LCSP behavior.
- Raw/unrestricted source and sensitive runtime/customer context are excluded
  from Jev payloads.
- Evaluation criteria are defined before `ACTIVE` activation.
- Final legal/compliance/risk verdict delegation to Jev is explicitly excluded.

## Non-goals

- replacing GPT/Gemini reasoning agents wholesale;
- replacing Scanner/PGE;
- replacing EngineeringRules;
- replacing deterministic EvidenceClaim validation;
- allowing Jev probability or confidence to become legal evidence;
- exposing source code, raw prompts, hidden reasoning, credentials or private
  Customer context to the remote decision provider.
