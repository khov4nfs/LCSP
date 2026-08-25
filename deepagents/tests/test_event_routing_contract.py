import re
from pathlib import Path

from tools.common.capabilities.assessment.investigation.engineering_rule.engineering_assessment_boundary import (
    EngineeringAssessmentBoundary,
)
from tools.legal.sources.recovery.legal_corpus_recovery_boundary import LegalCorpusRecoveryBoundary
from tools.common.capabilities.reporting.report.final_report.final_report_boundary import FinalReportBoundary
from tools.common.capabilities.reporting.gap.gap_analysis_boundary import GapAnalysisBoundary
from tools.common.capabilities.evidence.scanner.scanning.scan_boundary import ScanBoundary
from tools.common.capabilities.evidence.scanner.scanning.targeted_reanalysis_boundary import TargetedReanalysisBoundary


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_worker_source_events_match_the_shared_contracts():
    scan_contract = read_contract("packages/contracts/src/scan/callback.ts")
    github_contract = read_contract(
        "packages/contracts/src/github-integration/events.ts"
    )
    document_contract = read_contract("packages/contracts/src/document/events.ts")
    legal_matching_contract = read_contract(
        "packages/contracts/src/legal-rule-catalog/legal-matching.ts"
    )

    expected = {
        ScanBoundary: event_value(github_contract, "scanTriggered"),
        TargetedReanalysisBoundary: event_value(
            github_contract, "targetedReanalysisRequested"
        ),
        EngineeringAssessmentBoundary: event_value(
            scan_contract, "evidenceAccepted"
        ),
        LegalCorpusRecoveryBoundary: event_value(
            legal_matching_contract, "LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND"
        ),
        FinalReportBoundary: event_value(document_contract, "finalReportRequested"),
        GapAnalysisBoundary: event_value(document_contract, "gapAnalysisRequested"),
    }

    assert {boundary: boundary.source_event for boundary in expected} == expected


def test_production_pm2_starts_managed_deep_agent_not_worker_processes():
    ecosystem = read_contract("ecosystem.config.cjs")
    removed_processes = {
        "lcsp-scanner-worker",
        "lcsp-engineering-assessment-worker",
        "lcsp-gap-analysis-worker",
        "lcsp-legal-corpus-recovery-worker",
        "lcsp-targeted-reanalysis-worker",
        "lcsp-final-report-worker",
        "lcsp-technical-profile-worker",
        "lcsp-ai-usage-flow-worker",
        "lcsp-conflict-detection-worker",
        "lcsp-verified-profile-worker",
        "lcsp-legal-retrieval-worker",
        "lcsp-classification-worker",
    }

    assert '"lcsp-managed-deep-agent"' in ecosystem
    assert "entrypoint.py" in ecosystem
    assert ".venv/bin/python" in ecosystem
    assert all(f'"{process}"' not in ecosystem for process in removed_processes)


def test_redeploy_removes_legacy_worker_processes_without_worker_health_ports():
    redeploy = read_contract("redeploy.sh")

    assert "lcsp-managed-deep-agent" in redeploy
    assert "lcsp-scanner-worker" in redeploy
    assert "WORKER_HEALTH_PORTS" not in redeploy
    assert "/health" not in redeploy.split('echo "==> Web"', maxsplit=1)[-1]
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
