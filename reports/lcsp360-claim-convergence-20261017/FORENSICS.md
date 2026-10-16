# LCSP-360 claim convergence forensics

Baseline rehydrated at 2026-10-16 16:58 UTC: local/origin/VPS all `8af6967ba640732ae75f26cfa541b823e44d3e92`, canonical branch, VPS tracked clean, API/Web/Agent 200. Trusted ACTIVE `30f83523-f8a4-40d9-ab8f-3c4e878d8c60`, ACTIVE count one; production Preparation count33, active Preparations/leases/native runs/unpublished outbox zero. Three unrelated tracked web files retain their original hashes. No production execution is authorized.

## Root cause

`MOVING_CLAIM_INVENTORY_ROOT_CAUSE = PROVEN` for the simultaneous mutation/convergence defect, not as a claim that it was the only failure.

The retained trace shows claims continued to change after Requirements existed: 43 claims at the first Requirement (15:27:48 UTC), then counts43,49,53,54,58,61,63,65,68,79,92,93,94,95. Semantic relevance denominators also changed. There was no discovery/finalization boundary or inventory revision.

All123 outcomes are reconciled in [validation-forensics.json](validation-forensics.json): 57 parsed Gate rejections,66 schema errors,0 passing validations. The file includes first10, middle56–65, final10 and every attempt. Of the parsed results,57 report UNACCOUNTED_SEMANTIC_CLAIM,53 detached dependencies,52 incomplete structural accounting,51 claim/Requirement mismatch. These overlapping attempt counts must not be summed as separate attempts. Full gap occurrence distributions and captured schema paths are retained.

**Evidence limit:** old telemetry deliberately retained counts/codes/limited schema paths, not candidate/claim/Requirement/binding payloads or their fingerprints. No per-attempt candidate, inventory, Requirement or accounting fingerprint can be reconstructed honestly. Duplicate claims, invalid relations and missing binding subtypes cannot be separated from aggregate codes. They are null/NOT_RECORDED in the report. Longest identical *gap-code/count* sequence is9; that is not proof of nine identical effective candidates. Exact UNIQUE_*_FINGERPRINTS, REPEATED_GAP_FINGERPRINTS and LONGEST_EFFECTIVE_NO_PROGRESS_SEQUENCE are unavailable. New validation telemetry must record those safe fingerprints.

## Current ownership and paths

- Agent chooses claim IDs and every semantic field through `deepagents/rule_set_preparation/tools.py::add_to_packet_draft`. Its schema accepts section arrays, checking only that each item has a label. An existing label replaces the entire claim, including type/source nodes/state/statement/operative bindings, and claim relations can be replaced at any time. There is no claim-final state.
- `RuleSetPreparationContext.draft_packet` assembles the live mutable draft's claim graph together with Requirements/AssessmentRules; `run_validation` sends that assembled packet. It has no frozen revision. The tool is synchronous, so an individual API request sees one serialized packet, but successive validations and already-authored Requirements can observe a different graph. This is a moving target across attempts, not a proven mid-request race.
- `authored_claim_ids` prevents complete omission of previously named claims in a direct candidate, but does not freeze their meaning, source bindings, type, relevance or relations. Raw draft claim deletion is not exposed, yet reclassification can change the relevant denominator, and a new ID can add another equivalent candidate.
- IDs are arbitrary Agent labels. Persistence uses `(claimId,ruleSetVersionId)`; it does not assign a canonical discovery identity. `candidateFingerprint` is calculated only during accepted Rule Set persistence and includes the candidate's authored contents; it does not stabilize in-flight discovery.
- `run_validation` does not apply effective-state no-progress. Schema exceptions clear `last_validation`, return an error, and allow another iteration. `add_to_packet_draft` increments `progress_revision` for any changed payload, independently of semantic validity, and revokes the previous validation.
- `_record_completion_submission` has unchanged-state feedback/escalation, but is called only by submission. The failed run never submitted. Source observation no-progress in `agent.py::PreparationObservationMiddleware` is a separate read-tool guard, reset by progress revisions; it cannot detect a repeating invalid Rule validation state.
- Backend `ValidateComplianceRuleSetHandler` and `SubmitComplianceRuleSetHandler` validate the supplied graph against pinned source; `ComplianceRuleSetActivation.commit` locks the Preparation before authority publication. There is no inventory revision to compare. Existing AST/materialization and immutable source pinning remain suitable and will be reused.

## Fix scope

One Managed Deep Agent/thread/context will use explicit discovery -> inventory validation -> frozen ready -> rule authoring -> rule validation -> submission ready -> completion transitions. Persist immutable frozen inventory revisions under the existing Preparation. Reopening records a reason and increments revision; downstream candidate state is invalidated. Claim identity uses Preparation revision + source identity + an explicit Agent semantic key, not array position/random UUID/generated prose. Typed incremental tools validate on write and return canonical IDs/fields. Rule/evidence assembly copies linked structured semantics instead of asking for multiple independent rewrites. API validation/publication must check the same frozen revision under the existing Preparation lock. Phase validation gets effective-state/gap fingerprints and feedback-before-termination independent of arbitrary call counts.

The Legal Document AST/parser/chunk mapping are outside this fix. No model or disposable Preparation will run until deterministic and deployed provider-free gates pass.
