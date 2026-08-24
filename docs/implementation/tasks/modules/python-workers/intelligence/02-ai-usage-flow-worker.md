---
task_id: MW-intel-002
module: python-workers/intelligence
runtime: deepagents
priority: P0
status: DONE
epic_story: 4.2
depends_on:
  - python-workers/intelligence/01-technical-profile-worker.md
---

# AIUsageFlow Worker

## Outcome

Consume `technical-profile-ready` events and generate `AIUsageFlow` claims through a **bounded LangGraph runtime** that keeps deterministic evidence extraction, confidence calculation, abstention rules, and conflict detection authoritative. Model-assisted nodes are optional and may be used only for bounded business-meaning claim drafting or uncertainty narration from sanitized evidence metadata; they must call the `LLM Gateway`, cannot override deterministic evidence, and cannot fabricate unsupported material claims. Raw source code, full prompts, secrets, and full AST bodies are never sent anywhere in this worker.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/engineer_rule/intelligence/ai_usage_flow_consumer.py` | Create | `ConsumerBase` subclass for `technical-profile-ready` |
| `deepagents/tools/engineer_rule/intelligence/ai_usage_flow_graph.py` | Create | LangGraph workflow for stateful AIUsageFlow orchestration |
| `deepagents/tools/engineer_rule/intelligence/ai_usage_flow_rule_engine.py` | Create | Deterministic claim-generation rule table + evaluator |
| `deepagents/tools/engineer_rule/intelligence/confidence_calculator.py` | Create | Deterministic confidence formula per `ai-usage-flow-domain-spec.md` |
| `deepagents/tools/engineer_rule/intelligence/conflict_candidate_builder.py` | Create | WizardProfile vs. TechnicalProfile conflict candidate detection |
| `deepagents/tools/engineer_rule/intelligence/ai_usage_flow_claim_drafter.py` | Create | Optional gateway-backed claim drafting/narration helpers from sanitized metadata |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `intelligence.technical-profile-ready` |
| Routing key | `technical-profile-ready` |
| PBAC preflight | No (system event) |

## Runtime Inputs and Node Boundaries

This worker reads:
- `TechnicalProfile` fields: `aiDetected`, `providers`, `frameworks`, `modelInvocationCount`, `inputCategories`, `outputCategories`, `decisionFlowSignals`, `humanReviewSignals`, `coverageLimitations`, `confidence`, `evidenceRefs`.
- `WizardProfile` fields when linked (optional — see Verification Source below): `answers.businessProcess`, `answers.aiPurpose`, `answers.humanReview`, `answers.affectedSubjects`, `answers.dataTypes`.
- `TechnicalEvidenceReport`: `TechnicalFinding[]`, `EvidenceReference[]`, `coverageSummary`, `qualityStatus`.

Node boundaries:

- Deterministic nodes load inputs, apply claim rules, compute confidence, preserve abstentions, and build conflict candidates.
- Optional model-assisted nodes may draft structured claim proposals or uncertainty narration from sanitized metadata only.
- Guardrail nodes validate that proposed outputs still satisfy the deterministic rule table, evidence-ref requirements, and privacy constraints before persistence.
- Persistence node writes the accepted `AIUsageFlow` artifact and emits the next event.

## Verification Source

| WizardProfile state | `verificationSource` | Effect |
|---|---|---|
| Linked | `TECHNICAL_PLUS_WIZARD` | Business-declaration-dependent fields (business process, affected subjects) may use WizardProfile answers; conflict rules active. |
| Not linked | `TECHNICAL_ONLY` | Worker proceeds using TechnicalProfile/TechnicalEvidenceReport alone. Business-declaration-dependent fields fall back to technical-evidence-only inference with a confidence penalty and are more likely `UNKNOWN`. Generation is NOT blocked solely for a missing WizardProfile. |

`AIUsageFlow` generation is `BLOCKED` only when `TechnicalProfile` or `TechnicalEvidenceReport` is missing/failed — never solely for a missing `WizardProfile`.

## Claim Taxonomy (Authoritative — see `ai-usage-flow-domain-spec.md`)

`MODEL_PROVIDER_USAGE`, `MODEL_INVOCATION`, `AI_GENERATED_OUTPUT`, `DOWNSTREAM_ACTION`, `AUTOMATED_DECISION`, `HUMAN_REVIEW`, `PROMPT_STORAGE`, `PERSONAL_DATA_INPUT`, `TRAINING_ACTIVITY`, `RAG_USAGE`, `DOCUMENT_GENERATION`, `CONTENT_LABELING`, `HUMAN_OVERSIGHT_CONTROL`, `AI_INTERACTION_DISCLOSURE`, `INCIDENT_HANDLING`.

Each category's required/optional signals, missing-evidence behavior, and conflict behavior are defined in `ai-usage-flow-domain-spec.md`'s Claim Generation Rules table — this worker implements that table verbatim, it does not redefine it.

## AIUsageFlowClaim Generation

```python
@dataclass
class AIUsageFlowClaim:
    claim_id: str
    ai_usage_flow_id: str
    claim_category: str      # One of the 15 canonical categories above
    claim_field: str         # e.g. 'automation_level', 'human_review', 'content_labeling_status'
    claim_value: object      # Structured value (enum/string/list)
    lifecycle_state: str     # DETECTED | VALIDATED | CONFLICTED | VERIFIED | REJECTED | ABSTAINED
    evidence_refs: list[str] # Required for material claims
    confidence: float        # 0.00-1.00, deterministic formula
    confidence_breakdown: dict  # {base, required_evidence_bonus, optional_support_bonus, coverage_penalty, conflict_penalty, missing_evidence_penalty}
    uncertainty_reasons: list[str]
    conflict_refs: list[str] | None
```

## Confidence Formula (Deterministic — verbatim from `ai-usage-flow-domain-spec.md`)

```python
def calculate_claim_confidence(
    claim_category: str,
    required_evidence_present: bool,
    optional_signal_count: int,
    material_coverage_limitations: int,
    has_wizard_conflict: bool,
    missing_required_evidence_class: bool,
) -> tuple[float, dict]:
    base = CLAIM_CATEGORY_BASE[claim_category]
    D = 0.10 if required_evidence_present else 0.0
    O = min(optional_signal_count * 0.05, 0.10)
    C = min(material_coverage_limitations * 0.15, 0.30)
    K = 0.20 if has_wizard_conflict else 0.0
    M = 0.35 if missing_required_evidence_class else 0.0
    raw = base + D + O - C - K - M
    confidence = max(0.00, min(1.00, raw))
    return confidence, {"base": base, "D": D, "O": O, "C": C, "K": K, "M": M}
```

`CLAIM_CATEGORY_BASE` table (verbatim, must match `ai-usage-flow-domain-spec.md` exactly):

```python
CLAIM_CATEGORY_BASE = {
    "MODEL_PROVIDER_USAGE": 0.35,
    "MODEL_INVOCATION": 0.70,
    "AI_GENERATED_OUTPUT": 0.65,
    "DOWNSTREAM_ACTION": 0.70,
    "AUTOMATED_DECISION": 0.80,
    "HUMAN_REVIEW": 0.70,
    "PROMPT_STORAGE": 0.55,
    "PERSONAL_DATA_INPUT": 0.60,
    "TRAINING_ACTIVITY": 0.60,
    "RAG_USAGE": 0.65,
    "DOCUMENT_GENERATION": 0.65,
    "CONTENT_LABELING": 0.60,
    "HUMAN_OVERSIGHT_CONTROL": 0.65,
    "AI_INTERACTION_DISCLOSURE": 0.60,
    "INCIDENT_HANDLING": 0.55,
}
```

Thresholds: `< 0.40` → `ABSTAINED`; `0.40..0.64` → `DETECTED` (not material-eligible); `>= 0.65` → `VALIDATED` if no conflict; `>= 0.75` with complete evidence path → eligible to support legal matching after reconciliation.

## Business Rules

1. Listen on `technical-profile-ready`. Fetch `TechnicalProfile` and `TechnicalEvidenceReport` from NestJS API. Fetch `WizardProfile` only if linked to the assessment.
2. For each claim category, evaluate the rule engine's required/optional signal conditions against `TechnicalFinding[]`; deterministic evidence rules remain authoritative even if an optional model-assisted node is used later in the graph.
3. Set `evidence_refs` from the exact `TechnicalFinding`/`EvidenceReference` IDs that grounded the claim; a claim without required evidence refs cannot reach `VALIDATED`.
4. Compute `confidence`/`confidence_breakdown` via the deterministic formula above — never an LLM-assigned categorical confidence.
5. Set `verificationSource` per the Verification Source table; a missing `WizardProfile` alone must not block generation.
6. Run conflict candidate rules (WizardProfile vs. TechnicalProfile) per `ai-usage-flow-domain-spec.md`'s Conflict Generation Rules table; attach `conflict_refs` and set `lifecycle_state = CONFLICTED` when triggered.
7. Apply Abstention Rules verbatim (e.g., provider/package presence alone never yields a material `MODEL_INVOCATION` claim; unresolved dynamic output-to-action path abstains from `AUTOMATED_DECISION`).
8. Preserve `coverageLimitations` and `uncertaintyReasons` — never silently drop them.
9. Assemble `AIUsageFlowSummary` (all fields, including `contentLabelingStatus`, `riskDocumentationEvidence`, `trainingDataLawfulnessSignal`, `interventionControlPresent`, `aiInteractionDisclosurePresent`, `incidentHandlingPresent`) from validated claims.
10. If an optional model-assisted node is used, send only sanitized structured metadata through the `LLM Gateway`, record workflow/node context for audit, and reject schema-invalid or guardrail-conflicting output.
11. Assert no raw source/full prompt/secret/full AST body is present in any output field or persisted graph state before callback.
12. Submit to `POST /internal/ai-usage-flow/callback`.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `AI_MODEL_INVOCATION` finding with evidence ref | `MODEL_INVOCATION` claim, `VALIDATED`, confidence per formula |
| T02 | Provider/package finding only, no invocation | `MODEL_PROVIDER_USAGE` claim only; no material `MODEL_INVOCATION` claim (abstain) |
| T03 | No `WizardProfile` linked | `verificationSource = TECHNICAL_ONLY`; generation not blocked |
| T04 | `WizardProfile` says no AI, `TechnicalProfile.aiDetected = confirmed` | Conflict `WIZARD_NO_AI_BUT_INVOCATION_EXISTS` created |
| T05 | Synthetic-media output with no labeling pattern found, path resolved | `CONTENT_LABELING` claim `contentLabelingStatus = ABSENT` |
| T06 | Raw source content in any output field | Test MUST FAIL (never allowed) |
| T07 | Claim confidence computed via LLM categorical score instead of formula | Test MUST FAIL (deterministic formula only) |
| T08 | Missing `TechnicalProfile` | `AIUsageFlow` generation `BLOCKED` |
| T09 | Material claim missing `evidence_refs` | Claim rejected by callback validation |
| T10 | Coverage limitation present | Preserved in `coverageLimitations`, not discarded |
| T11 | Optional model-assisted node returns schema-invalid output | Node fails closed; artifact not persisted from invalid output |
| T12 | Optional model-assisted node tries to upgrade provider-only evidence into material claim | Guardrail rejects output; deterministic abstention preserved |

## Definition of Done

- Deterministic claim rules remain authoritative even when optional model-assisted nodes are present.
- Claim taxonomy matches the 15 canonical categories in `ai-usage-flow-domain-spec.md` exactly.
- Confidence computed via the exact deterministic formula and base-score table.
- `verificationSource` set correctly; missing `WizardProfile` never blocks generation alone.
- `evidence_refs` set for all material claims; no raw source/prompt/secret/AST content in any output field or graph state.
- Conflict candidates generated per the Conflict Generation Rules table.
- Any model-assisted node uses only sanitized inputs through `LLM Gateway` and fails closed on schema/guardrail violation.

## Implementation Evidence

- Added AIUsageFlow worker modules under `deepagents/tools/engineer_rule/intelligence/`:
  - `ai_usage_flow_consumer.py`
  - `ai_usage_flow_graph.py`
  - `ai_usage_flow_rule_engine.py`
  - `confidence_calculator.py`
  - `conflict_candidate_builder.py`
- Optional:
  - `ai_usage_flow_claim_drafter.py`
- Implemented `AIUsageFlowConsumer` as a `ConsumerBase` subclass for queue `intelligence.technical-profile-ready`, routing key `technical-profile-ready`, with `requires_pbac = False` for system event processing.
- Implemented canonical 15-category claim base-score table and deterministic confidence formula from `docs/specs/ai-usage-flow-domain-spec.md`.
- Implemented deterministic claim generation for provider usage, model invocation, generated output, content labeling, provider-only abstention, missing-evidence rejection, coverage limitation preservation, and `WIZARD_NO_AI_BUT_INVOCATION_EXISTS` conflict candidate generation.
- If model-assisted claim drafting is enabled, it runs as a bounded graph node through `LLM Gateway` with sanitized structured inputs and post-node deterministic guardrails.
- Updated `AIUsageFlowCallbackPayload` and `WorkerApiClient` to submit to `POST /internal/ai-usage-flow/callback` and fetch required TechnicalProfile/TechnicalEvidenceReport/WizardProfile inputs.
- Added unit coverage in `deepagents/tests/test_ai_usage_flow_worker.py` for T01–T12, consumer callback behavior, deterministic rule preservation, and guarded model-assisted node behavior.

## Validation

- `python -m py_compile deepagents/tools/engineer_rule/intelligence/ai_usage_flow_consumer.py deepagents/tools/engineer_rule/intelligence/ai_usage_flow_rule_engine.py deepagents/tools/engineer_rule/intelligence/confidence_calculator.py deepagents/tools/engineer_rule/intelligence/conflict_candidate_builder.py deepagents/tools/engineer_rule/intelligence/technical_profile_consumer.py deepagents/tools/engineer_rule/intelligence/technical_profile_builder.py deepagents/tools/common/platform/api_client.py deepagents/tools/common/platform/callback_schemas.py deepagents/tools/common/package/contract/api_client_contracts.py`
  - Result: passed.
- `python -m pytest deepagents/tests/test_ai_usage_flow_worker.py deepagents/tests/test_technical_profile_worker.py deepagents/tests/test_api_client.py deepagents/tests/test_queue_consumer.py deepagents/tests/test_evidence_assembler.py -q`
  - Result: 47 passed, 1 warning (`asyncio_mode` pytest config warning in minimal targeted environment).
