---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-08-run-ts-js-semantic-analysis
jira_issue: LCSP-158
status: DONE
---
# Build tool `run_ts_js_semantic_analysis`

## 1–4. Task information and objective

AO-1 P0; `scanner/ts_js_bridge`; `SYSTEM_ONLY`, `READ`. Execute the pinned ts-morph bridge over complete TS/JS dispatch and normalize safe symbols/calls/bounded flows. It accepts references, not Node command/env/source. Caller `ScanConsumer`; default/max 150/180 s, `maxDepth<=3`; transient process failure retries once, timeout/non-zero/malformed output/version mismatch becomes explicit limitation.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef","tsJsDispatchRef","bridgeConfigId","maxDepth"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"tsJsDispatchRef":{"type":"string","pattern":"^evidence:inventory-[A-Za-z0-9._-]{1,128}$"},"bridgeConfigId":{"type":"string","pattern":"^tsjs-bridge:[A-Za-z0-9._-]{1,64}$"},"maxDepth":{"type":"integer","minimum":1,"maximum":3}}}
```

## 6. Output schema and example

`result={schemaVersion,analyzerVersion,filesAnalyzed,filesSkipped,findings:array<=budget.maxItems,unsupportedDynamicFlows:array<=budget.maxItems,coverageLimitations:array<=budget.maxItems}`. Finding `{relativePath,line,findingType,ruleId,importSource,callExpression,kwargNames,analysisLevel,hasDynamicCall}`.

```json
{"status":"READY","toolName":"run_ts_js_semantic_analysis","toolVersion":"1.0.0","configHash":"sha256:ts-bridge-2","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:ts-5","coverageState":"SUFFICIENT","evidenceRefs":["evidence:ts-call-5"],"limitations":[],"result":{"schemaVersion":"1.0","analyzerVersion":"1.0.0","filesAnalyzed":14,"filesSkipped":0,"findings":[{"relativePath":"src/ai.ts","line":9,"findingType":"AI_INVOCATION","ruleId":"openai.chat","importSource":"openai","callExpression":"client.chat.completions.create","kwargNames":["messages","model"],"analysisLevel":1,"hasDynamicCall":false}],"unsupportedDynamicFlows":[],"coverageLimitations":[]}}
```

## 7–10. Outcomes and logic

Missing refs=`NEEDS_INPUT`; foreign/mismatched bridge=`BLOCKED`; timeout/non-zero/malformed JSON/version mismatch=`OUT_OF_COVERAGE`; unsafe bridge output=`FAILED`. Validate artifact/bridge pins; launch allow-listed Node via `create_subprocess_exec`, safe env/outside workspace CWD; schema validate JSON; kill timed-out process; redact/truncate stderr; relativize paths; stop dynamic/L4 flow; sort/dedupe/privacy validate. Reuse `ts_js_bridge` schema/runner and consumer.

## 11–15. LLM, registry, audit and security

`exposed_to_model:false`. Registry `run_ts_js_semantic_analysis/1.0.0`, `SCAN_EXECUTE`, `SCAN_RUNNING`, refs above, 150/180 s, no mutation. Audit binary/config/version, safe count/limitation refs/duration/output hash; never Node args/env/stderr/source/absolute root. Fixed Node binary/no shell/network/install; enforce workspace binding and deep result privacy.

## 16–22. Scenario, AC, tests, files

Scenario: static OpenAI TypeScript call returns symbol/location/kwarg names, then graph links it; dynamic computed call is a boundary not a false negative. AC: strict input/no arbitrary executable; safe JSON only; full dispatch coverage; path/stderr/privacy; stable ordering. Tests: provider/framework aliases, timeout kill, invalid JSON/version, secret env rejection, absolute stripping, dynamic edge, >100 files. Files `ts_js_bridge/*`, runner/schema, consumer/contracts/tests. Authority `07-ts-js-subprocess-bridge.md`. OQ: approved Node runtime image digest (Platform, open).
