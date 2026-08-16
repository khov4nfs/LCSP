"""Repository-wide Program Evidence Graph orchestration."""
from __future__ import annotations
from pathlib import Path
from typing import Iterable
from lcsp_workers.scanner.dependencies.dependency_fact import normalize_package_name
from .builder import ProgramGraphBuilder
from .extractor import RepositorySemanticExtractor
from .framework_links import FrameworkBoundaryExtractor
from .semantic_ir import SemanticEdgeFact, SemanticNodeFact
from .validator import validate_program_graph
from .vocabulary import NODE_TYPES

class ProgramGraphAssembler:
    """Build the whole statically resolvable repository graph before LLM investigation."""
    def assemble(self, *, scan_job_id: str, snapshot_id: str, commit_sha: str, workspace_path: Path, package_dependencies: Iterable[object] = (), technical_findings: Iterable[object] = (), structural_facts: Iterable[object] = (), coverage_notes: Iterable[str] = (), include_files: Iterable[str] | None = None, config_hash: str = ""):
        program = RepositorySemanticExtractor(workspace_path).extract(include_files=include_files)
        program.extend(FrameworkBoundaryExtractor(workspace_path).extract())
        program.add_node(SemanticNodeFact("repository", "REPOSITORY", f"snapshot:{snapshot_id}"))
        for node in list(program.nodes):
            if node.node_type == "FILE": program.add_edge(SemanticEdgeFact("CONTAINS", "repository", node.key))
        dependencies = list(package_dependencies)
        dependency_keys: dict[str, str] = {}
        for dependency in dependencies:
            name = str(getattr(dependency, "name", "") or "").strip()
            if not name: continue
            key = f"dependency:{normalize_package_name(name)}"; dependency_keys[normalize_package_name(name)] = key
            usage_facts = list(getattr(dependency, "usage_facts", []) or []); usage_states = sorted({str(getattr(fact, "usage_state", "") or "") for fact in usage_facts if getattr(fact, "usage_state", None)})
            attrs = {"ecosystem": str(getattr(dependency, "ecosystem", "") or ""), "version": str(getattr(dependency, "version", "") or ""), "usageStates": usage_states, "licenseExpression": str(getattr(dependency, "license_expression", "") or ""), "aiRelevant": bool(getattr(dependency, "is_ai_relevant", False))}
            program.add_node(SemanticNodeFact(key, "PACKAGE_DEPENDENCY", name, attributes={k: v for k, v in attrs.items() if v not in ("", [], False)})); program.add_edge(SemanticEdgeFact("DEPENDS_ON", "repository", key))
            for fact in usage_facts:
                for file_ref in getattr(fact, "file_refs", []) or []:
                    if file_ref: program.add_edge(SemanticEdgeFact("SUPPORTED_BY", key, f"file:{str(file_ref).replace(chr(92), '/')}"))
        # Connect language-level import package nodes to normalized dependency inventory.
        for node in list(program.nodes):
            if node.node_type != "PACKAGE": continue
            normalized = normalize_package_name(node.label.split("/")[0] if not node.label.startswith("@") else "/".join(node.label.split("/")[:2]))
            dependency_key = dependency_keys.get(normalized)
            if dependency_key: program.add_edge(SemanticEdgeFact("CORROBORATES", node.key, dependency_key))
        # Basic-language tree-sitter structure remains additive evidence instead of a discarded side channel.
        for fact in structural_facts:
            path = str(getattr(fact, "file_path", "") or "").replace("\\", "/"); name = str(getattr(fact, "name", "symbol") or "symbol"); line = int(getattr(fact, "line_number", 1) or 1); requested = str(getattr(fact, "graph_node_type", "FUNCTION") or "FUNCTION"); node_type = requested if requested in NODE_TYPES else "FUNCTION"; key = f"structural:{path}:{node_type}:{name}:{line}"
            attrs = {"patternType": str(getattr(fact, "pattern_type", "") or ""), "decorators": list(getattr(fact, "decorators", []) or []), "async": bool(getattr(fact, "is_async", False)), "parseSource": str(getattr(fact, "parse_source", "") or "")}
            evidence = tuple(f"evidence:{v}" for v in getattr(fact, "ai_finding_ids", []) or [] if v)
            program.add_node(SemanticNodeFact(key, node_type, name, path or None, line, line, name, {k: v for k, v in attrs.items() if v not in ("", [], False)}, evidence_refs=evidence))
            if path: program.add_edge(SemanticEdgeFact("CONTAINS", f"file:{path}", key, evidence_refs=evidence))
        for finding in technical_findings:
            fid, path, ftype = str(getattr(finding, "finding_id", "") or ""), str(getattr(finding, "file_path", "") or "").replace("\\", "/"), str(getattr(finding, "finding_type", "") or "")
            if not fid or not path: continue
            line = int(getattr(finding, "line_number", 1) or 1); key = f"finding:{fid}"; node_type = "AI_MODEL_INVOCATION" if any(v in ftype for v in ("AI", "MODEL", "PROVIDER")) else "BUSINESS_ACTION"
            program.add_node(SemanticNodeFact(key, node_type, ftype, path, line, line, attributes={"findingType": ftype}, evidence_refs=(f"evidence:{fid}",))); program.add_edge(SemanticEdgeFact("CONTAINS", f"file:{path}", key, evidence_refs=(f"evidence:{fid}",)))
        builder = ProgramGraphBuilder(workspace_path, scan_job_id=scan_job_id, snapshot_id=snapshot_id, commit_sha=commit_sha, config_hash=config_hash); builder.add_program(program)
        for note in coverage_notes: builder.add_coverage_note(str(note))
        return validate_program_graph(builder.build())
