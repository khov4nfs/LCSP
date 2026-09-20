"""Bounded, non-executing Ruby syntax and evidence extraction."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from tree_sitter import Language, Parser
import tree_sitter_ruby

from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)
from tools.common.capabilities.evidence.scanner.dependencies.dependency_fact import (
    DependencyUsageFact,
    PackageDependency,
    USAGE_DECLARED,
    is_ai_package,
)


_AI_GEMS = {"ruby-openai": "OpenAI", "openai": "OpenAI", "anthropic": "Anthropic"}
_DYNAMIC_CALLS = {"send", "public_send", "method", "method_missing", "define_method"}


@dataclass(frozen=True)
class RubyFinding:
    finding_id: str
    finding_type: str
    confidence: float
    evidence: list[dict]
    file_path: str
    line_number: int
    analysis_level: str = "L1"


@dataclass(frozen=True)
class RubyAnalysisResult:
    files_analyzed: int
    files_skipped: int
    semantic_program: SemanticProgram
    package_dependencies: tuple[PackageDependency, ...] = ()
    findings: tuple[RubyFinding, ...] = ()
    coverage_limitations: tuple[str, ...] = ()
    unsupported_dynamic_flows: tuple[dict, ...] = ()


class RubyAnalyzer:
    """Analyze Ruby syntax using Tree-sitter; repository code is never executed."""

    def __init__(self, workspace: str | Path) -> None:
        self._workspace = Path(workspace)
        self._parser = Parser(Language(tree_sitter_ruby.language()))

    def analyze(self, include_files: Iterable[str] | None = None) -> RubyAnalysisResult:
        files = self._files(include_files)
        program = SemanticProgram()
        dependencies: list[PackageDependency] = []
        findings: list[RubyFinding] = []
        limitations: list[str] = []
        dynamic_flows: list[dict] = []
        dependencies.extend(self._manifest_dependencies(files))
        analyzed = 0
        skipped = 0
        for relative in files:
            path = self._workspace / relative
            try:
                source = path.read_bytes()
            except (OSError, UnicodeError):
                skipped += 1
                limitations.append(f"ruby_read_failed: file={relative}")
                continue
            tree = self._parser.parse(source)
            if tree.root_node.has_error:
                limitations.append(f"ruby_parse_partial: file={relative}")
            analyzed += 1
            self._extract_file(
                relative,
                source,
                tree.root_node,
                program,
                dependencies,
                findings,
                dynamic_flows,
            )
        return RubyAnalysisResult(
            files_analyzed=analyzed,
            files_skipped=skipped,
            semantic_program=self._dedupe_program(program),
            package_dependencies=tuple(self._dedupe_dependencies(dependencies)),
            findings=tuple(findings),
            coverage_limitations=tuple(sorted(set(limitations))),
            unsupported_dynamic_flows=tuple(
                dict(item)
                for item in {
                    (item["file"], item["line"], item["reason"]): item
                    for item in dynamic_flows
                }.values()
            ),
        )

    def _files(self, include_files: Iterable[str] | None) -> list[str]:
        if include_files is not None:
            return sorted({str(value).replace("\\", "/") for value in include_files})
        return sorted(
            path.relative_to(self._workspace).as_posix()
            for path in self._workspace.rglob("*.rb")
            if path.is_file()
            and not any(part in {".git", "vendor", "tmp", "coverage", "build"} for part in path.parts)
        )

    def _manifest_dependencies(self, files: list[str]) -> list[PackageDependency]:
        roots = {self._workspace / relative for relative in files}
        manifests: set[Path] = set()
        for path in roots:
            for parent in (path.parent, *path.parents):
                for name in ("Gemfile",):
                    candidate = parent / name
                    if candidate.is_file():
                        manifests.add(candidate)
                if parent == self._workspace:
                    break
        values: list[PackageDependency] = []
        pattern = re.compile(r"^\s*gem\s+['\"]([^'\"]+)['\"](?:\s*,\s*['\"]([^'\"]+)['\"])?")
        for manifest in sorted(manifests):
            relative_manifest = manifest.relative_to(self._workspace).as_posix()
            try:
                lines = manifest.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeError):
                continue
            for line in lines:
                match = pattern.match(line)
                if not match:
                    continue
                name, version = match.groups()
                values.append(
                    PackageDependency(
                        name,
                        version,
                        "rubygems",
                        None,
                        [DependencyUsageFact(name, version, "rubygems", USAGE_DECLARED, "ruby_manifest", [relative_manifest])],
                        0.0,
                        is_ai_package(name) or name.lower() in _AI_GEMS,
                    )
                )
        return values

    def _extract_file(
        self,
        relative: str,
        source: bytes,
        root,
        program: SemanticProgram,
        dependencies: list[PackageDependency],
        findings: list[RubyFinding],
        dynamic_flows: list[dict],
    ) -> None:
        stack: list[tuple[str, str]] = []

        def visit(node) -> None:
            if node.type in {"module", "class", "method", "singleton_method"}:
                symbol = self._symbol_name(node, source, stack)
                if symbol:
                    node_type = {
                        "module": "MODULE",
                        "class": "CLASS",
                        "method": "METHOD",
                        "singleton_method": "METHOD",
                    }[node.type]
                    key = f"ruby:{relative}:{node_type}:{symbol}"
                    program.add_node(
                        SemanticNodeFact(
                            key=key,
                            node_type=node_type,
                            label=symbol,
                            file_path=relative,
                            start_line=node.start_point[0] + 1,
                            end_line=node.end_point[0] + 1,
                            symbol_ref=symbol,
                            attributes={"language": "ruby"},
                        )
                    )
                    if stack:
                        parent_key = f"ruby:{relative}:TYPE:{'::'.join(stack)}"
                        program.add_edge(SemanticEdgeFact("DECLARES", parent_key, key))
                    if node.type in {"module", "class"}:
                        stack.append(symbol)
                    else:
                        self._visit_calls(
                            node,
                            relative,
                            source,
                            key,
                            program,
                            findings,
                            dynamic_flows,
                        )
                    for child in node.children:
                        visit(child)
                    if node.type in {"module", "class"}:
                        stack.pop()
                    return
            if node.type == "call":
                self._handle_top_level_call(node, relative, source, program, dependencies, findings, dynamic_flows)
            for child in node.children:
                visit(child)

        visit(root)

    def _symbol_name(self, node, source: bytes, stack: list[str]) -> str | None:
        text = node.text.decode("utf-8", errors="replace")
        if node.type == "module" or node.type == "class":
            match = re.search(r"\b(?:module|class)\s+([A-Z][\w:]*)", text)
            return match.group(1) if match else None
        if node.type == "method":
            match = re.search(r"\bdef\s+([\w!?=]+)", text)
            return "::".join([*stack, f"#{match.group(1)}"]) if match else None
        match = re.search(r"\bdef\s+self\.([\w!?=]+)", text)
        return "::".join([*stack, f".{match.group(1)}"]) if match else None

    def _visit_calls(self, node, relative, source, owner, program, findings, dynamic_flows) -> None:
        for child in node.children:
            if child.type == "call":
                self._emit_call(child, relative, source, owner, program, findings, dynamic_flows)
            self._visit_calls(child, relative, source, owner, program, findings, dynamic_flows)

    def _handle_top_level_call(self, node, relative, source, program, dependencies, findings, dynamic_flows) -> None:
        function = self._call_name(node, source)
        if function in {"require", "require_relative"}:
            value = self._first_string_argument(node, source)
            if value:
                key = f"ruby:require:{relative}:{node.start_point[0] + 1}:{value}"
                program.add_node(SemanticNodeFact(key, "PACKAGE", value, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"requireType": function}))
                dependencies.append(PackageDependency(value, None, "rubygems", None, [DependencyUsageFact(value, None, "rubygems", USAGE_DECLARED, "ruby_ast", [relative])], 0.0, is_ai_package(value)))
            else:
                dynamic_flows.append(
                    {
                        "file": relative,
                        "line": node.start_point[0] + 1,
                        "reason": f"dynamic Ruby {function}",
                    }
                )
            return
        self._emit_call(node, relative, source, "ruby:module:" + relative, program, findings, dynamic_flows)

    def _emit_call(self, node, relative, source, owner, program, findings, dynamic_flows) -> None:
        name = self._call_name(node, source) or "unknown"
        line = node.start_point[0] + 1
        key = f"ruby:call:{relative}:{line}:{name}"
        dynamic = name in _DYNAMIC_CALLS
        call_text = node.text.decode("utf-8", errors="replace")
        model_match = re.search(r"\bmodel\s*:\s*['\"]([^'\"]+)['\"]", call_text)
        attributes = {"language": "ruby", "callee": name}
        if model_match:
            attributes["model"] = model_match.group(1)
        program.add_node(SemanticNodeFact(key, "CALL_SITE", name, relative, line, node.end_point[0] + 1, attributes=attributes, coverage_state="LIMITED" if dynamic else "SUFFICIENT", resolution_state="UNRESOLVED" if dynamic else "OBSERVED"))
        program.add_edge(SemanticEdgeFact("CALLS", owner, key, coverage_state="LIMITED" if dynamic else "SUFFICIENT", resolution_state="UNRESOLVED" if dynamic else "OBSERVED"))
        if dynamic:
            dynamic_flows.append({"file": relative, "line": line, "reason": f"dynamic Ruby dispatch: {name}"})
        if self._looks_like_ai_call(node, source):
            finding_id = hashlib.sha256(f"ruby:{relative}:{line}:{name}".encode()).hexdigest()[:16]
            evidence = [{"file": relative, "line": line, "call": name}]
            if model_match:
                evidence[0]["model"] = model_match.group(1)
            findings.append(RubyFinding(finding_id, "AI_MODEL_INVOCATION", 0.9, evidence, relative, line))

    def _call_name(self, node, source: bytes) -> str | None:
        text = node.text.decode("utf-8", errors="replace")
        match = re.match(r"\s*([\w:.!?=]+)", text)
        return match.group(1) if match else None

    def _first_string_argument(self, node, source: bytes) -> str | None:
        for descendant in self._descendants(node):
            if descendant.type == "string_content":
                return descendant.text.decode("utf-8", errors="replace")
        return None

    def _looks_like_ai_call(self, node, source: bytes) -> bool:
        text = node.text.decode("utf-8", errors="replace").lower()
        source_text = source.decode("utf-8", errors="replace").lower()
        provider = any(
            token in text or token in source_text
            for token in ("openai", "anthropic", "gemini", "bedrock")
        )
        operation = any(
            token in text
            for token in ("chat", "completions", "messages.create", "generate_content", "complete")
        )
        return provider and operation

    def _descendants(self, node):
        for child in node.children:
            yield child
            yield from self._descendants(child)

    @staticmethod
    def _dedupe_dependencies(values: list[PackageDependency]) -> list[PackageDependency]:
        result: list[PackageDependency] = []
        seen: set[str] = set()
        for value in values:
            if value.name in seen:
                continue
            seen.add(value.name)
            result.append(value)
        return sorted(result, key=lambda item: item.name)

    @staticmethod
    def _dedupe_program(program: SemanticProgram) -> SemanticProgram:
        result = SemanticProgram()
        seen_nodes: set[str] = set()
        seen_edges: set[tuple[str, str, str]] = set()
        for node in program.nodes:
            if node.key not in seen_nodes:
                seen_nodes.add(node.key)
                result.add_node(node)
        for edge in program.edges:
            key = (edge.edge_type, edge.source_key, edge.target_key)
            if key not in seen_edges:
                seen_edges.add(key)
                result.add_edge(edge)
        result.coverage_notes = sorted(set(program.coverage_notes))
        result.unresolved_frontiers = sorted(set(program.unresolved_frontiers))
        return result
