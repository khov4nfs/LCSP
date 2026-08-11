# Technical Evidence Query Tool Tasks

Status: READY_FOR_PLANNING  
Story: AO-2 — Register Read-Only Evidence Query Tools  
Template: `agentic-tool-implementation-task-template.md`

All cards read immutable sanitized `TechnicalEvidenceReport`/Evidence Graph projections. Mutation is `NONE` except `request_targeted_reanalysis`.

| Task ID / tool | Implementation instruction | Typed result and safety boundary | Required verification |
|---|---|---|---|
| `TASK-AO-2-01-get-scan-coverage` / `get_scan_coverage` | Query file/tool coverage projection by artifact version and bounded path/type filter. | Analyzed/skipped/limited counts and refs; never workspace/source. | Complete vs limited coverage, tenant/artifact isolation. |
| `TASK-AO-2-02-search-evidence` / `search_evidence` | Filter normalized findings by catalog fields; cursor-sort deterministically. | Bounded finding summaries/evidence refs only. | Pagination, filter allow-list, no raw finding payload. |
| `TASK-AO-2-03-get-finding-detail` / `get_finding_detail` | Resolve one finding only from pinned artifact. | Safe metadata, provenance, limitations, evidence refs. | Unknown/stale ID and nested privacy tests. |
| `TASK-AO-2-04-get-symbol-context` / `get_symbol_context` | Resolve normalized symbol/fact adjacency with caller/callee limits. | Relative locations and categories, not function body. | Max neighbours/depth and AST/source rejection. |
| `TASK-AO-2-05-get-evidence-subgraph` / `get_evidence_subgraph` | Traverse graph by explicit seed/direction/depth/node/edge caps. | Truncated graph plus coverage/limit marker. | Cycles, cap hit, cross-artifact denial. |
| `TASK-AO-2-06-trace-static-flow` / `trace_static_flow` | Read bounded L1–L3 normalized flow facts. | Path refs and explicit dynamic-edge stop. | Dynamic boundary and deterministic ordering. |
| `TASK-AO-2-07-find-similar-symbols` / `find_similar_symbols` | Rank normalized fingerprints/graph neighbourhood with fixed algorithm/version. | Candidate list distinct from verification verdict. | Score/order reproducibility and scope cap. |
| `TASK-AO-2-08-find-provider-invocations` / `find_provider_invocations` | Corroborate invocation facts; do not infer from package/config alone. | Invocation evidence or explicit absence/limit. | Dependency-only false positive fixture. |
| `TASK-AO-2-09-inspect-data-path` / `inspect_data_path` | Read sanitized ingress/schema/field category facts through bounded path. | Data categories and refs, never values. | PII/source-value rejection and dynamic boundary. |
| `TASK-AO-2-10-inspect-decision-path` / `inspect_decision_path` | Read normalized score/rank/recommend/approve/reject/status paths. | Structural decision evidence with confidence/limits. | No semantic overclaim and result cap. |
| `TASK-AO-2-11-inspect-human-review-path` / `inspect_human_review_path` | Read queue/approval/assignment/state-gate evidence. | Review-path refs or `UNKNOWN`. | Missing dynamic workflow evidence remains unknown. |
| `TASK-AO-2-12-inspect-deployment-context` / `inspect_deployment_context` | Read approved sanitized manifest/config metadata projection. | Deployment categories/refs; secret values prohibited. | Nested secret and arbitrary config rejection. |
| `TASK-AO-2-13-request-targeted-reanalysis` / `request_targeted_reanalysis` | Validate PBAC, idempotency, analyzer allow-list and bounded scope; enqueue deterministic scan analyzer. | New immutable artifact ref/audit only; never execute source. | Duplicate request, denied scope, retry/DLQ, no source mutation. |

## Definition of Done

- Every query validates the shared invocation contract before artifact access and returns the shared response metadata.
- Every capped traversal/search declares a limitation instead of silently truncating.

## Executable Tool Packets

All packets inherit [shared-tool-contract.md](shared-tool-contract.md). First build versioned `CoverageProjection`, `FindingProjection`, `SymbolProjection`, `GraphNodeProjection`, `GraphEdgeProjection`, `FlowSegmentProjection`, and `DeploymentProjection` from an accepted immutable report. No adapter may parse flexible `evidencePayload` itself.

### Read-only evidence tools

| Tool | Tool-specific input → safe output | Deterministic execution and LLM policy | Failure, seams, and verification |
|---|---|---|---|
| `get_scan_coverage` | `{pathPrefixes?,language?,supportLevels?,toolNames?,cursor?,maxResults}` → files `{relativePath,disposition,supportLevel,limitationRefs}`, tool outcomes, dynamic boundaries, counts/cursor | Filter/sort pinned `CoverageProjection` by path/id. LLM uses it only to establish sufficient vs limited scope. | Missing projection=`NEEDS_INPUT`; excluded/unanalysed scope=`OUT_OF_COVERAGE`. Test complete/limited/skip, tool failure, cursor and cross-artifact denial. |
| `search_evidence` | Allow-listed typed filters for finding/provider/framework/category/confidence/location + cursor → summaries, searched scope, `exhaustive`, cursor | Filter `FindingProjection`, sort `(relativePath,line,findingId)`. No free-text query. LLM discovers refs only; package/config hit is not invocation. | Empty exhaustive result differs from limited result. Test filter deny-list, tie/cursor stability, scope cap and raw-field rejection. |
| `get_finding_detail` | `{findingId,allowedFields?}` → metadata, relative location, categories, confidence, provenance, refs, limits | Exact pinned projection lookup; safe field projection only. LLM chooses next permitted tool, not source lookup. | Unknown/stale/out-of-scope ID returns non-leaking `NOT_FOUND`. Test nested redaction, stale ID, tenant/scope denial. |
| `get_symbol_context` | `{symbolRef,include,maxNeighbors}` where include is allow-listed imports/decorators/categories/callers/callees/refs → bounded symbol/adjacency | One-hop `SymbolProjection`/graph facts; deterministic ordering; no body/decorator argument. LLM may select a flow anchor only. | Unknown scope blocks; cap adds limitation. Test aliases/unresolved symbol, max neighbour, source/AST rejection. |
| `get_evidence_subgraph` | `{seedRef,direction,maxDepth,maxNodes,maxEdges,nodeTypes?,edgeTypes?}` → nodes, edges, traversal, `truncated`, dynamic refs | BFS with visited set and stable order; stop before cap. LLM sees categories/refs only. | Invalid seed/cross-artifact/over-limit denied. Test cycles, each cap, deterministic output, nested graph privacy. |
| `trace_static_flow` | `{startRef,direction?,desiredStages?,maxHops}` → L1–L3 segments, terminal `{RESOLVED,DYNAMIC_BOUNDARY,UNRESOLVED}`, stop reason | Traverse `FlowSegmentProjection`; first L4 ends trace. LLM must surface terminal uncertainty. | Dynamic/cap returns explicit limitation. Test input→invocation→output→action, queue stop, ties and max hops. |
| `find_similar_symbols` | `{seedSymbolRef|fingerprint,dimensions,maxResults}` → algorithm version, scored candidates, matched dimensions, excluded reasons | Fixed normalized fingerprint weights; sort score desc/ref; remove seed. Candidates are never verification verdicts. | No similarity is not absence/support. Test reproducible rank, scope/limit, self exclusion. |
| `find_provider_invocations` | `{provider?,framework?,pathPrefixes?,maxResults}` → actual invocations, declared/config signals separately, searched scope/exhaustive | Query invocation-call facts only; do not promote package/config data. LLM can claim confirmed use only from invocation ref. | Limited scope is `OUT_OF_COVERAGE`. Test dependency-only false positive, alias call, sufficient empty vs limited empty. |
| `inspect_data_path` | `{startRef,direction?,maxHops,maxResults,dataCategories?}` → ingress/schema/field categories, roles, refs, terminal | Traverse safe data projections; values/defaults/raw schemas/prompts excluded. LLM maps only declared category. | Dynamic stop/cap declared. Test PII value leak, category filter, terminal. |
| `inspect_decision_path` | `{startRef,maxHops,actionCategories?,maxResults}` → decision segments/categories/confidence/terminal | Traverse normalized score/rank/recommend/approve/reject/status facts; never infer legal/business conclusion. | Dynamic/cap limitation. Test structural-only evidence, action fixture and no semantic overclaim. |
| `inspect_human_review_path` | `{startRef,maxHops,reviewKinds?}` → review evidence, `PRESENT|ABSENT|UNKNOWN`, terminal | Query queue/assignment/approval/state-gate facts. `ABSENT` only for complete defined scope. | Unknown dynamic evidence stays `UNKNOWN`. Test generic `review()` false-positive prevention and queue fixture. |
| `inspect_deployment_context` | `{pathPrefixes?,manifestKinds?,environments?,maxResults}` → sanitized deployment categories/refs/cursor | Read `DeploymentProjection`; never key/value config or secret key/value. LLM treats as supporting signal. | Forbidden lookup denied. Test nested secret, arbitrary config lookup, paging/scope. |

### `request_targeted_reanalysis` — sole AO-2 mutation

- **Input:** `inputArtifactVersion`, allow-listed `analyzerId`, bounded `scope:{pathPrefixes|subjectRefs}`, `reasonRequirementId`, `idempotencyKey` and shared envelope.
- **Output:** `{reanalysisRequestId,state:QUEUED|ALREADY_QUEUED,inputArtifactVersion,requestedAnalyzer,configVersion,auditRef}`; later completion links a new immutable report version.
- **Execution/LLM:** PBAC, checkpoint, analyzer/scope allow-list, idempotency reservation, outbox command, deterministic worker analyzer against commit-pinned snapshot, policy retry/DLQ. LLM cannot choose shell/URL/analyzer or expect synchronous result.
- **Failure/tests:** invalid analyzer/scope/PBAC blocks before command; duplicate returns replay state. Reuse trusted scan trigger/outbox/worker seams; test duplicate keys, retry/DLQ, source preservation, and no mutation of prior artifact.
