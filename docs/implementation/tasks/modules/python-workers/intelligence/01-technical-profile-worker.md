---
task_id: MW-intel-001
module: python-workers/intelligence
runtime: deepagents
priority: P0
status: DONE
epic_story: 3.6
depends_on:
  - python-workers/scanner/04-evidence-report-assembly.md
  - python-workers/platform/01-worker-platform-bootstrap.md
---

# TechnicalProfile Worker

## Outcome

Consume `scan.evidence-accepted` events and produce a `TechnicalProfile` from the accepted `TechnicalEvidenceReport`. Profile summarizes evidence quality, coverage, AI usage signals, and dependency risks. No LLM calls — pure structured analysis of evidence payload.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/engineer_rule/intelligence/__init__.py` | Create | Package init |
| `deepagents/tools/engineer_rule/intelligence/technical_profile_consumer.py` | Create | `ConsumerBase` subclass for `scan.evidence-accepted` |
| `deepagents/tools/engineer_rule/intelligence/technical_profile_builder.py` | Create | Evidence → TechnicalProfile logic |
| `deepagents/tools/engineer_rule/intelligence/evidence_quality_evaluator.py` | Create | Evidence quality and actionability assessment |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `intelligence.evidence-accepted` |
| Routing key | `scan.evidence-accepted` |
| RBAC preflight | No (system event, no user context) |

## TechnicalProfile Schema

```python
@dataclass
class TechnicalProfile:
    schema_version: str
    provider_version: str                     # Worker version
    evidence_report_id: str
    assessment_id: str
    organization_id: str

    # Evidence quality
    evidence_quality: str                     # 'high' | 'medium' | 'low' | 'insufficient'
    coverage_notes: list[str]                 # Business-language limitations
    tool_coverage: dict[str, bool]            # { 'syft': True, 'semgrep': False, ... }

    # AI usage signals summary
    ai_usage_signal_count: int
    signal_types_detected: list[str]          # ['provider_integration', 'model_call', ...]
    dependency_ai_packages: list[str]         # Package names only (from SBOM)

    # Privacy flags
    privacy_flags: PrivacyFlags
```

## Business Rules

1. Listen on `scan.evidence-accepted`. Fetch `TechnicalEvidenceReport` from NestJS API.
2. Evaluate evidence quality: `high` if all tools succeeded and AI signals found; `medium` if partial coverage; `low` if no AI signals; `insufficient` if critical tools all failed.
3. `dependency_ai_packages` extracted from SBOM entries where package name matches AI package list (e.g., `openai`, `anthropic`, `langchain`, `autogen`, `llama-index`).
4. `signal_types_detected` deduplicated list from `ai_usage_signals`.
5. No LLM calls in this worker.
6. `privacy_flags.contains_source_code = False` asserted before callback.
7. Submit to `POST /internal/evidence/technical-profile-callback` via `WorkerApiClient`.
8. `provider_version` = this worker's version (pinned).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Evidence with AI signals | `evidence_quality = high`, signals populated |
| T02 | Evidence with no AI signals | `evidence_quality = low` |
| T03 | Syft failed, Semgrep passed | `evidence_quality = medium`, tool_coverage noted |
| T04 | All tools failed | `evidence_quality = insufficient` |
| T05 | SBOM has `openai` package | `dependency_ai_packages` includes `openai` |
| T06 | Privacy flags asserted | `contains_source_code = False` verified |
| T07 | No LLM calls made | No LLM provider API calls in network trace |

## Definition of Done

- `TechnicalProfile` built from evidence without LLM calls.
- Evidence quality evaluated from tool coverage and signal presence.
- `dependency_ai_packages` from SBOM (names only, no versions in signal list).
- `contains_source_code = False` asserted before callback.

## Implementation Evidence

- Added deterministic intelligence package under `deepagents/tools/engineer_rule/intelligence/`.
- Added `TechnicalProfileConsumer` as a `ConsumerBase` subclass for queue `intelligence.evidence-accepted`, routing key `scan.evidence-accepted`, with `requires_rbac = False` for system event processing.
- Added `TechnicalProfileBuilder` and `EvidenceQualityEvaluator` for evidence-only profile derivation; no LLM gateway/provider calls are used.
- Updated worker callback schema/API client to submit `TechnicalProfile` payloads to `POST /internal/evidence/technical-profile-callback`.
- Added unit coverage in `deepagents/tests/test_technical_profile_worker.py` for T01–T07 and consumer callback behavior.

## Validation

- `python -m py_compile deepagents/tools/engineer_rule/intelligence/__init__.py deepagents/tools/engineer_rule/intelligence/evidence_quality_evaluator.py deepagents/tools/engineer_rule/intelligence/technical_profile_builder.py deepagents/tools/engineer_rule/intelligence/technical_profile_consumer.py deepagents/tools/common/platform/api_client.py deepagents/tools/common/platform/callback_schemas.py deepagents/tools/common/package/contract/api_client_contracts.py`
  - Result: passed.
- `python -m pytest deepagents/tests/test_technical_profile_worker.py deepagents/tests/test_api_client.py deepagents/tests/test_queue_consumer.py deepagents/tests/test_evidence_assembler.py -q`
  - Result: 32 passed, 1 warning (`asyncio_mode` pytest config warning in minimal targeted environment).
