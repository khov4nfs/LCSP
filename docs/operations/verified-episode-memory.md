# Verified Episode Memory Operations

Verified episodes are reusable execution examples for Planner and Investigator.
They are not factual authority for the current assessment run.

Current production scope:

- Capture and retrieve through `/internal/evidence/agentic-tools/dispatch`.
- Persist verified episodes in the API database.
- Retrieve by exact trusted scope: `assessmentId`, `ownerAgent`, active status,
  pinned `engineeringRuleIds`, and pinned `artifactVersions`.
- Consolidate/expire active records through the API consolidation command.

Required API environment:

- `WORKER_API_KEY` for the internal dispatch endpoint.
- `DATABASE_URL` for API persistence.
- `VERIFIED_EPISODE_CONSOLIDATION_INTERVAL_MS` when the background
  consolidation worker should run periodically. Set `0` or leave unset to avoid
  the periodic worker.

Runtime environment:

- `LCSP_VERIFIED_EPISODE_BACKEND=api` to use the governed API-backed gateway.
- `LCSP_VERIFIED_EPISODE_RETRIEVAL_ENABLED=true` to expose retrieval to the
  managed agent runtime.
- `NESTJS_API_BASE_URL` and `WORKER_API_KEY` for the internal dispatch API.

Out of scope for this implementation:

- Embedding generation for verified episode retrieval.
- API semantic retrieval, vector search, pgvector, or ANN indexes.
- Precision tuning gates or eval jobs for verified episode memory.
- Model/runtime eval container modes.
