"""Internal LCSP runtime organized by execution responsibility.

The physical tree is canonical. A temporary import bridge keeps historical
``runtime.*`` and ``tools.*`` implementation imports working while callers are
migrated to the capability-oriented namespaces.
"""
from __future__ import annotations

import importlib.abc
import importlib.machinery
import importlib.util
import sys
from typing import Final


_PLANNING_MODULES: Final[frozenset[str]] = frozenset({
    "engineering_rule_planner",
    "material_scope",
    "plan_audit_result",
    "planning_business_scope",
    "planning_scope",
})
_INVESTIGATION_MODULES: Final[frozenset[str]] = frozenset({
    "code_context",
    "code_context_investigator",
    "deterministic_investigator",
    "engineering_assessment_boundary",
    "initial_query_executor",
    "investigator",
    "openwiki_context",
    "pipeline",
    "planned_pipeline",
    "selected_rule_orchestration",
})
_AI_USAGE_FLOW_MODULES: Final[frozenset[str]] = frozenset({
    "ai_usage_flow_boundary",
    "ai_usage_flow_graph",
    "ai_usage_flow_proposer",
    "ai_usage_flow_rule_engine",
    "confidence_calculator",
    "conflict_candidate_builder",
    "engineering_claim_adapter",
})
_CONFLICT_DETECTION_MODULES: Final[frozenset[str]] = frozenset({
    "conflict_detection_boundary",
    "conflict_detector",
    "conflict_score_calculator",
})
_EVIDENCE_CLAIM_MODULES: Final[frozenset[str]] = frozenset({
    "claim_topology",
    "evidence_claim_validator",
    "evidence_ledger",
    "models",
})
_TECHNICAL_PROFILE_MODULES: Final[frozenset[str]] = frozenset({
    "evidence_quality_evaluator",
    "technical_profile_boundary",
    "technical_profile_builder",
})
_VERIFIED_PROFILE_MODULES: Final[frozenset[str]] = frozenset({
    "verified_profile_boundary",
})
_CLASSIFICATION_MODULES: Final[frozenset[str]] = frozenset({
    "citation_guardrail",
    "classification_boundary",
    "classification_graph",
    "classification_proposer",
    "overclaim_detector",
    "rationale_narrator",
    "risk_tier_calculator",
})
_ENGINEERING_RULE_EVALUATION_MODULES: Final[frozenset[str]] = frozenset({
    "rule_evaluator",
})
_RETRIEVAL_MODULES: Final[frozenset[str]] = frozenset({
    "chroma_path",
    "chroma_vectorless",
    "chromadb_citation_retriever",
    "legal_match_builder",
    "legal_retrieval_boundary",
    "legal_retrieval_index_boundary",
    "legal_retrieval_index_builder",
    "legal_retrieval_index_repository",
    "normative_chunk_filter",
    "rule_applicability_evaluator",
})
_SOURCE_MODULES: Final[frozenset[str]] = frozenset({
    "legal_change_detector_boundary",
    "legal_corpus_recovery_boundary",
    "legal_corpus_recovery_driver",
    "legal_source_ingest_boundary",
    "ocr_fallback",
    "ocr_fallback_boundary",
    "ocr_fallback_repository",
    "ocr_quality_boundary",
    "ocr_quality_repository",
    "ocr_quality_validator",
    "official_source_snapshot",
    "official_text_extraction",
    "official_text_extraction_boundary",
    "official_text_extraction_repository",
    "scripts",
    "vbpl_effect_applier",
    "vbpl_effect_detector",
    "vbpl_effected_chunk_set_boundary",
    "vbpl_effected_chunk_set_exporter",
})
_API_MODULES: Final[frozenset[str]] = frozenset({
    "api_client",
    "artifact_storage",
    "callback_schemas",
    "config",
})
_AUTH_MODULES: Final[frozenset[str]] = frozenset({"pbac_client", "redaction"})
_DISPATCH_MODULES: Final[frozenset[str]] = frozenset({
    "correlation",
    "dev_unsafe_instrumentation",
    "dev_unsafe_trace",
    "graph_runtime",
    "logging",
    "logging_config",
    "logging_path",
    "orchestration_logging",
    "tracing",
    "wizard_clarification",
})


def _suffix(fullname: str, prefix: str) -> str:
    return fullname[len(prefix):].lstrip(".")


def _join_module(base: str, tail: str) -> str:
    return f"{base}.{tail}" if tail else base


def _route_claim_module(module: str) -> str | None:
    head, _, tail = module.partition(".")
    if head in _AI_USAGE_FLOW_MODULES:
        base = f"runtime.assessment.claims.ai_usage_flow.{head}"
    elif head in _CONFLICT_DETECTION_MODULES:
        base = f"runtime.assessment.claims.conflict_detection.{head}"
    elif head in _EVIDENCE_CLAIM_MODULES:
        base = f"runtime.assessment.claims.evidence_claim.{head}"
    elif head in _TECHNICAL_PROFILE_MODULES:
        base = f"runtime.assessment.claims.technical_profile.{head}"
    elif head in _VERIFIED_PROFILE_MODULES:
        base = f"runtime.assessment.claims.verified_profile.{head}"
    else:
        return None
    return _join_module(base, tail)


def _route_evaluation_module(module: str) -> str | None:
    head, _, tail = module.partition(".")
    if head in _CLASSIFICATION_MODULES:
        base = f"runtime.assessment.evaluation.classification.{head}"
    elif head in _ENGINEERING_RULE_EVALUATION_MODULES:
        base = f"runtime.assessment.evaluation.engineering_rule.{head}"
    else:
        return None
    return _join_module(base, tail)


def _route_assessment_module(module: str) -> str | None:
    head, _, tail = module.partition(".")
    if head in _PLANNING_MODULES:
        base = f"runtime.assessment.planning.engineering_rule.{head}"
    elif head in _INVESTIGATION_MODULES:
        base = f"runtime.assessment.investigation.engineering_rule.{head}"
    else:
        routed = _route_claim_module(module)
        if routed is not None:
            return routed
        routed = _route_evaluation_module(module)
        if routed is not None:
            return routed
        return None
    return _join_module(base, tail)


def _route_legal(module: str) -> str:
    head, _, tail = module.partition(".")
    if head in {"corpus", "retrieval", "sources", "maintenance"}:
        return f"runtime.legal.{module}"
    if head in _RETRIEVAL_MODULES:
        base = f"runtime.legal.retrieval.{head}"
    elif head in _SOURCE_MODULES:
        base = f"runtime.legal.sources.{head}"
    else:
        base = f"runtime.legal.corpus.{head}"
    return _join_module(base, tail)


def _route_platform_core(module: str) -> str | None:
    head, _, tail = module.partition(".")
    if head in _API_MODULES:
        base = f"runtime.infrastructure.api.{head}"
    elif head in _AUTH_MODULES:
        base = f"runtime.infrastructure.auth.{head}"
    elif head in _DISPATCH_MODULES:
        base = f"runtime.infrastructure.dispatch.{head}"
    else:
        return None
    return _join_module(base, tail)


def _canonical_name(fullname: str) -> str | None:
    # These two relative names are emitted when implementation blobs that used to
    # share one flat package execute under their new capability package identity.
    # Keep them virtual during the structural migration; no shim files are added to
    # the physical tree.
    moved_relative_dependencies = {
        "runtime.assessment.investigation.rule_evaluator": (
            "runtime.assessment.evaluation.engineering_rule.rule_evaluator"
        ),
        "runtime.assessment.planning.models": (
            "runtime.assessment.claims.evidence_claim.models"
        ),
    }
    if fullname in moved_relative_dependencies:
        return moved_relative_dependencies[fullname]

    assessment_routes = (
        ("runtime.assessment.claims", _route_claim_module),
        ("runtime.assessment.evaluation", _route_evaluation_module),
    )
    for prefix, router in assessment_routes:
        if fullname.startswith(f"{prefix}."):
            routed = router(_suffix(fullname, prefix))
            if routed is not None:
                return routed

    for prefix, capability, modules in (
        ("runtime.assessment.planning", "engineering_rule", _PLANNING_MODULES),
        ("runtime.assessment.investigation", "engineering_rule", _INVESTIGATION_MODULES),
    ):
        if fullname.startswith(f"{prefix}."):
            module = _suffix(fullname, prefix)
            head, _, tail = module.partition(".")
            if head in modules:
                return _join_module(f"{prefix}.{capability}.{head}", tail)

    legacy_gap = "runtime.reporting.gap.reporting"
    if fullname == legacy_gap or fullname.startswith(f"{legacy_gap}."):
        return "runtime.reporting.gap" + fullname[len(legacy_gap):]

    canonical_roots = (
        "runtime.evidence",
        "runtime.legal.corpus",
        "runtime.legal.retrieval",
        "runtime.legal.sources",
        "runtime.legal.maintenance",
        "runtime.assessment",
        "runtime.workflow",
        "runtime.reporting.gap",
        "runtime.reporting.report",
        "runtime.infrastructure",
    )
    if fullname == "runtime" or any(
        fullname == root or fullname.startswith(f"{root}.") for root in canonical_roots
    ):
        return None

    for prefix in (
        "runtime.engineering_rule.intelligence",
        "tools.engineer_rule.intelligence",
    ):
        if fullname == prefix:
            return "runtime.assessment.claims"
        if fullname.startswith(f"{prefix}."):
            routed = _route_claim_module(_suffix(fullname, prefix))
            if routed is not None:
                return routed

    for prefix in (
        "runtime.engineering_rule.investigation",
        "tools.engineer_rule.investigation",
    ):
        if fullname == prefix:
            return "runtime.assessment.investigation"
        if fullname.startswith(f"{prefix}.rule_evaluator"):
            return (
                "runtime.assessment.evaluation.engineering_rule.rule_evaluator"
                + fullname[len(f"{prefix}.rule_evaluator"):]
            )
        if fullname.startswith(f"{prefix}."):
            module = _suffix(fullname, prefix)
            head, _, tail = module.partition(".")
            if head in _INVESTIGATION_MODULES:
                return _join_module(
                    f"runtime.assessment.investigation.engineering_rule.{head}",
                    tail,
                )

    prefix_aliases = (
        ("runtime.graph", "runtime.evidence.graph"),
        ("runtime.scanner", "runtime.evidence.scanner"),
        ("runtime.classification", "runtime.assessment.evaluation.classification"),
        (
            "runtime.engineering_rule.clarification.investigation.clarification",
            "runtime.workflow.recovery.clarification",
        ),
        ("runtime.orchestration.context", "runtime.workflow.state"),
        ("runtime.orchestration.control", "runtime.workflow.recovery"),
        ("runtime.orchestration.invocation", "runtime.workflow.resume"),
        ("runtime.orchestration.managed", "runtime.workflow.checkpoint"),
        ("runtime.platform.agentic_evidence", "runtime.evidence.provenance"),
        ("runtime.platform.llm", "runtime.infrastructure.llm"),
        ("runtime.platform.package", "runtime.infrastructure.dispatch"),
        ("runtime.platform.scripts", "runtime.infrastructure.dispatch.scripts"),
        (
            "runtime.platform.tool_dispatch",
            "runtime.infrastructure.dispatch.tool_dispatch",
        ),
        (
            "tools.clarification.investigation.clarification",
            "runtime.workflow.recovery.clarification",
        ),
        (
            "tools.classification.classification",
            "runtime.assessment.evaluation.classification",
        ),
        ("tools.classification", "runtime.assessment.evaluation.classification"),
        ("tools.context", "runtime.workflow.state"),
        ("tools.control", "runtime.workflow.recovery"),
        ("tools.gap.reporting", "runtime.reporting.gap"),
        ("tools.gap", "runtime.reporting.gap"),
        ("tools.invocation", "runtime.workflow.resume"),
        ("tools.reports.reporting", "runtime.reporting.report"),
        ("tools.reports", "runtime.reporting.report"),
        ("tools.common.agentic_evidence", "runtime.evidence.provenance"),
        ("tools.common.dispatch", "runtime.infrastructure.dispatch.tool_dispatch"),
        ("tools.common.dossiers", "runtime.reporting.report.dossiers"),
        ("tools.common.llm", "runtime.infrastructure.llm"),
        ("tools.common.managed", "runtime.workflow.checkpoint"),
        ("tools.common.package", "runtime.infrastructure.dispatch"),
        ("tools.common.scripts", "runtime.infrastructure.dispatch.scripts"),
        ("tools.graph.scanner.program_graph", "runtime.evidence.graph"),
        ("tools.graph.scanner", "runtime.evidence.scanner"),
    )
    for legacy, canonical in prefix_aliases:
        if fullname == legacy or fullname.startswith(f"{legacy}."):
            return canonical + fullname[len(legacy):]

    for prefix in (
        "runtime.engineering_rule.planner.investigation",
        "tools.planner.investigation",
    ):
        if fullname == prefix:
            return "runtime.assessment"
        if fullname.startswith(f"{prefix}."):
            routed = _route_assessment_module(_suffix(fullname, prefix))
            if routed is not None:
                return routed

    for prefix in ("runtime.legal", "tools.legal.legal", "tools.legal"):
        if fullname == prefix:
            return None if prefix == "runtime.legal" else "runtime.legal"
        if fullname.startswith(f"{prefix}."):
            return _route_legal(_suffix(fullname, prefix))

    for prefix in ("runtime.platform.core", "tools.common.platform"):
        if fullname == prefix:
            return "runtime.infrastructure" if prefix.startswith("tools.") else None
        if fullname.startswith(f"{prefix}."):
            return _route_platform_core(_suffix(fullname, prefix))

    if fullname == "tools.engineer_rule":
        return "runtime.assessment"

    if fullname.startswith("runtime.reporting.") and not fullname.startswith(
        ("runtime.reporting.gap", "runtime.reporting.report")
    ):
        return "runtime.reporting.report." + _suffix(fullname, "runtime.reporting")

    return None


_VIRTUAL_PACKAGES: Final[frozenset[str]] = frozenset({
    "runtime.platform",
    "runtime.platform.core",
    "runtime.engineering_rule",
    "runtime.engineering_rule.planner",
    "runtime.engineering_rule.clarification",
    "runtime.engineering_rule.clarification.investigation",
    "runtime.orchestration",
    "tools.clarification",
    "tools.clarification.investigation",
    "tools.graph",
})


class _LegacyRuntimeAliasFinder(importlib.abc.MetaPathFinder):
    """Resolve migration-only legacy imports into the canonical runtime tree."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        if fullname in _VIRTUAL_PACKAGES:
            spec = importlib.machinery.ModuleSpec(fullname, loader=None, is_package=True)
            spec.submodule_search_locations = []
            return spec

        canonical = _canonical_name(fullname)
        if canonical is None or canonical == fullname:
            return None

        canonical_spec = importlib.util.find_spec(canonical)
        if canonical_spec is None:
            return None
        if canonical_spec.origin is None:
            spec = importlib.machinery.ModuleSpec(fullname, loader=None, is_package=True)
            spec.submodule_search_locations = list(
                canonical_spec.submodule_search_locations or []
            )
            return spec

        locations = canonical_spec.submodule_search_locations
        return importlib.util.spec_from_file_location(
            fullname,
            canonical_spec.origin,
            submodule_search_locations=list(locations) if locations is not None else None,
        )


def install_legacy_aliases() -> None:
    """Install the temporary import bridge exactly once."""
    if not any(isinstance(finder, _LegacyRuntimeAliasFinder) for finder in sys.meta_path):
        sys.meta_path.insert(0, _LegacyRuntimeAliasFinder())


install_legacy_aliases()
