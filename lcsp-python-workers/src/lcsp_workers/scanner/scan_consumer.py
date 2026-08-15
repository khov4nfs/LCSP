from __future__ import annotations

import hashlib
import json
import platform
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from lcsp_workers.agentic_evidence.dispatcher import ScannerToolDispatcher
from lcsp_workers.agentic_evidence.scanner_tool_entrypoints import (
    ScannerToolExecutionContext,
)
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.callback_schemas import CallbackResponse
from lcsp_workers.platform.correlation import set_correlationId
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .analyzers.ai_invocation_detector import AIInvocationDetector
from .analyzers.ai_pattern_rules import AI_RULE_TABLE
from .analyzers.python_analyzer import PythonAnalysisResult
from .dependencies.dependency_normalizer import DependencyNormalizer
from .evidence_assembler import EvidenceAssembler, PrivacyAssertionError
from .inventory.analyzer_router import AnalyzerRouter
from .inventory.language_classifier import LanguageClassifier
from .parsers.structural_augmentor import StructuralAugmentor
from .parsers.structural_types import StructuralFact
from .graph.evidence_graph_assembler import EvidenceGraphAssembler
from .evidence.terminal_state_handler import (
    CleanupBlockedError,
    verify_workspace_cleanup_sync,
)
from .snapshot_service_client import SnapshotArchiveRequest, SnapshotServiceClient
from .ts_js_bridge.bridge import TsJsBridge
from .ts_js_bridge.bridge_types import TsJsCoverageLimitation
from .tool_registry import ToolRegistry
from .toolchain_execution import (
    APPROVED_TOOL_NAMES,
    RepositoryLanguageProfile,
    ToolchainExecutionPlan,
    ToolchainExecutionPlanner,
)
from .tools.deptry_tool import DeptryRunResult, DeptryTool
from .tools.knip_tool import KnipRunResult, KnipTool
from .tools.semgrep_tool import SemgrepRunResult, SemgrepTool
from .tools.syft_tool import SyftRunResult, SyftTool
from .tools.tool_base import (
    NOT_RUN_VERSION,
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    ToolExecutionResult,
)
from .ts_js_bridge.bridge_types import TsJsBridgeResult
from .workspace import ArchiveMaterializationError, ScannerWorkspace

logger = get_logger(__name__)

NOT_APPLICABLE_RULESET_HASH = "sha256:not-applicable"
PYTHON_ANALYZER_CONFIG_HASH = "sha256:" + hashlib.sha256(
    b"lcsp-python-analyzer:max-l3-hops=1"
).hexdigest()
PYTHON_RULESET_HASH = "sha256:" + hashlib.sha256(
    json.dumps(
        AI_RULE_TABLE,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
).hexdigest()
STRUCTURAL_CONFIG_HASH = "sha256:" + hashlib.sha256(
    b"lcsp-structural-custom-parser:file-limit=100"
).hexdigest()


TARGETED_REANALYSIS_ANALYZER_IDS = {
    "RUN_SEMGREP_RULES",
    "RUN_PYTHON_SEMANTIC_ANALYSIS",
    "RUN_TS_JS_SEMANTIC_ANALYSIS",
    "RUN_STRUCTURAL_AUGMENTATION",
}


@dataclass(frozen=True)
class ScanJobEnvelope:
    scan_job_id: str
    snapshot_id: str
    commit_sha: str
    correlationId: str


@dataclass(frozen=True)
class TargetedReanalysisPlan:
    analyzer_id: str
    path_prefixes: tuple[str, ...]

    @classmethod
    def from_message(cls, message: dict) -> "TargetedReanalysisPlan | None":
        value = message.get("targetedReanalysis")
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ArchiveMaterializationError("targeted reanalysis plan is invalid")
        analyzer_id = value.get("analyzerId")
        path_prefixes = value.get("pathPrefixes")
        if (
            not isinstance(analyzer_id, str)
            or analyzer_id not in TARGETED_REANALYSIS_ANALYZER_IDS
            or not isinstance(path_prefixes, list)
        ):
            raise ArchiveMaterializationError("targeted reanalysis plan is invalid")
        normalized_prefixes = tuple(sorted(set(path_prefixes)))
        if not normalized_prefixes or any(
            not isinstance(prefix, str)
            or not prefix.endswith("/")
            or prefix.startswith("/")
            or ".." in prefix.split("/")
            for prefix in normalized_prefixes
        ):
            raise ArchiveMaterializationError("targeted reanalysis plan is invalid")
        return cls(analyzer_id=analyzer_id, path_prefixes=normalized_prefixes)

    def includes(self, file_path: str) -> bool:
        normalized_path = file_path.replace("\\", "/")
        return any(normalized_path.startswith(prefix) for prefix in self.path_prefixes)

    def runs(self, analyzer_id: str) -> bool:
        return self.analyzer_id == analyzer_id

    def to_evidence_payload(self) -> dict[str, object]:
        return {
            "analyzer_id": self.analyzer_id,
            "path_prefixes": list(self.path_prefixes),
        }


class ScanConsumer(ConsumerBase):
    queue_name = "scan.triggered"
    routing_key = "command.scan.requested.v1"
    scan_timeout_seconds = 600

    def __init__(
        self,
        config,
        pbac_client=None,
        snapshot_client: SnapshotServiceClient | None = None,
        workspace: ScannerWorkspace | None = None,
        syft_tool: SyftTool | None = None,
        semgrep_tool: SemgrepTool | None = None,
        knip_tool: KnipTool | None = None,
        deptry_tool: DeptryTool | None = None,
        language_classifier: LanguageClassifier | None = None,
        analyzer_router: AnalyzerRouter | None = None,
        dependency_normalizer: DependencyNormalizer | None = None,
        ts_js_bridge_factory: Callable[[Path], TsJsBridge] | None = None,
        ai_invocation_detector: AIInvocationDetector | None = None,
        api_client: WorkerApiClient | None = None,
        evidence_assembler: EvidenceAssembler | None = None,
        structural_augmentor: StructuralAugmentor | None = None,
        evidence_graph_assembler: EvidenceGraphAssembler | None = None,
        execution_planner: ToolchainExecutionPlanner | None = None,
    ):
        super().__init__(config, pbac_client)
        self._snapshot_client = snapshot_client or SnapshotServiceClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._workspace = workspace or ScannerWorkspace()
        self._syft_tool = syft_tool or SyftTool()
        self._semgrep_tool = semgrep_tool or SemgrepTool()
        self._knip_tool = knip_tool or KnipTool()
        self._deptry_tool = deptry_tool or DeptryTool()
        self._language_classifier = language_classifier or LanguageClassifier()
        self._analyzer_router = analyzer_router or AnalyzerRouter()
        self._dependency_normalizer = dependency_normalizer or DependencyNormalizer()
        self._ts_js_bridge_factory = ts_js_bridge_factory or (
            lambda workspace_path: TsJsBridge(workspace=workspace_path)
        )
        self._ai_invocation_detector = ai_invocation_detector or AIInvocationDetector()
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._evidence_assembler = evidence_assembler or EvidenceAssembler()
        self._structural_augmentor = structural_augmentor or StructuralAugmentor()
        self._evidence_graph_assembler = evidence_graph_assembler or EvidenceGraphAssembler()
        self._execution_planner = execution_planner or ToolchainExecutionPlanner()
        self._scanner_tool_dispatcher = ScannerToolDispatcher(
            ScannerToolExecutionContext(
                workspace=self._workspace,
                language_classifier=self._language_classifier,
                syft_tool=self._syft_tool,
                semgrep_tool=self._semgrep_tool,
                knip_tool=self._knip_tool,
                deptry_tool=self._deptry_tool,
                ts_js_bridge_factory=self._ts_js_bridge_factory,
                structural_augmentor=self._structural_augmentor,
                evidence_graph_assembler=self._evidence_graph_assembler,
            )
        )

    def handle(self, message: dict, correlationId: str) -> CallbackResponse:
        started_at = time.monotonic()
        envelope = self._read_envelope(message, correlationId)
        targeted_plan = TargetedReanalysisPlan.from_message(message)
        set_correlationId(envelope.correlationId)

        archive = self._snapshot_client.download_snapshot_archive(
            SnapshotArchiveRequest(
                snapshot_id=envelope.snapshot_id,
                scan_job_id=envelope.scan_job_id,
                correlationId=envelope.correlationId,
            )
        )

        result = None
        tool_registry = ToolRegistry()
        try:
            result = self._scanner_tool_dispatcher.dispatch(
                "materialize_snapshot",
                scan_job_id=envelope.scan_job_id,
                archive=archive,
                snapshot_id=envelope.snapshot_id,
            )
            logger.info(
                "SCAN_WORKSPACE_MATERIALIZED",
                job_id=result.job_id,
                snapshot_id=result.snapshot_id,
                workspace_path=str(result.workspace_path),
                total_size_bytes=result.total_size_bytes,
                extracted_files=result.extracted_files,
                skipped_files=result.skipped_files,
                coverage_limited=result.coverage_limited,
            )

            classification_limitations: list[dict[str, str]] = []
            classifications = []
            routed_python_files: list[str] = []
            routed_ts_js_files: list[str] = []
            routed_basic_files: list[str] = []
            execution_plan = self._execution_planner.build(
                [], targeted=targeted_plan is not None
            )
            try:
                classifications = self._scanner_tool_dispatcher.dispatch(
                    "classify_workspace_languages",
                    workspace_path=result.workspace_path,
                )
                if targeted_plan is not None:
                    classifications = [
                        classification
                        for classification in classifications
                        if targeted_plan.includes(classification.file_path)
                    ]
                dispatch = self._analyzer_router.route(classifications)
                execution_plan = self._execution_planner.build(
                    classifications, targeted=targeted_plan is not None
                )
                routed_python_files = list(dispatch.python_files)
                routed_ts_js_files = list(dispatch.ts_js_files)
                routed_basic_files = list(dispatch.basic_files)
                classification_limitations = list(dispatch.coverage_limitations)
                logger.info(
                    "SCAN_LANGUAGE_CLASSIFIED",
                    classified_files=len(classifications),
                    python_files=len(dispatch.python_files),
                    ts_js_files=len(dispatch.ts_js_files),
                    basic_files=len(dispatch.basic_files),
                    skipped_files=len(dispatch.skipped_files),
                    coverage_limitations=len(dispatch.coverage_limitations),
                )
            except Exception as error:
                classification_limitations = [
                    {
                        "file_path": "<workspace>",
                        "reason": f"language_classification_failed: {type(error).__name__}",
                    }
                ]
                logger.exception(
                    "SCAN_LANGUAGE_CLASSIFICATION_FAILED",
                    scan_job_id=envelope.scan_job_id,
                    error=str(error),
                )
            classification_limitations.extend(execution_plan.coverage_limitations())

            if execution_plan.should_run(APPROVED_TOOL_NAMES["syft"]):
                syft_started_at = self._utc_timestamp()
                syft_result = self._scanner_tool_dispatcher.dispatch(
                    "run_syft_inventory",
                    workspace_path=result.workspace_path,
                )
                self._record_tool_execution(
                    tool_registry,
                    syft_result.execution,
                    ruleset_hash=NOT_APPLICABLE_RULESET_HASH,
                    started_at=syft_started_at,
                    ended_at=self._utc_timestamp(),
                    language_profile=execution_plan.language_profile,
                    coverage_limitations=self._execution_limitations(
                        syft_result.execution
                    ),
                    sbom_entries=len(syft_result.entries),
                )
            else:
                syft_result = SyftRunResult(
                    entries=[],
                    execution=self._register_skipped_tool(
                        tool_registry,
                        execution_plan,
                        "syft",
                    ),
                )

            if time.monotonic() - started_at > self.scan_timeout_seconds:
                raise ArchiveMaterializationError(
                    f"scan timeout exceeded for job {envelope.scan_job_id!r}"
                )

            if execution_plan.should_run(APPROVED_TOOL_NAMES["semgrep"]):
                semgrep_started_at = self._utc_timestamp()
                semgrep_result = self._scanner_tool_dispatcher.dispatch(
                    "run_semgrep_rules",
                    workspace_path=result.workspace_path,
                )
                self._record_semgrep_executions(
                    tool_registry,
                    semgrep_result,
                    started_at=semgrep_started_at,
                    ended_at=self._utc_timestamp(),
                    language_profile=execution_plan.language_profile,
                )
            else:
                semgrep_result = SemgrepRunResult(
                    findings=[],
                    executions=[
                        self._register_skipped_tool(
                            tool_registry,
                            execution_plan,
                            "semgrep",
                        )
                    ],
                    redaction_applied=False,
                )

            if time.monotonic() - started_at > self.scan_timeout_seconds:
                raise ArchiveMaterializationError(
                    f"scan timeout exceeded for job {envelope.scan_job_id!r}"
                )

            if execution_plan.should_run(APPROVED_TOOL_NAMES["knip"]):
                knip_started_at = self._utc_timestamp()
                knip_result = self._scanner_tool_dispatcher.dispatch(
                    "run_knip_usage_analysis",
                    workspace_path=result.workspace_path,
                )
                self._record_tool_execution(
                    tool_registry,
                    knip_result.execution,
                    ruleset_hash=NOT_APPLICABLE_RULESET_HASH,
                    started_at=knip_started_at,
                    ended_at=self._utc_timestamp(),
                    language_profile=execution_plan.language_profile,
                    coverage_limitations=self._execution_limitations(
                        knip_result.execution
                    ),
                    dependency_facts=len(knip_result.facts),
                )
            else:
                knip_result = KnipRunResult(
                    facts=[],
                    execution=self._register_skipped_tool(
                        tool_registry,
                        execution_plan,
                        "knip",
                    ),
                )

            if time.monotonic() - started_at > self.scan_timeout_seconds:
                raise ArchiveMaterializationError(
                    f"scan timeout exceeded for job {envelope.scan_job_id!r}"
                )

            if execution_plan.should_run(APPROVED_TOOL_NAMES["deptry"]):
                deptry_started_at = self._utc_timestamp()
                deptry_result = self._scanner_tool_dispatcher.dispatch(
                    "run_deptry_usage_analysis",
                    workspace_path=result.workspace_path,
                )
                self._record_tool_execution(
                    tool_registry,
                    deptry_result.execution,
                    ruleset_hash=NOT_APPLICABLE_RULESET_HASH,
                    started_at=deptry_started_at,
                    ended_at=self._utc_timestamp(),
                    language_profile=execution_plan.language_profile,
                    coverage_limitations=self._execution_limitations(
                        deptry_result.execution
                    ),
                    dependency_facts=len(deptry_result.facts),
                )
            else:
                deptry_result = DeptryRunResult(
                    facts=[],
                    execution=self._register_skipped_tool(
                        tool_registry,
                        execution_plan,
                        "deptry",
                    ),
                )

            if time.monotonic() - started_at > self.scan_timeout_seconds:
                raise ArchiveMaterializationError(
                    f"scan timeout exceeded for job {envelope.scan_job_id!r}"
                )

            if execution_plan.should_run(APPROVED_TOOL_NAMES["ts_morph"]):
                ts_js_started_at = self._utc_timestamp()
                ts_js_analysis = self._scanner_tool_dispatcher.dispatch(
                    "run_ts_js_semantic_analysis",
                    workspace_path=result.workspace_path,
                    include_files=routed_ts_js_files,
                )
                self._record_tool_execution(
                    tool_registry,
                    ts_js_analysis.execution,
                    ruleset_hash=ts_js_analysis.execution.config_hash,
                    started_at=ts_js_started_at,
                    ended_at=self._utc_timestamp(),
                    language_profile=execution_plan.language_profile,
                    coverage_limitations=[
                        limitation.reason
                        for limitation in ts_js_analysis.coverage_limitations
                    ],
                    tool_name=APPROVED_TOOL_NAMES["ts_morph"],
                    ts_js_findings=len(ts_js_analysis.findings),
                    ts_js_dynamic_flows=len(ts_js_analysis.unsupported_dynamic_flows),
                    ts_js_coverage_limitations=len(ts_js_analysis.coverage_limitations),
                )
            else:
                ts_js_analysis = TsJsBridgeResult(
                    files_analyzed=0,
                    files_skipped=0,
                    findings=[],
                    unsupported_dynamic_flows=[],
                    coverage_limitations=[],
                    analyzer_version=NOT_RUN_VERSION,
                    execution=self._register_skipped_tool(
                        tool_registry,
                        execution_plan,
                        "ts_morph",
                    ),
                )

            package_dependencies = self._dependency_normalizer.normalize(
                sbom_entries=syft_result.entries,
                usage_facts=[*knip_result.facts, *deptry_result.facts],
            )
            if execution_plan.should_run(APPROVED_TOOL_NAMES["python_ast"]):
                python_started_at = self._utc_timestamp()
                python_analysis = self._scanner_tool_dispatcher.dispatch(
                    "run_python_semantic_analysis",
                    workspace_path=result.workspace_path,
                    include_files=routed_python_files,
                )
                python_ended_at = self._utc_timestamp()
                python_limitations = (
                    list(python_analysis.coverage_limitations)
                    or (
                        ["Python analysis reported bounded coverage limitations"]
                        if python_analysis.coverage_limitation
                        or python_analysis.files_skipped
                        else []
                    )
                )
                for tool_key, tool_version in (
                    ("python_ast", f"python-{platform.python_version()}"),
                    ("python_libcst", self._libcst_version()),
                ):
                    self._record_tool_execution(
                        tool_registry,
                        ToolExecutionResult(
                            tool_name=APPROVED_TOOL_NAMES[tool_key],
                            tool_version=tool_version,
                            outcome=OUTCOME_SUCCESS,
                            config_hash=PYTHON_ANALYZER_CONFIG_HASH,
                        ),
                        ruleset_hash=PYTHON_RULESET_HASH,
                        started_at=python_started_at,
                        ended_at=python_ended_at,
                        language_profile=execution_plan.language_profile,
                        coverage_limitations=python_limitations,
                    )
            else:
                python_analysis = PythonAnalysisResult(
                    files_analyzed=0,
                    files_skipped=0,
                    ai_call_sites=[],
                    import_map={},
                    unsupported_dynamic_flows=[],
                    coverage_limitation=True,
                )
                for tool_key in ("python_ast", "python_libcst"):
                    self._register_skipped_tool(
                        tool_registry,
                        execution_plan,
                        tool_key,
                    )
            technical_findings = self._ai_invocation_detector.detect(
                semgrep_result=semgrep_result,
                python_analysis=python_analysis,
                ts_js_analysis=ts_js_analysis,
                syft_result=syft_result,
                package_dependencies=package_dependencies,
                tool_executions=[
                    *( [syft_result.execution] if syft_result is not None else [] ),
                    *(semgrep_result.executions if semgrep_result is not None else []),
                    *( [knip_result.execution] if knip_result is not None else [] ),
                    *( [deptry_result.execution] if deptry_result is not None else [] ),
                    *( [ts_js_analysis.execution] if ts_js_analysis is not None else [] ),
                ],
            )
            coverage_notes = self._coverage_notes(
                result,
                [
                    *classification_limitations,
                    *self._ts_js_coverage_limitations(
                        ts_js_analysis.coverage_limitations
                        if ts_js_analysis is not None
                        else []
                    ),
                ],
            )
            if targeted_plan is not None:
                coverage_notes.append(
                    "TARGETED_REANALYSIS: "
                    f"analyzer={targeted_plan.analyzer_id} "
                    f"path_prefixes={len(targeted_plan.path_prefixes)}"
                )
            structural_facts: list[StructuralFact] = []
            if execution_plan.should_run(APPROVED_TOOL_NAMES["tree_sitter"]):
                structural_started_at = self._utc_timestamp()
                try:
                    candidate_files = [
                        *routed_python_files,
                        *routed_ts_js_files,
                        *routed_basic_files,
                    ]
                    structural_facts = self._scanner_tool_dispatcher.dispatch(
                        "run_structural_augmentation",
                        workspace_path=result.workspace_path,
                        files=candidate_files,
                        finding_ids=[
                            finding.finding_id for finding in technical_findings
                        ],
                    )
                    self._record_tool_execution(
                        tool_registry,
                        ToolExecutionResult(
                            tool_name=APPROVED_TOOL_NAMES["tree_sitter"],
                            tool_version="custom-parser-1.0.0",
                            outcome=OUTCOME_SUCCESS,
                            config_hash=STRUCTURAL_CONFIG_HASH,
                        ),
                        ruleset_hash=NOT_APPLICABLE_RULESET_HASH,
                        started_at=structural_started_at,
                        ended_at=self._utc_timestamp(),
                        language_profile=execution_plan.language_profile,
                        coverage_limitations=list(
                            self._structural_augmentor.last_coverage_notes
                        ),
                    )
                except Exception as error:
                    structural_ended_at = self._utc_timestamp()
                    self._record_tool_execution(
                        tool_registry,
                        ToolExecutionResult(
                            tool_name=APPROVED_TOOL_NAMES["tree_sitter"],
                            tool_version="custom-parser-1.0.0",
                            outcome=OUTCOME_TOOL_FAILURE,
                            config_hash=STRUCTURAL_CONFIG_HASH,
                            messages=["structural augmentation failed safely"],
                        ),
                        ruleset_hash=NOT_APPLICABLE_RULESET_HASH,
                        started_at=structural_started_at,
                        ended_at=structural_ended_at,
                        language_profile=execution_plan.language_profile,
                        coverage_limitations=[
                            "Structural parser failed; affected structural facts are unavailable"
                        ],
                    )
                    logger.warning(
                        "SCAN_STRUCTURAL_AUGMENTATION_FAILED",
                        scan_job_id=envelope.scan_job_id,
                        error=str(error),
                    )
            else:
                self._register_skipped_tool(
                    tool_registry,
                    execution_plan,
                    "tree_sitter",
                )
            logger.info(
                "SCAN_TOOL_PROVENANCE_RECORDED",
                tool_provenance=[asdict(item) for item in tool_registry.all()],
            )
            evidence_graph = self._scanner_tool_dispatcher.dispatch(
                "build_evidence_graph",
                scan_job_id=envelope.scan_job_id,
                snapshot_id=envelope.snapshot_id,
                commit_sha=envelope.commit_sha,
                workspace_path=result.workspace_path,
                technical_findings=technical_findings,
                structural_facts=structural_facts,
                package_dependencies=package_dependencies,
                coverage_notes=coverage_notes,
            )
            callback_payload = self._evidence_assembler.assemble(
                scan_job_id=envelope.scan_job_id,
                syft_result=syft_result,
                semgrep_result=semgrep_result,
                coverage_notes=coverage_notes,
                package_dependencies=package_dependencies,
                dependency_executions=[
                    *( [knip_result.execution] if knip_result is not None else [] ),
                    *( [deptry_result.execution] if deptry_result is not None else [] ),
                ],
                python_analysis=python_analysis,
                ts_js_analysis=ts_js_analysis,
                technical_findings=technical_findings,
                structural_facts=structural_facts,
                evidence_graph=evidence_graph,
                scan_coverage=classifications,
                targeted_reanalysis=(
                    targeted_plan.to_evidence_payload()
                    if targeted_plan is not None
                    else None
                ),
                tool_provenance=tool_registry.all(),
            )
            self._finalize_workspace_cleanup(envelope.scan_job_id)
            callback_response = self._api_client.post_scan_callback(
                envelope.scan_job_id,
                callback_payload,
            )
            logger.info(
                "SCAN_EVIDENCE_CALLBACK_SUBMITTED",
                scan_job_id=envelope.scan_job_id,
                status=callback_payload.status,
                schema_version=callback_payload.schema_version,
            )
            return callback_response
        except PrivacyAssertionError as error:
            logger.error(
                "SCAN_EVIDENCE_PRIVACY_ASSERTION_FAILED",
                scan_job_id=envelope.scan_job_id,
                error_code=error.error_code,
            )
            self._finalize_workspace_cleanup(envelope.scan_job_id)
            raise
        except Exception as error:
            try:
                self._finalize_workspace_cleanup(envelope.scan_job_id)
            except CleanupBlockedError as cleanup_error:
                raise cleanup_error from error
            raise

    def _finalize_workspace_cleanup(self, job_id: str) -> None:
        workspace_path = self._workspace.workspace_path(job_id)
        try:
            self._workspace.cleanup(job_id)
        except ArchiveMaterializationError:
            raise

        try:
            verify_workspace_cleanup_sync(workspace_path)
        except CleanupBlockedError as error:
            raise ArchiveMaterializationError(str(error)) from error

    def _read_envelope(self, message: dict, correlationId: str) -> ScanJobEnvelope:
        scan_job_id = self._read_field(message, "scan_job_id", "scanJobId")
        snapshot_id = self._read_field(message, "snapshot_id", "snapshotId")
        commit_sha = self._read_field(message, "commit_sha", "commitSha") or ""
        message_correlationId = self._read_field(
            message,
            "correlationId",
            "correlationId",
        )

        if not scan_job_id or not snapshot_id:
            raise ArchiveMaterializationError(
                "scan job envelope missing required identifiers"
            )

        return ScanJobEnvelope(
            scan_job_id=scan_job_id,
            snapshot_id=snapshot_id,
            commit_sha=commit_sha,
            correlationId=message_correlationId or correlationId,
        )

    def _read_field(self, message: dict, *names: str) -> str | None:
        for name in names:
            value = message.get(name)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _record_semgrep_executions(
        self,
        tool_registry: ToolRegistry,
        semgrep_result: SemgrepRunResult,
        *,
        started_at: str,
        ended_at: str,
        language_profile: RepositoryLanguageProfile,
    ) -> None:
        from .tools.semgrep_tool import AI_USAGE_TOOL_NAME

        for execution in semgrep_result.executions:
            context: dict[str, object] = {}
            if execution.tool_name == AI_USAGE_TOOL_NAME:
                context["semgrep_findings"] = len(semgrep_result.findings)
            else:
                context["redaction_applied"] = semgrep_result.redaction_applied

            self._record_tool_execution(
                tool_registry,
                execution,
                ruleset_hash=execution.config_hash,
                started_at=started_at,
                ended_at=ended_at,
                language_profile=language_profile,
                coverage_limitations=self._execution_limitations(execution),
                **context,
            )

    def _record_tool_execution(
        self,
        tool_registry: ToolRegistry,
        execution,
        *,
        ruleset_hash: str,
        started_at: str,
        ended_at: str,
        language_profile: RepositoryLanguageProfile,
        coverage_limitations: list[str],
        tool_name: str | None = None,
        **context: object,
    ) -> None:
        tool_registry.register(
            execution,
            ruleset_hash=ruleset_hash,
            started_at=started_at,
            ended_at=ended_at,
            language_profile=language_profile,
            coverage_limitations=coverage_limitations,
            tool_name=tool_name,
        )

        logger.info(
            "SCAN_TOOL_EXECUTED",
            tool_name=execution.tool_name,
            tool_version=execution.tool_version,
            outcome=execution.outcome,
            config_hash=execution.config_hash,
            **context,
        )

        if execution.outcome != OUTCOME_SUCCESS:
            logger.warning(
                "SCAN_TOOL_NON_BLOCKING_FAILURE",
                tool_name=execution.tool_name,
                outcome=execution.outcome,
                messages=execution.messages,
            )

    def _utc_timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def _execution_limitations(self, execution: ToolExecutionResult) -> list[str]:
        if execution.outcome == OUTCOME_SUCCESS:
            return []
        if execution.messages:
            return list(execution.messages)
        return [f"{execution.tool_name}: {execution.outcome} without diagnostic messages"]

    def _register_skipped_tool(
        self,
        tool_registry: ToolRegistry,
        execution_plan: ToolchainExecutionPlan,
        tool_key: str,
    ) -> ToolExecutionResult:
        tool_name = APPROVED_TOOL_NAMES[tool_key]
        entry = execution_plan.entry_for(tool_name)
        execution = tool_registry.register_skipped(
            entry,
            language_profile=execution_plan.language_profile,
            recorded_at=self._utc_timestamp(),
        )
        logger.info(
            "SCAN_TOOL_SKIPPED_UNSUPPORTED",
            tool_name=tool_name,
            reason=entry.reason,
            language_profile=asdict(execution_plan.language_profile),
        )
        return execution

    def _libcst_version(self) -> str:
        try:
            from importlib.metadata import version

            return version("libcst")
        except Exception:
            return "not-installed"

    def _coverage_notes(
        self,
        result,
        classification_limitations: list[dict[str, str]] | None = None,
    ) -> list[str]:
        notes: list[str] = []
        if result.coverage_limited:
            notes.append(
                "Scanner coverage limited: "
                f"skipped {result.skipped_files} files due to workspace safety limits."
            )

        for limitation in classification_limitations or []:
            file_path = limitation.get("file_path", "<unknown>")
            reason = limitation.get("reason", "unsupported")
            notes.append(
                f"SCAN_COVERAGE_LIMITATION: file={file_path} reason={reason}"
            )
        return notes

    def _ts_js_coverage_limitations(
        self,
        limitations: list[TsJsCoverageLimitation],
    ) -> list[dict[str, str]]:
        return [
            {
                "file_path": limitation.file_path,
                "reason": limitation.reason,
            }
            for limitation in limitations
        ]
