"""Bounded, non-executing Java/Kotlin syntax and build metadata analysis."""
from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tree_sitter import Language, Parser
import tree_sitter_java
import tree_sitter_kotlin

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.dependencies.dependency_fact import PackageDependency, DependencyUsageFact, USAGE_DECLARED, is_ai_package


@dataclass(frozen=True)
class JvmAnalysisResult:
    language: str
    files_analyzed: int
    files_skipped: int
    semantic_program: SemanticProgram
    package_dependencies: tuple[PackageDependency, ...] = ()
    coverage_limitations: tuple[str, ...] = ()
    unsupported_dynamic_flows: tuple[dict, ...] = ()
    project_references: tuple[str, ...] = ()


class JvmAnalyzer:
    def __init__(self, workspace: str | Path, language: str) -> None:
        self.workspace = Path(workspace)
        self.language = language
        grammar = tree_sitter_java.language() if language == "java" else tree_sitter_kotlin.language()
        self.parser = Parser(Language(grammar))
        self.extension = ".java" if language == "java" else ".kt"

    def analyze(self, include_files: Iterable[str] | None = None) -> JvmAnalysisResult:
        files = self._files(include_files)
        program = SemanticProgram()
        limitations: list[str] = []
        dynamic: list[dict] = []
        analyzed = skipped = 0
        for relative in files:
            try:
                source = (self.workspace / relative).read_bytes()
            except (OSError, UnicodeError):
                skipped += 1
                limitations.append(f"{self.language}_read_failed:file={relative}")
                continue
            tree = self.parser.parse(source)
            analyzed += 1
            if tree.root_node.has_error:
                limitations.append(f"{self.language}_parse_partial:file={relative}")
            self._walk(tree.root_node, relative, program, dynamic)
        deps, refs, metadata_limits = self._metadata(include_files)
        limitations.extend(metadata_limits)
        ai_packages = {dependency.name.lower() for dependency in deps if self._is_ai_dependency(dependency.name)}
        if ai_packages:
            for node in list(program.nodes):
                if node.node_type != "CALL_SITE" or not self._looks_like_ai_call(str(node.attributes.get("callee", ""))):
                    continue
                ai_key = f"ai:{node.key}"
                program.add_node(SemanticNodeFact(ai_key, "AI_MODEL_INVOCATION", node.label, node.file_path, node.start_line, node.end_line, attributes={"provider": self._ai_provider(ai_packages), "sourceCall": node.key}, semantic_types=("AI_MODEL_INVOCATION",)))
                program.add_edge(SemanticEdgeFact("INVOKES_AI", node.key, ai_key))
        return JvmAnalysisResult(self.language, analyzed, skipped, program, tuple(deps), tuple(sorted(set(limitations))), tuple(dynamic), tuple(sorted(set(refs))))

    def _walk(self, root, relative, program, dynamic):
        def visit(node, package="", owner=None):
            text = node.text.decode("utf-8", errors="replace")
            if node.type in {"package_declaration", "package_header"}:
                match = re.search(r"\bpackage\s+([\w.]+)", text)
                package = match.group(1) if match else package
            if node.type in {"import_declaration", "import_header"}:
                match = re.search(r"\bimport\s+([\w.*]+)", text)
                if match:
                    key = self._key(relative, node.start_point[0] + 1, "PACKAGE_DEPENDENCY", match.group(1))
                    program.add_node(SemanticNodeFact(key, "PACKAGE_DEPENDENCY", match.group(1), relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"import": match.group(1)}, semantic_types=("PACKAGE_DEPENDENCY",)))
            declaration = self._declaration(node.type, text)
            if declaration:
                kind, name = declaration
                qualified = ".".join(filter(None, (package, owner, name)))
                key = self._key(relative, node.start_point[0] + 1, kind, qualified)
                attrs = {"language": self.language, "annotations": sorted(set(re.findall(r"@([A-Za-z_]\w*)", text)))}
                program.add_node(SemanticNodeFact(key, kind, qualified, relative, node.start_point[0] + 1, node.end_point[0] + 1, symbol_ref=qualified, attributes=attrs, semantic_types=(kind,)))
                bases = self._bases(text)
                for base in bases:
                    base_key = self._key(relative, node.start_point[0] + 1, "TYPE", base)
                    program.add_node(SemanticNodeFact(base_key, "TYPE", base, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"language": self.language}))
                    program.add_edge(SemanticEdgeFact("IMPLEMENTS" if base.startswith("I") else "EXTENDS", key, base_key))
                owner = qualified
            if node.type in {"method_invocation", "call_expression", "explicit_constructor_invocation", "object_creation_expression"}:
                callee = self._callee(text)
                if callee:
                    key = self._key(relative, node.start_point[0] + 1, "CALL_SITE", callee)
                    program.add_node(SemanticNodeFact(key, "CALL_SITE", callee, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"callee": callee, "resolution": "UNRESOLVED", "language": self.language}, resolution_state="UNRESOLVED"))
                    if any(token in callee for token in ("Class.forName", ".invoke", "Method.invoke", "reflect")):
                        dynamic.append({"file_path": relative, "line_number": node.start_point[0] + 1, "callee": callee})
            for child in node.children:
                visit(child, package, owner)
        visit(root)

    def _metadata(self, include_files):
        manifests = []
        if include_files is None:
            manifests = sorted(set(self.workspace.rglob("pom.xml")) | set(self.workspace.rglob("build.gradle")) | set(self.workspace.rglob("build.gradle.kts")) | set(self.workspace.rglob("settings.gradle")) | set(self.workspace.rglob("settings.gradle.kts")))
        else:
            manifests = sorted(self.workspace / value for value in include_files if Path(value).name in {"pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"})
        deps, refs, limits = [], [], []
        for manifest in manifests:
            if not manifest.is_file():
                continue
            try:
                text = manifest.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                limits.append(f"jvm_manifest_read_failed:file={manifest.name}")
                continue
            if manifest.name == "pom.xml":
                try:
                    root = ET.fromstring(text)
                    for item in root.iter():
                        tag = item.tag.rsplit("}", 1)[-1]
                        if tag == "dependency":
                            group = next((x.text.strip() for x in item if x.tag.rsplit("}", 1)[-1] == "groupId" and x.text), "")
                            artifact = next((x.text.strip() for x in item if x.tag.rsplit("}", 1)[-1] == "artifactId" and x.text), "")
                            version = next((x.text.strip() for x in item if x.tag.rsplit("}", 1)[-1] == "version" and x.text and "${" not in x.text), None)
                            if artifact:
                                name = f"{group}:{artifact}" if group else artifact
                                deps.append(PackageDependency(name, version, "maven", None, [DependencyUsageFact(name, version, "maven", USAGE_DECLARED, "pom.xml", [manifest.name], is_ai_package(name))], 0.0, is_ai_package(name)))
                except ET.ParseError:
                    limits.append(f"jvm_pom_parse_partial:file={manifest.name}")
            else:
                for match in re.finditer(r"(?:implementation|api|compileOnly|runtimeOnly)\s*[(\"]+\s*[\"']([^\"']+)[\"']", text):
                    deps.append(PackageDependency(match.group(1), None, "gradle", None, [DependencyUsageFact(match.group(1), None, "gradle", USAGE_DECLARED, manifest.name, [manifest.name], is_ai_package(match.group(1)))], 0.0, is_ai_package(match.group(1))))
                refs.extend(re.findall(r"project\s*\(\s*[\"'](:[^\"']+)[\"']", text))
        return deps, refs, limits

    def _files(self, include_files):
        if include_files is not None:
            allowed = {".java", ".kt"}
            return tuple(sorted(str(item).replace("\\", "/") for item in include_files if Path(str(item)).suffix.lower() in allowed))
        return tuple(sorted(path.relative_to(self.workspace).as_posix() for path in self.workspace.rglob(f"*{self.extension}") if path.is_file() and not any(part in {"target", "build", ".gradle", "out", ".git", "generated"} for part in path.parts)))

    @staticmethod
    def _declaration(kind, text):
        patterns = {
            "class_declaration": ("CLASS", r"\bclass\s+([A-Za-z_]\w*)"),
            "interface_declaration": ("INTERFACE", r"\binterface\s+([A-Za-z_]\w*)"),
            "enum_declaration": ("TYPE", r"\benum(?:\s+class)?\s+([A-Za-z_]\w*)"),
            "record_declaration": ("TYPE", r"\brecord\s+([A-Za-z_]\w*)"),
            "object_declaration": ("CLASS", r"\bobject\s+([A-Za-z_]\w*)"),
            "function_declaration": ("FUNCTION", r"\bfun\s+([A-Za-z_]\w*)"),
            "method_declaration": ("METHOD", r"(?:[A-Za-z_<>,?\[\].]+\s+)+([A-Za-z_]\w*)\s*\("),
            "constructor_declaration": ("METHOD", r"\b([A-Z][A-Za-z0-9_]*)\s*\("),
        }
        item = patterns.get(kind)
        if not item:
            return None
        match = re.search(item[1], text)
        return (item[0], match.group(1)) if match else None

    @staticmethod
    def _bases(text):
        match = re.search(r"\b(?:extends|implements|:)\s*([^\{]+)", text)
        return tuple(item.strip().split("<", 1)[0] for item in match.group(1).split(",")) if match else ()

    @staticmethod
    def _callee(text):
        match = re.search(r"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(", text)
        return match.group(1) if match else None

    @staticmethod
    def _is_ai_dependency(name):
        value = name.lower()
        return any(token in value for token in ("spring-ai", "langchain4j", "openai", "anthropic", "bedrock", "generativeai", "gemini"))

    @staticmethod
    def _looks_like_ai_call(callee):
        value = callee.lower()
        return any(token in value for token in ("chat", "complete", "embedding", "prompt", "content"))

    @staticmethod
    def _ai_provider(packages):
        value = " ".join(packages)
        if "anthropic" in value: return "Anthropic"
        if "openai" in value: return "OpenAI"
        if "spring-ai" in value: return "Spring AI"
        if "langchain4j" in value: return "LangChain4j"
        if "bedrock" in value: return "AWS Bedrock"
        return "unknown"

    @staticmethod
    def _key(relative, line, kind, value):
        digest = hashlib.sha1(f"{relative}:{kind}:{value}".encode()).hexdigest()[:12]
        return f"jvm:{kind.lower()}:{digest}"
