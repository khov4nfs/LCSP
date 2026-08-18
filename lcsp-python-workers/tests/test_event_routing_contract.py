import re
from pathlib import Path

from lcsp_workers.investigation.engineering_assessment_consumer import (
    EngineeringAssessmentConsumer,
)
from lcsp_workers.legal.legal_corpus_recovery_consumer import LegalCorpusRecoveryConsumer
from lcsp_workers.reporting.final_report_consumer import FinalReportConsumer
from lcsp_workers.reporting.gap_analysis_consumer import GapAnalysisConsumer
from lcsp_workers.scanner.scan_consumer import ScanConsumer
from lcsp_workers.scanner.targeted_reanalysis_consumer import TargetedReanalysisConsumer


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_worker_routing_keys_match_the_shared_contracts():
    scan_contract = read_contract("packages/contracts/src/scan/callback.ts")
    github_contract = read_contract(
        "packages/contracts/src/github-integration/events.ts"
    )
    document_contract = read_contract("packages/contracts/src/document/events.ts")
    legal_matching_contract = read_contract(
        "packages/contracts/src/legal-rule-catalog/legal-matching.ts"
    )

    expected = {
        ScanConsumer: event_value(github_contract, "scanTriggered"),
        TargetedReanalysisConsumer: event_value(
            github_contract, "targetedReanalysisRequested"
        ),
        EngineeringAssessmentConsumer: event_value(
            scan_contract, "evidenceAccepted"
        ),
        LegalCorpusRecoveryConsumer: event_value(
            legal_matching_contract, "LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND"
        ),
        FinalReportConsumer: event_value(document_contract, "finalReportRequested"),
        GapAnalysisConsumer: event_value(document_contract, "gapAnalysisRequested"),
    }

    assert {consumer: consumer.routing_key for consumer in expected} == expected


def test_production_pm2_starts_only_canonical_assessment_consumers():
    ecosystem = read_contract("ecosystem.config.cjs")
    expected_targets = {
        "lcsp_workers.scanner.scan_consumer:ScanConsumer",
        "lcsp_workers.scanner.targeted_reanalysis_consumer:TargetedReanalysisConsumer",
        "lcsp_workers.investigation.engineering_assessment_consumer:EngineeringAssessmentConsumer",
        "lcsp_workers.legal.legal_corpus_recovery_consumer:LegalCorpusRecoveryConsumer",
        "lcsp_workers.reporting.gap_analysis_consumer:GapAnalysisConsumer",
        "lcsp_workers.reporting.final_report_consumer:FinalReportConsumer",
    }
    removed_targets = {
        "lcsp_workers.intelligence.technical_profile_consumer:TechnicalProfileConsumer",
        "lcsp_workers.intelligence.ai_usage_flow_consumer:AIUsageFlowConsumer",
        "lcsp_workers.intelligence.conflict_detection_consumer:ConflictDetectionConsumer",
        "lcsp_workers.intelligence.verified_profile_consumer:VerifiedProfileConsumer",
        "lcsp_workers.legal.legal_retrieval_consumer:LegalRetrievalConsumer",
        "lcsp_workers.classification.classification_consumer:ClassificationConsumer",
    }

    missing_targets = sorted(
        target for target in expected_targets if f'"{target}"' not in ecosystem
    )
    unexpected_targets = sorted(
        target for target in removed_targets if f'"{target}"' in ecosystem
    )
    assert missing_targets == []
    assert unexpected_targets == []


def test_redeploy_health_gate_covers_only_production_worker_ports():
    redeploy = read_contract("redeploy.sh")

    assert "readonly WORKER_HEALTH_PORTS=(8101 8102 8108 8109 8110 8111)" in redeploy
    assert 'for port in "${WORKER_HEALTH_PORTS[@]}"' in redeploy
    assert "FIRST_WORKER_HEALTH_PORT" not in redeploy
    assert "LAST_WORKER_HEALTH_PORT" not in redeploy


def read_contract(relative_path: str) -> str:
    return (REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8")


def event_value(contract: str, name: str) -> str:
    match = re.search(
        rf"\b{name}\b\s*(?::|=)\s*\"([^\"]+)\"",
        contract,
        re.MULTILINE,
    )
    assert match is not None, f"Missing event contract: {name}"
    return match.group(1)
