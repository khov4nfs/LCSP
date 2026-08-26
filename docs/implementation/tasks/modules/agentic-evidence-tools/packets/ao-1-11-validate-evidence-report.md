---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-11-validate-evidence-report
jira_issue: LCSP-173
status: DONE
---
# Build tool `validate_evidence_report`

## 1–4. Task information and objective

AO-1 P0; `scanner/evidence_assembler.py` and quality/privacy gates; `SYSTEM_ONLY`, `SYSTEM_MUTATION` (accept/reject immutable callback artifact). Validate draft TechnicalEvidenceReport schema, per-tool provenance/coverage, privacy, policy, cleanup and callback idempotency before persistence. Caller `ScanConsumer` only; default/max 30/60 s, callback max 3 attempts bounded backoff; privacy/policy/schema failures never retry.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["draftReportRef","callbackRef","cleanupRef"],"properties":{"draftReportRef":{"type":"string","pattern":"^evidence:draft-report-[A-Za-z0-9._-]{1,128}$"},"callbackRef":{"type":"string","pattern":"^callback:[A-Za-z0-9._-]{1,128}$"},"cleanupRef":{"type":"string","pattern":"^cleanup:[A-Za-z0-9._-]{1,128}$"}}}
```

Draft report is a sanitized internal object, never free JSON/raw scanner output.

## 6. Output schema and examples

`result={qualityState:"ACCEPTED|REJECTED|LIMITED",validation:{schema,provenance,privacy,policy,cleanup},retryable:boolean,reportRef?:string}`. Validation values are `PASS|FAIL|LIMITED`.

```json
{"status":"READY","toolName":"validate_evidence_report","toolVersion":"1.0.0","configHash":"sha256:quality-2","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"technicalEvidenceReportId":"evidence:draft-report-42"},"provenanceRef":"prov:validate-42","coverageState":"PARTIAL","evidenceRefs":["evidence:report-42"],"limitations":[{"code":"SEMGREP_TIMEOUT","affectedScopeRef":"tool:semgrep","reason":"noncritical scan tool limited","retryable":false}],"result":{"qualityState":"ACCEPTED","validation":{"schema":"PASS","provenance":"PASS","privacy":"PASS","policy":"PASS","cleanup":"PASS"},"retryable":false,"reportRef":"evidence:report-42"}}
```

## 7–10. Outcomes and logic

Missing draft/cleanup=`NEEDS_INPUT`; foreign callback or invalid transition=`BLOCKED`; noncritical tool gaps=`READY` with partial coverage; raw source/secret/prompt/full AST, source execution/install, missing mandatory provenance or malformed schema=`FAILED`; callback transport is `FAILED` then 3 retry/DLQ. Validate schema; require tool provenance/config refs; deep traverse forbidden-data gate; apply severity/quality policy; validate graph; verify cleanup; hash/report version; reserve callback idempotency; persist/callback only accepted report; safe audit. Reuse `EvidenceAssembler`, `PrivacyAssertionError`, validators, severity mapper, terminal handler.

## 11–15. LLM, registry, audit and security

Not model-callable. Registry `validate_evidence_report/1.0.0`, action `SCAN_FINALIZE`, state `SCAN_ASSEMBLING`, requires draft/callback/cleanup refs, 30/60 s, callback retries, idempotency keyed by scan/report hash. Audit gate decisions/config/policy version/report hash/limitation refs/duration; never log rejected field value, source, secret/prompt/AST, stack trace or callback body. RBAC is service-to-service callback authorization; fail closed before persistence; immutable previous reports cannot change.

## 16–22. Scenario, AC, tests, files

Scenario: report has an explicit Semgrep timeout limitation but all mandatory provenance/cleanup gates pass: immutable report persists `PARTIAL`. If nested prompt text exists, privacy fails and no callback occurs. AC: accepted output always versioned/provenanced; forbidden payload never persists/LLM leaks; callback retries are idempotent; cleanup required; critical policy maps terminally. Tests: schema/hash/provenance, source/secret/prompt/AST fuzz fixtures, missing config, zero finding, severity timeout, retries/DLQ, cleanup residual, safe audit. Files `evidence_assembler.py`, privacy/schema/quality validators, callback/terminal paths, tests. Authority `12-schema-privacy-quality-gates.md`, AO-1. OQ: DLQ operator runbook reference (Operations, open).
