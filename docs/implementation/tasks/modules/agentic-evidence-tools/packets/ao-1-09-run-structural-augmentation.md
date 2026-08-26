---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-09-run-structural-augmentation
jira_issue: LCSP-158
status: DONE
---
# Build tool `run_structural_augmentation`

## 1–4. Task information and objective

AO-1 P0; `scanner/parsers/structural_augmentor.py`; `SYSTEM_ONLY`, `READ`. Process every eligible BASIC/Python/TS/JS file to derive sanitized routes/controllers/classes/functions and connect only pre-existing finding IDs. It never makes semantic findings. Caller `ScanConsumer`, after inventory/findings; default/max 180/240 s; per-file parser/grammar error does not retry and becomes a limitation, transient worker I/O retries once.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef","inventoryRef","findingRefs","parserConfigId"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"inventoryRef":{"type":"string","pattern":"^evidence:inventory-[A-Za-z0-9._-]{1,128}$"},"findingRefs":{"type":"array","maxItems":10000,"items":{"type":"string","pattern":"^finding:[A-Za-z0-9._-]{1,128}$"}},"parserConfigId":{"type":"string","pattern":"^structural-parser:[A-Za-z0-9._-]{1,64}$"}}}
```

The worker resolves file list from `inventoryRef`; callers cannot pass source bodies or arbitrary paths.

## 6. Output schema and example

`result={structuralFacts:array<=budget.maxItems,coverageLimitations:array<=budget.maxItems}`. Fact `{relativePath,patternType,name,line,decorators, isAsync,aiFindingIds,graphNodeType,parseSource}`; decorators are names only.

```json
{"status":"READY","toolName":"run_structural_augmentation","toolVersion":"1.0.0","configHash":"sha256:treesitter-1","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:struct-4","coverageState":"PARTIAL","evidenceRefs":["evidence:struct-4"],"limitations":[{"code":"STRUCTURAL_PARSE_LIMITATION","affectedScopeRef":"path:src/broken.ts","reason":"grammar parse failed","retryable":false}],"result":{"structuralFacts":[{"relativePath":"src/api.py","patternType":"ROUTE","name":"ask","line":12,"decorators":["post"],"isAsync":true,"aiFindingIds":["finding:sg-12"],"graphNodeType":"ROUTE","parseSource":"TREE_SITTER"}],"coverageLimitations":["lim:struct-parse-1"]}}
```

## 7–10. Outcomes and logic

Missing inventory=`NEEDS_INPUT`; stale/foreign refs=`BLOCKED`; grammar/regex/timeout per file=`OUT_OF_COVERAGE`; contract violation=`FAILED`. Enumerate every eligible inventory entry—no cap; tree-sitter parse; extract safe pattern names/lines/decorator names; fallback regex only after grammar error; link only IDs supplied and known; add per-file limitation on failure; sort/dedupe and privacy validate. Reuse `StructuralAugmentor`, scanner types, consumer.

## 11–15. LLM, registry, audit and security

Not exposed to model; models get graph/query projections later and may use structural context, never infer arguments/runtime behavior. Registry `run_structural_augmentation/1.0.0`, `SCAN_EXECUTE`, state `SCAN_RUNNING`, refs above, 180/240 s, no mutation. Audit parser/config hash, file/fact/limitation counts, refs and duration; forbid code/decorator argument/full AST/absolute path. Trusted scan RBAC/workspace isolation; parser output must pass privacy gate.

## 16–22. Scenario, AC, tests, files

Scenario: a FastAPI handler has `post` decorator and pre-existing AI finding; graph receives two cited safe facts. AC: 101+ eligible files all analyzed or limited; failure never stops other files; no semantic evidence invented; safe decorators only; stable refs/audit. Tests: FastAPI/Nest/Celery/class/async, fallback, no decorator arguments, 101+ accounting, invalid ID, privacy. Files `parsers/structural_augmentor.py`, scanner types/consumer/tests. Authority `15-tree-sitter-structural-parser.md`, AO-1. OQ: BASIC grammar coverage matrix (Architecture, open).
