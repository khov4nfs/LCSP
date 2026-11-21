# Agent Adaptive Memory Buffer (`.agents/memory/`)

## 1. Purpose
This directory houses persistent organizational memory and learned lessons across all AI Agent sessions. It acts as the project's **Adaptive Learning Loop**: when an agent fixes a non-trivial bug, resolves a complex edge-case, or receives a correction from a human developer, the distilled invariant is recorded here so future sessions never repeat the same mistake.

## 2. Structure
- `lessons-learned.md`: The canonical ledger of resolved technical pitfalls, categorized by stack (`apps/api`, `apps/web`, `deepagents`, `packages/contracts`).

## 3. Protocol for AI Agents
1. **Query on Startup**: Before executing a major refactor or non-trivial task in module X, consult `lessons-learned.md` for historical pitfalls related to that module.
2. **Record on Resolution**: When resolving a bug under the Debugging Protocol, distill the Root Cause & Fix into a new entry in `lessons-learned.md`.
3. **Elevate to Rule**: If a lesson occurs more than once or represents a critical architectural boundary, elevate it to the target module's `AGENTS.md` verification checklist.
