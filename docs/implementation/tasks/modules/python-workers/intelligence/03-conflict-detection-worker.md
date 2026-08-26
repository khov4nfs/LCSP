---
task_id: MW-intel-003
module: python-workers/intelligence
runtime: deepagents
priority: P0
status: DONE
epic_story: 5.1
depends_on:
  - python-workers/intelligence/02-ai-usage-flow-worker.md
---

# Conflict Detection Worker

## Outcome

Consume `ai-usage-flow-ready` events and detect reconciliation conflicts between AIUsageFlow claims and the WizardProfile answers. Produce `ConflictRecord` candidates with calculated Conflict Scores. Submit to NestJS reconciliation callback. Empty result (no conflicts) is also valid and explicitly submitted.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/engineer_rule/intelligence/conflict_detection_consumer.py` | Create | `ConsumerBase` subclass for `ai-usage-flow-ready` |
| `deepagents/tools/engineer_rule/intelligence/conflict_detector.py` | Create | Conflict detection logic |
| `deepagents/tools/engineer_rule/intelligence/conflict_score_calculator.py` | Create | Explanatory Conflict Score calculation |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `intelligence.ai-usage-flow-ready` |
| Routing key | `ai-usage-flow-ready` |
| RBAC preflight | No (system event) |

## Conflict Detection Logic

**Inputs:**
- `AIUsageFlow.claims` — evidence-backed usage claims
- `WizardProfile.answers` — Manager's business answers

**Conflict types:**

| Type | Detection rule |
|---|---|
| `evidence_contradiction` | Claim says `external_llm_usage = True`, WizardProfile says `external_llm_usage = False` |
| `scope_mismatch` | Claim `agent_pattern` found, WizardProfile `decision_role = no_autonomous_decision` |
| `unverifiable` | High-confidence claim exists but `evidence_refs` are from `low` coverage tools only |

## Conflict Score Formula

```
conflict_score = (evidence_confidence_weight * contradiction_severity) / normalization_factor
```

- Ranges 0.0 – 1.0
- `evidence_confidence_weight`: `high = 1.0`, `medium = 0.7`, `low = 0.4`, `unknown = 0.2`
- `contradiction_severity`: `direct = 1.0`, `partial = 0.5`, `scope_only = 0.3`
- `score_explanation` must be human-readable business language

## Business Rules

1. Fetch `AIUsageFlow` and `WizardProfile` from NestJS API.
2. Run conflict detection for each conflict type.
3. If no conflicts detected: submit callback with `conflicts = []` (explicit empty — not missing).
4. For each conflict: calculate `conflict_score` and generate `score_explanation` in business language.
5. No LLM calls in this worker — pure deterministic rule-based detection.
6. Submit to `POST /internal/reconciliation/conflict-callback`.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `external_llm_usage` mismatch | `evidence_contradiction` conflict with score |
| T02 | Agent pattern vs no-autonomous-decision | `scope_mismatch` conflict |
| T03 | High-confidence claim, low-coverage evidence | `unverifiable` conflict |
| T04 | No conflicts | `conflicts = []` submitted (not missing) |
| T05 | Conflict score 0.0 – 1.0 range | Score validated |
| T06 | No LLM calls | Network trace inspection |
| T07 | `score_explanation` is business language | No technical code terms |

## Definition of Done

- Deterministic rule-based conflict detection (no LLM).
- Conflict score 0.0–1.0 with business-language explanation.
- Empty conflict result explicitly submitted (not omitted).
- Three conflict types implemented: `evidence_contradiction`, `scope_mismatch`, `unverifiable`.

## Implementation Evidence

- Added `ConflictDetectionConsumer` for queue `intelligence.ai-usage-flow-ready`, routing key `ai-usage-flow-ready`, and no RBAC preflight.
- Added deterministic `ConflictDetector` for:
  - `evidence_contradiction`
  - `scope_mismatch`
  - `unverifiable`
- Added `ConflictScoreCalculator` with bounded 0.0–1.0 score calculation and business-language explanations.
- Added `ConflictDetectionCallbackPayload` and Worker API client support for:
  - `GET /internal/ai-usage-flow/{ai_usage_flow_id}`
  - `POST /internal/reconciliation/conflict-callback`
- Empty no-conflict output is serialized as `conflicts: []`.

## Validation

- `python3 -m compileall -q deepagents/tools/engineer_rule/intelligence deepagents/tools/common/platform deepagents/tools/common/package/contract deepagents/tests/test_conflict_detection_worker.py`
- `/tmp/lcsp-managed-deepagents-venv/bin/python -m pytest deepagents/tests/test_conflict_detection_worker.py deepagents/tests/test_api_client.py -q`
  - Result: 22 passed, 1 warning (`asyncio_mode` config warning)
