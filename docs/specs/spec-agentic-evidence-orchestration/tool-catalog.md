# Tool Catalog

All tools are worker-owned, schema-validated capabilities. They return references and sanitized metadata; raw repository source, secrets, full prompts, and full AST bodies are forbidden.

## Shared invocation contract

Every tool request carries `assessmentId`, `workflowRunId`, `artifactVersions`, `correlationId`, `budget`, and a bounded `scope`. Every response carries `status`, `toolVersion`, `configHash`, `provenanceRef`, `coverageState`, `evidenceRefs`, and `limitations`.

## Mandatory baseline tools

Implementation tasks: [baseline scanner tools](../../implementation/tasks/modules/agentic-evidence-tools/baseline-scanner-tools.md).

| Tool | Purpose |
| --- | --- |
| `materialize_snapshot` | Create the restricted commit-pinned scanner workspace. |
| `classify_workspace_languages` | Inventory every file and assign support level or explicit skip limitation. |
| `run_syft_inventory` | Produce SBOM and dependency inventory. |
| `run_semgrep_rules` | Run versioned AI/security pattern rules. |
| `run_knip_usage_analysis` | Analyze JS/TS dependency usage. |
| `run_deptry_usage_analysis` | Analyze Python dependency usage. |
| `run_python_semantic_analysis` | Produce Python AST/CST imports, calls, parameters, prompts, and bounded L1-L3 paths. |
| `run_ts_js_semantic_analysis` | Produce TS/JS symbol, call, prompt-variable, and bounded flow facts. |
| `run_structural_augmentation` | Process every eligible file and emit route/controller/class/function structural facts. |
| `build_evidence_graph` | Normalize findings, facts, nodes, edges, coverage, and tool provenance. |
| `validate_evidence_report` | Enforce schema, privacy, quality, and cleanup gates. |

## Technical evidence query and verification tools

Implementation tasks: [technical evidence query tools](../../implementation/tasks/modules/agentic-evidence-tools/technical-evidence-query-tools.md).

| Tool | Purpose |
| --- | --- |
| `get_scan_coverage` | Return analyzed/skipped/limited files, tool outcomes, and unresolved dynamic boundaries. |
| `search_evidence` | Search normalized findings by type, provider, framework, data/action category, confidence, or location metadata. |
| `get_finding_detail` | Return finding metadata, evidence refs, provenance, and limitations. |
| `get_symbol_context` | Return sanitized symbol metadata: imports, decorators, parameter/output categories, callers/callees, and finding refs. |
| `get_evidence_subgraph` | Return a bounded upstream/downstream graph slice for a finding or symbol. |
| `trace_static_flow` | Trace bounded input → invocation → output → action/review paths and stop explicitly at dynamic edges. |
| `find_similar_symbols` | Find analogous symbols by normalized call shape, provider/framework, data/action category, and graph neighborhood. |
| `find_provider_invocations` | Distinguish package/config presence from evidence of an actual model invocation. |
| `inspect_data_path` | Map evidence-backed ingress/schema/field metadata to data categories. |
| `inspect_decision_path` | Detect bounded score/rank/recommend/approve/reject/status-update paths. |
| `inspect_human_review_path` | Detect evidence of review queues, approvals, assignments, and state gates. |
| `inspect_deployment_context` | Read sanitized deployment/manifest/config metadata without secret values. |
| `request_targeted_reanalysis` | Run an allow-listed deterministic analyzer on a validated scope; never execute source. |

## Artifact, Wizard, and conflict tools

Implementation tasks: [artifact, Wizard, and conflict tools](../../implementation/tasks/modules/agentic-evidence-tools/artifact-wizard-conflict-tools.md).

| Tool | Purpose |
| --- | --- |
| `get_assessment_context` | Return submitted Wizard answers, target IDs, and pinned versions. |
| `compare_wizard_claim` | Return `SUPPORTED`, `CONTRADICTED`, `NOT_FOUND`, `UNKNOWN`, or `OUT_OF_COVERAGE` for one Wizard target. |
| `propose_missing_targets` | Produce evidence-backed candidate targets absent from Wizard declarations. |
| `get_artifact_chain` | Return immutable TechnicalEvidenceReport → TechnicalProfile → AIUsageFlow → conflict → VerifiedProfile references. |
| `get_reconciliation_context` | Return conflicts, evidence traces, and allowed resolution paths. |
| `get_verified_profile` | Return the reconciled, versioned legal-matching input. |

## Reconciliation and independent-review transition tools

These are protected workflow transitions, not LLM reasoning tools. They close the two material-state gaps between AO-4 verification and AO-5 legal/gap work.

| Tool | Purpose |
| --- | --- |
| `reconcile_profile_to_verified_profile` | Persist one immutable `VerifiedProfile` only from pinned submitted Wizard, accepted technical evidence, and conflict-free reconciliation inputs. |
| `submit_classification_for_independent_review` | Create an immutable pending independent-review request from a passing classification-proposal gate; it cannot approve a classification. |
| `resolve_independent_classification_review` | Let an authorized independent reviewer approve or reject the pending request and, on approval, persist the immutable reviewed `Classification`. |

## Legal retrieval, classification, and gap tools

Implementation tasks: [legal classification and gap tools](../../implementation/tasks/modules/agentic-evidence-tools/legal-classification-gap-tools.md).

| Tool | Purpose |
| --- | --- |
| `get_legal_corpus_readiness` | Return active corpus/index availability and the specific missing corpus requirement. |
| `retrieve_legal_basis` | Retrieve allowed primary, parent, and referenced legal chunks from the pinned structure-first corpus. |
| `get_legal_rule_match` | Return rule applicability, required facts, citation allowlist, and coverage. |
| `validate_citation_set` | Deterministically reject absent, repealed, out-of-allowlist, or version-mismatched citations. |
| `get_classification_baseline` | Return deterministic classification baseline and prerequisites. |
| `validate_classification_proposal` | Apply citation, overclaim, conflict, coverage, and state gates to a proposal. |
| `get_gap_requirements` | Return the versioned requirement matrix applicable to the classification. |
| `evaluate_gap_matrix` | Return `SATISFIED`, `MISSING`, `CONTRADICTED`, `UNKNOWN`, or `OUT_OF_COVERAGE` per requirement. |
| `get_gap_evidence_trace` | Identify whether a gap originates in Wizard, scanner, profile, legal basis, citation, or conflict resolution. |
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
| Technical signal | `search_evidence` → `trace_static_flow` → `request_targeted_reanalysis` | `UNKNOWN` or `OUT_OF_COVERAGE` |
| Wizard contradiction | `compare_wizard_claim` → `get_reconciliation_context` | `CONFLICT` |
| Legal basis/citation | `retrieve_legal_basis` → `get_legal_rule_match` → `validate_citation_set` | `BLOCKED` |
| Corpus unavailable | corpus recovery tools in order | `BLOCKED` |
| Gap evidence | `get_gap_evidence_trace` → resolver for its source layer | `MISSING` or `UNKNOWN` |
