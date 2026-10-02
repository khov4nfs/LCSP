"""One bounded Deep Agent task for scan-time AI discovery.

Repository hydration and Codebase Memory indexing happen before this boundary in
middleware/system_event_dispatch.py. EngineeringRule analysis is deliberately not
part of this scan job; it runs independently, one rule at a time.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from importlib.metadata import version
from typing import Any

from deepagents import create_deep_agent
from deepagents.backends import BackendProtocol

from harness import configure_lcsp_harness
from middleware.agent_run_budget import AgentRunBudgetMiddleware
from middleware.usage_metering import AgentRoleMiddleware
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from model_policy import resolve_agent_model, resolved_policy_snapshot
from orchestration.agent_stream import AGENT_STREAM_STAGES, invoke_with_stream
from orchestration.technical_coverage_policy import attach_partial_coverage_policy
from tools.common.capabilities.evidence.graph.schema.models import program_graph_content_hash
from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.platform.repository_sandbox import current_repository_backend
from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS

from .models import AiDiscovery, AiFinding, RepositoryAnalysisResult, SourceAnchor

logger = get_logger(__name__)

REPOSITORY_ANALYSIS_VERSION = "2.0.0"
AI_DISCOVERY_FINALIZE_AFTER_MODEL_CALLS = 12
AI_DISCOVERY_FAILED = "AI_DISCOVERY_FAILED"
SNIPPET_REF_MAX_LINES = 7

SYSTEM_PROMPT = """You perform one bounded AI-discovery pass over the assessed repository.

The repository is your native filesystem and shell working directory. Its Codebase Memory index
is already built; use the supplied graph tools for navigation and inspect source before reporting
evidence. Do not analyze EngineeringRules, legal criteria, compliance, or customer context. Do not
create discovery tasks, plans, batches, graph-provider queries, or a repository evidence graph.

Determine only the minimum repository-backed facts needed to establish whether and how this
application uses AI. Establish, when evidence permits: whether AI usage exists; the relevant
provider/model invocation surface; the main feature or workflow where AI is used; and the governed
source anchors needed for the next assessment state. Stop as soon as those facts are sufficiently
established. Do not broadly understand the repository and do not investigate unrelated
EngineeringRules. If the facts cannot be established with a reasonable bounded investigation,
return AI_UNKNOWN with coverage_state PARTIAL and the limitation in material_unresolved_frontiers
and coverage_notes instead of continuing broad exploration.

Return only the small structured result. AI_CONFIRMED requires a concrete model invocation or
outbound AI call. AI_ABSENT_CONFIRMED is allowed only after broad material coverage with no
generated, dynamic, excluded, unreadable, or unresolved frontier; otherwise return AI_UNKNOWN.
Report repository-relative anchors and compact metadata only, never raw source, prompts, secrets,
credentials, or command output.
"""


@dataclass
class RepositoryAnalysisArtifact:
    result: RepositoryAnalysisResult
    evidence_payload: dict[str, Any]
    tools_version: dict[str, str]
    config_hash: dict[str, str]


class RepositoryDeepAnalyzer:
    """Run the single scan-time AI-discovery task against the hydrated repository."""

    def __init__(
        self,
        *,
        role: str = "repository-analyst",
        backend: BackendProtocol | None = None,
    ) -> None:
        self._role = role
        self._backend = backend

    def analyze(
        self,
        *,
        snapshot_id: str,
        commit_sha: str,
        scan_job_id: str,
        backend: BackendProtocol | None = None,
        **_: Any,
    ) -> RepositoryAnalysisArtifact:
        repository_backend = backend or self._backend or current_repository_backend()
        if repository_backend is None:
            raise RuntimeError(
                "repository analysis requires the current LCSP repository sandbox backend"
            )

        failed = False
        try:
            result = self._invoke(
                repository_backend,
                snapshot_id=snapshot_id,
                commit_sha=commit_sha,
                scan_job_id=scan_job_id,
            )
            result = enforce_ai_absence_backstop(repository_backend, result)
        except Exception as error:  # AI discovery is independently durable per A4
            logger.warning(
                "AI_DISCOVERY_FAILED",
                scan_job_id=scan_job_id,
                error_type=type(error).__name__,
            )
            result = _failed_ai_discovery_result()
            failed = True

        return RepositoryAnalysisArtifact(
            result=result,
            evidence_payload=self._evidence_payload(
                repository_backend,
                result,
                snapshot_id=snapshot_id,
                commit_sha=commit_sha,
                scan_job_id=scan_job_id,
                ai_discovery_failed=failed,
            ),
            tools_version={
                "deepagents": version("deepagents"),
                "repository-analysis": REPOSITORY_ANALYSIS_VERSION,
            },
            config_hash={
                "repository-analysis": "sha256:"
                + hashlib.sha256(
                    (SYSTEM_PROMPT + "\n" + resolved_policy_snapshot(self._role)["policyVersion"]).encode("utf-8")
                ).hexdigest()
            },
        )

    def _invoke(
        self,
        backend: BackendProtocol,
        *,
        snapshot_id: str,
        commit_sha: str,
        scan_job_id: str,
    ) -> RepositoryAnalysisResult:
        configure_lcsp_harness()
        model = resolve_agent_model(self._role)
        agent = create_deep_agent(
            name="ai-discovery-analyst",
            model=model,
            backend=backend,
            system_prompt=SYSTEM_PROMPT,
            middleware=[
                AgentRunBudgetMiddleware(
                    finalize_after=AI_DISCOVERY_FINALIZE_AFTER_MODEL_CALLS
                ),
                AgentRoleMiddleware("repository-analyst"),
                *MODEL_GOVERNANCE_MIDDLEWARE,
            ],
            tools=CODEBASE_MEMORY_GRAPH_TOOLS,
            response_format=RepositoryAnalysisResult,
            debug=False,
        )
        response = invoke_with_stream(
            agent,
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Establish the minimum evidence of whether and how AI is used for snapshot "
                            f"{snapshot_id} at commit {commit_sha or 'unknown'} (scan {scan_job_id}); "
                            "stop once established, or return AI_UNKNOWN with a limitation."
                        ),
                    }
                ]
            },
            config={
                "configurable": {"thread_id": f"ai-discovery:{scan_job_id}"},
                "metadata": {
                    "scan_job_id": scan_job_id,
                    "snapshot_id": snapshot_id,
                    "commit_sha": commit_sha,
                },
            },
            stage=AGENT_STREAM_STAGES["scanner"],
        )
        if not isinstance(response, dict) or response.get("structured_response") is None:
            raise RuntimeError("AI-discovery Deep Agent did not return structured_response")
        return RepositoryAnalysisResult.model_validate(response["structured_response"])

    @staticmethod
    def _evidence_payload(
        backend: BackendProtocol,
        result: RepositoryAnalysisResult,
        *,
        snapshot_id: str,
        commit_sha: str,
        scan_job_id: str,
        ai_discovery_failed: bool = False,
    ) -> dict[str, Any]:
        anchors: list[dict[str, Any]] = []
        anchor_by_id: dict[str, dict[str, Any]] = {}
        for anchor in result.source_anchors:
            relative = anchor.file_path.replace("\\", "/").lstrip("/")
            if relative in {".git", ".lcsp"} or relative.startswith((".git/", ".lcsp/")):
                continue
            downloaded = backend.download_files([f"/{relative}"])
            if not downloaded:
                continue
            source_file = downloaded[0]
            if source_file.error or source_file.content is None:
                continue
            body = {
                "anchor_id": anchor.anchor_id,
                "snapshot_id": snapshot_id,
                "commit_sha": commit_sha,
                "file_path": relative,
                "symbol_ref": anchor.symbol_ref,
                "start_line": anchor.start_line,
                "end_line": anchor.end_line,
                "source_hash": "sha256:"
                + hashlib.sha256(source_file.content).hexdigest(),
            }
            anchors.append(body)
            anchor_by_id[anchor.anchor_id] = body

        findings: list[dict[str, Any]] = []
        for finding in result.ai_discovery.findings:
            anchor = anchor_by_id.get(finding.anchor_id or "")
            body = finding.model_dump(exclude_none=True)
            body.pop("anchor_id", None)
            body["evidence_refs"] = [
                ref for ref in body.get("evidence_refs", []) if ref in anchor_by_id
            ]
            if anchor:
                body["snippet_ref"] = {
                    "snapshot_id": snapshot_id,
                    "commit_sha": commit_sha,
                    "file_path": anchor["file_path"],
                    "symbol": anchor["symbol_ref"],
                    "start_line": anchor["start_line"],
                    "end_line": min(
                        anchor["end_line"],
                        anchor["start_line"] + SNIPPET_REF_MAX_LINES - 1,
                    ),
                    "evidence_hash": anchor["source_hash"],
                    "snippet_policy": "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
                }
                if finding.anchor_id not in body["evidence_refs"]:
                    body["evidence_refs"].append(finding.anchor_id)
            findings.append(body)

        graph = {
            "graph_id": f"deep-agent:{scan_job_id}",
            "snapshot_id": snapshot_id,
            "commit_sha": commit_sha,
            "node_count": 0,
            "edge_count": 0,
            "nodes": [],
            "edges": [],
            "source_anchors": anchors,
            "indexes": {},
            "unresolved_frontiers": list(
                result.ai_discovery.material_unresolved_frontiers
            ),
            "coverage_state": result.coverage_state,
            "coverage_notes": result.coverage_notes,
            "provenance": {
                "engine": "deepagents",
                "analysisVersion": REPOSITORY_ANALYSIS_VERSION,
            },
            "evidence_refs": [item["anchor_id"] for item in anchors],
            "graph_hash": "",
            "schema_version": "deep-agent-1.0.0",
        }
        graph["graph_hash"] = program_graph_content_hash(graph)
        return attach_partial_coverage_policy(
            {
                "commit_sha": commit_sha,
                "summary": result.summary,
                "languages": result.languages,
                "frameworks": result.frameworks,
                "coverage_state": result.coverage_state,
                "technical_coverage": {
                    "coverage_state": result.coverage_state,
                    "limitations": list(result.coverage_notes),
                },
                "technicalCoverageState": result.coverage_state,
                "coverageLimitations": result.coverage_notes,
                "evidence_graph": graph,
                "ai_discovery": {
                    "schema_version": "1.0.0",
                    "gate": result.ai_discovery.gate,
                    "coverage_state": result.ai_discovery.coverage_state,
                    "findings": findings,
                    "material_unresolved_frontiers": (
                        result.ai_discovery.material_unresolved_frontiers
                    ),
                    "limitations": [AI_DISCOVERY_FAILED] if ai_discovery_failed else [],
                },
            }
        )


def _failed_ai_discovery_result() -> RepositoryAnalysisResult:
    return RepositoryAnalysisResult(
        summary="AI discovery could not complete.",
        coverage_state="PARTIAL",
        coverage_notes=[AI_DISCOVERY_FAILED],
        ai_discovery=AiDiscovery(
            gate="AI_UNKNOWN",
            coverage_state="PARTIAL",
            material_unresolved_frontiers=[AI_DISCOVERY_FAILED],
        ),
    )


# Existing deterministic contradiction backstop. It only downgrades absence.
_AI_IMPORT_SIGNALS: tuple[tuple[str, tuple[str, ...], str], ...] = (
    ("import openai", ("**/*.py",), "openai"),
    ("from openai", ("**/*.py",), "openai"),
    ("import anthropic", ("**/*.py",), "anthropic"),
    ("from anthropic", ("**/*.py",), "anthropic"),
    ("from langchain", ("**/*.py",), "langchain"),
    ("from google import genai", ("**/*.py",), "google-genai"),
    ("import google.generativeai", ("**/*.py",), "google-genai"),
    ("import litellm", ("**/*.py",), "litellm"),
    ("from litellm", ("**/*.py",), "litellm"),
)
_JS_SOURCE_GLOBS = ("**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs")
_JS_AI_MODULES: tuple[tuple[str, str], ...] = (
    ("openai", "openai"),
    ("@google/genai", "google-genai"),
    ("@google/generative-ai", "google-genai"),
    ("@anthropic-ai/sdk", "anthropic"),
    ("@aws-sdk/client-bedrock-runtime", "bedrock"),
    ("@mistralai/mistralai", "mistral"),
    ("@langchain/", "langchain"),
    ("langchain", "langchain"),
)
_AI_MANIFEST_SIGNALS: tuple[tuple[str, tuple[str, ...], str], ...] = (
    *((f'"{module}' + ("" if module.endswith("/") else '"'), ("**/package.json",), provider)
      for module, provider in _JS_AI_MODULES),
    *((package, ("**/pyproject.toml", "**/requirements*.txt"), provider)
      for package, provider in (
          ("openai", "openai"),
          ("anthropic", "anthropic"),
          ("langchain", "langchain"),
          ("google-genai", "google-genai"),
          ("google-generativeai", "google-genai"),
          ("litellm", "litellm"),
      )),
)
_AI_SIGNALS = (
    *_AI_IMPORT_SIGNALS,
    *((f"from {quote}{module}", _JS_SOURCE_GLOBS, provider)
      for module, provider in _JS_AI_MODULES for quote in ('"', "'")),
    *((f'require("{module}', _JS_SOURCE_GLOBS, provider)
      for module, provider in _JS_AI_MODULES),
    *_AI_MANIFEST_SIGNALS,
)
_NON_PRODUCT_SEGMENTS = frozenset(
    {"node_modules", ".venv", "venv", ".git", ".lcsp", "dist", "build", "vendor",
     "site-packages", "__pycache__", "tests", "test", "__tests__", "fixtures"}
)
_MAX_BACKSTOP_MATCHES = 50


def _product_path(path: str) -> bool:
    parts = [part for part in path.replace("\\", "/").split("/") if part]
    if not parts or any(part in _NON_PRODUCT_SEGMENTS for part in parts[:-1]):
        return False
    name = parts[-1]
    return not (name.startswith("test_") or ".spec." in name or ".test." in name)


def _first_product_match(
    backend: BackendProtocol, pattern: str, globs: tuple[str, ...]
) -> Any:
    for glob in globs:
        found = backend.grep(pattern, path="/", glob=glob, max_count=_MAX_BACKSTOP_MATCHES)
        if getattr(found, "error", None):
            raise RuntimeError(str(found.error))
        for match in getattr(found, "matches", None) or []:
            if _product_path(str(match.get("path") or "")):
                return match
    return None


def enforce_ai_absence_backstop(
    backend: BackendProtocol, result: RepositoryAnalysisResult
) -> RepositoryAnalysisResult:
    """Downgrade an AI-absence result contradicted by deterministic SDK signals."""
    if result.ai_discovery.gate != "AI_ABSENT_CONFIRMED":
        return result

    hits: dict[str, dict[str, Any]] = {}
    frontiers: list[str] = []
    try:
        for pattern, globs, provider in _AI_SIGNALS:
            if provider not in hits:
                match = _first_product_match(backend, pattern, globs)
                if match is not None:
                    hits[provider] = match
    except Exception as error:
        frontiers.append(
            "AI absence could not be verified: deterministic SDK scan failed "
            f"({type(error).__name__})"
        )
    if not hits and not frontiers:
        return result

    data = result.model_dump()
    findings = list(data["ai_discovery"]["findings"])
    anchors = list(data["source_anchors"])
    taken = {anchor["anchor_id"] for anchor in anchors}
    for index, (provider, match) in enumerate(sorted(hits.items()), start=1):
        anchor_id = f"ai-absence-backstop-{index}"
        while anchor_id in taken:
            anchor_id += "-x"
        taken.add(anchor_id)
        file_path = str(match["path"]).lstrip("/")
        line = int(match.get("line") or 1)
        anchors.append(
            SourceAnchor(
                anchor_id=anchor_id,
                file_path=file_path,
                start_line=line,
                end_line=line,
            ).model_dump()
        )
        findings.append(
            AiFinding(
                evidence_id=anchor_id,
                state="AI_PROVIDER_REFERENCE",
                resolution_state="OBSERVED",
                kind="PROVIDER_REFERENCE",
                provider=provider,
                clarification_owner="CUSTOMER",
                clarification_kind="OUTBOUND_AI_CONFIRMATION",
                evidence_refs=[anchor_id],
                anchor_id=anchor_id,
            ).model_dump()
        )
    data["source_anchors"] = anchors
    data["ai_discovery"].update(
        gate="AI_UNKNOWN",
        findings=findings,
        material_unresolved_frontiers=[
            *data["ai_discovery"]["material_unresolved_frontiers"],
            *frontiers,
        ],
    )
    data["coverage_notes"] = [
        *data["coverage_notes"],
        "AI_ABSENT_CONFIRMED was downgraded to AI_UNKNOWN by the deterministic "
        "AI SDK dependency/import check.",
    ]
    return RepositoryAnalysisResult.model_validate(data)


__all__ = [
    "AI_DISCOVERY_FAILED",
    "REPOSITORY_ANALYSIS_VERSION",
    "RepositoryAnalysisArtifact",
    "RepositoryDeepAnalyzer",
    "SYSTEM_PROMPT",
    "enforce_ai_absence_backstop",
]
