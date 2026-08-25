---
status: in-progress
updated_at: 2026-08-12
---

# Sprint 6 Tool Runtime Status

## Purpose

This artifact records the current runtime implementation status of the Agentic tool catalog against the actual LCSP source tree.

It distinguishes:

- packet/spec exists
- handler/query/command exists
- controller/module/runtime exposure exists
- adjacent legacy behavior exists but does not yet satisfy the named tool contract

It is intended to prevent false completion claims while the mixed Sprint 6 worktree is being split and finished.

## Source evidence used

- [tool-catalog.md](/home/khovan/Workplaces/LCSP/docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md)
- [evidence.module.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/evidence/evidence.module.ts)
- [evidence.controller.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/evidence/presentation/http/evidence.controller.ts)
- [scan.module.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/scan/scan.module.ts)
- [reconciliation.module.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/reconciliation/reconciliation.module.ts)
- [reconciliation.controller.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts)
- [classification.module.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/classification/classification.module.ts)
- [legal-rule-catalog.module.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/legal-rule-catalog/legal-rule-catalog.module.ts)
- [legal-rule-catalog.controller.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/legal-rule-catalog/presentation/http/legal-rule-catalog.controller.ts)
- worker paths under:
  - [tools/scanner](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner)
  - [tools/legal](/home/khovan/Workplaces/LCSP/deepagents/tools/legal/legal)
- focused verification on Wednesday, August 12, 2026:
  - scanner baseline: `tests/test_scanner_workspace.py`, `tests/test_language_classifier.py`, `tests/test_syft_tool.py`, `tests/test_semgrep_tool.py`, `tests/test_dependency_usage_tools.py`, `tests/test_scanner_analyzer.py`, `tests/test_ts_js_bridge.py`, `tests/test_structural_augmentation.py`, `tests/scanner/graph/test_graph_assembler.py`, `tests/scanner/evidence/test_gates.py`, `tests/test_evidence_gates.py`, `tests/test_evidence_assembler.py`
  - scan callback/API gate: `apps/api/src/modules/scan/application/services/scan/evidence-schema-validator.service.spec.ts`, `apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts`
  - AO-6 dedicated worktrees:
    - `LCSP-ao6-fetch-snapshot`
    - `LCSP-ao6-extract-text`
    - `LCSP-ao6-ocr-fallback`
    - `LCSP-ao6-ocr-quality`
    - `LCSP-ao6-reviewed-input`
    - `LCSP-ao6-legal-chunks`
    - `LCSP-ao6-chunk-integrity`
    - `LCSP-ao6-index-build`
    - `LCSP-ao6-retrieval-validation`
    - `LCSP-ao6-activate-corpus`
    - `LCSP-213-resume-waiting-runs`

## Status legend

- `IMPLEMENTED_RUNTIME` — named tool has packet + production handler/worker + module/controller/runtime path.
- `IMPLEMENTED_CORE_ONLY` — core implementation exists, but this audit has not yet verified the full runtime exposure against the catalog contract.
- `PARTIAL_OR_LEGACY` — adjacent behavior exists, but not yet under the named Sprint 6 tool contract.
- `NOT_IMPLEMENTED` — no convincing runtime path found under the tool name or an equivalent bounded contract.

## Current status by tool group

### AO-1 baseline scanner tools

| Tool                           | Status              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `materialize_snapshot`         | IMPLEMENTED_RUNTIME | worker snapshot/workspace path in [workspace.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/workspace.py) and [snapshot_service_client.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/snapshot_service_client.py); verified by `tests/test_scanner_workspace.py` on Wednesday, August 12, 2026                                                                                                                                                                                                                                                            |
| `classify_workspace_languages` | IMPLEMENTED_RUNTIME | worker inventory path in [language_classifier.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/inventory/language_classifier.py); verified by `tests/test_language_classifier.py` and scan-consumer routing coverage in `tests/test_scanner_workspace.py`                                                                                                                                                                                                                                                                                                                                  |
| `run_syft_inventory`           | IMPLEMENTED_RUNTIME | [syft_tool.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/tools/syft_tool.py); verified by `tests/test_syft_tool.py`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `run_semgrep_rules`            | IMPLEMENTED_RUNTIME | [semgrep_tool.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/tools/semgrep_tool.py); verified by `tests/test_semgrep_tool.py`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `run_knip_usage_analysis`      | IMPLEMENTED_RUNTIME | [knip_tool.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/tools/knip_tool.py); verified by `tests/test_dependency_usage_tools.py`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `run_deptry_usage_analysis`    | IMPLEMENTED_RUNTIME | [deptry_tool.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/tools/deptry_tool.py); verified by `tests/test_dependency_usage_tools.py`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `run_python_semantic_analysis` | IMPLEMENTED_RUNTIME | analyzer/parser path under [analyzers](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/analyzers) and [parsers](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/parsers); verified by `tests/test_scanner_analyzer.py`                                                                                                                                                                                                                                                                                                                                              |
| `run_ts_js_semantic_analysis`  | IMPLEMENTED_RUNTIME | [ts_js_bridge](/home/khovan/Workplaces/LCSP/deepagents/tools/common/capabilities/evidence/scanner/ts_js_bridge); verified by `tests/test_ts_js_bridge.py` and routed invocation coverage in `tests/test_scanner_workspace.py`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `run_structural_augmentation`  | IMPLEMENTED_RUNTIME | [structural_augmentor.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/parsers/structural_augmentor.py); verified by `tests/test_structural_augmentation.py`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `build_evidence_graph`         | IMPLEMENTED_RUNTIME | graph path under [graph](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/graph); verified by `tests/scanner/graph/test_graph_assembler.py` and sanitized serialization checks in `tests/test_evidence_assembler.py`                                                                                                                                                                                                                                                                                                                                                                           |
| `validate_evidence_report`     | IMPLEMENTED_RUNTIME | gates under [privacy_gate.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/evidence/privacy_gate.py), [quality_gate.py](/home/khovan/Workplaces/LCSP/deepagents/tools/graph/scanner/evidence/quality_gate.py), and API [evidence-schema-validator.service.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/scan/application/services/scan/evidence-schema-validator.service.ts); verified by `tests/scanner/evidence/test_gates.py`, `tests/test_evidence_gates.py`, `tests/test_evidence_assembler.py`, and API callback validator specs on Wednesday, August 12, 2026 |

### AO-2 technical evidence query tools

All AO-2 tools except `request_targeted_reanalysis` are wired through [evidence.module.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/evidence/evidence.module.ts) and [evidence.controller.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/evidence/presentation/http/evidence.controller.ts).

| Tool                          | Status              | Evidence                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_scan_coverage`           | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `search_evidence`             | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `get_finding_detail`          | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `get_symbol_context`          | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `get_evidence_subgraph`       | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `trace_static_flow`           | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `find_similar_symbols`        | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `find_provider_invocations`   | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `inspect_data_path`           | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `inspect_decision_path`       | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `inspect_human_review_path`   | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `inspect_deployment_context`  | IMPLEMENTED_RUNTIME | handler + query + controller route                                                                                                                                                                                                                      |
| `request_targeted_reanalysis` | IMPLEMENTED_RUNTIME | [scan.module.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/scan/scan.module.ts), [scan.controller.ts](/home/khovan/Workplaces/LCSP/apps/api/src/modules/scan/presentation/http/scan.controller.ts), request-targeted-reanalysis command/handler |

### AO-3 protected workflow transition tools

| Tool                                           | Status              | Evidence                                                      |
| ---------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `reconcile_profile_to_verified_profile`        | IMPLEMENTED_RUNTIME | reconciliation module + controller + command/handler          |
| `submit_classification_for_independent_review` | IMPLEMENTED_RUNTIME | classification review submission controller + command/handler |
| `resolve_independent_classification_review`    | IMPLEMENTED_RUNTIME | classification review resolution controller + command/handler |

### AO-4 artifact, wizard, and conflict tools

| Tool                         | Status              | Evidence                                                           |
| ---------------------------- | ------------------- | ------------------------------------------------------------------ |
| `get_assessment_context`     | IMPLEMENTED_RUNTIME | reconciliation module + controller query path                      |
| `compare_wizard_claim`       | IMPLEMENTED_RUNTIME | dedicated compare-wizard-claim controller + registration + handler |
| `propose_missing_targets`    | IMPLEMENTED_RUNTIME | reconciliation controller + handler                                |
| `get_artifact_chain`         | IMPLEMENTED_RUNTIME | reconciliation controller + handler                                |
| `get_reconciliation_context` | IMPLEMENTED_RUNTIME | reconciliation controller + handler                                |
| `get_verified_profile`       | IMPLEMENTED_RUNTIME | reconciliation controller + handler                                |

### AO-5 legal retrieval, classification, and gap tools

| Tool                               | Status              | Evidence                                                   |
| ---------------------------------- | ------------------- | ---------------------------------------------------------- |
| `get_legal_corpus_readiness`       | IMPLEMENTED_RUNTIME | legal-rule-catalog module + readiness controller + handler |
| `retrieve_legal_basis`             | IMPLEMENTED_RUNTIME | legal basis retrieval controller + handler                 |
| `get_legal_rule_match`             | IMPLEMENTED_RUNTIME | legal rule match controller + handler                      |
| `validate_citation_set`            | IMPLEMENTED_RUNTIME | citation set validation controller + handler               |
| `get_classification_baseline`      | IMPLEMENTED_RUNTIME | classification baseline controller + handler               |
| `validate_classification_proposal` | IMPLEMENTED_RUNTIME | proposal validation controller + handler                   |
| `get_gap_requirements`             | IMPLEMENTED_RUNTIME | gap requirements controller + registration + handler       |
| `evaluate_gap_matrix`              | IMPLEMENTED_RUNTIME | gap matrix controller + handler                            |
| `get_gap_evidence_trace`           | IMPLEMENTED_RUNTIME | gap evidence trace controller + handler                    |
| `propose_gap_remediation`          | IMPLEMENTED_RUNTIME | gap remediation controller + handler                       |

### AO-6 admin-managed corpus recovery tools

This group had been the largest runtime gap in earlier audits. The current source tree and dedicated worktrees now show a materially different state.

| Tool                                | Status              | Evidence / gap                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_admin_source_catalog`          | IMPLEMENTED_RUNTIME | legal-rule-catalog module + admin-source-catalog controller + handler + static fail-closed catalog service                                                                                                                                                                                                                                      |
| `fetch_official_source_snapshot`    | IMPLEMENTED_RUNTIME | dedicated worker/runtime path verified in worktree `LCSP-ao6-fetch-snapshot`; focused API + worker tests passed on Wednesday, August 12, 2026; `AO-6-02` maps to `LCSP-205`; delivered through PR [#194](https://github.com/khovan123/LCSP/pull/194), merged on Wednesday, August 12, 2026; issue branch commit tip before merge was `7f919646` |
| `extract_official_text`             | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-extract-text`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                                    |
| `run_ocr_fallback`                  | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-ocr-fallback`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                                    |
| `evaluate_ocr_quality`              | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-ocr-quality`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                                     |
| `build_reviewed_corpus_input`       | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-reviewed-input`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                                  |
| `build_legal_chunks`                | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-legal-chunks`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                                    |
| `validate_chunk_integrity`          | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-chunk-integrity`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                                 |
| `build_legal_retrieval_index`       | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-index-build`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                                     |
| `validate_retrieval_index`          | IMPLEMENTED_RUNTIME | dedicated worker/runtime path in `LCSP-ao6-retrieval-validation`; focused worker/contract tests passed on Wednesday, August 12, 2026                                                                                                                                                                                                            |
| `activate_validated_corpus_version` | IMPLEMENTED_RUNTIME | validated activation path verified in worktree `LCSP-ao6-activate-corpus`; `AO-6-11` maps to `LCSP-215`; current branch tip `043d66ca` is still broader than AO-6-11 alone because it carries AO-6-03 through AO-6-10 surfaces; it needs scope-splitting before a compliant issue PR can be opened                                              |
| `resume_waiting_runs`               | IMPLEMENTED_RUNTIME | legal-rule-catalog controller + command/handler + contract path exist; `AO-6-12` maps to `LCSP-213`; delivered through PR [#193](https://github.com/khovan123/LCSP/pull/193), merged on Wednesday, August 12, 2026                                                                                                                              |

## Hard conclusion from the current source tree

1. AO-2, AO-3, AO-4, and AO-5 mostly already have real runtime paths.
2. AO-1 baseline tools now have convincing runtime implementation evidence through the scan worker pipeline and callback/validation path.
3. AO-6 runtime implementation evidence is now present for the full named chain from `get_admin_source_catalog` through `resume_waiting_runs`, but several slices still need issue-key-specific branch/PR finalization.

## Next implementation priority

If the goal is to make Sprint 6 auditable rather than merely coded, the highest-value next step is no longer raw AO-6 runtime implementation. The next gap is issue isolation and stale status artifacts:

1. finalize Jira-key-specific branches/PRs for the AO-6 slices that still use `feat/task-...` branch names, using `main` as the baseline whenever the runtime path is already merged
2. refresh the remaining Sprint 6 status artifacts that still describe AO-6 as unimplemented
3. continue isolated-branch proof for AO-1 and the remaining AO-2/AO-4/AO-5 tool slices

## Relationship to the extraction manifests

The current extraction manifests remain valid for the mixed AO-2/AO-3/AO-4/AO-5 worktree:

- [candidate-1-request-targeted-reanalysis-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-1-request-targeted-reanalysis-extraction-manifest.md)
- [candidate-2-independent-classification-review-resolution-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-2-independent-classification-review-resolution-extraction-manifest.md)
- [candidate-3-gap-requirements-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-3-gap-requirements-extraction-manifest.md)
- [candidate-4-compare-wizard-claim-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-4-compare-wizard-claim-extraction-manifest.md)

But they do not prove Sprint 6 completion. They only prove that the mixed branch can be decomposed for the already-implemented AO-2/AO-3/AO-4/AO-5 slices.
