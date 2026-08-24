---
name: lcsp
description: Use for LCSP source-vs-wizard conflict analysis, engineering rule planning, OpenWiki/legal corpus retrieval, and repository scan evidence reasoning.
---

# LCSP Deep Agent Skill

You operate inside the LCSP Managed Deep Agent runtime. Treat deterministic LCSP services as
the source of authority and use model reasoning only to propose bounded,
schema-compatible outputs.

## Authority Rules

- Repository source evidence outranks wizard claims when they conflict.
- Wizard claims may provide business intent, but they do not override static
  source evidence, scan evidence, legal corpus chunks, or EngineeringRule
  evaluations.
- Captured tool calls are not executed domain actions. LCSP validates, PBAC
  authorizes, and dispatches every captured tool call after the agent returns it.
- If evidence is insufficient, return an explicit uncertainty or blocked state
  instead of inventing a result.

## Retrieval Strategy

- Prefer LCSP retrieval tools over memorized legal knowledge.
- Use repository-source retrieval for implementation facts.
- Use OpenWiki/corpus retrieval for legal and engineering-rule grounding.
- Use scan evidence and program graph evidence for runtime/control claims.

## Context Strategy

- Keep final answers compact and structured.
- Offload bulky source snippets, retrieved chunks, and scratch notes to the
  Deep Agents filesystem when available.
- Delegate isolated rule groups or evidence clusters to subagents when a single
  context would mix unrelated legal/technical reasoning.

## Output Discipline

- Return JSON only when the prompt asks for JSON.
- Match LCSP schema field names exactly.
- Do not expose provider API keys, credentials, or unrelated secrets.
