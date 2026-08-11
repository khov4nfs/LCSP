---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-05-run-knip-usage-analysis
status: READY_FOR_PLANNING
---
# Build tool `run_knip_usage_analysis`

## 1–4. Task information and objective

AO-1 P1; `scanner/tools/knip_tool.py`; `SYSTEM_ONLY`, `READ`. Produce bounded TS/JS package-use facts correlated to the pinned SBOM. Caller `ScanConsumer` only when classifier dispatch includes TS/JS and manifest precondition applies. Default/max timeout 120/150 s; retry transient spawn error once; missing manifest/not applicable/version mismatch/timeout never retry.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef","sbomRef","tsJsDispatchRef"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"sbomRef":{"type":"string","pattern":"^evidence:sbom-[A-Za-z0-9._-]{1,128}$"},"tsJsDispatchRef":{"type":"string","pattern":"^evidence:inventory-[A-Za-z0-9._-]{1,128}$"}}}
```

## 6. Output schema and example

`result={usageFacts:array<=budget.maxItems,executionRef}`; fact `{packageName,version,ecosystem:"NPM",usageState:"USED|UNUSED|UNRESOLVED",sourceTool:"KNIP",relativeFileRefs:array<=20,isAiRelevant:boolean,confidenceDelta:number}`.

```json
{"status":"READY","toolName":"run_knip_usage_analysis","toolVersion":"1.0.0","configHash":"sha256:knip-5.44.4","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:knip-3","coverageState":"SUFFICIENT","evidenceRefs":["evidence:usage-knip-3"],"limitations":[],"result":{"usageFacts":[{"packageName":"openai","version":"4.0.0","ecosystem":"NPM","usageState":"USED","sourceTool":"KNIP","relativeFileRefs":["src/ai.ts"],"isAiRelevant":true,"confidenceDelta":0.05}],"executionRef":"exec:knip-3"}}
```

## 7–10. Outcomes and logic

No manifest/TS files=`READY` empty with `NOT_APPLICABLE` limitation; missing SBOM=`NEEDS_INPUT`; timeout/tool error=`OUT_OF_COVERAGE`; foreign refs=`BLOCKED`. Verify pinned Knip; fixed `npx --no-install knip --reporter json`; parse safe JSON, join to SBOM, relativize/dedupe/sort, cap corroboration to +0.15, privacy validate. Reuse `knip_tool.py`, dependency normalizer, consumer.

## 11–15. LLM, registry, audit and security

Not exposed to model; dependency declaration/use cannot prove model invocation. Registry `run_knip_usage_analysis/1.0.0`, `SCAN_EXECUTE`, `SCAN_RUNNING`, action `SCAN_EXECUTE`, immutable SBOM/dispatch refs, timeout above, no mutation. Audit tool/version/config/count/refs/duration; no package config/source/stderr. Require workspace tenant/job binding; no package installation, shell, arbitrary Knip config or external registry access.

## 16–22. Scenario, AC, tests, files

Scenario: used NPM `openai` gives +0.05 supporting evidence only; semantic analyzer still decides call evidence. AC: supported dispatch only, unused/transitive state preserved, missing scope explicit, deterministic output, no install/privacy leak. Tests: used/unused/missing/transitive, no `npm install`, timeout/version, relative paths/cap, cross-job ref. Files `tools/knip_tool.py`, normalizer/consumer/tests. Authority `05-knip-deptry-dependency-tool.md`. OQ: owner confirms shared monorepo manifest traversal (Tech Lead, open).
