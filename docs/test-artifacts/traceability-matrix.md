---
stepsCompleted:
  - step-01-load-context
  - step-02-discover-tests
  - step-03-map-criteria
  - step-04-analyze-gaps
  - step-05-gate-decision
lastStep: step-05-gate-decision
lastSaved: '2026-06-25'
tempCoverageMatrixPath: /tmp/tea-trace-coverage-matrix-2026-06-25T00-00-00-000-07-00.json
coverageBasis: acceptance_criteria
oracleConfidence: high
oracleResolutionMode: formal_requirements
oracleSources:
  - docs/planning-artifacts/epics.md
  - docs/product/prd.md
  - docs/specs/functional-requirements.md
  - docs/specs/non-functional-requirements.md
  - docs/specs/acceptance-criteria-catalog.md
  - docs/specs/requirements-traceability-matrix.md
  - docs/specs/requirements-traceability-summary.md
  - docs/specs/user-task-flows.md
externalPointerStatus: not_used
---

# LCSP Test Architecture Traceability Matrix

## Step 1 - Context Load

### Coverage Oracle Resolution

The coverage oracle is resolved from formal project requirements. The primary oracle is `docs/planning-artifacts/epics.md`, because it contains the current story set, acceptance criteria, FR/NFR references, UX alignment, and story-level traceability requirements created after the latest UX and epic remediation.

Supporting authority comes from the active PRD, FR catalog, NFR catalog, acceptance criteria catalog, user task flows, and requirements traceability documents. `docs/archive/**` is excluded from authority review.

The existing requirements traceability matrix is retained as an input source, but it contains stale story-readiness wording from before the canonical epics/stories artifact was created. Trace generation must therefore prefer the current `epics.md` story/AC inventory when matrix wording conflicts with newer planning artifacts.

### Oracle Confidence

`high`

Rationale:

- Active functional requirements are normalized as `FR-001..FR-056`.
- Active acceptance criteria are normalized as `AC-001..AC-041` plus `AC-050A..AC-050F`.
- Active NFRs are normalized as `NFR-001..NFR-030` and `NFR-033..NFR-035`.
- Canonical epics now contain story-level acceptance criteria and a story-level coverage map.
- Historical structured attestation and manual technical evidence JSON upload paths are explicitly superseded or removed.

### Loaded Project Artifacts

| Artifact | Role in trace run |
|---|---|
| `docs/planning-artifacts/epics.md` | Primary story and AC oracle. |
| `docs/product/prd.md` | Product requirement and scope authority. |
| `docs/specs/functional-requirements.md` | FR catalog and FR-to-AC references. |
| `docs/specs/non-functional-requirements.md` | NFR catalog, measurement, and verification methods. |
| `docs/specs/acceptance-criteria-catalog.md` | Canonical AC catalog and UC/FR/NFR joins. |
| `docs/specs/requirements-traceability-matrix.md` | Existing UC/FR/AC/NFR/domain implementation map; stale story status noted. |
| `docs/specs/requirements-traceability-summary.md` | Traceability summary input. |
| `docs/specs/user-task-flows.md` | UX/user-flow alignment input. |
| `docs/specs/scanner-spec.md` | Scanner behavior and evidence contract input. |
| `docs/specs/legal-matching-domain-spec.md` | Legal retrieval, citation allowlist, and LegalRuleMatch input. |
| `docs/architecture/architecture.md` | Architecture and implementation boundary input. |
| `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md` | Rebased UX design input. |
| `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md` | Rebased UX experience input. |
| `docs/planning-artifacts/canonical-ux-review-2026-06-25.md` | UX review constraints and residual concern input. |

### Contract and External Pointer Status

No OpenAPI, Swagger, GraphQL, or equivalent machine-readable endpoint contract was found in the active docs scan. Domain specifications are available and will be used as the contract basis for domain-level trace coverage where endpoint contracts are absent.

External pointers are not used for this trace run.

### Knowledge Base Loaded

The trace run loaded the required Test Architect knowledge fragments:

- `test-priorities-matrix.md`
- `risk-governance.md`
- `probability-impact.md`
- `test-quality.md`
- `selective-testing.md`

Applied principles:

- P0/P1 priority is assigned to security, RBAC, data integrity, compliance, legal citation, worker idempotency, and fail-closed paths.
- Risk score `9` is a blocker; scores `6..8` require mitigation and produce gate concerns.
- Each acceptance criterion must map to at least one test or to an explicit owned waiver.
- Tests should be deterministic, isolated, explicit, focused, self-cleaning, and suitable for selective execution by priority and domain tags.

### Step 1 Result

```text
CONTEXT_LOADED
FORMAL_REQUIREMENTS_ORACLE_SELECTED
ACCEPTANCE_CRITERIA_COVERAGE_BASIS_SELECTED
ORACLE_CONFIDENCE_HIGH
EXTERNAL_POINTERS_NOT_USED
ARCHIVE_EXCLUDED_FROM_AUTHORITY
READY_FOR_TEST_DISCOVERY
```

## Step 2 - Discover and Catalog Tests

### Test Directory Resolution

The TEA config does not define `test_dir`. Discovery therefore used repository-wide standard test patterns:

- directories: `tests/`, `test/`, `__tests__/`, `e2e/`, `spec/`, `specs/`
- files: `*.spec.*`, `*.test.*`
- framework markers: Playwright, Cypress, Vitest, Jest, Pytest, unittest
- test declarations: `describe`, `it`, `test`, `expect`, `assert`, `@pytest`
- requirement tags: `FR-*`, `AC-*`, `NFR-*`, `UC-*`, `@p0`, `@p1`, `@smoke`, `@regression`

### Test Inventory

No executable test source files were found in the active repository.

| Level | Tests found | Notes |
|---|---:|---|
| E2E | 0 | No Playwright/Cypress/E2E test files found. |
| API | 0 | No endpoint/API integration tests found. |
| Component | 0 | No component test files found. |
| Unit | 0 | No unit test files found. |

Machine-readable test identity inventory is empty:

```yaml
tests: []
```

### Discovered Runtime or Contract References

The repo is currently documentation/planning-heavy rather than implementation/test-heavy. Testable design contracts were found, including:

- API groups and route contracts in `docs/implementation/backend-implementation.md`.
- Worker commands and events in `docs/specs/event-catalog.md` and `docs/implementation/queue-implementation.md`.
- Scanner command/event/runtime contract in `docs/specs/scanner-spec.md` and `docs/implementation/scanner-worker-implementation.md`.
- Legal retrieval, citation allowlist, and LegalRuleMatch contracts in `docs/specs/legal-matching-domain-spec.md`.
- AIUsageFlow and classification handoffs in `docs/specs/ai-usage-flow-domain-spec.md` and `docs/specs/legal-classification-spec.md`.

Representative API routes with no direct tests found:

| Method | Route | Domain |
|---|---|---|
| `POST` | `/api/v1/assessments` | Assessment |
| `GET` | `/api/v1/assessments/:assessmentId` | Assessment |
| `POST` | `/api/v1/assessments/:assessmentId/wizard-profile` | Wizard |
| `POST` | `/api/v1/assessments/:assessmentId/github/repository-connections` | GitHub |
| `POST` | `/api/v1/assessments/:assessmentId/repository-snapshots` | Repository Snapshot |
| `POST` | `/api/v1/assessments/:assessmentId/scans` | Scan |
| `GET` | `/api/v1/assessments/:assessmentId/scans/:scanJobId` | Scan |
| `GET` | `/api/v1/assessments/:assessmentId/technical-profile` | TechnicalProfile |
| `GET` | `/api/v1/assessments/:assessmentId/ai-usage-flow` | AIUsageFlow |
| `GET` | `/api/v1/assessments/:assessmentId/reconciliation-conflicts` | Reconciliation |
| `POST` | `/api/v1/assessments/:assessmentId/reconciliation-conflicts/:conflictId/resolve` | Reconciliation |
| `POST` | `/api/v1/assessments/:assessmentId/classifications` | Classification |
| `GET` | `/api/v1/assessments/:assessmentId/classifications/latest` | Classification |
| `GET` | `/api/v1/assessments/:assessmentId/gap-analysis/latest` | Gap Analysis |
| `POST` | `/api/v1/assessments/:assessmentId/documents` | Document |
| `GET` | `/api/v1/assessments/:assessmentId/documents/:documentId` | Document |

### Coverage Heuristics

```yaml
coverage_heuristics:
  api_endpoint_coverage:
    status: no_direct_tests_found
    endpoints_with_no_direct_tests:
      - assessment_create
      - assessment_read
      - wizard_profile_save
      - github_repository_connection
      - repository_snapshot_create
      - scan_request
      - scan_status_read
      - technical_profile_read
      - ai_usage_flow_read
      - reconciliation_conflict_list
      - reconciliation_conflict_resolve
      - classification_request
      - classification_latest_read
      - gap_analysis_latest_read
      - document_request
      - document_status_read
  authentication_authorization_coverage:
    status: no_tests_found
    missing_negative_paths:
      - invalid_login_or_session
      - invalid_mfa_or_replayed_otp
      - unsafe_oauth_callback
      - oauth_without_github_authorization
      - rbac_denied_manager_only_action
      - revoked_developer_scope
      - worker_service_identity_denied
  error_path_coverage:
    status: no_tests_found
    missing_paths:
      - validation_failure
      - timeout
      - transient_broker_failure
      - duplicate_message
      - out_of_order_message
      - repository_access_failure
      - scanner_parser_failure
      - scanner_cleanup_failure
      - legal_corpus_unapproved_or_superseded
      - zero_citation_candidates
      - out_of_allowlist_citation
      - llm_timeout_or_invalid_schema
      - document_guard_violation
  ui_journey_coverage:
    status: no_e2e_or_component_tests_found
    missing_journeys:
      - login_mfa_oauth
      - organization_and_rbac_scope
      - assessment_wizard_readiness
      - repository_connection_and_scan_status
      - technical_profile_and_ai_usage_flow_review
      - conflict_resolution_and_verified_profile
      - legal_matching_and_classification_status
      - gap_analysis_document_and_audit_export
  ui_state_coverage:
    status: no_e2e_or_component_tests_found
    missing_states:
      - loading
      - empty
      - validation_error
      - permission_denied
      - blocked
      - degraded
      - failed_with_actionable_recovery
```

### Step 2 Result

```text
TEST_DISCOVERY_COMPLETED
NO_EXECUTABLE_TESTS_FOUND
API_CONTRACT_REFERENCES_FOUND_WITHOUT_DIRECT_TESTS
AUTHZ_NEGATIVE_PATH_TESTS_MISSING
ERROR_PATH_TESTS_MISSING
UI_JOURNEY_TESTS_MISSING
READY_FOR_CRITERIA_MAPPING
```

## Step 3 - Map Coverage Oracle to Tests

### Matrix Basis

The matrix maps every active acceptance criterion from `docs/specs/acceptance-criteria-catalog.md` to discovered executable tests. Because Step 2 found no executable tests, all current coverage statuses are `NONE`. The priority column reflects risk-based test priority, not delivery priority.

Machine-readable test identities remain empty for every row:

```yaml
mapped_tests: []
```

### Acceptance Criteria Trace Matrix

| AC | Priority | Coverage | Test levels | Required coverage focus | Current mapped tests |
|---|---|---|---|---|---|
| AC-001 | P0 | NONE | API, Integration | RBAC-authorized assessment creation, audit event. | None |
| AC-002 | P1 | NONE | API, Component/E2E | WizardProfile submission and business-language validation. | None |
| AC-003 | P0 | NONE | API, E2E | Readiness-only state, no risk level, blocked/degraded messaging. | None |
| AC-004 | P0 | NONE | API, Worker, Integration | Repository authorization, snapshot, scan, rerun history. | None |
| AC-005 | P0 | NONE | API, Worker, Unit | Evidence schema/privacy rejection before profile generation. | None |
| AC-006 | P0 | NONE | API, Worker, Unit | Evidence quality ready/insufficient/rejected reasons. | None |
| AC-007 | P0 | NONE | API, Worker, Integration | Redacted TechnicalProfile with evidence refs and unknowns. | None |
| AC-008 | P0 | NONE | Worker, Unit | AIUsageFlow claim refs, confidence, uncertainty. | None |
| AC-009 | P0 | NONE | Worker, Integration | Unclear critical usage blocks unsupported classification. | None |
| AC-010 | P0 | NONE | Worker, Integration | Material evidence/declaration mismatch creates blocking conflict. | None |
| AC-011 | P1 | NONE | API, Unit | Conflict Score is explanatory only, not alternate route. | None |
| AC-012 | P0 | NONE | API, Integration, E2E | Manager resolution audited and separated from scanner evidence. | None |
| AC-013 | P0 | NONE | API, Unit, E2E | Historical structured-attestation guard blocks active dependencies. | None |
| AC-014 | P0 | NONE | Worker, Integration | Unresolved conflict blocks VerifiedProfile creation. | None |
| AC-015 | P0 | NONE | API, Integration, E2E | Unresolved conflict blocks VerifiedProfile approval. | None |
| AC-016 | P0 | NONE | Worker, Integration | Approved corpus and VerifiedProfile create cited LegalRuleMatch. | None |
| AC-017 | P0 | NONE | Worker, Integration, E2E | Missing corpus/citation blocks or degrades legal output. | None |
| AC-018 | P0 | NONE | API, Worker, E2E | Classification or explicit blocked state from valid basis. | None |
| AC-019 | P0 | NONE | API, Worker, E2E | Report guard and readiness-only output without risk level. | None |
| AC-020 | P0 | NONE | API, Integration | Immutable redacted audit/version history. | None |
| AC-021 | P0 | NONE | API, Integration, E2E | Auth/MFA/session denial and audit. | None |
| AC-022 | P0 | NONE | API, Worker, Integration | Redaction/blocking at persistence/send/display boundaries. | None |
| AC-023 | P0 | NONE | API, Integration, E2E | OAuth identity cannot authorize repository access. | None |
| AC-024 | P0 | NONE | API, Integration | Organization and RBAC-denied action audit. | None |
| AC-025 | P0 | NONE | API, E2E | Developer cannot perform Manager-only actions. | None |
| AC-026 | P0 | NONE | API, Integration | Revoked Developer policy blocks new actions and audits. | None |
| AC-027 | P0 | NONE | E2E, Integration | Full login-to-audit-export MVP smoke on real dependencies. | None |
| AC-028 | P0 | NONE | Worker, Integration | Repository access failure blocks downstream. | None |
| AC-029 | P1 | NONE | Worker, Unit | Single-file parser failure records limitation and continues. | None |
| AC-030 | P0 | NONE | Worker, Integration | Cleanup failure fails scan, audits security event, blocks downstream. | None |
| AC-031 | P0 | NONE | Worker, Unit | Unsupported dynamic Python flow without false inference. | None |
| AC-032 | P0 | NONE | Worker, Unit | AI import without invocation remains possible-use only. | None |
| AC-033 | P0 | NONE | API, Worker, E2E | Wizard/evidence conflict creates Manager task and blocks classification. | None |
| AC-034 | P0 | NONE | Worker, Integration | Missing citation prevents unsupported conclusion. | None |
| AC-035 | P0 | NONE | Worker, Integration | Unapproved/superseded corpus blocks retrieval. | None |
| AC-036 | P0 | NONE | Worker, Integration | Zero citation candidates create no applicability claim. | None |
| AC-037 | P0 | NONE | Worker, Integration | LLM outage retry exhaustion fails closed. | None |
| AC-038 | P0 | NONE | Worker, Integration | Invalid LLM schema retry exhaustion fails closed. | None |
| AC-039 | P0 | NONE | Worker, Integration | Duplicate message causes no duplicate state/artifact. | None |
| AC-040 | P0 | NONE | Worker, Integration | Broker failure keeps outbox pending/retries to terminal result. | None |
| AC-041 | P0 | NONE | Worker, Integration, E2E | Document guard violation blocks generation and publishes no artifact. | None |
| AC-050A | P0 | NONE | API, Worker, Integration | Trusted trigger creates/resumes exactly one correct scan workflow. | None |
| AC-050B | P0 | NONE | API, Worker, Integration | Duplicate trigger idempotency creates no duplicate artifact. | None |
| AC-050C | P0 | NONE | API, Worker, Integration | Out-of-order trigger does not mutate completed history. | None |
| AC-050D | P0 | NONE | API, Worker, E2E | Missing mapping blocks scan with actionable state. | None |
| AC-050E | P0 | NONE | API, Worker, E2E | Ambiguous mapping blocks, no best-effort scan. | None |
| AC-050F | P0 | NONE | API, Integration | Trigger authorization audit captures RBAC decision details. | None |

### Coverage Logic Validation

| Check | Result |
|---|---|
| P0/P1 items have coverage | FAIL. All P0/P1 items have `NONE` because no executable tests exist. |
| Duplicate coverage across levels | PASS. No mapped tests, so no duplicate mapping risk yet. |
| Error/alternate states covered where required | FAIL. Error-path tests are missing across scan, worker, legal, LLM, queue, and document guards. |
| API items marked FULL only with endpoint checks | PASS. No API item is marked `FULL`. |
| Auth/authz items include denied/invalid path tests | FAIL. RBAC/auth negative-path tests are missing. |
| UI journeys marked FULL only with E2E/component coverage | PASS. No UI journey is marked `FULL`. |

### Heuristic Signals by Coverage Domain

| Domain | Signal |
|---|---|
| Endpoint coverage | Missing for all route contracts discovered in `backend-implementation.md`. |
| Auth/authz coverage | Missing positive and negative tests for login/session/MFA/OAuth/RBAC/Developer revocation/worker service identity. |
| Error-path coverage | Missing validation, timeout, broker failure, duplicate/out-of-order, repository failure, scanner parser/cleanup, corpus, citation, LLM, and document guard tests. |
| UI journey coverage | Missing E2E/component tests for every Manager, Developer, legal operations, document, and audit flow. |
| UI state coverage | Missing loading, empty, validation, permission denied, blocked, degraded, and failed-with-recovery assertions. |

### Step 3 Result

```text
CRITERIA_MAPPING_COMPLETED
AC_COVERAGE_ROWS_BUILT
ALL_ACTIVE_ACCEPTANCE_CRITERIA_CURRENTLY_UNCOVERED
P0_P1_COVERAGE_VALIDATION_FAILED
AUTHZ_NEGATIVE_PATH_COVERAGE_MISSING
ERROR_PATH_COVERAGE_MISSING
READY_FOR_GAP_ANALYSIS
```

## Step 4 - Analyze Gaps and Complete Phase 1

### Execution Mode

`sequential`

No explicit user override requested `agent-team` or `subagent`, and the active runtime did not expose a supported agent-team/subagent capability for this step. The step was executed in deterministic sequence.

### Gap Analysis

| Gap bucket | Count | Status |
|---|---:|---|
| Critical gaps `P0` | 44 | Uncovered |
| High gaps `P1` | 3 | Uncovered |
| Medium gaps `P2` | 0 | None |
| Low gaps `P3` | 0 | None |
| Partial coverage | 0 | None |
| Unit-only coverage | 0 | None |

All 47 active acceptance criteria are currently uncovered because no executable tests were discovered.

### Coverage Statistics

| Metric | Value |
|---|---:|
| Total requirements | 47 |
| Fully covered | 0 |
| Partially covered | 0 |
| Uncovered | 47 |
| Overall full coverage | 0% |
| P0 coverage | 0/44 (0%) |
| P1 coverage | 0/3 (0%) |
| P2 coverage | 0/0 (100% by absence) |
| P3 coverage | 0/0 (100% by absence) |

### Coverage Heuristic Gaps

| Heuristic | Count |
|---|---:|
| Endpoints without tests | 16 |
| Auth/authz negative-path gaps | 7 |
| Error/failure-path gaps | 13 |
| UI journeys without E2E/component coverage | 8 |
| UI states without coverage | 7 |

### Recommendations

| Priority | Recommendation |
|---|---|
| URGENT | Run `/bmad:tea:atdd` for the 44 P0 acceptance criteria before implementation readiness can be considered testable. |
| HIGH | Run `/bmad:tea:automate` after ATDD scaffolding to expand coverage for 3 P1 acceptance criteria. |
| HIGH | Add API tests for 16 route contracts from `backend-implementation.md`. |
| HIGH | Add negative-path auth/authz tests for login/session/MFA/OAuth/RBAC/Developer revocation/worker service identity. |
| MEDIUM | Add error/edge tests for validation, timeout, broker, duplicate/out-of-order, repository, scanner, legal corpus, citation, LLM, and document guard failures. |
| HIGH | Add E2E or component coverage for the eight core UX journeys. |
| MEDIUM | Add UI state coverage for loading, empty, validation error, permission denied, blocked, degraded, and failed-with-recovery states. |
| LOW | Run `/bmad:tea:test-review` after executable tests exist. |

### Phase 1 Coverage Matrix Output

```text
/tmp/tea-trace-coverage-matrix-2026-06-25T00-00-00-000-07-00.json
```

The temp JSON was parsed successfully after generation and contains:

```text
PHASE_1_COMPLETE
TOTAL_REQUIREMENTS_47
FULLY_COVERED_0
UNCOVERED_47
P0_COVERAGE_0_OF_44
P1_COVERAGE_0_OF_3
TEST_INVENTORY_EMPTY
RECOMMENDATIONS_8
```

### Step 4 Result

```text
PHASE_1_COMPLETE
COVERAGE_MATRIX_JSON_WRITTEN
GAP_ANALYSIS_COMPLETED
ALL_ACTIVE_ACCEPTANCE_CRITERIA_UNCOVERED
NO_GATE_DECISION_MADE
READY_FOR_PHASE_2_GATE_DECISION
```

## Step 5 - Gate Decision

### Gate Eligibility

| Field | Value |
|---|---|
| Collection status | `COLLECTED` |
| Allow gate | `true` |
| Gate eligible | `true` |
| Gate basis | `priority_thresholds` |
| Decision mode | `deterministic_priority_threshold` |

### Gate Decision

```text
FAIL
```

Rationale:

```text
P0 coverage is 0% (required: 100%). 44 critical requirements uncovered.
```

### Coverage Analysis

| Criterion | Actual | Required/target | Status |
|---|---:|---:|---|
| P0 coverage | 0% | 100% required | NOT_MET |
| P1 coverage | 0% | 90% target, 80% minimum | NOT_MET |
| Overall coverage | 0% | 80% minimum | NOT_MET |

### Critical Gaps

44 P0 acceptance criteria remain uncovered. The most important blocker is not a single missing test, but the absence of any executable test inventory for active LCSP acceptance criteria.

### Machine-Readable Outputs

| Output | Path |
|---|---|
| Phase 1 coverage matrix | `/tmp/tea-trace-coverage-matrix-2026-06-25T00-00-00-000-07-00.json` |
| E2E trace summary | `docs/test-artifacts/e2e-trace-summary.json` |
| Gate decision | `docs/test-artifacts/gate-decision.json` |

### Recommended Actions

1. Run `/bmad:tea:atdd` for the 44 P0 acceptance criteria.
2. Add API/integration tests for the 16 route contracts and worker command/event handoffs.
3. Add negative-path tests for auth, RBAC, Developer revocation, worker service identity, citation allowlist, and fail-closed states.
4. Add E2E/component tests for the eight core UX journeys and blocked/degraded UI states.
5. Re-run `$bmad-testarch-trace` after executable tests exist.

### Final Result

```text
TRACE_WORKFLOW_COMPLETE
PHASE_1_COVERAGE_MATRIX_READ
GATE_DECISION_FAIL
E2E_TRACE_SUMMARY_WRITTEN
GATE_DECISION_JSON_WRITTEN
IMPLEMENTATION_GATE_BLOCKED_BY_ZERO_TEST_COVERAGE
```
