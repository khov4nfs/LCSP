# Worker A file discovery contract

Historical integration snapshot. The owner's simplification supersedes its lease/next-unit findings; see the [simplification report](LCSP-360-simplify-P-report.md) and [takeover acceptance](LCSP-360-takeover-acceptance-report.md) for current behavior and evidence.

The Draft7 source of truth is `deepagents/rule_set_preparation/claim-file.schema.json`.
Review kinds are the ten entries in `claim-file.schema.json` under `claims.items.properties.relations`, including INCORPORATES and CROSS_REFERENCE. No legacy kinds.

Reference accounting forms (all reject extra properties):
- `{"material": false, "reason": "..."}`
- `{"material": "UNRESOLVED", "reason": "..."}`
- `{"material": true, "binding": {"from": "local-key", "to": "document/dieu-N.json#key", "kind": "DEFINED_BY"}}`

Bound entries must match a relation carrying the referenceId on the FROM claim. Local TO uses the local key. Cross-file paths are relative to /work/claims. Frame dimensions may be omitted; the runtime supplies null for absent dimensions. legalEffect retains the current packet shape.

API dependency: COMPLETE must accept a multi-Article batch without NEXT, under the run operationId plus source/frontier revisions; cross-batch endpoints retain existing fingerprint verification. The Python adapter uses INIT + pinned nodes to adopt units, never NEXT.

Budget pause integration: the Python runner calls the existing failure callback with reason AGENT_BUDGET_REACHED, then verifies executionState=PAUSED. Worker B's failure handler now maps that reason to PAUSED; resume preserves LOAD payloads. No new endpoint is needed.

## Integration findings from the broad Python run

The new file-bridge cases pass with Worker B's current COMPLETE implementation. The older node/lease bridge suites also exposed these API-side follow-ups (Worker A did not edit API files):
- `SEED` in `apps/api/test/support/review-frontier-bridge.ts` now exits with `Diagnostic setup refused` before Python discovery executes. Update its diagnostic seeding prerequisites to the current materialization/claim gate.
- Restarting a direct harness `ReviewFrontier` produces a new operationId, while the handler pins the first ID on the run and does not return it in INIT/LOAD. Old restore/NEXT tests then fail COMPLETE with SOURCE_REVIEW_LEASE_CONFLICT / Initialize this run's review operation before completing units. Production reclaim clears reviewOperationId; direct restart fixtures must simulate that reclaim or preserve the operation identity.
- The older single-node self-reference liveness fixture now sees its own candidate endpoint as available during the COMPLETE transaction and rejects an unnecessary reference wait. That fixture should bind its two distinct same-unit claims instead of waiting.

No live Preparation, production data change, Rule Authoring semantic change, deployment, git stage/commit/push, or Phase 7 deletion was performed by Worker A.
