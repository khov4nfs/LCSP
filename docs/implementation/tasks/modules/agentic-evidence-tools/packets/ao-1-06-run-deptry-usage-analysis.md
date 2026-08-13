---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-06-run-deptry-usage-analysis
jira_issue: LCSP-158
status: DONE
---
# Build tool `run_deptry_usage_analysis`

## 1–4. Task information and objective

AO-1 P1; `scanner/tools/deptry_tool.py`; `SYSTEM_ONLY`, `READ`. Produce bounded Python dependency-use facts joined to the immutable SBOM. `ScanConsumer` calls it only for Python dispatch plus dependency manifest. Timeout 60/90 s; retry transient process error once; manifest absence/not-applicable/version mismatch/timeout does not retry.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef","sbomRef","pythonDispatchRef"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"sbomRef":{"type":"string","pattern":"^evidence:sbom-[A-Za-z0-9._-]{1,128}$"},"pythonDispatchRef":{"type":"string","pattern":"^evidence:inventory-[A-Za-z0-9._-]{1,128}$"}}}
```

## 6. Output schema and example

`result.usageFacts` has same safe schema as Knip except `ecosystem:"PYPI"`, `sourceTool:"DEPTRY"`.

```json
{"status":"READY","toolName":"run_deptry_usage_analysis","toolVersion":"1.0.0","configHash":"sha256:deptry-0.20","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:deptry-2","coverageState":"SUFFICIENT","evidenceRefs":["evidence:usage-deptry-2"],"limitations":[],"result":{"usageFacts":[{"packageName":"openai","version":"1.12.0","ecosystem":"PYPI","usageState":"USED","sourceTool":"DEPTRY","relativeFileRefs":["pyproject.toml"],"isAiRelevant":true,"confidenceDelta":0.05}],"executionRef":"exec:deptry-2"}}
```

## 7–10. Outcomes and logic

Missing manifest/Python files=`READY` empty with not-applicable limitation; missing SBOM=`NEEDS_INPUT`; timeout/non-zero/malformed JSON=`OUT_OF_COVERAGE`; foreign workspace=`BLOCKED`. Validate refs/version; fixed `deptry . --json-output <temp>`; parse output file; normalize against SBOM; retain declared/unused/unresolved state; relative sort/cap/confidence cap; delete temp; privacy validate. Reuse `deptry_tool.py`, normalizer, consumer.

## 11–15. LLM, registry, audit and security

`exposed_to_model:false`; a declared package is never an AI-use assertion. Registry `run_deptry_usage_analysis/1.0.0`, `SCAN_EXECUTE`, `SCAN_RUNNING`, action `SCAN_EXECUTE`, refs above, 60/90 s, no mutation/DLQ. Audit config/version/ref/count/result hash/status; redact stderr, temp path, source and environment. Fixed binary/no install/network; PBAC inherits trusted job and validates artifacts.

## 16–22. Scenario, AC, tests, files

Scenario: Deptry calls out `openai` as used; later structural/semantic evidence corroborates it. AC: Python scope only; output joins pinned SBOM; no source/temp paths leak; absent manifest distinct from tool failure; stable output/audit. Tests: used/unused/missing/transitive Python fixtures, timeout/non-zero/malformed JSON, temp cleanup, no install, privacy/cross-job. Files `tools/deptry_tool.py`, normalizer/consumer/tests. Authority `05-knip-deptry-dependency-tool.md`. OQ: canonical mapping for extras/optional groups (Tech Lead, open).
