# ADR-024 - Real LLM Provider as Mandatory A-to-Z MVP Requirement

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Status

Accepted for A-to-Z Runnable MVP (Phase 5.2J)

## Decision Context

```text
SUPERSEDES_MOCK_LLM_AS_MVP_HAPPY_PATH
PROJECT_OWNER_LOCKED
```

Approved as part of SPRINT-CHANGE-PROPOSAL-5.2J (2026-06-23). Phase 5.2I (commit c33b137) preserved as historical evidence.

## Decision

```text
REAL_LLM_PROVIDER_MANDATORY_FOR_A_TO_Z_MVP_ACCEPTANCE
MOCK_LLM_RETAINED_FOR_TEST_AND_OFFLINE_ONLY
```

A real configured LLM provider is mandatory for the A-to-Z MVP acceptance run. Mock-backed runs do not qualify as the final A-to-Z MVP acceptance run.

## LLM Mode Classification

```text
provider  → real inference (required for A-to-Z acceptance)
mock      → deterministic mock (unit tests, offline CI, credential-unavailable dev)
```

## Provider Selection

`COST_OR_CREDENTIAL_DECISION_REQUIRED` — Project Owner + Finance.

Candidates: OpenAI GPT-4o, Google Gemini 1.5 Pro/Flash, Anthropic Claude 3.x.

Legal corpus retrieval does not require an embedding provider for MVP. ADR-026 supersedes pgvector/embedding-based legal retrieval with ChromaDB structure-first vectorless legal retrieval.

## Required Decisions

| Concern | Status |
|---|---|
| Provider selection | `COST_OR_CREDENTIAL_DECISION_REQUIRED` |
| Model configuration | `TECHNICAL_DECISION_REQUIRED` |
| Legal retrieval embedding provider/model | `NOT_REQUIRED_FOR_MVP`; future semantic retrieval or reranking only |
| Credential configuration | `COST_OR_CREDENTIAL_DECISION_REQUIRED` |
| Timeout and token limits | `TECHNICAL_DECISION_REQUIRED` |
| Structured output validation | `TECHNICAL_DECISION_REQUIRED` |
| Cost-control boundary | `COST_OR_CREDENTIAL_DECISION_REQUIRED` |
| Fallback behavior per node | `TECHNICAL_DECISION_REQUIRED` |

## Model Configuration

| Setting | Constraint |
|---|---|
| Max output tokens | At least 1200 baseline; node-specific overrides may apply |
| Temperature | 0.2 or below for classification and legal matching nodes |
| System prompt | Versioned; stored as prompt template refs, not in source |

## Credential Configuration

- API key in secret manager. Not in source. Not in logs.
- `LLM_API_KEY_REF` resolved from secret manager.
- Key rotation policy required before acceptance run.
- Cost logging per workflow run required.
- Monthly budget cap approved before acceptance run.

## LLM Call Failure Behavior

```text
LLM call fails:
  → Retry up to 2 times (exponential backoff)
  → If all retries fail:
    - Classification node: CLASSIFICATION_LLM_UNAVAILABLE; fail-closed
    - Document generation node: DOCUMENT_GENERATION_LLM_UNAVAILABLE; fail-closed
    - AIUsageFlow node: degrade to deterministic-only with uncertainty annotation
  → Audit: provider/model/timeout/failure recorded
```

## Retained Invariants

- All LLM calls route through LLM Gateway (ADR-015). RETAINED.
- No raw source code to LLM (ADR-006). RETAINED.
- No secrets to LLM. RETAINED.
- LLM output cannot override deterministic evidence or legal citations. RETAINED.
- Citation Guardrail and output guardrails remain required. RETAINED.

## Structured Output Validation

- All LLM outputs must pass Zod schema validation before acceptance.
- Invalid output triggers retry then fail-closed.

## Consequences

- LLM Gateway must implement a real provider adapter alongside retained mock adapter.
- `LLM_MODE=provider` required for acceptance run.
- Monthly LLM cost budget cap must be approved before acceptance environment setup.
- `llm-gateway-implementation.md` must reflect this decision.

## Non-Claims

- This ADR does not select the specific LLM provider.
- Mock mode remains valid for unit tests and offline CI.
- This ADR does not authorize production deployment.
