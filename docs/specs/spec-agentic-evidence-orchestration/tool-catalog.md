# Tool Catalog

> **Superseded by the Repository Analyst runtime (2026-09-30), see deepagents/FLOW.md.**

All tools are worker-owned, schema-validated capabilities. They return references and sanitized metadata; raw repository source, secrets, full prompts, and full AST bodies are forbidden.

## Shared invocation contract

Every tool request carries `assessmentId`, `workflowRunId`, `artifactVersions`, `correlationId`, `budget`, and a bounded `scope`. Every response carries `status`, `toolVersion`, `configHash`, `provenanceRef`, `coverageState`, `evidenceRefs`, and `limitations`.

## Repository-analysis capabilities

Repository analysis is not exposed as a bag of language-specific model-callable
scanner tools. The Repository Deep Agent uses its native repository harness and may
invoke Codebase Memory MCP as an optional structural-memory layer.

| Capability | Purpose |
| --- | --- |
| Deep Agents filesystem/search | Direct repository discovery and source verification. |
| Deep Agents execute | Bounded repository-local shell inspection in the LCSP Docker sandbox. |
| Deep Agents task/subagents | Parallel bounded exploration of packages, languages, and architecture paths. |
| Codebase Memory index_repository | Build structural memory for the current assessment repository. |
| Codebase Memory architecture/search tools | Accelerate architecture and symbol discovery. |
| Codebase Memory trace/query/change tools | Relationship and impact analysis. |
| Codebase Memory check_index_coverage | Best-effort coverage diagnostics used together with direct source inspection. |
| RepositoryAnalysisResult | Emit source anchors, compatibility evidence graph, coverage state, unresolved frontiers, and AI gate. |

## Repository evidence investigation and targeted reanalysis

The active repository-analysis surface is the Deep Agents native harness, not the retired custom scanner/query-tool catalog. The agent uses direct filesystem/search/shell/subagent capabilities, optional Codebase Memory MCP graph/search/trace/coverage support, and repository source verification before closing claims.

| Capability | Purpose |
| --- | --- |
| Native filesystem/search | Locate and verify repository source directly. |
| Native execute | Run bounded repository-inspection commands inside the LCSP Docker sandbox. |
| Native task/subagents | Split bounded codebase exploration across packages or technical frontiers. |
| Codebase Memory MCP | Optional architecture, symbol, relationship, change, and index-coverage memory. |
| RepositoryAnalysisResult | Persist source anchors, compatibility graph, coverage state, unresolved frontiers, and AI discovery gate. |
| `request_targeted_reanalysis` | Re-enter the same Repository Deep Agent analysis boundary with a validated target scope; it does not invoke a retired language-specific analyzer. |


## Artifact, Wizard, and conflict tools

Implementation tasks: [artifact, Wizard, and conflict tools](../../implementation/tasks/modules/agentic-evidence-tools/artifact-wizard-conflict-tools.md).

| Tool | Purpose |
| --- | --- |
| `get_assessment_context` | Return submitted Wizard answers, target IDs, and pinned versions. |
| `compare_wizard_claim` | Return `SUPPORTED`, `CONTRADICTED`, `NOT_FOUND`, `UNKNOWN`, or `OUT_OF_COVERAGE` for one Wizard target. |
| `propose_missing_targets` | Produce evidence-backed candidate targets absent from Wizard declarations. |
| `get_artifact_chain` | Return immutable TechnicalEvidenceReport, TechnicalProfile, AIUsageFlow, conflict and direct classification references. |
| `get_reconciliation_context` | Return conflicts, evidence traces, and allowed resolution paths. |

## Reconciliation and independent-review transition tools

These are protected workflow transitions, not LLM reasoning tools. They close the two material-state gaps between AO-4 verification and AO-5 legal/gap work.

| Tool | Purpose |
| --- | --- |
| `engineering_assessment_requested` | Managed invocation boundary that starts EngineeringRule assessment from accepted evidence and conflict-free context. |

## Legal retrieval, classification, and gap tools

Implementation tasks: [legal classification and gap tools](../../implementation/tasks/modules/agentic-evidence-tools/legal-classification-gap-tools.md).

| Tool | Purpose |
| --- | --- |
| `get_legal_corpus_readiness` | Return active corpus/index availability and the specific missing corpus requirement. |
| `retrieve_legal_basis` | Retrieve allowed primary, parent, and referenced legal chunks from the pinned structure-first corpus. |
| `validate_citation_set` | Deterministically reject absent, repealed, out-of-allowlist, or version-mismatched citations. |
| `get_gap_requirements` | Return the versioned requirement matrix applicable to the classification. |
| `evaluate_gap_matrix` | Return `SATISFIED`, `MISSING`, `CONTRADICTED`, `UNKNOWN`, or `OUT_OF_COVERAGE` per requirement. |
| `get_gap_evidence_trace` | Identify whether a gap originates in Wizard, repository analysis, profile, legal basis, citation, or conflict resolution. |
| `propose_gap_remediation` | Produce structured remediation candidates; it cannot close a gap. |

## Admin-managed corpus recovery tools

Implementation tasks: [legal corpus recovery tools](../../implementation/tasks/modules/agentic-evidence-tools/legal-corpus-recovery-tools.md).

| Tool | Purpose |
| --- | --- |
| `get_admin_source_catalog` | Resolve a source only by Admin-managed source/document identity. |
| `fetch_official_source_snapshot` | Fetch an allow-listed official source and create an immutable, hashed snapshot. |
| `extract_official_text` | Prefer official HTML/DOCX extraction. |
| `run_ocr_fallback` | Produce immutable page-hashed OCR output only when canonical text extraction is unavailable. |
| `evaluate_ocr_quality` | Detect missing pages, low-quality text, numbering, identity, and hierarchy anomalies. |
| `build_reviewed_corpus_input` | Build a deterministic correction/review artifact from extraction/OCR output and validation findings. |
| `build_legal_chunks` | Create stable article/clause/point chunks and context/cross-reference metadata. |
| `validate_chunk_integrity` | Validate hashes, hierarchy, locators, relationships, repeal mapping, and duplicate/missing chunks. |
| `build_legal_retrieval_index` | Build the versioned ChromaDB structure-first index. |
| `validate_retrieval_index` | Verify every stable chunk ID and expected context role is retrievable. |
| `activate_validated_corpus_version` | Automatically activate a fully validated immutable corpus version and write audit/outbox records. |
| `resume_waiting_runs` | Resume only workflow runs blocked on the activated corpus version. |

## Resolver map

| Missing requirement | Resolver sequence | Terminal outcome when unresolved |
| --- | --- | --- |
| Technical signal | native repository search/source inspection → optional Codebase Memory trace/search → `request_targeted_reanalysis` when scope must be refreshed | `UNKNOWN` or `OUT_OF_COVERAGE` |
| Wizard contradiction | `compare_wizard_claim` → `get_reconciliation_context` | `CONFLICT` |
| Legal basis/citation | `retrieve_legal_basis` → `get_legal_rule_match` → `validate_citation_set` | `BLOCKED` |
| Corpus unavailable | corpus recovery tools in order | `BLOCKED` |
| Gap evidence | `get_gap_evidence_trace` → resolver for its source layer | `MISSING` or `UNKNOWN` |
