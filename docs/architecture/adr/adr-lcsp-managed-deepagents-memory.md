# ADR: LCSP Managed Deep Agents Memory Boundary

Status: Accepted

Date: 2026-08-30

## Context

LCSP assessment runs contain tenant, user, repository, legal-corpus, and compliance evidence. Managed Deep Agents thread state is useful execution memory, but deployment-shared durable agent memory is not an LCSP factual authority boundary.

## Decision

LCSP uses checkpoint-first, authority-separated memory:

- Managed Deep Agents and LangGraph thread state are execution memory only.
- LCSP API/database records and governed artifacts are long-term factual memory.
- Checked-in prompts, skills, and policy modules are procedural memory.
- Specialist scratch is transient and private to one invocation.
- Verified episodes are captured through API/DB when configured as read-only retrieval aids, but never as factual authority.
- Verified episode capture is append-only and configuration-gated. Retrieval is disabled by default
  and must exact-filter by owner agent, EngineeringRule IDs, and pinned artifact versions before any
  ranking.
- Deployment-shared `/memories/agent` memory remains disabled for assessment, user, tenant, repository, legal, and compliance facts.

## Consequences

Specialists must return typed handoffs. Runtime identity must come from trusted runtime context or deterministic service envelopes, not model-authored arguments. Investigator claims must be schema-valid and, when graph evidence is available, pass `EvidenceClaimValidator` before deterministic compliance evaluation can consume them.

Semantic ranking, deduplication, TTL, and consolidation are background concerns over verified
episodes only. They cannot promote an episode into authoritative assessment, legal, repository, or
compliance state.
