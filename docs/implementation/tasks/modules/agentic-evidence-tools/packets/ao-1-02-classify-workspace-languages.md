---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-02-classify-workspace-languages
status: READY_FOR_PLANNING
---
# Build tool `classify_workspace_languages`

## 1–4. Task information and objective

AO-1 P0; runtime `lcsp-python-workers/scanner/inventory`; `SYSTEM_ONLY`, `READ`. Classify every materialized manifest entry into supported, skipped, or limited disposition and dispatch language routes. It is called by `ScanConsumer` after `materialize_snapshot`, never by a model. It reads the restricted workspace manifest; it does not parse source semantically. Default/maximum timeout: 30/60 s; no retry for deterministic classification, one retry for transient I/O.

## 5. Input schema

Shared envelope applies. `input` is:

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"pathPrefixes":{"type":"array","maxItems":20,"items":{"type":"string","pattern":"^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,256}$"}}}}
```

`workspaceRef` must belong to the same scan job; `budget.maxItems` caps returned examples, not coverage accounting.

## 6. Output schema and examples

`result={classifications:array<=budget.maxItems,dispatch:{pythonFiles,tsJsFiles,basicFiles,skippedFiles},counts:{eligible,analyzed,skipped,limited}}`; each classification has `relativePath`, `language` (`PYTHON|TS_JS|BASIC|UNKNOWN`), `supportLevel` (`FULL|BASIC|NONE`), `sizeBytes`, `lineCount`, `disposition` (`ANALYZE|SKIP|LIMIT`), optional `limitationRef`.

```json
{"status":"READY","toolName":"classify_workspace_languages","toolVersion":"1.0.0","configHash":"sha256:language-v1","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:lang-14","coverageState":"PARTIAL","evidenceRefs":["evidence:inventory-14"],"limitations":[{"code":"BINARY_FILE","affectedScopeRef":"path:assets/logo.png","reason":"binary is outside parser coverage","retryable":false}],"result":{"classifications":[{"relativePath":"src/app.py","language":"PYTHON","supportLevel":"FULL","sizeBytes":803,"lineCount":31,"disposition":"ANALYZE"},{"relativePath":"assets/logo.png","language":"UNKNOWN","supportLevel":"NONE","sizeBytes":1200,"lineCount":0,"disposition":"LIMIT","limitationRef":"lim:binary-1"}],"dispatch":{"pythonFiles":["src/app.py"],"tsJsFiles":[],"basicFiles":[],"skippedFiles":[]},"counts":{"eligible":2,"analyzed":1,"skipped":0,"limited":1}}}
```

## 7–10. Outcomes and logic

Invalid workspace=`BLOCKED`; absent manifest=`NEEDS_INPUT`; unreadable file=`OUT_OF_COVERAGE` with per-file limitation; I/O failure=`FAILED`. Algorithm: enumerate full manifest deterministically; apply exclusions; test binary/minified/generated/size rules; derive language from content/extension; emit exactly one disposition for each entry; sort relative path; persist counts and limitation refs. Reuse `scanner/inventory/language_classifier.py` and `analyzer_router.py`.

## 11–15. LLM, registry, audit and security

`exposed_to_model:false`; model may only consume downstream coverage projection. Registry: `classify_workspace_languages/1.0.0`, `SCAN_EXECUTE`, `SCAN_RUNNING`, requires `workspaceRef`, server file ceiling, 30/60 s, no mutation/DLQ. Audit refs/counts/config hash/duration; redact filenames only if they match secret policy, never log file content/absolute root. PBAC is inherited trusted scan dispatch; handler rejects foreign/expired workspace refs.

## 16–22. Scenario, AC, tests, files

Scenario: scanner routes `src/app.py` to Python and marks binary asset limited; orchestrator later must preserve `PARTIAL`, not infer no evidence. AC: complete manifest accounting even above 500 files; strict schema rejects traversal/extra property; unsupported/binary/minified/oversized files have limitation; stable sorted dispatch; no content crosses callback. Tests: extension/content matrix, generated/binary/oversize/read-error, 501 files with limitations, cross-job workspace, privacy and transient retry. Files: `inventory/language_classifier.py`, `analyzer_router.py`, `scan_consumer.py`, contracts/tests. Authority `14-language-classifier.md`, `scanner-spec.md`. OQ: confirm generated-file heuristic version (Tech Lead, open, no readiness block).
