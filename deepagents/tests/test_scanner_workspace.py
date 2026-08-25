"""AC-030 - LCSP-113 scanner workspace setup tests."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.config import WorkerConfig
from tools.common.capabilities.evidence.scanner.scanning import scan_boundary as scan_boundary_module
from tools.common.capabilities.evidence.scanner.assembly.evidence_assembler import PrivacyAssertionError
from tools.common.capabilities.evidence.scanner.scanning.scan_boundary import ScanBoundary
from tools.common.capabilities.evidence.scanner.snapshot.snapshot_service_client import (
    SnapshotArchiveRequest,
    SnapshotServiceClient,
)
from tools.common.capabilities.evidence.scanner.tools.deptry.deptry_tool import DeptryRunResult
from tools.common.capabilities.evidence.scanner.tools.knip.knip_tool import KnipRunResult
from tools.common.capabilities.evidence.scanner.tools.semgrep.semgrep_tool import SemgrepRunResult
from tools.common.capabilities.evidence.scanner.tools.syft.syft_tool import SyftRunResult
from tools.common.capabilities.evidence.scanner.tools.common.tool_base import OUTCOME_SUCCESS, ToolExecutionResult
from tools.common.capabilities.evidence.scanner.ts_js_bridge.bridge_types import (
    TsJsBridgeResult,
    TsJsFinding,
)
from tools.common.capabilities.evidence.scanner.snapshot import workspace as workspace_module
from tools.common.capabilities.evidence.scanner.snapshot.workspace import (
    ArchiveMaterializationError,
    ScannerWorkspace,
)


def _mock_syft_result() -> SyftRunResult:
    return SyftRunResult(
        entries=[],
        execution=ToolExecutionResult(
            tool_name="syft",
            tool_version="syft v1.0.0",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:test",
            messages=[],
        ),
    )


def _mock_semgrep_result() -> SemgrepRunResult:
    return SemgrepRunResult(
        findings=[],
        executions=[
            ToolExecutionResult(
                tool_name="semgrep_ai_usage",
                tool_version="semgrep 1.99.0",
                outcome=OUTCOME_SUCCESS,
                config_hash="sha256:ai-test",
                messages=[],
            ),
            ToolExecutionResult(
                tool_name="semgrep_secret_detect",
                tool_version="semgrep 1.99.0",
                outcome=OUTCOME_SUCCESS,
                config_hash="sha256:secret-test",
                messages=[],
            ),
        ],
        redaction_applied=False,
    )


def test_scanner_tool_result_summary_uses_tool_specific_counters() -> None:
    syft_result = SyftRunResult(
        entries=[MagicMock(), MagicMock()],
        execution=ToolExecutionResult(
            tool_name="syft",
            tool_version="syft v1.0.0",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:test",
            messages=[],
        ),
    )
    ts_js_result = TsJsBridgeResult(
        files_analyzed=3,
        files_skipped=1,
        findings=[MagicMock()],
        unsupported_dynamic_flows=[MagicMock(), MagicMock()],
        coverage_limitations=[],
        analyzer_version="test",
        execution=ToolExecutionResult(
            tool_name="ts_morph",
            tool_version="test",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:test",
            messages=[],
        ),
    )

    assert ScanBoundary._scanner_tool_result_summary(syft_result) == {
        "dependency_count": 2,
        "outcome": OUTCOME_SUCCESS,
    }
    assert ScanBoundary._scanner_tool_result_summary(ts_js_result) == {
        "finding_count": 1,
        "coverage_limitation_count": 0,
        "dynamic_flow_limitation_count": 2,
        "file_count": 3,
        "skipped_file_count": 1,
        "outcome": OUTCOME_SUCCESS,
    }
    assert ScanBoundary._scanner_tool_result_summary([MagicMock(), MagicMock()]) == {
        "item_count": 2,
    }


def test_scan_terminal_client_errors_are_non_retryable() -> None:
    wrong_state = WorkerCallbackError(
        "SCAN_JOB_WRONG_STATE: Callback failed with client error 409."
    )
    mismatch_response = httpx.Response(
        409,
        json={
            "ok": False,
            "problem": {
                "code": "SNAPSHOT_SCAN_MISMATCH",
                "status": 409,
            },
        },
        request=httpx.Request(
            "GET",
            "http://test/internal/repository-snapshots/snapshot/archive",
        ),
    )
    mismatch = httpx.HTTPStatusError(
        "snapshot mismatch",
        request=mismatch_response.request,
        response=mismatch_response,
    )
    server_response = httpx.Response(
        500,
        request=httpx.Request("GET", "http://test/internal/error"),
    )
    server_error = httpx.HTTPStatusError(
        "server error",
        request=server_response.request,
        response=server_response,
    )

    assert ScanBoundary._is_terminal_scan_client_error(wrong_state)
    assert ScanBoundary._is_terminal_scan_client_error(mismatch)
    assert not ScanBoundary._is_terminal_scan_client_error(server_error)
    assert not ScanBoundary._is_terminal_scan_client_error(
        WorkerCallbackError("Callback failed with client error 422.")
    )


def _mock_knip_result() -> KnipRunResult:
    return KnipRunResult(
        facts=[],
        execution=ToolExecutionResult(
            tool_name="knip",
            tool_version="not-run",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:knip-test",
            messages=[],
        ),
    )


def _mock_deptry_result() -> DeptryRunResult:
    return DeptryRunResult(
        facts=[],
        execution=ToolExecutionResult(
            tool_name="deptry",
            tool_version="not-run",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:deptry-test",
            messages=[],
        ),
    )


def _mock_ts_js_result() -> TsJsBridgeResult:
    return TsJsBridgeResult(
        files_analyzed=1,
        files_skipped=0,
        findings=[
            TsJsFinding(
                file_path="src/app.ts",
                line_number=2,
                finding_type="AI_PROVIDER_USAGE",
                rule_id="ts-openai-chat-completions",
                import_source="openai",
                call_expression="client.chat.completions.create",
                kwarg_names=["model", "messages"],
                analysis_level="L1",
                has_dynamic_call=False,
                confidence=0.9,
            )
        ],
        unsupported_dynamic_flows=[],
        coverage_limitations=[],
        analyzer_version="1.0.0",
        execution=ToolExecutionResult(
            tool_name="ts_js_analyzer",
            tool_version="1.0.0",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:ts-js",
            messages=[],
        ),
    )


def _build_tar_gz(members: dict[str, bytes]) -> bytes:
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        for member_name, content in members.items():
            info = tarfile.TarInfo(name=member_name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return archive.getvalue()


@pytest.mark.p0
@pytest.mark.integration
def test_workspace_materializes_archive_and_records_stats(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz(
        {
            "repo/README.md": b"hello world\n",
            "repo/src/app.py": b"print('ok')\n",
        }
    )

    result = workspace.materialize("job-1", archive, snapshot_id="snap-1")

    assert result.job_id == "job-1"
    assert result.snapshot_id == "snap-1"
    assert result.total_size_bytes == len(b"hello world\n") + len(b"print('ok')\n")
    assert result.extracted_files == 2
    assert result.skipped_files == 0
    assert result.coverage_limited is False
    assert (result.workspace_path / "repo" / "README.md").read_text() == "hello world\n"
    assert (result.workspace_path / "repo" / "src" / "app.py").read_text() == "print('ok')\n"

    workspace.cleanup("job-1")
    assert not result.workspace_path.exists()


@pytest.mark.p0
@pytest.mark.integration
def test_workspace_skips_files_over_limit_and_marks_coverage_limited(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(
        root_path=workspace_dir / "scanner",
        max_file_size_bytes=100,
    )
    archive = _build_tar_gz(
        {
            "repo/small.txt": b"small",
            "repo/large.bin": b"x" * 101,
        }
    )

    result = workspace.materialize("job-2", archive)

    assert result.extracted_files == 1
    assert result.skipped_files == 1
    assert result.coverage_limited is True
    assert (result.workspace_path / "repo" / "small.txt").exists()
    assert not (result.workspace_path / "repo" / "large.bin").exists()

    workspace.cleanup("job-2")


@pytest.mark.p0
@pytest.mark.integration
def test_workspace_rejects_path_traversal_and_cleans_up(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz({"../escape.txt": b"nope"})

    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("job-3", archive)

    assert not workspace.workspace_path("job-3").exists()


@pytest.mark.p0
@pytest.mark.integration
def test_workspace_rejects_excessive_depth(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner", max_path_depth=3)
    archive = _build_tar_gz({"repo/a/b/c/d.txt": b"deep"})

    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("job-4", archive)

    assert not workspace.workspace_path("job-4").exists()


@pytest.mark.p0
@pytest.mark.integration
def test_workspace_rejects_excessive_member_count(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner", max_member_count=1)
    archive = _build_tar_gz({
        "repo/first.txt": b"one",
        "repo/second.txt": b"two",
    })

    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("job-5", archive)

    assert not workspace.workspace_path("job-5").exists()


@pytest.mark.p0
@pytest.mark.integration
def test_workspace_cleanup_failure_blocks_completion(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz({"repo/README.md": b"hello\n"})

    workspace.materialize("job-6", archive)

    def failing_rmtree(path: Path) -> None:
        raise OSError("cleanup failed")

    monkeypatch.setattr(workspace_module.shutil, "rmtree", failing_rmtree)

    with pytest.raises(ArchiveMaterializationError):
        workspace.cleanup("job-6")


@pytest.mark.p0
@pytest.mark.integration
def test_workspace_rejects_decompression_bomb(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner", max_expansion_ratio=5)
    archive = _build_tar_gz({"repo/bomb.txt": b"A" * 1024})

    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("job-7", archive)

    assert not workspace.workspace_path("job-7").exists()


@pytest.mark.p0
@pytest.mark.integration
def test_scan_boundary_uses_internal_snapshot_service_and_cleans_up(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz({"repo/src/app.py": b"print('hello')\n"})

    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive

    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()
    bridge = MagicMock()
    bridge.analyze = AsyncMock(return_value=_mock_ts_js_result())
    bridge_factory = MagicMock(return_value=bridge)
    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
        ts_js_bridge_factory=bridge_factory,
    )

    boundary.handle(
        {
            "scanJobId": "job-4",
            "snapshotId": "snap-4",
            "correlationId": "corr-4",
        },
        correlationId="fallback-corr",
    )

    snapshot_client.download_snapshot_archive.assert_called_once_with(
        SnapshotArchiveRequest(
            snapshot_id="snap-4",
            scan_job_id="job-4",
            correlationId="corr-4",
        )
    )
    syft_tool.run.assert_called_once()
    semgrep_tool.run.assert_called_once()
    knip_tool.run.assert_not_called()
    deptry_tool.run.assert_called_once()
    bridge_factory.assert_not_called()
    runtime_events = [
        call.args[1]
        for call in api_client.post_scan_runtime_event.call_args_list
    ]
    assert runtime_events[0]["event_type"] == "RUN_STARTED"
    assert runtime_events[0]["tool_name"] == "repository_scan"
    assert [event["tool_name"] for event in runtime_events if "tool_name" in event][:4] == [
        "repository_scan",
        "download_snapshot_archive",
        "download_snapshot_archive",
        "materialize_snapshot",
    ]
    assert runtime_events[-1]["event_type"] == "RUN_COMPLETED"
    semgrep_events = [
        event for event in runtime_events if event.get("tool_name") == "semgrep"
    ]
    assert [event["event_type"] for event in semgrep_events] == [
        "TOOL_STARTED",
        "TOOL_COMPLETED",
    ]
    assert semgrep_events[-1]["output_summary"] == {
        "executions": 2,
        "findings": 0,
        "nonBlockingFailures": 0,
        "redactionApplied": False,
    }
    python_events = [
        event
        for event in runtime_events
        if event.get("tool_name") == "python_semantic_analysis"
    ]
    assert [event["event_type"] for event in python_events] == [
        "TOOL_STARTED",
        "TOOL_COMPLETED",
    ]
    assert python_events[-1]["output_summary"]["filesAnalyzed"] == 1
    api_client.post_scan_callback.assert_called_once()
    posted_payload = api_client.post_scan_callback.call_args.args[1]
    assert posted_payload.privacy_flags["containsSourceCode"] is False
    tool_provenance = posted_payload.evidence_payload["tool_provenance"]
    assert tool_provenance
    assert all(record["tool_version"] for record in tool_provenance)
    assert all(record["config_hash"].startswith("sha256:") for record in tool_provenance)
    assert all(record["ruleset_hash"].startswith("sha256:") for record in tool_provenance)
    assert all(record["started_at"].endswith("Z") for record in tool_provenance)
    assert all(record["ended_at"].endswith("Z") for record in tool_provenance)
    assert all(
        record["language_profile"]["languages"] == ("python",)
        for record in tool_provenance
    )
    assert all("coverage_limitations" in record for record in tool_provenance)
    skipped = {
        record["tool_name"]: record
        for record in tool_provenance
        if record["outcome"] == "skipped_unsupported"
    }
    assert skipped["knip"]["evidence_eligible"] is False
    assert skipped["ts_morph"]["evidence_eligible"] is False
    assert any(
        "unsupported_for_language_profile" in limitation
        for record in skipped.values()
        for limitation in record["coverage_limitations"]
    )
    assert not workspace.workspace_path("job-4").exists()


@pytest.mark.p0
@pytest.mark.integration
def test_scan_boundary_limits_source_analyzers_to_targeted_path_prefixes(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz(
        {
            "repo/src/in_scope.py": b"print('in')\n",
            "repo/other/out_of_scope.py": b"print('out')\n",
        }
    )
    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive
    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()
    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
    )

    boundary.handle(
        {
            "scanJobId": "job-targeted-scope",
            "snapshotId": "snap-targeted-scope",
            "commitSha": "commit-targeted-scope",
            "correlationId": "corr-targeted-scope",
            "targetedReanalysis": {
                "analyzerId": "RUN_PYTHON_SEMANTIC_ANALYSIS",
                "pathPrefixes": ["repo/src/"],
            },
        },
        correlationId="fallback-corr",
    )

    # Syft (SBOM inventory) is suppressed during targeted re-analysis —
    # execution_plan.should_run("syft") returns False when targeted=True.
    syft_tool.run.assert_not_called()
    # Semgrep and deptry run based on the Python language profile of the
    # in-scope file; targeted_plan only scopes file classification, not tools.
    semgrep_tool.run.assert_called_once()
    deptry_tool.run.assert_called_once()
    knip_tool.run.assert_not_called()  # language-profile unsupported for Python-only
    posted_payload = api_client.post_scan_callback.call_args.args[1]
    coverage_files = posted_payload.evidence_payload["scan_coverage"]["files"]
    assert [item["file_path"] for item in coverage_files] == ["repo/src/in_scope.py"]
    assert posted_payload.evidence_payload["targeted_reanalysis"] == {
        "analyzer_id": "RUN_PYTHON_SEMANTIC_ANALYSIS",
        "path_prefixes": ["repo/src/"],
    }
    graph = posted_payload.evidence_payload["evidence_graph"]
    assert graph["provenance"]["snapshot_id"] == "snap-targeted-scope"
    assert graph["provenance"]["commit_sha"] == "commit-targeted-scope"


@pytest.mark.p0
@pytest.mark.integration
def test_scan_boundary_defers_callback_until_cleanup_is_verified(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz({"repo/README.md": b"hello\n"})

    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive

    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()

    def failing_rmtree(path: Path) -> None:
        raise OSError("cleanup failed")

    monkeypatch.setattr(workspace_module.shutil, "rmtree", failing_rmtree)

    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
    )

    with pytest.raises(ArchiveMaterializationError):
        boundary.handle(
            {
                "scanJobId": "job-6",
                "snapshotId": "snap-6",
                "correlationId": "corr-6",
            },
            correlationId="fallback-corr",
        )

    api_client.post_scan_callback.assert_not_called()


@pytest.mark.p0
@pytest.mark.integration
def test_scan_boundary_cleanup_runs_on_timeout(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz({"repo/README.md": b"hello\n"})

    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive

    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()
    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
    )
    boundary.scan_timeout_seconds = 0

    times = iter([1.0, 2.0])
    monkeypatch.setattr(scan_boundary_module.time, "monotonic", lambda: next(times))

    with pytest.raises(ArchiveMaterializationError):
        boundary.handle(
            {
                "scanJobId": "job-5",
                "snapshotId": "snap-5",
                "correlationId": "corr-5",
            },
            correlationId="fallback-corr",
        )

    assert not workspace.workspace_path("job-5").exists()


def test_scan_boundary_emits_llm_limit_waiting_runtime_events(
    workspace_dir: Path,
) -> None:
    api_client = MagicMock()
    boundary = ScanBoundary(
        WorkerConfig(
            nestjs_api_base_url="http://api.test",
            worker_api_key="worker-test-key",
            log_level="INFO",
            max_retries=3,
        ),
        snapshot_client=MagicMock(spec=SnapshotServiceClient),
        workspace=ScannerWorkspace(root_path=workspace_dir / "scanner"),
        api_client=api_client,
    )

    boundary._emit_llm_limit_waiting(
        "job-limit",
        RuntimeError("quota exceeded"),
        "LLM token quota exceeded; waiting to resume.",
    )

    runtime_events = [
        call.args[1]
        for call in api_client.post_scan_runtime_event.call_args_list
    ]
    assert runtime_events == [
        {
            "event_type": "TOOL_WAITING_INPUT",
            "run_status": "WAITING",
            "stage": "SCAN",
            "summary": "LLM token limit exceeded; repository scan is waiting to resume",
            "tool_name": "build_evidence_graph",
            "error_summary": "RuntimeError",
            "completed_at": runtime_events[0]["completed_at"],
            "waiting_reason": "LLM token quota exceeded; waiting to resume.",
        },
        {
            "event_type": "RUN_STAGE_CHANGED",
            "run_status": "WAITING",
            "stage": "SCAN",
            "summary": "Repository scan is waiting for LLM capacity",
            "tool_name": "repository_scan",
            "error_summary": "RuntimeError",
            "waiting_reason": "LLM token quota exceeded; waiting to resume.",
        },
    ]


@pytest.mark.p0
def test_scan_boundary_privacy_assertion_aborts_callback_and_cleans_up(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz({"repo/src/app.py": b"print('ok')\n"})

    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive

    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()
    evidence_assembler = MagicMock()
    evidence_assembler.assemble.side_effect = PrivacyAssertionError(
        "source code detected"
    )
    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
        evidence_assembler=evidence_assembler,
    )

    with pytest.raises(PrivacyAssertionError):
        boundary.handle(
            {
                "scanJobId": "job-privacy",
                "snapshotId": "snap-privacy",
                "correlationId": "corr-privacy",
            },
            correlationId="fallback-corr",
        )

    evidence_assembler.assemble.assert_called_once()
    api_client.post_scan_callback.assert_not_called()
    assert not workspace.workspace_path("job-privacy").exists()


@pytest.mark.p0
@pytest.mark.integration
def test_scan_boundary_emits_classifier_coverage_limitations_in_callback(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz({"repo/src/utils.min.js": b"const a=1;\n"})

    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive

    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()

    def assert_coverage_limitation(scan_job_id, payload) -> None:
        assert scan_job_id == "job-8"
        coverage_notes = payload.evidence_payload.get("coverage_notes", [])
        assert any(
            "SCAN_COVERAGE_LIMITATION:" in note and "utils.min.js" in note
            for note in coverage_notes
        )

    api_client.post_scan_callback.side_effect = assert_coverage_limitation
    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
    )

    boundary.handle(
        {
            "scanJobId": "job-8",
            "snapshotId": "snap-8",
            "correlationId": "corr-8",
        },
        correlationId="fallback-corr",
    )

    api_client.post_scan_callback.assert_called_once()


@pytest.mark.p0
@pytest.mark.integration
def test_scan_boundary_full_scan_routes_all_python_files_without_default_quota(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    members = {
        f"repo/src/file_{index}.py": b"def f():\n    return 1\n"
        for index in range(501)
    }
    archive = _build_tar_gz(members)

    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive

    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()

    def assert_python_analysis_is_routed(scan_job_id, payload) -> None:
        assert scan_job_id == "job-9"
        analysis = payload.evidence_payload.get("python_analysis") or {}
        assert analysis.get("files_analyzed") == 501
        coverage_notes = payload.evidence_payload.get("coverage_notes", [])
        assert not any(
            "python_file_limit_exceeded" in note for note in coverage_notes
        )

    api_client.post_scan_callback.side_effect = assert_python_analysis_is_routed
    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
    )

    boundary.handle(
        {
            "scanJobId": "job-9",
            "snapshotId": "snap-9",
            "correlationId": "corr-9",
        },
        correlationId="fallback-corr",
    )

    api_client.post_scan_callback.assert_called_once()


@pytest.mark.p0
@pytest.mark.integration
def test_scan_boundary_invokes_ts_js_bridge_with_routed_files(
    workspace_dir: Path,
) -> None:
    workspace = ScannerWorkspace(root_path=workspace_dir / "scanner")
    archive = _build_tar_gz(
        {
            "repo/src/app.ts": (
                b"import OpenAI from 'openai';\n"
                b"client.chat.completions.create({ model: 'gpt-4o', messages: [] });\n"
            )
        }
    )

    snapshot_client = MagicMock(spec=SnapshotServiceClient)
    snapshot_client.download_snapshot_archive.return_value = archive

    config = WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )
    syft_tool = MagicMock()
    syft_tool.run.return_value = _mock_syft_result()
    semgrep_tool = MagicMock()
    semgrep_tool.run.return_value = _mock_semgrep_result()
    knip_tool = MagicMock()
    knip_tool.run.return_value = _mock_knip_result()
    deptry_tool = MagicMock()
    deptry_tool.run.return_value = _mock_deptry_result()
    api_client = MagicMock()
    bridge = MagicMock()
    bridge.analyze = AsyncMock(return_value=_mock_ts_js_result())
    bridge_factory = MagicMock(return_value=bridge)

    def assert_ts_js_analysis(scan_job_id, payload) -> None:
        assert scan_job_id == "job-ts"
        ts_js_analysis = payload.evidence_payload.get("ts_js_analysis") or {}
        assert ts_js_analysis["findings"][0]["rule_id"] == "ts-openai-chat-completions"
        technical_findings = payload.evidence_payload.get("technical_findings") or []
        provider = next(
            finding
            for finding in technical_findings
            if finding["finding_type"] == "AI_PROVIDER_USAGE"
        )
        assert provider["rule_ids"] == ["ts-openai-chat-completions"]
        assert provider["source_tools"] == ["ts_js_bridge"]

    api_client.post_scan_callback.side_effect = assert_ts_js_analysis
    boundary = ScanBoundary(
        config,
        snapshot_client=snapshot_client,
        workspace=workspace,
        syft_tool=syft_tool,
        semgrep_tool=semgrep_tool,
        knip_tool=knip_tool,
        deptry_tool=deptry_tool,
        api_client=api_client,
        ts_js_bridge_factory=bridge_factory,
    )

    boundary.handle(
        {
            "scanJobId": "job-ts",
            "snapshotId": "snap-ts",
            "correlationId": "corr-ts",
        },
        correlationId="fallback-corr",
    )

    bridge_factory.assert_called_once()
    bridge.analyze.assert_called_once_with(include_files=["repo/src/app.ts"])
    deptry_tool.run.assert_not_called()
    posted_payload = api_client.post_scan_callback.call_args.args[1]
    skipped = {
        record["tool_name"]: record
        for record in posted_payload.evidence_payload["tool_provenance"]
        if record["outcome"] == "skipped_unsupported"
    }
    assert skipped["deptry"]["evidence_eligible"] is False
    assert skipped["python_ast"]["evidence_eligible"] is False
    assert skipped["python_libcst"]["evidence_eligible"] is False
    api_client.post_scan_callback.assert_called_once()
