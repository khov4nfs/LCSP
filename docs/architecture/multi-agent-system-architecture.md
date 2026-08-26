# LCSP Multi-Agent System Architecture

## Status

AUTHORITATIVE MULTI-AGENT ARCHITECTURE

## Purpose

Define the agent/workflow roles in LCSP and the architectural guardrails for agentic processing. This document explains component responsibilities and routing principles. Implementation details live in `docs/implementation/`.

## Architectural Pattern

```text
State-machine-driven orchestration with bounded specialist workers.
```

LCSP does not use free-form autonomous handoffs for compliance-critical workflow. Each worker has a bounded responsibility and produces a typed output object or a blocked state.

## Worker Roles

| Worker / Agent           | Responsibility                                                        | Must Not Do                                                            |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Scanner Worker           | Static repository analysis and TechnicalEvidenceReport creation.      | Execute source, infer legal risk, send raw source to LLM.              |
| Technical Profile Worker | Normalize scanner evidence into technical profile dimensions.         | Invent business usage.                                                 |
| AIUsageFlow Worker       | Produce evidence-backed business usage claims.                        | Classify legal risk or ignore uncertainty.                             |
| Reconciliation Worker    | Detect conflicts and create VerifiedProfile only when clean/resolved. | Overwrite scanner evidence or let non-Manager input unblock MVP alone. |
| Legal Matching Worker    | Retrieve citation-backed legal rules.                                 | Fabricate citations or use unpinned legal basis.                       |
| Classification Worker    | Classify only from VerifiedProfile and citation-backed matches.       | Classify before VerifiedProfile.                                       |
| Gap Analysis Worker      | Map classification to compliance gaps.                                | Generate final legal output.                                           |
| Document Worker          | Generate document artifacts under output guardrails.                  | Emit final legal conclusions without citation traceability.            |

## Routing Principle

```text
Persisted object + event -> bounded worker -> persisted object + event/block.
```

Routing is deterministic and state-driven. LLM calls, when used, are tools behind guardrails and never own workflow state transitions.

## Human-In-The-Loop Rule

When WizardProfile, TechnicalProfile, or AIUsageFlow conflict, the workflow pauses and creates a Manager Conflict Resolution Task. Manager resolution is auditable and separate from scanner evidence.

## Runtime Details

See:

- `docs/developer/developer-implementation-guide.md`
- `docs/implementation/backend-implementation.md`
- `docs/implementation/queue-implementation.md`
- `docs/implementation/llm-gateway-implementation.md`
