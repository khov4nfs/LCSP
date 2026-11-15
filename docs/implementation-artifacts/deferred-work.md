- source_spec: `docs/implementation-artifacts/spec-ai-dependency-pre-scan-catalog.md`
  summary: Bound scanner framework observations and candidate facts to the shared contract maximum of 500 entries.
  evidence: The pre-existing scanner can emit one observation and fact per matching dependency without a cap, while `repositoryProfileSchema` rejects `frameworks` and `candidateFacts` arrays above 500 entries.
