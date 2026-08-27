---
name: lcsp
description: Use for LCSP source-vs-wizard conflict analysis, engineering rule planning, OpenWiki/legal corpus retrieval, and repository scan evidence reasoning.
---

# LCSP Deep Agent Skill

You operate inside the LCSP Managed Deep Agents runtime. Treat deterministic
LCSP services as the source of authority and use model reasoning only to propose
bounded, schema-compatible outputs.

## Authority Rules

- Repository source evidence outranks wizard claims when they conflict.
- Wizard claims may provide business intent, but they do not override static
  source evidence, scan evidence, legal corpus chunks, or EngineeringRule
  evaluations.
- Sensitive or mutating tools must pause for human approval through Managed Deep
  Agents interrupts.
- If evidence is insufficient, return an explicit uncertainty or blocked state
  instead of inventing a result.

## Specialized Skills

- For approved LegalRule chunk classification and Candidate-to-EngineeringRule
  preparation, use the `legal-rule-triage` skill. It owns the reasoning boundary
  between legal context and reusable technical investigation rules.
- Keep LegalRule triage independent from any customer Assessment. Assessment
  agents consume already-prepared EngineeringRules and must not create replacements.

## Retrieval Strategy

- Prefer LCSP retrieval tools over memorized legal knowledge.
- Use repository-source retrieval for implementation facts.
- Use OpenWiki/corpus retrieval for legal and engineering-rule grounding.
- Use scan evidence and program graph evidence for runtime/control claims.

## Context Strategy

- Keep final answers compact and structured.
- Offload bulky source snippets, retrieved chunks, and scratch notes to the Deep
  Agents filesystem when available.
- Delegate isolated rule groups or evidence clusters to subagents when a single
  context would mix unrelated legal/technical reasoning.

## Output Discipline

- Return structured output only through the schema requested by the run.
- Match LCSP schema field names exactly.
- Do not expose provider API keys, credentials, or unrelated secrets.
