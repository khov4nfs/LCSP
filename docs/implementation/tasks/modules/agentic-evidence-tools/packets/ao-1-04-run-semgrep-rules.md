---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-04-run-semgrep-rules
jira_issue: LCSP-158
status: DONE
---
# Build tool `run_semgrep_rules`

## 1–4. Task information and objective

AO-1 P0; `lcsp-python-workers/scanner/tools`; `SYSTEM_ONLY`, `READ`. Execute the allow-listed, pinned Semgrep AI ruleset against a trusted workspace and return redacted normalized findings. Caller: `ScanConsumer`; it must not accept arbitrary rules, flags, source, or CLI. Default/max timeout 120/180 s; retry only container/runtime transient twice (1 s, 4 s); ruleset/version/non-zero validation failures never retry.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef","rulesetId"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"rulesetId":{"type":"string","pattern":"^semgrep-ruleset:[A-Za-z0-9._-]{1,64}$"},"severityFloor":{"type":"string","enum":["INFO","LOW","MEDIUM","HIGH","CRITICAL"]}}}
```

Shared envelope applies. Registry resolves `rulesetId` to immutable version/hash; severity can only narrow, not expand, the configured rules.

## 6. Output schema and example

`result={findings:array<=budget.maxItems,executionRef,redactionApplied:true}`. Finding: `{findingId,ruleId,signalType,relativePath,lineStart,lineEnd,message,severity,confidence}`—no code excerpt, metavariable value, `extra.lines`, secret match or stack trace.

```json
{"status":"READY","toolName":"run_semgrep_rules","toolVersion":"1.0.0","configHash":"sha256:rules-ai-7","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:semgrep-7","coverageState":"SUFFICIENT","evidenceRefs":["finding:sg-12"],"limitations":[],"result":{"findings":[{"findingId":"finding:sg-12","ruleId":"lcsp.openai.chat-call","signalType":"AI_CALL_PATTERN","relativePath":"src/client.py","lineStart":18,"lineEnd":18,"message":"AI SDK call pattern","severity":"HIGH","confidence":0.7}],"executionRef":"exec:semgrep-7","redactionApplied":true}}
```

## 7–10. Outcomes and logic

Unknown workspace/ruleset/state=`BLOCKED`; missing artifact=`NEEDS_INPUT`; timeout/non-zero=`OUT_OF_COVERAGE` by severity policy; output schema/redaction breach=`FAILED`. Verify pinned binary/ruleset hash; invoke fixed argument list; parse JSON; strip unsafe fields before normalizing; relative-path validate; dedupe/sort by location/rule; add provenance/config/coverage; privacy validate. Reuse `scanner/tools/semgrep_tool.py`, approved AI rulesets, `evidence_assembler.py`.

## 11–15. LLM, registry, audit and security

`exposed_to_model:false`; downstream LLM gets only sanitized finding projection and must seek semantic corroboration. Registry: `run_semgrep_rules/1.0.0`, `SCAN_EXECUTE`, `SCAN_RUNNING`, action `SCAN_EXECUTE`, workspace/snapshot refs, 120/180 s, no mutation. Audit ruleset/version/hash, count/severity/status/duration/output hash—not command, code, secrets, stderr or environment. Fixed subprocess, no install/network, restricted workspace; PBAC inherited scan job; deny secret tool result before callback.

## 16–22. Scenario, AC, tests, files

Scenario: `lcsp.openai.chat-call` produces a safe location finding; classifier treats it as evidence, not a final invocation decision. AC: only pinned rules execute; strict extra args rejected; all callbacks lack source/secrets/prompts; timeout has limitation; stable ordering/audit. Tests: known provider fixture, source/secret fixture stripped, full ruleset hash, non-zero/timeout/version mismatch, path privacy, PBAC. Files: `tools/semgrep_tool.py`, rulesets, assembler/consumer, contracts/tests. Authority `03-semgrep-ai-rules-tool.md`, `08-semgrep-full-ai-ruleset.md`. OQ: severity terminal threshold is policy-owned (Security, open).
