import re
from pathlib import Path

from lcsp_workers.classification.classification_consumer import ClassificationConsumer
from lcsp_workers.intelligence.ai_usage_flow_consumer import AIUsageFlowConsumer
from lcsp_workers.intelligence.conflict_detection_consumer import ConflictDetectionConsumer
from lcsp_workers.intelligence.technical_profile_consumer import TechnicalProfileConsumer
from lcsp_workers.intelligence.verified_profile_consumer import VerifiedProfileConsumer
from lcsp_workers.legal.legal_corpus_recovery_consumer import LegalCorpusRecoveryConsumer
from lcsp_workers.legal.legal_retrieval_consumer import LegalRetrievalConsumer
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
        TechnicalProfileConsumer: event_value(scan_contract, "evidenceAccepted"),
        AIUsageFlowConsumer: event_value(scan_contract, "technicalProfileReady"),
        ConflictDetectionConsumer: event_value(scan_contract, "aiUsageFlowReady"),
        VerifiedProfileConsumer: event_value(
            scan_contract, "reconciliationAllConflictsResolved"
        ),
        LegalRetrievalConsumer: event_value(
            legal_matching_contract, "LEGAL_MATCHING_REQUEST_COMMAND"
        ),
        LegalCorpusRecoveryConsumer: event_value(
            legal_matching_contract, "LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND"
        ),
        ClassificationConsumer: event_value(scan_contract, "legalRuleMatchReady"),
        FinalReportConsumer: event_value(document_contract, "finalReportRequested"),
        GapAnalysisConsumer: event_value(document_contract, "gapAnalysisRequested"),
    }

    assert {
        consumer: consumer.routing_key for consumer in expected
    } == expected


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
