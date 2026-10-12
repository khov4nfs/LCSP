# LLM Gateway Implementation

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Purpose

Define the LLM Gateway as LCSP's only external model invocation boundary.

## Scope

The gateway centralizes model-provider configuration, input sanitization, prompt-template versioning, schema validation, retries, timeouts, audit metadata and privacy enforcement.

## Dependencies / Source References

- `docs/architecture/architecture.md`
- `docs/implementation/backend-implementation.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`
- `docs/specs/legal-classification-spec.md`
- `docs/specs/document-generation-spec.md`

## Implementation Boundaries

- No component may call an external LLM provider directly.
- Raw source, full prompts, secrets and full AST bodies must not enter the gateway.
- LLM outputs cannot override deterministic evidence.
- LLM outputs cannot create legal conclusions without citation-backed downstream guardrails.

## Provider Adapter Pattern

A-to-Z MVP LLM mode:

```text
LLM_MODE:
  provider   — real inference (required for A-to-Z acceptance run)
  mock       — deterministic mock (unit tests, offline CI, credential-unavailable dev)
```

A real configured LLM provider is mandatory for the A-to-Z MVP acceptance run per ADR-024. Mock-backed runs do not qualify as the final A-to-Z MVP acceptance run. Mock mode is retained for unit tests and offline CI.

> Phase 5.2J update: The previous Phase 5.2I decision `LLM_PROVIDER_MVP: DETERMINISTIC_MOCK_LLM_GATEWAY_BY_DEFAULT` as the controlled MVP happy path is superseded by ADR-024. Phase 5.2I (commit c33b137) is preserved as historical evidence.

| Layer | Responsibility |
| --- | --- |
| Gateway API | Accept sanitized structured input and node context |
| Policy filter | Reject disallowed fields and unsafe payload classes |
| Prompt/template resolver | Select prompt by version reference |
| Provider adapter | Apply provider-specific request/response formatting |
| Output validator | Enforce schema and safety constraints |
| Metadata recorder | Persist model run metadata and output hash |

## Gateway and LangGraph Boundary

The LLM Gateway is not the workflow orchestrator. LangGraph may orchestrate worker-local runtime state, but every model-assisted node still crosses the same gateway boundary.

```text
LangGraph node
-> sanitized structured request
-> LLM Gateway
-> provider adapter
-> schema validation
-> metadata + output ref returned to graph state
```

Boundary rules:

- Workers may use LangChain/LangGraph for prompt assembly, structured output helpers, and runtime coordination.
- Workers may not bypass the gateway by calling provider SDKs, LangChain provider wrappers, or hosted model endpoints directly.
- Gateway requests must include workflow and node context so graph runs remain auditable and replay-safe.
- Gateway responses must be consumed as validated structured outputs plus metadata refs, not as raw provider payloads persisted into business artifacts.

## Required Model Run Metadata

| Field | Meaning |
| --- | --- |
| `assessment_id` | Assessment scope |
| `workflow_run_id` | Workflow scope |
| `node_name` | Calling node |
| `provider` | Configured provider label |
| `model` | Configured model label |
| `prompt_version` | Prompt/template version ref |
| `input_reference` | Reference to sanitized input payload |
| `output_hash` | Hash of stored/validated output |
| `timestamp` | Run timestamp |
| `status` | Success/failure/retry/degraded |

## Allowed Inputs

Sanitized metadata such as route category, service/module label, data category labels, output type labels, downstream action labels, human-review state, confidence and evidence reference ids.

## Forbidden Inputs

Raw repository source, full system prompts, secrets, raw provider tokens, full AST bodies, unredacted credentials and arbitrary log dumps.

## Timeout / Retry / Rate Limit

- Apply the controlled MVP default timeout and token budgets unless provider mode explicitly overrides them through configuration.
- Fail closed on schema invalid output.
- Degrade or block according to node guardrail policy when provider outage occurs.
- Record timeout/rate-limit metrics without logging sensitive inputs.

Environment mode contract:

| Environment | Required `LLM_MODE` | Qualification |
| --- | --- |
| A-to-Z acceptance | `provider` | Mandatory. A run without a real configured provider is not the A-to-Z MVP acceptance run. |
| Local integrated A-to-Z smoke path | `provider` | Required unless the run is explicitly labeled offline/non-acceptance. |
| Unit tests / offline CI | `mock` | Allowed for deterministic tests and credential-unavailable CI only. |
| Credential-unavailable local development | `mock` | Allowed only for component development; must not be reported as MVP readiness evidence. |

Controlled MVP settings:

| Setting | Value |
| --- | --- |
| `LLM_MODE` | No MVP default of `mock`. Acceptance and integrated A-to-Z runs must set `provider`; mock mode is test/offline-only. |
| `LLM_TIMEOUT_MS` | `15000` |
| `LLM_MAX_OUTPUT_TOKENS` | `1200` |
| Retry budget | 2 retries for transient provider errors in provider mode; mock mode should not retry except for internal schema validation failure. |
| Provider config keys | `LLM_PROVIDER_NAME`, `LLM_MODEL_NAME`, `LLM_API_KEY_REF`, `LLM_TIMEOUT_MS`, `LLM_MAX_OUTPUT_TOKENS` |

## Prompt Injection Defense

- Treat repository-derived strings as untrusted metadata.
- Use structured inputs and schema-constrained outputs.
- Reject outputs that instruct workflow bypass, citation bypass or evidence override.

## Required Inputs and Outputs

| Input | Output |
| --- | --- |
| Sanitized structured metadata | Schema-validated model response |
| Node policy and prompt version | Model run metadata |
| Provider config | Provider-normalized response or failure |

## Graph Node Contract Requirements

Every graph node that invokes the gateway must declare:

- sanitized input schema
- output schema
- prompt/template version reference
- timeout and retry policy
- blocked/degraded fallback behavior
- audit metadata fields to record

If any requirement is missing, the node is not eligible for production or acceptance-run use.

## State / Error / Failure Handling

- Provider outage: retry then mark node failed/degraded per policy.
- Invalid output schema: controlled retry then fail closed.
- Disallowed input detected: reject call and audit security event.

## Security and Privacy Considerations

Store prompt version refs and input references, not raw prompt/source/secret content. Audit metadata only.

## Audit Requirements

Audit model run requested, rejected, timed out, schema invalid, completed, retried and failed, including provider/model/prompt version and output hash.

## Locked A-to-Z MVP LLM Provider Decisions

> Phase 5.2J update. Previous section: 'Locked Controlled MVP Provider Decision'. Phase 5.2I decisions are preserved as historical evidence (commit c33b137).

| Decision | Controlled MVP Value |
| --- | --- |
| Provider selection | Real configured LLM provider mandatory for A-to-Z acceptance run per ADR-024. `COST_OR_CREDENTIAL_DECISION_REQUIRED`. Candidates: OpenAI GPT-4o, Google Gemini 1.5 Pro/Flash, Anthropic Claude 3.x. |
| Mock mode | Deterministic mock retained for unit tests, offline CI, and credential-unavailable dev. Mock run does not qualify as A-to-Z MVP acceptance. |
| Embedding model | Not required for legal corpus retrieval MVP. Optional future reranker/semantic retrieval requires separate approval. |
| Credential management | `LLM_API_KEY_REF` resolved from secret manager. Not in source. Not in logs. |
| Cost-control | Monthly budget cap required before acceptance run. Token usage logged per workflow run. |
| Token budget | `LLM_MAX_OUTPUT_TOKENS=1200` default for controlled MVP unless a provider-specific environment configuration overrides it. |
| Legal/compliance output | Mock output cannot create legal advice, compliance certification, formal legal reliability or production claims. |
