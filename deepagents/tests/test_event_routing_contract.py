import re
from pathlib import Path

from tools.common.capabilities.assessment.investigation.engineering_rule.engineering_assessment_boundary import (
    EngineeringAssessmentBoundary,
)
from tools.legal.sources.recovery.legal_corpus_recovery_boundary import LegalCorpusRecoveryBoundary
from tools.common.capabilities.reporting.report.final_report.final_report_boundary import FinalReportBoundary
from tools.common.capabilities.reporting.gap.gap_analysis_boundary import GapAnalysisBoundary
from tools.common.capabilities.evidence.repository_analysis.boundary import RepositoryAnalysisBoundary
from tools.common.capabilities.evidence.repository_analysis.targeted_boundary import (
    TargetedRepositoryAnalysisBoundary,
)


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
        RepositoryAnalysisBoundary: event_value(github_contract, "scanTriggered"),
        TargetedRepositoryAnalysisBoundary: event_value(
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


def test_fogewise_deploys_agent_runtime_not_legacy_managed_service():
    manifest = read_contract(".fogewise/deploy.yml")
    workflow = read_contract(".github/workflows/fogewise-deploy.yml")
    removed_processes = {
        "managed-deep-agent",
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

    assert "agent-runtime-server:" in manifest
    assert "path: deepagents-langgraph" in manifest
    assert re.search(
        r"agent-runtime-server:\n\s+path: deepagents-langgraph\n\s+requires:\n\s+- postgres",
        manifest,
    )
    assert "agent-runtime:" in manifest
    assert "path: deepagents" in manifest
    assert "dockerSocket: true" in manifest
    assert "LCSP_AGENT_RUNTIME_ROLE: bridge" in manifest
    assert "LCSP_AGENT_SERVER_URL: http://agent-runtime-server:8000" in manifest
    assert "REDIS_URI: redis://fogewise-redis:6379" not in manifest
    assert (
        "LANGGRAPH_CHECKPOINT_DATABASE_URL: ${LANGGRAPH_CHECKPOINT_DATABASE_URL}"
        in manifest
    )
    assert "LCSP_REPOSITORY_SANDBOX_IMAGE: ${FOGEWISE_IMAGE_AGENT_RUNTIME}" in manifest
    assert all(process not in manifest for process in removed_processes)

    assert "'environment'" in workflow
    assert "'dockerSocket'" in workflow
    assert "'extraHosts'" in workflow
    assert "FOGEWISE_IMAGE_" in workflow


def test_fogewise_langgraph_server_image_has_docker_sandbox_control_plane():
    dockerfile = read_contract("deepagents-langgraph/Dockerfile")
    pyproject = read_contract("deepagents/pyproject.toml")
    runtime_dependencies = pyproject.split(
        "[project.optional-dependencies]", maxsplit=1
    )[0]

    assert "FROM python:3.11-slim-trixie" in dockerfile
    assert "langchain/langgraph-api" not in dockerfile
    assert "LANGSERVE_GRAPHS" not in dockerfile
    assert "docker.io" in dockerfile
    assert "docker-cli" in dockerfile
    assert "COPY deepagents /app/deepagents" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "http://127.0.0.1:8000/health" in dockerfile
    assert (
        'ENTRYPOINT ["python", "-m", '
        '"tools.common.capabilities.agent_runtime.local_server"]'
        in dockerfile
    )
    assert '"langgraph-api' not in pyproject
    assert "langgraph-cli[inmem]" not in runtime_dependencies
    assert '"langgraph-cli[inmem]>=0.4.31"' in pyproject


def test_ci_tracks_fogewise_agent_server_image_changes():
    change_detection = read_contract(".github/workflows/check-changed.yml")
    tests = read_contract(".github/workflows/test.yml")

    assert "deepagents-langgraph/**" in change_detection
    assert "deepagents-langgraph/**" in tests
    assert "docker build -f deepagents-langgraph/Dockerfile" in tests
    assert "LCSP_PRODUCTION_AGENT_SERVER_IMAGE_E2E" in tests
    assert "test_production_agent_server_image_e2e.py" in tests


def test_redeploy_removes_legacy_worker_processes_without_worker_health_ports():
    redeploy = read_contract("redeploy.sh")

    assert "lcsp-agent-runtime" in redeploy
    assert "docker build" in redeploy
    assert "lcsp-agent-runtime:production-sandbox" in redeploy
    assert ".venv/bin/langgraph build" not in redeploy
    assert "lcsp-langgraph-agent-server:local" not in redeploy
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
