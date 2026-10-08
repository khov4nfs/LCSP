# W6 cutover reconciliation (rehearsal evidence)

- Result: **PASS** — 462 checks across 32 stages
- Run: 20261008075952_82952 · started 2026-10-08T07:59:52.669Z
- V1 baseline: `87ae8c4eb358c17318e71a53c3125d75975b9d98` (95 migrations) → upgraded through `prisma migrate deploy`
- Cutover run: `a805eef1-05f5-46de-85e4-303019fe24d6`

## 1. Population (seeded; every expectation below comes from the seed, not from the tool)
|  | count |
| --- | --- |
| assessments | 60 |
| terminal (READY_FOR_REVIEW / AI_NOT_DETECTED) | 30 |
| non-terminal | 30 |
|   READY_FOR_REVIEW | 18 |
|   AI_NOT_DETECTED | 12 |
|   WIZARD_IN_PROGRESS | 6 |
|   WIZARD_SUBMITTED | 6 |
|   EVIDENCE_REQUIRED | 6 |
|   SCAN_IN_PROGRESS | 6 |
|   CLASSIFICATION_LOCKED | 6 |

## 2. Quiescence and old-traffic closure
Undelivered retired V1 commands/events cancelled (archived first, audited, non-replayable): **72**

| retired event type | cancelled |
| --- | --- |
| `command.scan.requested.v1` | 6 |
| `command.scan.targeted-reanalysis.v1` | 6 |
| `command.assessment-interview.pause-agent.v1` | 6 |
| `command.assessment-interview.resume-agent.v1` | 6 |
| `command.legal-matching.requested.v1` | 6 |
| `event.technical-evidence.accepted.v1` | 6 |
| `event.technical-profile.ready.v1` | 6 |
| `event.ai-usage-flow.ready.v1` | 6 |
| `event.classification-result.ready.v1` | 6 |
| `event.reconciliation.all-conflicts-resolved.v1` | 6 |
| `document.final-report-requested` | 6 |
| `document.gap-analysis-requested` | 6 |

In-flight V1 work closed after its original was archived:

| source | closed |
| --- | --- |
| ASSESSMENT_RUNTIME_TURN | 18 |
| TARGETED_REANALYSIS_REQUEST | 2 |
| TARGETED_REANALYSIS_CHECKPOINT | 2 |
| REPOSITORY_SCAN_JOB | 5 |
| DOCUMENT_REQUEST | 6 |

Published legacy history (12) and retained/V2 traffic (7 undelivered) were left untouched.

## 3. Archive coverage (live V1 rows vs archived rows; sha256 and content sampled by independent code)
| source | live | archived | sampled |
| --- | --- | --- | --- |
| ASSESSMENT | 60 | 60 | 15 |
| ASSESSMENT_INTERVIEW_THREAD | 36 | 36 | 15 |
| ENGINEERING_RULE_ASSESSMENT | 12 | 12 | 12 |
| ASSESSMENT_RUNTIME_TURN | 60 | 60 | 15 |
| ASSESSMENT_RUNTIME_EVENT | 120 | 120 | 15 |
| PIPELINE_RECONCILIATION | 15 | 15 | 15 |
| REPOSITORY_SCAN_JOB | 42 | 42 | 15 |
| TECHNICAL_EVIDENCE_REPORT | 32 | 32 | 15 |
| TECHNICAL_PROFILE | 32 | 32 | 15 |
| AI_USAGE_FLOW | 22 | 22 | 15 |
| CONFLICT_RECORD | 22 | 22 | 15 |
| TARGETED_REANALYSIS_REQUEST | 7 | 7 | 7 |
| TARGETED_REANALYSIS_CHECKPOINT | 7 | 7 | 7 |
| VERIFIED_AGENT_EPISODE | 10 | 10 | 10 |
| VERIFIED_PROFILE | 22 | 22 | 15 |
| CLASSIFICATION_RESULT | 22 | 22 | 15 |
| CLASSIFICATION_REVIEW_REQUEST | 22 | 22 | 15 |
| LEGAL_RULE_MATCH | 22 | 22 | 15 |
| DOCUMENT_REQUEST | 36 | 36 | 15 |
| READINESS_EXPORT | 26 | 26 | 15 |
| DECISION_MODEL_DECISION | 9 | 9 | 9 |
| DECISION_MODEL_EVENT | 9 | 9 | 9 |
| LEGAL_RULE_CATALOG_VERSION | 1 | 1 | 1 |
| LEGAL_RULE | 3 | 3 | 3 |
| RULE_APPROVAL_RECORD | 1 | 1 | 1 |
| CORPUS_APPROVAL_RECORD | 1 | 1 | 1 |
| CORPUS_DISCARD_RECEIPT | 1 | 1 | 1 |
| CORPUS_PREPARATION | 1 | 1 | 1 |

## 4. Assessments
- Terminal V1 assessments archived read-only (no canonical lifecycle invented): **30**
- Non-terminal assessments backfilled (fresh thread/state, nothing promoted from V1): **30**, snapshot pinned for 17
- Backfill reasons: NO_SNAPSHOT=8, PINNED_LATEST_READY_SNAPSHOT=17, NO_USABLE_SNAPSHOT=5
- Assessment Root started by the migration: **0** — the migration has no activation phase (see section 8)

## 5. Legacy report artifacts — five-class reconciliation
Total report-related records accounted for: **62**

| class | count |
| --- | --- |
| ARTIFACT_PRESENT_AND_COPIED | 18 |
| ARTIFACT_PRESENT_BUT_COPY_FAILED | 0 |
| NO_LEGACY_ARTIFACT_PRESENT | 21 |
| METADATA_ONLY_LEGACY_RECORD | 21 |
| INVALID_OR_ORPHANED_LEGACY_REFERENCE | 2 |

| reason | count |
| --- | --- |
| COPIED_AND_VERIFIED | 2 |
| INLINE_CONTENT_ARCHIVED | 16 |
| PLACEHOLDER_UPLOADER_NEVER_PERSISTED | 21 |
| NO_ARTIFACT_REFERENCE | 9 |
| READY_WITHOUT_REFERENCE | 2 |
| NO_INLINE_CONTENT | 10 |
| REFERENCE_TARGET_MISSING | 2 |

Source-inspection evidence for the V1 uploader: `deepagents/tools/common/capabilities/reporting/report/delivery/storage_uploader.py` at `87ae8c4eb358c17318e71a53c3125d75975b9d98` (sha256 `e3789784a7101ab16f1b552a27ff70420a2c38e41a6661e382076f8362eaf842`) — PLACEHOLDER_RETURNS_MOCK_URL_WITHOUT_PERSISTING; callers: deepagents/tools/common/capabilities/reporting/gap/gap_analysis_boundary.py, deepagents/tools/common/capabilities/reporting/report/final_report/final_report_boundary.py.

> **Limitation (carried into W7 release evidence).** The V1 report uploader was a placeholder that returned a mock URL without persisting bytes. Historical V1 reports are therefore archived as metadata and classified; no historical artifact was regenerated, fabricated, or given a synthetic hash or storage reference.

Proof points (all asserted by the harness): copied artifacts = 2 (each byte-identical to its source and re-verified from storage); no blob exists for any record that is not a verified copy; zero V2 `AssessmentArtifact` rows written or replaced; metadata-only, not-retained and orphaned references carry no invented size, hash or location.

## 6. Stages
| stage | status | ms |
| --- | --- | --- |
| environment | PASS | 32 |
| baseline-v1-schema | PASS | 5489 |
| seed-production-shaped-v1-population | PASS | 174 |
| upgrade-through-prisma-migrate-deploy | PASS | 2644 |
| active-legal-portfolio-prerequisite | PASS | 42 |
| restore-point-drill (real pg_dump -> pg_restore) | PASS | 2608 |
| cli-preflight (read-only) | PASS | 3443 |
| cutover run 1: start -> restore point -> execute | PASS | 5962 |
| independent verification of the archive (harness code, harness table list) | PASS | 178 |
| source preservation, ids, tenants, hierarchy | PASS | 2399 |
| closure: zero old execution authority remains | PASS | 12 |
| migration starts no re-evaluation and spends nothing (zero model calls, zero credits) | PASS | 1815 |
| report artifacts: accounted, byte-identical, nothing fabricated | PASS | 5 |
| second run is idempotent | PASS | 3325 |
| restart from the restore point converges to identical archive digests | PASS | 8130 |
| rollback boundary: restore until the first accepted V2 write, forward repair only after | PASS | 8750 |
| archive retrieval and retired surface over HTTP (real API process) | PASS | 7661 |
| re-evaluation 1/7: preflight is read-only; every refusal changes nothing | PASS | 13695 |
| re-evaluation 2/7: booting and restarting the API starts nothing | PASS | 12304 |
| re-evaluation 3/7: a canary starts exactly one Root; rerun and duplicate cutover are no-ops | PASS | 9994 |
| re-evaluation 4/7: the REAL Root executes the canary; usage lands only on it; verification passes | PASS | 10364 |
| re-evaluation 5/7: the bounded batch (global cap, per-tenant cap, back-pressure, concurrent operators) | PASS | 8293 |
| re-evaluation 6/7: failures are isolated (failed start, failure budget, failed execution) | PASS | 8590 |
| re-evaluation 7/7: final reconciliation (V1 untouched, ledger = commands, accounting moved only by real usage) | PASS | 1607 |
| clean install: every migration from an empty database; the cutover tooling is a safe no-op | PASS | 15061 |
| fail-closed: unresolved-report-location-blocks-cutover | PASS | 7410 |
| fail-closed: unreadable-report-location-fails-closed | PASS | 3994 |
| fail-closed: copy-failure-fails-closed-and-resumes | PASS | 6492 |
| fail-closed: re-evaluation-refused-while-the-rollback-boundary-is-open | PASS | 9939 |
| fail-closed: re-evaluation-refused-when-the-cutover-does-not-validate | PASS | 8450 |
| fail-closed: live-acquisition-writes-after-cutover-are-not-v1-residue | PASS | 7493 |
| fail-closed: unclassified-outbox-traffic-and-late-v1-writes | PASS | 12200 |

## 7. Validation
Blocking failures: **0** · pass 93 · warn 1 · fail 0

| check | status | blocking |
| --- | --- | --- |
| REPORT_INVALID_OR_ORPHANED_REFERENCES | WARN | false |

## 8. AI re-evaluation is a separate, explicit, bounded action

The default cutover **performs zero model calls and consumes zero AI/customer credits**: it migrates, archives and prepares 30 in-progress assessments (fresh Root thread, canonical state `PREPARING`, pins and coverage) and enqueues **no** Assessment Root command. Re-evaluation is an operator action (`reevaluation-preflight` → `reevaluation-start --mode CANARY` → `reevaluation-verify-canary` → `reevaluation-start --mode BATCH`), never a side effect of migration, archive, traffic cutover, process start-up or a worker restart.

### Preflight (read-only, before any start)
|  | value |
| --- | --- |
| migrated in-progress assessments | 30 |
| eligible (pinned, prepared, covered, connection active) | 17 |
| not ready | 13 |
| excluded by reason | NO_PINNED_SNAPSHOT=13, COVERAGE_INCOMPLETE=13 |
| tenants with eligible assessments | 3 |
| declared model route | openai/rehearsal-model |
| concurrency (global / tenant / backlog / pacing ms / max failures) | 2 / 1 / 2 / 5000 / 3 |
| upper-bound Root executions for this invocation | 5 |
| model calls per Root execution | not estimated (no false precision) |
| usage policy | Provider token usage is recorded as telemetry (LlmUsageEvent, idempotent per invocation); a model invocation never reserves or debits wallet credits. |

### Canary verification (canonical state only)
| check | status |
| --- | --- |
| THREAD_UNIQUE | PASS |
| CHECKPOINT_RECORDED | PASS |
| EVENTS_RECORDED | PASS |
| MODEL_USAGE_RECORDED | PASS |
| ACCOUNTING_CONSISTENT | PASS |
| DECISIONS_RECORDED | PASS |
| ARTIFACT_FLOW | PASS |
| NO_V1_AUTHORITY | PASS |

### Accounting trail (rows in the accounting tables; usage events appear only with real execution)
| point | Root commands | in flight | usage events | wallet / ledger / reservation / order rows |
| --- | --- | --- | --- | --- |
| after migration, preflight and refusals | 0 | 0 | 0 | 0 / 0 / 0 / 0 |
| after the canary start (nothing executed yet) | 1 | 1 | 0 | 0 / 0 / 0 / 0 |
| after the canary executed (2 usage events, attributed to it alone) | 1 | 0 | 2 | 0 / 0 / 0 / 0 |
| after the bounded batches (starts only; no execution, no new usage) | 6 | 5 | 2 | 0 / 0 / 0 / 0 |

Operator re-evaluation ledger rows: **10** — each matches exactly one Root command; failed execution isolated: `08e98bd8-8f46-47b5-8b9e-c13c61904535` execution FAILED under lifecycle `ACTIVE`, reported as `RETRYABLE_FAILURE`, never restarted by the scheduler.
