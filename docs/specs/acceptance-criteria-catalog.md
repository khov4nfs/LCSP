# LCSP Acceptance Criteria Catalog

Canonical catalog: `AC-001..AC-041` plus Phase 5.2L `AC-050A..AC-050F`. `FR-050` is active as `AUTOMATIC_TRUSTED_SCAN_INITIATION`. `FR-051` is `REMOVED_FROM_PRODUCT`. `FR-052` is `DEFERRED_POST_MVP`. Canonical active UCs are `UC-001..UC-017`; historical `UC-018` structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP`.

| AC | Acceptance outcome | UC | FR | NFR |
|---|---|---|---|---|
| AC-001 | Authorized Manager creates an owned, audited Assessment. | UC-003 | FR-013 | NFR-008,010 |
| AC-002 | Submitted Wizard answers create a structured WizardProfile. | UC-004 | FR-014 | NFR-028 |
| AC-003 | Wizard/incomplete-evidence readiness shows no risk level. | UC-004,014 | FR-015,040 | NFR-018,020,022,028 |
| AC-004 | Authorized repository, snapshot, scan, and rerun stay in scope and preserve history. | UC-005,006,007,016 | FR-016,017,018,049 | NFR-006..009,016,030 |
| AC-005 | Invalid evidence schema/privacy flags reject the report before profile generation. | UC-007,008 | FR-020 | NFR-012..016 |
| AC-006 | Evidence quality yields ready/insufficient/rejected with actionable reason. | UC-008 | FR-021 | NFR-018,022,026 |
| AC-007 | Accepted evidence creates a redacted, evidence-backed TechnicalProfile or explicit unknowns. | UC-008 | FR-022,023,048 | NFR-014,016,029 |
| AC-008 | AIUsageFlow claims include evidence refs, confidence, and uncertainty. | UC-009 | FR-024 | NFR-029 |
| AC-009 | Unclear critical usage remains unclear and blocks unsupported classification. | UC-009 | FR-025 | NFR-018,019,022 |
| AC-010 | Material declaration/evidence mismatch creates a blocking conflict. | UC-010 | FR-026 | NFR-018 |
| AC-011 | Conflict Score explains materiality but creates no alternative route. | UC-010 | FR-027 | NFR-028 |
| AC-012 | Manager resolution is separate from scanner evidence, audited, and reruns reconciliation. | UC-010 | FR-028,029 | NFR-008,010,011,018 |
| AC-013 | Historical structured-attestation guard. No active MVP feature may use attestation to unlock classification, resolve conflict, approve VerifiedProfile, support reconciliation, or create report/audit dependency. | — | FR-045,046 | `SUPERSEDED_FOR_ACTIVE_MVP` |
| AC-014 | No unresolved conflict permits direct EngineeringRule classification to start. | UC-011 | FR-030 | NFR-016,018 |
| AC-015 | Customer-facing VerifiedProfile approval is not an active classification gate. | UC-011 | FR-030,031 | NFR-008,010,018,022 |
| AC-016 | Approved immutable corpus plus LegalRules yields citation-backed EngineeringRules. | UC-012 | FR-032,033,053,054,056 | NFR-017,029,033,034 |
| AC-017 | Missing required corpus/citation blocks or explicitly degrades legal output. | UC-012,013 | FR-034,036 | NFR-017,018,020,022,034 |
| AC-018 | Valid evidence/legal/provider basis yields classification or explicit blocked status. | UC-013,014 | FR-035..038,055 | NFR-017..019,021,022,033 |
| AC-019 | Missing final-output prerequisite blocks report; readiness-only output has no risk level. | UC-014 | FR-039..041 | NFR-018,020..022 |
| AC-020 | Material state/version changes create redacted immutable audit history. | UC-006,015,016 | FR-017,042..045,049 | NFR-010,011,016,030 |
| AC-021 | Invalid auth/MFA/session action is denied safely and audited. | UC-001 | FR-001..005 | NFR-001..005 |
| AC-022 | Sensitive source/value is redacted or blocked at persistence/send/display boundaries. | UC-007,017 | FR-019,043,048 | NFR-012..015 |
| AC-023 | OAuth login alone cannot authorize repository access. | UC-001,005,017 | FR-005,006,016 | NFR-005..007 |
| AC-024 | Unauthorized organization/role action is denied and audited. | UC-002,003 | FR-007..013 | NFR-008..010 |
| AC-025 | Developer cannot perform Manager-only actions. | UC-002,018 | FR-010..012,047 | NFR-008..010 |
| AC-026 | Revoked Developer policy blocks new actions and is auditable. | UC-002,018 | FR-011,012 | NFR-009,010 |
| AC-027 | On real DB/broker/storage/providers and approved corpus, Manager completes login-to-audit-export and obtains a cited document; Developer is optional. | UC-001,003..015,017 | FR-002,005,006,012..044,048,053..056 | NFR-010,012,017..026,029,030,033..035 |
| AC-028 | Snapshot retrieval failure produces `REPOSITORY_ACCESS_FAILED` and blocks downstream. | UC-007,016 | FR-018,049 | NFR-022,023,026,035 |
| AC-029 | Single-file parser failure records limitation and bounded scan continues. | UC-007 | FR-018,019 | NFR-018,023,026 |
| AC-030 | Unverified cleanup fails scan, audits security event, and blocks downstream. | UC-007,017 | FR-019 | NFR-013,016,018,026,035 |
| AC-031 | Dynamic Python flow records `UNSUPPORTED_DYNAMIC_FLOW` without false inference. | UC-007,008,009 | FR-023,025 | NFR-018,023,026,035 |
| AC-032 | AI import without invocation remains possible-use evidence only. | UC-008,009 | FR-023,025 | NFR-018,019,029 |
| AC-033 | Wizard/evidence conflict creates Manager task and blocks classification. | UC-010 | FR-026,028,029 | NFR-010,011,018,022 |
| AC-034 | Missing citation blocks/degrades match and prevents unsupported conclusion. | UC-012,013 | FR-034,036 | NFR-017,018,020,034 |
| AC-035 | Unapproved/superseded corpus blocks retrieval for new assessment. | UC-012 | FR-032,054,056 | NFR-017,018,022,034 |
| AC-036 | Zero citation candidates create no applicability claim and block/degrade classification. | UC-012 | FR-032..034,056 | NFR-017,018,029,034 |
| AC-037 | LLM outage exhausts bounded retry then fails closed with actionable status. | UC-013 | FR-035,055 | NFR-021,022,026,033 |
| AC-038 | Invalid LLM schema exhausts bounded retry then fails closed. | UC-013 | FR-035,055 | NFR-018,021,022,026 |
| AC-039 | Duplicate message causes no duplicate state or artifact. | UC-015,016 | FR-042,044,049 | NFR-010,024,026,030 |
| AC-040 | Transient broker failure keeps outbox pending and retries to ack/terminal failure. | UC-015 | FR-042,044 | NFR-010,021,024,026 |
| AC-041 | Document guard violation blocks generation and publishes no artifact. | UC-014,017 | FR-039,041 | NFR-018,020,021,022,026 |
| AC-050A | Trusted trigger with complete mapping creates or resumes exactly one scan workflow for the correct tenant, repository, assessment, branch, and commit. | UC-016 | FR-050 | NFR-008,010,016,024,026,030 |
| AC-050B | Duplicate trigger delivery with the same idempotency key returns or resumes the existing job and creates no duplicate artifact. | UC-016 | FR-050 | NFR-010,024,026,030 |
| AC-050C | Out-of-order trigger events wait, no-op, or block safely without mutating completed history. | UC-016 | FR-050 | NFR-018,026,030 |
| AC-050D | Missing repository/account/assessment mapping creates `PENDING_MAPPING`, `BLOCKED_MAPPING`, or `WAITING_FOR_CONTEXT`; no scan starts. | UC-016 | FR-050 | NFR-008,018,022,026 |
| AC-050E | Ambiguous assessment mapping blocks with Manager-visible recovery state and never best-effort scans. | UC-016 | FR-050 | NFR-008,018,022,026 |
| AC-050F | Every scan-trigger authorization decision records actor/service identity, organization, resource, action, policy ID, policy version, decision, safe context refs, and correlation ID. | UC-016,017 | FR-050 | NFR-008,010,011,026 |

```text
CANONICAL_ACCEPTANCE_CRITERIA_NORMALIZED
FR_050_ACCEPTANCE_CRITERIA_ADDED
FR_051_REMOVED_FROM_PRODUCT
STRUCTURED_ATTESTATION_SUPERSEDED_FOR_ACTIVE_MVP
GOLDEN_PATH_EXCLUDES_OPTIONAL_DEVELOPER_DEPENDENCY
```
