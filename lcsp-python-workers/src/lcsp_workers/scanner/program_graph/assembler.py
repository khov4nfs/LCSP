"""Repository-wide Unified System Evidence Graph orchestration."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

from lcsp_workers.scanner.dependencies.dependency_fact import normalize_package_name

from .ai_invocation_gate import AIInvocationSemanticGate
from .ai_lifecycle import AILifecycleExtractor
from .api_boundary_resolution import ApiBoundaryResolver
from .builder import ProgramGraphBuilder
from .contract_flow import ContractLineageFlowFinalizer
from .contract_lineage import ContractDataLineageExtractor
from .data_lineage import SemanticDataLineageExtractor
from .database_lineage import DatabaseSchemaLineageExtractor
from .decision_influence import DecisionInfluenceEnricher
from .extractor import RepositorySemanticExtractor
from .framework_links import FrameworkBoundaryExtractor
from .framework_metadata import normalize_framework_binding_metadata
from .framework_resolution import FrameworkBoundaryResolver
from .generic_dispatch_resolution import GenericDispatchResolver
from .javascript_architecture_resolution import JavaScriptArchitectureResolver
from .managed_architecture_resolution import ManagedArchitectureResolver
from .protocol_resolution import ProtocolBoundaryResolver
from .python_architecture_resolution import PythonArchitectureResolver
from .python_consumer_resolution import PythonConsumerBoundaryResolver
from .python_framework_adapters import PythonFrameworkAdapters
from .redux_extended_resolution import ReduxExtendedResolver
from .semantic_integrity import SemanticIntegrityFinalizer
from .semantic_ir import SemanticEdgeFact, SemanticNodeFact
from .sensitive_lineage_gate import SensitiveLineageGate
from .source_roles import (
    exclude_test_sources_from_semantic_program,
    is_test_source_path,
)
from .validator import validate_program_graph
from .vocabulary import NODE_TYPES


class ProgramGraphAssembler:
    """Build the whole statically resolvable repository graph before LLM investigation."""

    def assemble(
        self,
        *,
        scan_job_id: str,
        snapshot_id: str,
        commit_sha: str,
        workspace_path: Path,
        package_dependencies: Iterable[object] = (),
        technical_findings: Iterable[object] = (),
        structural_facts: Iterable[object] = (),
        coverage_notes: Iterable[str] = (),
        include_files: Iterable[str] | None = None,
        config_hash: str = "",
    ):
        program = RepositorySemanticExtractor(workspace_path).extract(
            include_files=include_files
        )
        program.extend(FrameworkBoundaryExtractor(workspace_path).extract())

        # Framework identities are continuation boundaries, never silent endpoints.
        # Resolve known framework families first, then run a conservative literal-key
        # registration/dispatch fallback for custom libraries and other languages.
        FrameworkBoundaryResolver(workspace_path).enrich(program)
        PythonConsumerBoundaryResolver(workspace_path).enrich(program)
        PythonArchitectureResolver(workspace_path).enrich(program)
        PythonFrameworkAdapters(workspace_path).enrich(program)
        JavaScriptArchitectureResolver(workspace_path).enrich(program)
        ReduxExtendedResolver(workspace_path).enrich(program)
        ManagedArchitectureResolver(workspace_path).enrich(program)
        GenericDispatchResolver(workspace_path).enrich(program)
        normalize_framework_binding_metadata(program)

        # P0 semantic boundary: high-recall provider-name detection is not inference.
        # Normalize executable call semantics before any AI input/output lineage is
        # materialized so false provider/config/redaction calls cannot create derived
        # AI_OUTPUT nodes that later look corroborated to Planner/Investigator.
        AIInvocationSemanticGate().enrich(program)

        # Normalize concrete repository evidence for model ownership/lifecycle before
        # data-lineage enrichment. Dependency presence alone is not a lifecycle stage.
        AILifecycleExtractor(workspace_path).enrich(program)

        # v3 data lineage is built over the already resolved technical IR. It creates
        # first-class DATA_OBJECT identities, preserves payload flow through framework
        # boundaries, materializes AI input/output flow, reads protobuf contracts and
        # derives weak semantic seeds without trusting identifier names as conclusions.
        SemanticDataLineageExtractor(workspace_path).enrich(program)

        # Protocol/API/DB contracts provide stable data identities before implementation
        # variables. Schema field names are weak semantic seeds only; runtime lineage and
        # processing behavior are required before sensitive facts become Planner-material.
        ContractDataLineageExtractor(workspace_path).enrich(program)
        DatabaseSchemaLineageExtractor(workspace_path).enrich(program)
        ContractLineageFlowFinalizer().enrich(program)

        # Promote sensitive semantics only when behavior corroborates the weak seed.
        # A standalone "fingerprint"/"cccd" identifier remains INFERRED, while actual
        # OCR/KYC or biometric representation+matching flow becomes CORROBORATED.
        SensitiveLineageGate(workspace_path).enrich(program)

        # API/protocol declarations are continuation boundaries. Resolve source HTTP,
        # GraphQL and gRPC handlers to concrete symbols or expose explicit uncertainty.
        ApiBoundaryResolver(workspace_path).enrich(program)
        ProtocolBoundaryResolver().enrich(program)

        # Bind lineage-backed business actions to first-class BUSINESS_DECISION nodes.
        # This is a technical influence relation only; legal automation/risk conclusions
        # remain outside the graph and deterministic EngineeringRule evaluator.
        DecisionInfluenceEnricher().enrich(program)

        # Test/spec/fixture sources are not product behavior. Remove them before stable
        # graph IDs and source anchors are built so they cannot pollute rule retrieval,
        # code search, planner materiality, or persisted classification evidence. The
        # post-filter framework finalizer runs inside this policy boundary.
        exclude_test_sources_from_semantic_program(program)

        program.add_node(
            SemanticNodeFact("repository", "REPOSITORY", f"snapshot:{snapshot_id}")
        )
        for node in list(program.nodes):
            if node.node_type == "FILE":
                program.add_edge(SemanticEdgeFact("CONTAINS", "repository", node.key))

        dependencies = list(package_dependencies)
        dependency_keys: dict[str, str] = {}
        for dependency in dependencies:
            name = str(getattr(dependency, "name", "") or "").strip()
            if not name:
                continue
            normalized_name = normalize_package_name(name)
            key = f"dependency:{normalized_name}"
            dependency_keys[normalized_name] = key
            usage_facts = list(getattr(dependency, "usage_facts", []) or [])
            usage_states = sorted(
                {
                    str(getattr(fact, "usage_state", "") or "")
                    for fact in usage_facts
                    if getattr(fact, "usage_state", None)
                }
            )
            attrs = {
                "ecosystem": str(getattr(dependency, "ecosystem", "") or ""),
                "version": str(getattr(dependency, "version", "") or ""),
                "usageStates": usage_states,
                "licenseExpression": str(
                    getattr(dependency, "license_expression", "") or ""
                ),
                "aiRelevant": bool(getattr(dependency, "is_ai_relevant", False)),
            }
            program.add_node(
                SemanticNodeFact(
                    key,
                    "PACKAGE_DEPENDENCY",
                    name,
                    attributes={
                        attr_key: value
                        for attr_key, value in attrs.items()
                        if value not in ("", [], False)
                    },
                )
            )
            program.add_edge(SemanticEdgeFact("DEPENDS_ON", "repository", key))
            for fact in usage_facts:
                for file_ref in getattr(fact, "file_refs", []) or []:
                    normalized_ref = str(file_ref).replace("\\", "/")
                    if normalized_ref and not is_test_source_path(normalized_ref):
                        program.add_edge(
                            SemanticEdgeFact(
                                "SUPPORTED_BY",
                                key,
                                f"file:{normalized_ref}",
                            )
                        )

        # Connect language-level import package nodes to normalized dependency inventory.
        for node in list(program.nodes):
            if node.node_type != "PACKAGE":
                continue
            package_root = (
                node.label.split("/")[0]
                if not node.label.startswith("@")
                else "/".join(node.label.split("/")[:2])
            )
            normalized = normalize_package_name(package_root)
            dependency_key = dependency_keys.get(normalized)
            if dependency_key:
                program.add_edge(
                    SemanticEdgeFact("CORROBORATES", node.key, dependency_key)
                )

        # Basic-language tree-sitter structure remains additive evidence instead of a
        # discarded side channel, but test-only structure must never become product evidence.
        for fact in structural_facts:
            path = str(getattr(fact, "file_path", "") or "").replace("\\", "/")
            if path and is_test_source_path(path):
                continue
            name = str(getattr(fact, "name", "symbol") or "symbol")
            line = int(getattr(fact, "line_number", 1) or 1)
            requested = str(
                getattr(fact, "graph_node_type", "FUNCTION") or "FUNCTION"
            )
            node_type = requested if requested in NODE_TYPES else "FUNCTION"
            key = f"structural:{path}:{node_type}:{name}:{line}"
            attrs = {
                "patternType": str(getattr(fact, "pattern_type", "") or ""),
                "decorators": list(getattr(fact, "decorators", []) or []),
                "async": bool(getattr(fact, "is_async", False)),
                "parseSource": str(getattr(fact, "parse_source", "") or ""),
            }
            evidence = tuple(
                f"evidence:{value}"
                for value in getattr(fact, "ai_finding_ids", []) or []
                if value
            )
            program.add_node(
                SemanticNodeFact(
                    key,
                    node_type,
                    name,
                    path or None,
                    line,
                    line,
                    name,
                    {
                        attr_key: value
                        for attr_key, value in attrs.items()
                        if value not in ("", [], False)
                    },
                    evidence_refs=evidence,
                )
            )
            if path:
                program.add_edge(
                    SemanticEdgeFact(
                        "CONTAINS", f"file:{path}", key, evidence_refs=evidence
                    )
                )

        for finding in technical_findings:
            fid = str(getattr(finding, "finding_id", "") or "")
            path = str(getattr(finding, "file_path", "") or "").replace("\\", "/")
            ftype = str(getattr(finding, "finding_type", "") or "")
            if not fid or not path or is_test_source_path(path):
                continue
            line = int(getattr(finding, "line_number", 1) or 1)
            key = f"finding:{fid}"
            node_type = (
                "AI_MODEL_INVOCATION"
                if any(value in ftype for value in ("AI", "MODEL", "PROVIDER"))
                else "BUSINESS_ACTION"
            )
            evidence = (f"evidence:{fid}",)
            program.add_node(
                SemanticNodeFact(
                    key,
                    node_type,
                    ftype,
                    path,
                    line,
                    line,
                    attributes={"findingType": ftype},
                    evidence_refs=evidence,
                )
            )
            program.add_edge(
                SemanticEdgeFact(
                    "CONTAINS", f"file:{path}", key, evidence_refs=evidence
                )
            )

        # Apply the same semantic contract to additive analyzer findings. This second
        # pass cannot create AI lineage (lineage is already complete); it prevents broad
        # legacy finding categories from persisting under AI_MODEL_INVOCATION identity.
        AIInvocationSemanticGate().enrich(program)

        # High-recall extractors and legacy technical findings may use broad lexical
        # categories. Normalize them only after every additive evidence source has been
        # attached, so weak provider/config/action vocabulary cannot become trusted
        # AI inference or business-decision semantics in the persisted graph.
        SemanticIntegrityFinalizer().enrich(program)

        builder = ProgramGraphBuilder(
            workspace_path,
            scan_job_id=scan_job_id,
            snapshot_id=snapshot_id,
            commit_sha=commit_sha,
            config_hash=config_hash,
        )
        builder.add_program(program)
        for note in coverage_notes:
            builder.add_coverage_note(str(note))
        return validate_program_graph(builder.build())
