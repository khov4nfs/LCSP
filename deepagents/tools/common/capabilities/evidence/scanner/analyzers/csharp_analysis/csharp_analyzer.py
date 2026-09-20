"""Bounded, non-executing C# syntax and project metadata analysis."""
from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tree_sitter import Language, Parser
import tree_sitter_c_sharp

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


_AI_PACKAGES = {
    "openai": "OpenAI",
    "azure.ai.openai": "Azure OpenAI",
    "microsoft.extensions.ai": "Microsoft.Extensions.AI",
    "microsoft.semantickernel": "Semantic Kernel",
    "awssdk.bedrockruntime": "AWS Bedrock",
    "google.cloud.aiplatform.v1": "Google Vertex AI",
}


@dataclass(frozen=True)
class CSharpAnalysisResult:
    files_analyzed: int
    files_skipped: int
    semantic_program: SemanticProgram
    package_dependencies: tuple[PackageDependency, ...] = ()
    coverage_limitations: tuple[str, ...] = ()
    unsupported_dynamic_flows: tuple[dict, ...] = ()
    project_references: tuple[str, ...] = ()
    target_frameworks: tuple[str, ...] = ()


class CSharpAnalyzer:
    """Analyze C# syntax with Tree-sitter; project code is never executed."""

    def __init__(self, workspace: str | Path) -> None:
        self._workspace = Path(workspace)
        self._parser = Parser(Language(tree_sitter_c_sharp.language()))

    def analyze(self, include_files: Iterable[str] | None = None) -> CSharpAnalysisResult:
        files = self._files(include_files)
        program = SemanticProgram()
        limitations: list[str] = []
        dynamic_flows: list[dict] = []
        dependencies: list[PackageDependency] = []
        project_refs: list[str] = []
        target_frameworks: list[str] = []
        ai_packages: set[str] = set()
        analyzed = 0
        skipped = 0

        for relative in files:
            path = self._workspace / relative
            try:
                source = path.read_bytes()
            except (OSError, UnicodeError):
                skipped += 1
                limitations.append(f"csharp_read_failed: file={relative}")
                continue
            tree = self._parser.parse(source)
            analyzed += 1
            if tree.root_node.has_error:
                limitations.append(f"csharp_parse_partial: file={relative}")
            self._analyze_tree(tree.root_node, relative, program, dynamic_flows, ai_packages)

        for manifest in self._manifest_files(include_files):
            deps, refs, frameworks, manifest_limits = self._project_metadata(manifest)
            dependencies.extend(deps)
            project_refs.extend(refs)
            target_frameworks.extend(frameworks)
            limitations.extend(manifest_limits)
            ai_packages.update(item.name.lower() for item in deps if item.is_ai_relevant)

        if ai_packages:
            for node in list(program.nodes):
                if node.node_type != "CALL_SITE":
                    continue
                text = str(node.attributes.get("callee", ""))
                if not self._looks_like_ai_call(text):
                    continue
                program.add_node(
                    SemanticNodeFact(
                        key=f"ai:{node.key}",
                        node_type="AI_MODEL_INVOCATION",
                        label=text,
                        file_path=node.file_path,
                        start_line=node.start_line,
                        end_line=node.end_line,
                        attributes={"provider": self._provider(ai_packages), "sourceCall": node.key},
                        semantic_types=("AI_MODEL_INVOCATION",),
                    )
                )
                program.add_edge(SemanticEdgeFact("INVOKES_AI", node.key, f"ai:{node.key}"))

        return CSharpAnalysisResult(
            files_analyzed=analyzed,
            files_skipped=skipped,
            semantic_program=program,
            package_dependencies=tuple(sorted(dependencies, key=lambda item: (item.name, item.version or ""))),
            coverage_limitations=tuple(sorted(set(limitations))),
            unsupported_dynamic_flows=tuple(dynamic_flows),
            project_references=tuple(sorted(set(project_refs))),
            target_frameworks=tuple(sorted(set(target_frameworks))),
        )

    def _analyze_tree(self, root, relative, program, dynamic_flows, ai_packages) -> None:
        def visit(node, namespace: str = "", owner: str | None = None) -> None:
            if node.type in {"using_directive"}:
                name = self._using_name(node.text.decode("utf-8", errors="replace"))
                if name:
                    key = f"using:{relative}:{node.start_point[0] + 1}:{name}"
                    program.add_node(SemanticNodeFact(key, "PACKAGE_DEPENDENCY", name, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"using": name}))
                    if any(token in name.lower() for token in ("openai", "semantic.kernel", "extensions.ai", "azure.ai")):
                        ai_packages.add(name.lower())
                return
            if node.type in {"namespace_declaration", "file_scoped_namespace_declaration"}:
                name = self._named_child_text(node, "name") or self._identifier_from_text(node.text.decode("utf-8", errors="replace"))
                next_namespace = "::".join(filter(None, (namespace, name)))
                for child in node.children:
                    visit(child, next_namespace, owner)
                return
            if node.type in {"class_declaration", "interface_declaration", "struct_declaration", "record_declaration", "enum_declaration"}:
                name = self._named_child_text(node, "name") or self._identifier_from_text(node.text.decode("utf-8", errors="replace"))
                if not name:
                    return
                qualified = "::".join(filter(None, (namespace, name)))
                node_type = {"interface_declaration": "INTERFACE", "enum_declaration": "TYPE"}.get(node.type, "CLASS")
                key = self._key(relative, node.start_point[0] + 1, node_type, qualified)
                attrs = {"language": "csharp"}
                text = node.text.decode("utf-8", errors="replace")
                base_match = re.search(r":\s*([^\{]+)", text)
                bases = tuple(item.strip() for item in base_match.group(1).split(",")) if base_match else ()
                if bases:
                    attrs["bases"] = list(bases)
                program.add_node(SemanticNodeFact(key, node_type, qualified, relative, node.start_point[0] + 1, node.end_point[0] + 1, symbol_ref=qualified, attributes=attrs, semantic_types=(node_type,)))
                for base in bases:
                    base_key = f"type:{base}"
                    program.add_node(SemanticNodeFact(base_key, "TYPE", base, attributes={"language": "csharp"}))
                    program.add_edge(SemanticEdgeFact("IMPLEMENTS" if base.startswith("I") else "EXTENDS", key, base_key))
                for child in node.children:
                    visit(child, namespace, qualified)
                return
            if node.type in {"method_declaration", "constructor_declaration", "local_function_statement"}:
                name = self._named_child_text(node, "name") or self._identifier_from_text(node.text.decode("utf-8", errors="replace"))
                if name:
                    qualified = ".".join(filter(None, (owner, name)))
                    key = self._key(relative, node.start_point[0] + 1, "METHOD", qualified)
                    attrs = {"language": "csharp", "async": "async" in node.text.decode("utf-8", errors="replace")}
                    attrs["attributes"] = list(self._attributes(node))
                    program.add_node(SemanticNodeFact(key, "METHOD", qualified, relative, node.start_point[0] + 1, node.end_point[0] + 1, symbol_ref=qualified, attributes=attrs, semantic_types=("METHOD",)))
                for child in node.children:
                    visit(child, namespace, qualified if name else owner)
                return
            if node.type == "property_declaration":
                name = self._named_child_text(node, "name") or self._identifier_from_text(node.text.decode("utf-8", errors="replace"))
                if name:
                    qualified = ".".join(filter(None, (owner, name)))
                    program.add_node(SemanticNodeFact(self._key(relative, node.start_point[0] + 1, "PROPERTY", qualified), "PROPERTY", qualified, relative, node.start_point[0] + 1, node.end_point[0] + 1, symbol_ref=qualified, attributes={"language": "csharp"}))
            if node.type == "attribute":
                name = self._named_child_text(node, "name")
                if name:
                    program.add_node(SemanticNodeFact(self._key(relative, node.start_point[0] + 1, "ATTRIBUTE", name), "CONSTANT", name, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"attribute": name}))
            if node.type == "invocation_expression":
                text = node.text.decode("utf-8", errors="replace")
                callee = text.split("(", 1)[0].strip()
                key = self._key(relative, node.start_point[0] + 1, "CALL_SITE", callee)
                attributes = {"callee": callee, "resolution": "UNRESOLVED"}
                http = re.search(r"\.(GetAsync|PostAsync|PutAsync|DeleteAsync|SendAsync)\s*\(\s*[\"']([^\"']+)", text)
                if http:
                    attributes.update({"integrationType": "HTTP", "method": "GET" if http.group(1) == "GetAsync" else http.group(1).replace("Async", "").upper(), "route": http.group(2)})
                program.add_node(SemanticNodeFact(key, "CALL_SITE", callee, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes=attributes, resolution_state="UNRESOLVED"))
                if any(token in callee for token in (".Invoke", "Activator.", "dynamic")):
                    dynamic_flows.append({"file_path": relative, "line_number": node.start_point[0] + 1, "callee": callee})
            for child in node.children:
                visit(child, namespace, owner)

        visit(root)

    def _files(self, include_files):
        if include_files is not None:
            return tuple(sorted(set(str(item).replace("\\", "/") for item in include_files if str(item).endswith(".cs"))))
        return tuple(sorted(path.relative_to(self._workspace).as_posix() for path in self._workspace.rglob("*.cs") if path.is_file() and not any(part in {"bin", "obj", "generated", ".git"} for part in path.parts)))

    def _manifest_files(self, include_files):
        if include_files is None:
            manifests = set(self._workspace.rglob("*.csproj"))
        else:
            manifests = {self._workspace / item for item in include_files if str(item).endswith(".csproj")}
        return tuple(sorted(path for path in manifests if path.is_file()))

    def _project_metadata(self, manifest):
        deps = []
        refs = []
        frameworks = []
        limitations = []
        try:
            root = ET.fromstring(manifest.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ET.ParseError):
            return (), (), (), (f"csharp_project_metadata_partial: file={manifest.name}",)
        for item in root.iter():
            tag = item.tag.rsplit("}", 1)[-1]
            if tag == "TargetFramework" and item.text:
                frameworks.append(item.text.strip())
            elif tag == "TargetFrameworks" and item.text:
                frameworks.extend(part.strip() for part in item.text.split(";") if part.strip())
            elif tag == "PackageReference":
                name = item.attrib.get("Include")
                if name:
                    version = item.attrib.get("Version")
                    dep = PackageDependency(name, version, "nuget", f"pkg:nuget/{name}@{version}" if version else None, [DependencyUsageFact(name, version, "nuget", USAGE_DECLARED, "csharp-csproj", [manifest.name], is_ai_package(name))], 0.0, is_ai_package(name))
                    deps.append(dep)
            elif tag == "ProjectReference":
                value = item.attrib.get("Include")
                if value:
                    refs.append(value.replace("\\", "/"))
        return tuple(deps), tuple(refs), tuple(frameworks), tuple(limitations)

    @staticmethod
    def _key(relative, line, kind, value):
        digest = hashlib.sha1(f"{relative}:{kind}:{value}".encode()).hexdigest()[:12]
        return f"csharp:{kind.lower()}:{digest}"

    @staticmethod
    def _named_child_text(node, field_name):
        child = node.child_by_field_name(field_name)
        return child.text.decode("utf-8", errors="replace") if child is not None else None

    @staticmethod
    def _identifier_from_text(text):
        match = re.search(r"\b(?:class|interface|struct|record|enum|void|Task(?:<[^>]+>)?|[A-Z][\w<>]*)\s+([A-Za-z_]\w*)", text)
        return match.group(1) if match else None

    @staticmethod
    def _using_name(text):
        match = re.search(r"using\s+(?:[A-Za-z_]\w*\s*=\s*)?([^;]+)", text)
        return match.group(1).strip() if match else None

    @staticmethod
    def _attributes(node):
        return tuple(sorted(set(re.findall(r"\[\s*([A-Za-z_]\w*)", node.text.decode("utf-8", errors="replace")))))

    @staticmethod
    def _looks_like_ai_call(callee):
        return any(token in callee.lower() for token in ("complete", "chat", "embedding", "generatecontent", "getchatresponse", "invokeasync"))

    @staticmethod
    def _provider(packages):
        for package in packages:
            for key, provider in _AI_PACKAGES.items():
                if key in package:
                    return provider
        return "unknown"
