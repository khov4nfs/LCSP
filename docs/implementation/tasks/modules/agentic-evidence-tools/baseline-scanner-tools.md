# Mandatory Baseline Scanner Tool Tasks

Status: DELIVERED  
Story: AO-1 — Complete Structural Evidence Baseline  
Template: `agentic-tool-implementation-task-template.md`

All cards are worker-owned. The shared contract and privacy/failure rules are defined by the template; the existing scanner task is the implementation authority where linked.

| Task ID / tool | Existing implementation task | Build instruction | Required verification |
|---|---|---|---|
| `TASK-AO-1-01-materialize-snapshot` / `materialize_snapshot` | `python-workers/scanner/01-scanner-workspace-setup.md` | Create restricted commit-pinned ephemeral workspace; return snapshot/workspace refs only. | Pin, isolation, cleanup, no source in callback. |
| `TASK-AO-1-02-classify-workspace-languages` / `classify_workspace_languages` | `python-workers/scanner/14-language-classifier.md` | Inventory every file; classify supported/skipped/limited with relative path and reason. | No silent cap; every eligible file analyzed or limited. |
| `TASK-AO-1-03-run-syft-inventory` / `run_syft_inventory` | `python-workers/scanner/02-syft-sbom-tool.md` | Run pinned Syft; normalize safe package/dependency facts. | Version/config provenance and tool-failure limitation. |
| `TASK-AO-1-04-run-semgrep-rules` / `run_semgrep_rules` | `python-workers/scanner/03-semgrep-ai-rules-tool.md`, `08-semgrep-full-ai-ruleset.md` | Run pinned ruleset and emit redacted normalized findings. | Ruleset hash, source redaction, severity behavior. |
| `TASK-AO-1-05-run-knip-usage-analysis` / `run_knip_usage_analysis` | `python-workers/scanner/05-knip-deptry-dependency-tool.md` | Produce bounded TS/JS dependency-use facts. | Unsupported/tool failure coverage and safe paths. |
| `TASK-AO-1-06-run-deptry-usage-analysis` / `run_deptry_usage_analysis` | `python-workers/scanner/05-knip-deptry-dependency-tool.md` | Produce bounded Python dependency-use facts. | Same as Knip plus Python fixture coverage. |
| `TASK-AO-1-07-run-python-semantic-analysis` / `run_python_semantic_analysis` | `python-workers/scanner/06-python-ast-cst-analyzer.md` | Extract sanitized import/call/parameter/prompt-variable facts and L1–L3 paths. | No full AST/source/prompt, parser limitation. |
| `TASK-AO-1-08-run-ts-js-semantic-analysis` / `run_ts_js_semantic_analysis` | `python-workers/scanner/07-ts-js-subprocess-bridge.md` | Extract sanitized symbol/call/prompt-variable/bounded flow facts. | No raw code, bridge failure limitation. |
| `TASK-AO-1-09-run-structural-augmentation` / `run_structural_augmentation` | `python-workers/scanner/15-tree-sitter-structural-parser.md`, AO-1 | Process each eligible file and produce safe route/controller/class/function facts. | >100 files, parser limit, relative paths. |
| `TASK-AO-1-10-build-evidence-graph` / `build_evidence_graph` | `python-workers/scanner/11-evidence-graph-assembler.md`, AO-1 | Assemble scan-local versioned graph in evidence payload with provenance/coverage/evidence refs. | Graph callback integration, node/edge limits, privacy. |
| `TASK-AO-1-11-validate-evidence-report` / `validate_evidence_report` | `python-workers/scanner/12-schema-privacy-quality-gates.md` | Enforce schema, provenance, privacy, quality, and cleanup gates before persistence. | Reject raw source/secret/prompt/full AST and missing provenance. |

## Definition of Done

- Each listed existing task is reconciled with the catalog's shared request/response contract.
- AO-1 closes the graph/callback/privacy integration gaps rather than duplicating scanner analyzers.

## Executable Tool Packets

All packets inherit [shared-tool-contract.md](shared-tool-contract.md). `data` below is the typed `result` extension. Scanner tools are never directly callable by an LLM; the orchestrator may disclose only their sanitized output envelope.

### `materialize_snapshot`

- **Input:** `snapshotId`, `scanJobId`, pinned `commitSha`; `scope` is empty; server ceilings are 500 MB workspace and 10 MB/file.
- **Output data:** `{workspaceRef,snapshotId,commitSha,materializedFileCount,limitedFiles:[{relativePath,reasonCode}]}`. `workspaceRef` is opaque; no archive, absolute path, or file bytes.
- **Execution:** validate job/org/snapshot/commit equality; stream the internal snapshot archive; reject path traversal, links/devices and decompression bombs; extract under the restricted workspace; record every oversized file as a limitation; verify cleanup in `finally`.
- **Failure/LLM:** unsafe archive is `BLOCKED`/`FAILED` with no retry; retrieval may retry within policy. LLM sees counts/limitations only and cannot request GitHub, a path, or archive content.
- **Seams/tests:** `workspace.py`, snapshot client, `scan_consumer.py`; test malicious archive, size limits, job/commit mismatch, cleanup success/failure, and absent GitHub token/source callback.

### `classify_workspace_languages`

- **Input:** opaque `workspaceRef`, file manifest, optional relative `pathPrefixes`; budget `maxItems` is a report cap, never a reason to omit coverage.
- **Output data:** `{classifications:[{relativePath,language,supportLevel,sizeBytes,lineCount,disposition,limitationRef?}],dispatch:{pythonFiles,tsJsFiles,basicFiles,skippedFiles},counts}`.
- **Execution:** apply exclusions first, then content/extension/minified/size classification; route each file; record a per-file limitation for unsupported, binary, unreadable, generated, oversized, or quota-excluded files.
- **Failure/LLM:** a classifier error limits that file and continues. A missing file is never silently truncated; LLM may establish searched scope but must treat `LIMITED` as `OUT_OF_COVERAGE`.
- **Seams/tests:** `inventory/language_classifier.py`, `analyzer_router.py`; test extension matrix, binary/minified/oversize/excluded files and >500 eligible files with one limitation per omitted file.

### `run_syft_inventory`

- **Input:** `workspaceRef`, pinned Syft config/version; no arbitrary arguments; budget caps execution at 120 seconds.
- **Output data:** `{sbomEntries:[{name,version,ecosystem,purl,license,relativeLocation}],executionRef}`.
- **Execution:** execute pinned `syft dir:<workspace> -o json`; validate output schema, relativize locations, attach tool/config hash, and normalize package metadata.
- **Failure/LLM:** timeout/non-zero is a coverage limitation and the scan continues. LLM may use package presence as supporting evidence only, never proof of an invocation.
- **Seams/tests:** `tools/syft_tool.py`, `tool_registry.py`; test npm/empty workspace, timeout/non-zero, config hash and no absolute path/source output.

### `run_semgrep_rules`

- **Input:** `workspaceRef`, exact ruleset ID/hash and pinned Semgrep version; no caller-supplied rule file or CLI flag.
- **Output data:** `{findings:[{ruleId,signalType,relativePath,lineStart,lineEnd,message,severity}],redactionApplied:true,executionRef}`.
- **Execution:** run pinned Semgrep with bounded timeout; remove code excerpts (`extra.lines`); run secret detection only to prove/redact unsafe content and never persist its findings as evidence.
- **Failure/LLM:** non-zero/timeout becomes limitation by severity policy. Import/config/package evidence is not an invocation verdict and must be corroborated by semantic evidence.
- **Seams/tests:** `tools/semgrep_tool.py`, AI/secret rulesets; test known providers, stripped lines, full-ruleset hashes, timeout, and a secret fixture absent from callback/LLM payload.

### `run_knip_usage_analysis` and `run_deptry_usage_analysis`

- **Input:** `workspaceRef`, classifier dispatch, SBOM ref; Knip only for JS/TS and deptry only for Python with manifest precondition.
- **Output data:** `{usageFacts:[{packageName,version,ecosystem,usageState,sourceTool,relativeFileRefs,isAiRelevant,confidenceDelta}],executionRef}`.
- **Execution:** invoke preinstalled `npx --no-install knip --reporter json` (120s) or `deptry . --json-output` (60s); normalize against SBOM; each independent corroboration contributes exactly `+0.05`, capped at `+0.15`.
- **Failure/LLM:** not-applicable, missing manifest, timeout, and tool failure are explicit limitations; no dependency install. Declared package or unused dependency cannot become model-use claim.
- **Seams/tests:** Knip/deptry wrappers and dependency normalizer; test used/unused/missing/transitive package states, no install, relative locations, timeout, corroboration cap.

### `run_python_semantic_analysis`

- **Input:** full routed Python relative-path list and `maxDepth <= 3`; per-file parse threshold is 50 KB; no source text input from caller.
- **Output data:** `{filesAnalyzed,filesSkipped,aiCallSites:[{relativePath,line,functionName,moduleAlias,matchedRuleId,findingType,analysisLevel,callArgsSchema,kwargNames,hasDynamicCall}],importMap,unsupportedDynamicFlows,coverageLimitations}`.
- **Execution:** AST parse each eligible file, construct alias/import map and match pinned AI rule table; use CST only after a hit for identifier names; resolve same-module L2 and one direct import L3; stop at `getattr`, `**kwargs`, dispatch or L4 dynamic flow.
- **Failure/LLM:** syntax/oversize becomes per-file limitation; CST failure retains safe AST fact. LLM receives names/categories/locations, never argument values, prompt text, source, or AST body; dynamic edge means stop.
- **Seams/tests:** Python analyzer, AI rules, level guard; test OpenAI/LangChain/RAG/sklearn, aliases, dynamic flow, oversized file, excluded dirs, L3 stop and argument-name-only output.

### `run_ts_js_semantic_analysis`

- **Input:** routed TS/JS relative paths and `maxDepth <= 3`; bridge config/version; no arbitrary Node executable/env.
- **Output data:** `{schemaVersion,analyzerVersion,filesAnalyzed,filesSkipped,findings:[{relativePath,line,findingType,ruleId,importSource,callExpression,kwargNames,analysisLevel,hasDynamicCall}],unsupportedDynamicFlows,coverageLimitations}`.
- **Execution:** use allow-listed Node binary through `create_subprocess_exec`, safe environment and outside-workspace CWD; validate JSON schema; kill after 150 seconds; redact/truncate stderr and relativize all paths.
- **Failure/LLM:** timeout, non-zero, malformed JSON or version mismatch become non-blocking coverage limitation. LLM sees metadata only and treats dynamic flow as stop.
- **Seams/tests:** TS/JS bridge/schema validator and pinned ts-morph analyzer; test provider/framework aliases, timeout kill, invalid JSON, secret-env rejection, absolute-path stripping, stderr redaction, dynamic edge.

### `run_structural_augmentation`

- **Input:** normalized findings, classifier inventory, eligible BASIC/Python/TS/JS relative paths and parser config. The input does not include source bodies.
- **Output data:** `{structuralFacts:[{relativePath,patternType,name,line,decorators,isAsync,aiFindingIds,graphNodeType,parseSource}],coverageLimitations}`.
- **Execution:** tree-sitter parse every eligible file required by AO-1 (including widened BASIC scope); extract route/controller/class/function facts, decorator names only, and link only existing finding IDs; regex fallback after grammar error; never create semantic findings.
- **Failure/LLM:** parser/regex/timeout adds safe per-file limitation and continues. LLM may use structural facts for retrieval context, never proof of call arguments or runtime behavior.
- **Seams/tests:** tree-sitter parser/augmentor/types; test FastAPI/Nest/Celery/AI class/async, grammar fallback, decorator arguments excluded, 101+ files no silent cap, and every parser failure recorded.

### `build_evidence_graph`

- **Input:** normalized finding, dependency, semantic, structural, tool-provenance and coverage outputs from the same scan/version.
- **Output data:** `ScanGraph {graphId,schemaVersion,artifactHash,nodeCount,edgeCount,nodes,edges,aiProviderNodeRefs,aiInvocationNodeRefs,coverageGapNodeRefs,unsupportedFlowNodeRefs}`; each node/edge carries provenance, coverage and evidence refs.
- **Execution:** deduplicate nodes by `(relativePath,nodeType,label)`; add only known import/call/corroboration/flow/review/limitation edges; cap at 10,000 nodes/50,000 edges and emit `COVERAGE_GAP` rather than silently dropping; serialize scan-local graph in the evidence report payload.
- **Failure/LLM:** invalid node/link/schema produces typed limitation or terminal schema failure. LLM traverses a bounded sanitized projection only; graph absence is not negative proof.
- **Seams/tests:** graph contracts/builder/serializer, `EvidenceAssembler`, `ScanConsumer`; topology, SBOM corroboration, decision/review paths, dynamic/tool failure gaps, relative paths, raw-data rejection, caps and deterministic IDs/hash.

### `validate_evidence_report`

- **Input:** draft report plus callback/idempotency context and workspace cleanup ref; report contains only safe scanner artifacts.
- **Output data:** `{qualityState,validation:{schema,provenance,privacy,policy,cleanup},retryable,reportRef?}`. Callback/persistence occur only for accepted valid output.
- **Execution:** validate required schema/provenance per tool, deep privacy gate before each callback, quality/severity policy, report hash and callback idempotency; retry callback three times with bounded backoff; verify cleanup before terminal success.
- **Failure/LLM:** raw source/secret/prompt/full AST causes terminal privacy failure and no callback; source execution/install is terminal policy failure; missing config/ruleset provenance blocks downstream; noncritical tool gaps remain explicit limitations.
- **Seams/tests:** schema/privacy/quality validators, severity mapper, terminal handler; test source heuristic, missing hashes, malformed output, zero findings, timeout severity, callback retries, install attempt, cleanup residual, safe audit/logs.
