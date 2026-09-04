from tools.common.capabilities.reporting.report.dossiers.context_builder import ClassificationDossierBuilder


def _context() -> dict:
    return {
        "document_request": {
            "id": "doc-1",
            "assessment_id": "assessment-1",
            "classification_result_id": "classification-1",
            "document_type": "FINAL_REPORT",
        },
        "assessment": {
            "id": "assessment-1",
            "name": "Credit assistant",
            "description": "Assists staff review",
        },
        "classification_result": {
            "id": "classification-1",
            "classification_data": {
                "risk_level": "HIGH",
                "rationale": "Evidence-backed rationale",
            },
            "guardrail_status": "PASSED",
        },
        "verified_profile": {
            "id": "verified-1",
            "version": 2,
            "profile_data": {
                "merged_profile": {
                    "intendedUse": "assist credit review",
                    "affectedSubjects": ["applicants"],
                    "humanOversight": {"required": True},
                    "decisionImpact": "advisory",
                }
            },
        },
        "ai_usage_flow": {
            "id": "flow-1",
            "technical_profile_id": "profile-1",
            "unknown_usages": ["dynamic provider target"],
        },
        "technical_profile": {
            "id": "profile-1",
            "evidence_report_id": "evidence-1",
            "profile_data": {
                "program_graph_ref": {"graphId": "graph-1"},
                "data_categories": ["PII.EMAIL"],
                "external_integrations": [{"provider": "OPENAI"}],
                "human_control_evidence": {"state": "PRESENT"},
                "unresolved_frontiers": ["frontier-1"],
            },
        },
        "technical_evidence_report": {
            "id": "evidence-1",
            "snapshot_id": "snapshot-1",
            "schema_version": "1.0.0",
            "evidence_payload": {
                "evidence_graph": {
                    "graph_id": "graph-1",
                    "source_anchors": [{"anchor_id": "anchor-1"}],
                }
            },
        },
        "repository_snapshot": {"id": "snapshot-1", "commit_sha": "abc123"},
        "confirmed_customer_context": {
            "id": "customer_context-1",
            "version": 1,
            "answers": {"intendedUse": "assist credit review"},
        },
        "legal_rule_match": {
            "id": "match-1",
            "corpus_version_id": "corpus-1",
            "legal_rule_catalog_version_id": "catalog-1",
            "matches": [{"legalRuleId": "rule-1"}],
            "citation_allowlist": ["law:1"],
            "overall_coverage_status": "COMPLETE_CITATION",
        },
        "conflicts": [],
        "matrix_ref": "matrix:classification-1",
    }


def test_builder_pins_all_source_artifacts_and_never_invents_gap_outputs() -> None:
    dossier = ClassificationDossierBuilder().build(_context())
    assert dossier.source_artifacts.repository_snapshot_id == "snapshot-1"
    assert dossier.source_artifacts.program_evidence_graph_id == "graph-1"
    assert dossier.source_artifacts.legal_corpus_version_id == "corpus-1"
    assert dossier.sections["riskClassification"] == "HIGH"
    assert dossier.sections["gaps"] == []
    assert dossier.sections["remediation"] == []
    assert dossier.status == "INCOMPLETE"
    assert "gaps" in dossier.missing_requirements
    assert "remediation" in dossier.missing_requirements


def test_builder_keeps_sensitive_semantics_without_literal_personal_values() -> None:
    dossier = ClassificationDossierBuilder().build(_context())
    assert dossier.sections["dataProcessing"]["dataCategories"] == ["PII.EMAIL"]
    assert "@" not in str(dossier.to_dict())
    assert dossier.evidence_appendix == ({"anchor_id": "anchor-1"},)


def test_builder_is_deterministic_for_same_pinned_sources() -> None:
    builder = ClassificationDossierBuilder()
    left = builder.build(_context())
    right = builder.build(_context())
    assert left.dossier_id == right.dossier_id
    assert left.provenance == right.provenance
