---
task_id: MW-intel-004
module: python-workers/intelligence
runtime: deepagents
priority: P0
status: SUPERSEDED_FOR_ACTIVE_MVP
epic_story: 5.4
depends_on:
  - python-workers/intelligence/03-conflict-detection-worker.md
---

# VerifiedProfile Worker

> Superseded: active classification no longer depends on a VerifiedProfile worker/callback/approval gate. Direct EngineeringRule assessment consumes accepted evidence context.

## Outcome

Consume `reconciliation.all-conflicts-resolved` events and assemble the `VerifiedProfile` from the resolved `AIUsageFlow` + `WizardProfile` (when linked). VerifiedProfile contains final evidence-backed usage claims with resolution context. Gate: all conflicts must be resolved before building. When `AIUsageFlow.verificationSource = TECHNICAL_ONLY` (no linked WizardProfile), there are no Wizard-declaration conflicts to resolve by construction, so this gate is trivially satisfied and VerifiedProfile is built directly from AIUsageFlow.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/engineer_rule/intelligence/verified_profile_consumer.py` | Create | `ConsumerBase` subclass for `reconciliation.all-conflicts-resolved` |
| `deepagents/tools/engineer_rule/intelligence/verified_profile_builder.py` | Create | Final profile assembly |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `intelligence.all-conflicts-resolved` |
| Routing key | `reconciliation.all-conflicts-resolved` |
| RBAC preflight | No (system event) |

## VerifiedProfile Assembly

**Inputs:**
- Resolved `AIUsageFlow` (from NestJS API)
- Resolved `ConflictRecord` list (with Manager resolution notes) — empty when `verificationSource = TECHNICAL_ONLY`
- `WizardProfile` answers, optional — present only when `AIUsageFlow.verificationSource = TECHNICAL_PLUS_WIZARD`

**Output:**
```python
@dataclass
class VerifiedProfileData:
    verified_claims: list[AIUsageClaim]       # Claims surviving conflict resolution
    verification_source: str                   # 'TECHNICAL_ONLY' | 'TECHNICAL_PLUS_WIZARD', carried from AIUsageFlow
    wizard_context: dict | None                 # Relevant WizardProfile fields, None when TECHNICAL_ONLY
    conflict_resolutions: list[dict]           # Resolution summaries (not Manager notes verbatim); empty when TECHNICAL_ONLY
    gates_passed_at: dict                      # { 'conflicts_resolved': ISO timestamp }
    evidence_chain_integrity: bool             # True if all material claims have evidence_refs
```

## Business Rules

1. Fetch resolved `AIUsageFlow` + conflict resolutions from NestJS API.
2. Check NestJS preflight gate: no `PENDING` conflicts → `PENDING_CONFLICTS_EXIST` error from API is a signal to re-queue.
3. Include only claims from `AIUsageFlow` — do NOT add new claims in this worker.
4. `gates_passed_at.conflicts_resolved` = timestamp from event message.
5. `evidence_chain_integrity = True` only if all material claims have `evidence_refs`.
6. No LLM calls.
7. Submit to `POST /internal/reconciliation/verified-profile-callback`.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | All conflicts resolved | VerifiedProfile submitted |
| T02 | API returns `PENDING_CONFLICTS_EXIST` | Re-queue (not discard) |
| T03 | Material claims missing `evidence_refs` | `evidence_chain_integrity = False` |
| T04 | No new claims added | Verified claims = original AIUsageFlow claims |
| T05 | No LLM calls | Network trace verified |

## Definition of Done

- VerifiedProfile includes only existing claims — no new claims added.
- Gate check via API call — re-queue on `PENDING_CONFLICTS_EXIST`.
- `evidence_chain_integrity` accurately reflects material claim completeness.
- No LLM calls.

## Implementation Evidence

- Added `VerifiedProfileBuilder` to assemble `VerifiedProfileData` from existing `AIUsageFlow` claims, optional `WizardProfile` context, and resolved conflict records without creating new claims.
- Added conflict-resolution summaries that retain structured resolution metadata while intentionally excluding free-form Manager notes.
- Added `evidence_chain_integrity` calculation so material claims without `evidence_refs` mark the profile as incomplete instead of silently passing.
- Added `VerifiedProfileConsumer` for queue `intelligence.all-conflicts-resolved`, routing key `reconciliation.all-conflicts-resolved`, with `requires_rbac = False` for the system event.
- Added pending-conflict handling so `PENDING_CONFLICTS_EXIST` from API callback failures is raised as a requeueable worker error.
- Updated Python worker callback schema and API contract path to `POST /internal/reconciliation/verified-profile-callback`.
- Added API client support for fetching VerifiedProfile reconciliation context from the NestJS internal API.
- Added focused tests for all task scenarios plus API endpoint contract and error-code preservation.

## File List

- `deepagents/tools/engineer_rule/intelligence/__init__.py`
- `deepagents/tools/engineer_rule/intelligence/verified_profile_builder.py`
- `deepagents/tools/engineer_rule/intelligence/verified_profile_consumer.py`
- `deepagents/tools/common/platform/api_client.py`
- `deepagents/tools/common/platform/callback_schemas.py`
- `deepagents/tools/common/package/contract/api_client_contracts.py`
- `deepagents/tests/test_api_client.py`
- `deepagents/tests/test_verified_profile_worker.py`
- `docs/implementation/tasks/modules/python-workers/intelligence/04-verified-profile-worker.md`

## Validation

Baseline commit before task work: `3b63ab925765f8f3598f3de44e049fc16646e073`.

- `./.venv/bin/pytest tests/test_verified_profile_worker.py tests/test_api_client.py::test_verified_profile_callback_uses_reconciliation_endpoint`
  - Result: passed, 8 tests.
- `./.venv/bin/pytest tests/test_api_client.py tests/test_ai_usage_flow_worker.py tests/test_conflict_detection_worker.py tests/test_verified_profile_worker.py`
  - Result: passed, 44 tests.
- `./.venv/bin/pytest tests/test_api_client.py tests/test_technical_profile_worker.py tests/test_ai_usage_flow_worker.py tests/test_conflict_detection_worker.py tests/test_verified_profile_worker.py tests/test_queue_consumer.py`
  - Result: passed, 62 tests.
- `./.venv/bin/python -m compileall tools/engineer_rule/intelligence tools/common/platform tools/common/package/contract tests/test_verified_profile_worker.py tests/test_api_client.py`
  - Result: passed.
- `git diff --check`
  - Result: passed.
- Changed-file line length scan for Python files
  - Result: passed.
- `./.venv/bin/pytest`
  - Result: blocked by local dependency state: `tiktoken` missing during `tests/test_llm_gateway.py` collection.
- `./.venv/bin/pytest --ignore=tests/test_llm_gateway.py`
  - Result: 173 passed / 8 skipped / 4 failed, with remaining failures unrelated to this task: local venv missing `boto3` for audit export consumer and sandboxed socket binding for health tests.
- `./.venv/bin/pytest tests/test_worker_health.py`
  - Result: passed, 5 tests, run outside filesystem sandbox because tests bind a local HTTP socket.
