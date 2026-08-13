---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-03-run-syft-inventory
jira_issue: LCSP-158
status: DONE
---
# Build tool `run_syft_inventory`

## 1–4. Task information and objective

AO-1 P0; `lcsp-python-workers/scanner/tools`; `SYSTEM_ONLY`, `READ`. Run the pinned Syft binary over one trusted workspace and normalize safe SBOM/package facts. It is supporting dependency evidence, never proof of an invocation. Caller `ScanConsumer`; timeout 120 s; retry only `SYFT_TRANSIENT` twice with 1 s/4 s backoff; non-zero/version/config mismatch does not retry.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef","syftConfigId"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"syftConfigId":{"type":"string","pattern":"^syft-config:[A-Za-z0-9._-]{1,64}$"}}}
```

Shared envelope applies; config ID resolves only allow-listed pinned version/hash—no command, rule, URL, or argument field.

## 6. Output schema and example

`result={sbomEntries:array<=budget.maxItems,executionRef}`; an entry is `{name,version,ecosystem,purl,license,relativeLocation}`. `relativeLocation` is optional and never absolute.

```json
{"status":"READY","toolName":"run_syft_inventory","toolVersion":"1.0.0","configHash":"sha256:syft-config-9","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:syft-9","coverageState":"SUFFICIENT","evidenceRefs":["evidence:sbom-9"],"limitations":[],"result":{"sbomEntries":[{"name":"openai","version":"1.12.0","ecosystem":"PYPI","purl":"pkg:pypi/openai@1.12.0","license":"MIT","relativeLocation":"pyproject.toml"}],"executionRef":"exec:syft-9"}}
```

## 7–10. Outcomes and logic

Unknown workspace/config=`BLOCKED`; missing workspace=`NEEDS_INPUT`; timeout/non-zero=`OUT_OF_COVERAGE` with execution limitation; malformed Syft JSON=`FAILED`. Verify binary/version/config hash; run fixed `syft dir:<workspace> -o json` without shell; validate schema; relativize locations; normalize/dedupe/sort `(ecosystem,name,version)`; deep privacy-check output. Reuse `scanner/tools/syft_tool.py`, tool registry, dependency normalizer.

## 11–15. LLM, registry, audit and security

`exposed_to_model:false`; only sanitized package facts may appear in later evidence context. Registry: `run_syft_inventory/1.0.0`, `SCAN_EXECUTE`, `SCAN_RUNNING`, requires workspace/snapshot ref, 120 s, retry above, no mutation. Audit command template ID—not command string—version/config hash, package count, hashes/refs, status/duration; exclude source, stderr, environment and absolute locations. PBAC/trusted worker verifies workspace ownership; subprocess uses fixed binary/environment/no network or install.

## 16–22. Scenario, AC, tests, files

Scenario: inventory records `pkg:pypi/openai@1.12.0`; semantic tool must corroborate use before any AI-invocation claim. AC: fixed binary/config only; locations relative; empty workspace returns `READY` empty; failures are explicit limitations; no raw Syft payload. Tests: npm/Python/empty fixtures, timeout/non-zero/malformed JSON, version mismatch, sorting/config hash, absolute-path and stderr privacy. Files: `tools/syft_tool.py`, registry/normalizer, consumer and tests. Authority `02-syft-sbom-tool.md`. OQ: confirm image digest storage owner (Platform, open, no block).
