---
template: operational-runbook
version: 0.1.0
status: ACTIVE_TEMPLATE
owner: LCSP Engineering
---

# Operational Runbook Template

## Purpose

Use this template only for tasks that introduce or change runtime operations: API endpoints, workers, queues, object storage, ChromaDB indexing/retrieval, LLM provider calls, audit export, or generated artifacts.

## Runbook Metadata

| Field | Value |
|---|---|
| Runbook ID | `RUNBOOK-<runtime-or-domain>-<slug>` |
| Related task(s) | |
| Runtime | |
| Owner | |
| Severity scope | |
| Source authority | |

## Alert / Symptom

| Signal | Meaning | Severity |
|---|---|---|
| | | |

## Impact

- User impact:
- Workflow impact:
- Data/audit impact:
- Downstream blocking behavior:

## Initial Checks

1. Check correlation ID.
2. Check audit event.
3. Check queue state and DLQ, if applicable.
4. Check backing service availability.
5. Check version/corpus/artifact refs, if applicable.

## Logs and Metrics

| Signal | Location | Notes |
|---|---|---|
| Correlation ID | | |
| Causation ID | | |
| Audit event | | |
| Queue depth / DLQ | | |
| Worker retry count | | |
| Artifact ref | | |

## Common Causes

| Cause | Confirmation | Mitigation |
|---|---|---|
| | | |

## Mitigation

Describe safe actions. Do not include destructive commands unless separately approved.

## Recovery

| Condition | Recovery action | Evidence |
|---|---|---|
| | | |

## Escalation

| Escalate to | When |
|---|---|
| Product owner | User-visible product decision needed |
| Architecture owner | Contract or authority ambiguity |
| Security owner | RBAC, secret, raw source, or audit risk |
| Legal domain owner | Corpus, citation, legal version, or allowlist risk |

## Post-Incident Evidence

- Incident summary:
- Affected assessments/artifacts:
- Audit event refs:
- Queue/event refs:
- Corrective task:
