"""Bounded PHP syntax and Composer metadata analysis; never executes PHP."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tree_sitter import Language, Parser
import tree_sitter_php

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.dependencies.dependency_fact import DependencyUsageFact, PackageDependency, USAGE_DECLARED, is_ai_package


@dataclass(frozen=True)
class PhpAnalysisResult:
    files_analyzed: int
    files_skipped: int
    semantic_program: SemanticProgram
    package_dependencies: tuple[PackageDependency, ...] = ()
    coverage_limitations: tuple[str, ...] = ()
    unsupported_dynamic_flows: tuple[dict, ...] = ()


class PhpAnalyzer:
    def __init__(self, workspace: str | Path) -> None:
        self.workspace = Path(workspace)
        self.parser = Parser(Language(tree_sitter_php.language_php()))

    def analyze(self, include_files: Iterable[str] | None = None) -> PhpAnalysisResult:
        files = self._files(include_files)
        program = SemanticProgram(); limitations = []; dynamic = []; analyzed = skipped = 0
        for relative in files:
            try:
                source = (self.workspace / relative).read_bytes()
            except (OSError, UnicodeError):
                skipped += 1; limitations.append(f"php_read_failed:file={relative}"); continue
            tree = self.parser.parse(source); analyzed += 1
            if tree.root_node.has_error: limitations.append(f"php_parse_partial:file={relative}")
            self._walk(tree.root_node, relative, program, dynamic)
        deps, meta_limits = self._composer(include_files); limitations.extend(meta_limits)
        ai_packages = {item.name.lower() for item in deps if self._is_ai_dependency(item.name)}
        if ai_packages:
            for node in list(program.nodes):
                if node.node_type == "CALL_SITE" and self._looks_like_ai_call(str(node.attributes.get("callee", ""))):
                    key = f"ai:{node.key}"
                    program.add_node(SemanticNodeFact(key, "AI_MODEL_INVOCATION", node.label, node.file_path, node.start_line, node.end_line, attributes={"provider": self._provider(ai_packages), "sourceCall": node.key}, semantic_types=("AI_MODEL_INVOCATION",)))
                    program.add_edge(SemanticEdgeFact("INVOKES_AI", node.key, key))
        return PhpAnalysisResult(analyzed, skipped, program, tuple(deps), tuple(sorted(set(limitations))), tuple(dynamic))

    def _walk(self, root, relative, program, dynamic):
        def visit(node, namespace="", owner=None):
            text = node.text.decode("utf-8", errors="replace")
            if node.type == "namespace_definition":
                match = re.search(r"namespace\s+([\\A-Za-z_]\w*)", text); namespace = match.group(1) if match else namespace
            if node.type in {"use_declaration", "namespace_use_declaration"}:
                for name in re.findall(r"(?:use\s+|,\s*)([\\A-Za-z_]\w*(?:\\[A-Za-z_]\w*)*)", text):
                    key = self._key(relative, node.start_point[0] + 1, "PACKAGE_DEPENDENCY", name)
                    program.add_node(SemanticNodeFact(key, "PACKAGE_DEPENDENCY", name, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"import": name}, semantic_types=("PACKAGE_DEPENDENCY",)))
            declaration = self._declaration(node.type, text)
            if declaration:
                kind, name = declaration; qualified = "\\".join(filter(None, (namespace, owner, name)))
                key = self._key(relative, node.start_point[0] + 1, kind, qualified)
                attrs = {"language":"php", "attributes": sorted(set(re.findall(r"#\[\s*([A-Za-z_]\w*)", text)))}
                program.add_node(SemanticNodeFact(key, kind, qualified, relative, node.start_point[0] + 1, node.end_point[0] + 1, symbol_ref=qualified, attributes=attrs, semantic_types=(kind,)))
                bases = self._bases(text)
                for base in bases:
                    base_key = self._key(relative, node.start_point[0] + 1, "TYPE", base)
                    program.add_node(SemanticNodeFact(base_key, "TYPE", base, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"language":"php"}))
                    program.add_edge(SemanticEdgeFact("IMPLEMENTS" if "interface" in text.lower() else "EXTENDS", key, base_key))
                owner = qualified
            if node.type in {"member_call_expression", "scoped_call_expression", "function_call_expression"}:
                callee = self._callee(text)
                if callee:
                    key = self._key(relative, node.start_point[0] + 1, "CALL_SITE", callee)
                    program.add_node(SemanticNodeFact(key, "CALL_SITE", callee, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"callee":callee, "resolution":"UNRESOLVED", "language":"php"}, resolution_state="UNRESOLVED"))
                    if "$" in callee or any(token in callee for token in ("call_user_func", "Reflection", "__call")):
                        dynamic.append({"file_path":relative, "line_number":node.start_point[0]+1, "callee":callee})
            for child in node.children: visit(child, namespace, owner)
        visit(root)

    def _composer(self, include_files):
        paths = [self.workspace / str(item) for item in (include_files or ()) if Path(str(item)).name == "composer.json"]
        if not paths: paths = sorted(self.workspace.rglob("composer.json"))
        deps=[]; limits=[]
        for path in paths:
            try: payload=json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError): limits.append(f"composer_parse_partial:file={path.name}"); continue
            for section in ("require", "require-dev"):
                for name, version in (payload.get(section) or {}).items():
                    if name == "php": continue
                    deps.append(PackageDependency(name, version if isinstance(version,str) and not version.startswith("{") else None, "composer", None, [DependencyUsageFact(name, version if isinstance(version,str) else None, "composer", USAGE_DECLARED, section, [path.name], is_ai_package(name))], 0.0, is_ai_package(name)))
        return deps, limits

    def _files(self, include_files):
        if include_files is not None: return tuple(sorted(str(item).replace("\\", "/") for item in include_files if Path(str(item)).suffix.lower() == ".php"))
        return tuple(sorted(p.relative_to(self.workspace).as_posix() for p in self.workspace.rglob("*.php") if p.is_file() and not any(part in {"vendor","cache","storage","build",".git"} for part in p.parts)))

    @staticmethod
    def _declaration(kind, text):
        patterns={"class_declaration":("CLASS",r"\bclass\s+([A-Za-z_]\w*)"),"interface_declaration":("INTERFACE",r"\binterface\s+([A-Za-z_]\w*)"),"trait_declaration":("CLASS",r"\btrait\s+([A-Za-z_]\w*)"),"enum_declaration":("TYPE",r"\benum\s+([A-Za-z_]\w*)"),"function_definition":("FUNCTION",r"\bfunction\s+([A-Za-z_]\w*)"),"method_declaration":("METHOD",r"function\s+([A-Za-z_]\w*)")}
        item=patterns.get(kind)
        if not item:return None
        match=re.search(item[1],text); return (item[0],match.group(1)) if match else None

    @staticmethod
    def _bases(text):
        match=re.search(r"\bextends\s+([\\A-Za-z_]\w*)|\bimplements\s+([^\{]+)",text)
        if not match:return ()
        return tuple(x.strip() for x in (match.group(1) or match.group(2)).split(","))

    @staticmethod
    def _callee(text):
        match=re.search(r"([\\$A-Za-z_]\w*(?:->|::|\.)?[A-Za-z_]\w*)\s*\(",text); return match.group(1) if match else None

    @staticmethod
    def _key(relative,line,kind,value): return f"php:{kind.lower()}:{hashlib.sha1(f'{relative}:{kind}:{value}'.encode()).hexdigest()[:12]}"
    @staticmethod
    def _is_ai_dependency(name): return any(token in name.lower() for token in ("openai","anthropic","gemini","bedrock","laravel/ai"))
    @staticmethod
    def _looks_like_ai_call(callee): return any(token in callee.lower() for token in ("chat","complete","embedding","generate","prompt"))
    @staticmethod
    def _provider(packages):
        value=" ".join(packages).lower()
        if "anthropic" in value:return "Anthropic"
        if "openai" in value:return "OpenAI"
        if "gemini" in value:return "Google Gemini"
        if "bedrock" in value:return "AWS Bedrock"
        return "unknown"
