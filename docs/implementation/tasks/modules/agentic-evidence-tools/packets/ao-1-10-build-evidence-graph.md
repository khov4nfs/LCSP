---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-10-build-evidence-graph
status: READY_FOR_PLANNING
---
# Build tool `build_evidence_graph`

## 1–4. Task information and objective

AO-1 P0; `scanner/graph/graph_builder.py`; `SYSTEM_ONLY`, `SYSTEM_MUTATION` (creates immutable scan-local graph artifact only). Assemble normalized scanner outputs from exactly one pinned scan into a versioned, sanitized Evidence Graph carrying provenance, coverage and evidence references for every node/edge. Caller `ScanConsumer`; 60/120 s; deterministic schema/link failure is `FAILED`, transient persistence once retry; caps 10,000 nodes/50,000 edges create explicit coverage gaps.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["technicalEvidenceReportRef","artifactSetRef","graphSchemaVersion"],"properties":{"technicalEvidenceReportRef":{"type":"string","pattern":"^evidence:report-[A-Za-z0-9._-]{1,128}$"},"artifactSetRef":{"type":"string","pattern":"^artifact-set:[A-Za-z0-9._-]{1,128}$"},"graphSchemaVersion":{"type":"string","pattern":"^[0-9]+\\.[0-9]+$"}}}
```

`artifactSetRef` resolves only same-scan normalized findings/dependencies/semantic/structural/provenance/coverage; raw payloads are never input.

## 6. Output schema and example

`result={graphId,schemaVersion,artifactHash,nodeCount,edgeCount,nodes:array<=budget.maxItems,edges:array<=budget.maxItems,aiProviderNodeRefs,aiInvocationNodeRefs,coverageGapNodeRefs,unsupportedFlowNodeRefs}`. Nodes/edges include ID/type/relative locator plus `provenanceRef`, `coverageState`, `evidenceRefs`.

```json
{"status":"READY","toolName":"build_evidence_graph","toolVersion":"1.0.0","configHash":"sha256:graph-1","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"technicalEvidenceReportId":"evidence:report-42"},"provenanceRef":"prov:graph-42","coverageState":"PARTIAL","evidenceRefs":["graph:42","finding:sg-12"],"limitations":[],"result":{"graphId":"graph:42","schemaVersion":"1.0","artifactHash":"sha256:graphhash","nodeCount":3,"edgeCount":2,"nodes":[{"nodeId":"node:call-1","nodeType":"AI_INVOCATION","relativePath":"src/client.py","line":18,"provenanceRef":"prov:py-4","coverageState":"SUFFICIENT","evidenceRefs":["evidence:py-call-4"]}],"edges":[{"edgeId":"edge:1","edgeType":"INVOKES","fromNodeRef":"node:route-1","toNodeRef":"node:call-1","provenanceRef":"prov:struct-4","coverageState":"SUFFICIENT","evidenceRefs":["finding:sg-12"]}],"aiProviderNodeRefs":[],"aiInvocationNodeRefs":["node:call-1"],"coverageGapNodeRefs":[],"unsupportedFlowNodeRefs":[]}}
```

## 7–10. Outcomes and logic

Missing/stale report or same-scan mismatch=`NEEDS_INPUT`/`BLOCKED`; node/edge cap=`OUT_OF_COVERAGE` with `COVERAGE_GAP`; unknown link/schema/privacy breach=`FAILED`. Validate report/artifact versions; dedupe node `(relativePath,nodeType,label)`; create only known import/call/corroboration/flow/review/limitation edges; deterministic IDs/sort/hash; serialize versioned graph into report/callback persistence seam; deep privacy validate. Reuse `EvidenceGraphBuilder`, graph contracts, `EvidenceAssembler`, `ScanConsumer`.

## 11–15. LLM, registry, audit and security

`exposed_to_model:false`; AO-2 provides bounded graph queries only. Registry `build_evidence_graph/1.0.0`, `SCAN_EXECUTE`, `SCAN_ASSEMBLING`, requires report/artifact-set refs, 60/120 s, immutable artifact idempotency keyed by scan/config. Audit graph/report IDs/hash/counts/caps/status/duration, no nodes with raw source/prompt/AST. PBAC validates scan ownership; no old graph mutation or uncited edge allowed.

## 16–22. Scenario, AC, tests, files

Scenario: semantic AI call and route facts assemble an `INVOKES` edge citing both facts; AO-2 can later retrieve a bounded projection. AC: every node/edge has provenance/coverage/evidence refs; cap never silently drops; graph callback is immutable/versioned; privacy rejects prohibited values. Tests: topology/dedupe/hash, SBOM corroboration, dynamic/tool-failure gaps, cap, no absolute/raw data, callback idempotency. Files `graph/graph_builder.py`, graph contracts/serializer, assembler/consumer/tests. Authority `11-evidence-graph-assembler.md`, scanner spec, AO-1. OQ: persistence object-store key format (Platform, open).
