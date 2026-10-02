---
status: ACTIVE_PLANNING_ARTIFACT
artifact_type: engineering_handoff_catalog
---

# LCSP Engineering Handoff Catalog

## Purpose

This folder contains domain and wave handoff packets for implementation planning. Handoffs group task briefs into executable context packets for engineers and AI coding agents.

## Handoff Index

| Handoff | Status | Scope | Included tasks |
|---|---|---|---|
| [Repository Deep Agent architecture](../../architecture/repository-deep-agent-analysis.md) | `ACTIVE` | repository analysis, evidence gates, TechnicalProfile | LCSP Agent Runtime repository-analysis flow |
| [HANDOFF-ai-usage-flow-and-reconciliation.md](HANDOFF-ai-usage-flow-and-reconciliation.md) | `READY_FOR_PLANNING_REVIEW` | AIUsageFlow, conflict candidates, reconciliation, VerifiedProfile | MW-intel-002, MW-intel-004 |

## Rules

- Handoffs do not authorize implementation before readiness and sprint planning.
- Active handoffs must cite active authority docs only; archived handoffs are historical evidence only.
- Handoffs must preserve artifact boundaries:
  - `TechnicalEvidenceReport` is repository-analysis evidence.
  - `TechnicalProfile` is technical observation.
  - `AIUsageFlow` is business usage claim set.
  - `VerifiedProfile` is post-reconciliation final profile for legal matching.
