"""Bounded, non-executing Swift, Objective-C, and Dart analysis."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

from tree_sitter import Language, Parser
import tree_sitter_dart
import tree_sitter_objc
import tree_sitter_swift

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.dependencies.dependency_fact import DependencyUsageFact, PackageDependency, USAGE_DECLARED


@dataclass(frozen=True)
class MobileAnalysisResult:
    language: str
    files_analyzed: int
    files_skipped: int
    semantic_program: SemanticProgram
    package_dependencies: tuple[PackageDependency, ...] = ()
    coverage_limitations: tuple[str, ...] = ()
    unsupported_dynamic_flows: tuple[dict, ...] = ()


class MobileAnalyzer:
    _EXTENSIONS = {"swift": (".swift",), "objc": (".m", ".mm", ".h"), "dart": (".dart",)}

    def __init__(self, workspace: str | Path, language: str):
        self.workspace = Path(workspace)
        self.language = language
        module = {"swift": tree_sitter_swift, "objc": tree_sitter_objc, "dart": tree_sitter_dart}[language]
        self.parser = Parser(Language(module.language()))

    def analyze(self, include_files: Iterable[str] | None = None) -> MobileAnalysisResult:
        program = SemanticProgram(); limitations: list[str] = []; dynamic: list[dict] = []
        analyzed = skipped = 0
        for relative in self._files(include_files):
            try: source = (self.workspace / relative).read_bytes()
            except (OSError, UnicodeError):
                skipped += 1; limitations.append(f"{self.language}_read_failed:file={relative}"); continue
            tree = self.parser.parse(source); analyzed += 1
            if tree.root_node.has_error: limitations.append(f"{self.language}_parse_partial:file={relative}")
            self._walk(tree.root_node, relative, program, dynamic)
            self._source_evidence(source.decode("utf-8", errors="replace"), relative, program, dynamic)
        deps, metadata_limits = self._metadata(include_files); limitations.extend(metadata_limits)
        return MobileAnalysisResult(self.language, analyzed, skipped, program, tuple(deps), tuple(sorted(set(limitations))), tuple(dynamic))

    def _walk(self, root, relative, program, dynamic):
        def visit(node, owner=None):
            text = node.text.decode("utf-8", errors="replace")
            decl = self._declaration(node.type, text)
            current = owner
            if decl:
                kind, name = decl; qualified = f"{owner}.{name}" if owner else name
                key = self._key(relative, node.start_point[0] + 1, kind, qualified)
                program.add_node(SemanticNodeFact(key, kind, qualified, relative, node.start_point[0] + 1, node.end_point[0] + 1, symbol_ref=qualified, attributes={"language": self.language}, semantic_types=(kind,)))
                current = qualified
            if node.type in {"import_declaration", "import_or_export", "preproc_include"}:
                value = self._import_value(text)
                if value:
                    key = self._key(relative, node.start_point[0] + 1, "PACKAGE_DEPENDENCY", value)
                    program.add_node(SemanticNodeFact(key, "PACKAGE_DEPENDENCY", value, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes={"import": value}, semantic_types=("PACKAGE_DEPENDENCY",)))
            if self._is_call(node.type):
                callee = self._callee(text)
                if callee:
                    attrs = {"callee": callee, "resolution": "UNRESOLVED", "language": self.language}
                    if self._is_http_call(text):
                        attrs.update({"integrationType": "HTTP", "method": "GET"})
                        path = re.search(r"[\"'](/[^\"']*)[\"']", text)
                        if path: attrs.update({"path": path.group(1), "route": path.group(1)})
                    key = self._key(relative, node.start_point[0] + 1, "CALL_SITE", callee)
                    program.add_node(SemanticNodeFact(key, "CALL_SITE", callee, relative, node.start_point[0] + 1, node.end_point[0] + 1, attributes=attrs, resolution_state="UNRESOLVED"))
                    if any(token in callee.lower() for token in ("selector", "perform", "dynamic", "methodchannel")):
                        dynamic.append({"file_path": relative, "line_number": node.start_point[0] + 1, "callee": callee})
            for child in node.children: visit(child, current)
        visit(root)

    def _source_evidence(self, text, relative, program, dynamic):
        lines = text.splitlines()
        patterns = []
        if self.language == "swift":
            patterns = [(r"@main\s*(?:struct|class)\s+(\w+)", "APP_ENTRY", "application"), (r"(?:struct|class)\s+(\w+)\s*:\s*(?:[^\n{]*\bView\b)", "UI_COMPONENT", "view"), (r"(?:struct|class)\s+(\w+)\s*:\s*(?:[^\n{]*\bUIViewController\b)", "UI_COMPONENT", "view_controller")]
        elif self.language == "objc":
            patterns = [(r"@(?:interface|implementation)\s+(\w+)[^{\n]*(?:UIViewController|UIApplicationDelegate)", "UI_COMPONENT", "native_screen")]
        else:
            patterns = [(r"\bvoid\s+main\s*\([^)]*\)[^{]*\{[^}]*\brunApp\s*\(", "APP_ENTRY", "application"), (r"class\s+(\w+)\s+extends\s+(?:StatelessWidget|StatefulWidget)", "UI_COMPONENT", "widget")]
        for pattern, node_type, role in patterns:
            for match in re.finditer(pattern, text, re.S if self.language == "dart" else 0):
                line = text.count("\n", 0, match.start()) + 1; name = match.group(1) if match.lastindex else role
                key = self._key(relative, line, node_type, name)
                existing = next((node for node in program.nodes if node.file_path == relative and node.label == name and node.node_type in {"CLASS", "FUNCTION"}), None)
                if existing is not None:
                    program.nodes[program.nodes.index(existing)] = replace(existing, attributes={**existing.attributes, "mobileRole": role}, semantic_types=tuple(sorted(set((*existing.semantic_types, "MOBILE_ROLE")))))
                elif not any(node.key == key for node in program.nodes):
                    program.add_node(SemanticNodeFact(key, "CLASS" if node_type == "UI_COMPONENT" else "FUNCTION", name, relative, line, line, attributes={"mobileRole": role, "language": self.language}, semantic_types=("MOBILE_ROLE",)))
        nav_patterns = {
            "swift": r"\b(NavigationLink|pushViewController|present)\s*\([^\n]*",
            "objc": r"\b(pushViewController|presentViewController)\s*\([^\n]*",
            "dart": r"\b(Navigator\.push|Navigator\.pushNamed|go_router|routes)\s*[^\n]*",
        }
        for match in re.finditer(nav_patterns[self.language], text):
            line = text.count("\n", 0, match.start()) + 1; target = self._literal_target(match.group(0))
            key = self._key(relative, line, "NAVIGATION", match.group(1))
            program.add_node(SemanticNodeFact(key, "CALL_SITE", match.group(1), relative, line, line, attributes={"navigation": True, "target": target, "resolution": "OBSERVED" if target else "UNRESOLVED", "language": self.language}, resolution_state="OBSERVED" if target else "UNRESOLVED"))
            if not target: dynamic.append({"file_path": relative, "line_number": line, "callee": match.group(1), "reason": "dynamic_navigation"})

    def _metadata(self, include_files):
        names = {Path(str(item)).name for item in (include_files or ())}; paths=[]; limits=[]; deps=[]
        candidates = {"swift": ("Package.swift", "Podfile", "Podfile.lock"), "objc": ("Podfile", "Podfile.lock"), "dart": ("pubspec.yaml",)}[self.language]
        if include_files is None: paths = [self.workspace / name for name in candidates]
        else: paths = [self.workspace / name for name in candidates if name in names]
        for path in paths:
            if not path.is_file(): continue
            try: text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError): limits.append(f"{self.language}_manifest_read_failed:{path.name}"); continue
            if path.name == "pubspec.yaml":
                for name, version in re.findall(r"^\s{2}([A-Za-z0-9_]+):\s*([^#\n]+)", text, re.M):
                    deps.append(self._dependency(name, version.strip(), "pub", path.name))
            elif path.name in {"Podfile", "Podfile.lock"}:
                for name, version in re.findall(r"\bpod\s+[\"']([^\"']+)[\"'](?:\s*,\s*[\"']([^\"']+)[\"'])?", text):
                    deps.append(self._dependency(name, version or None, "cocoapods", path.name))
            elif path.name == "Package.swift":
                for name, version in re.findall(r"\.package\s*\([^\n]*?\b(?:name|url)\s*:\s*[\"']([^\"']+)[\"'][^\n]*?(?:from|exact)\s*:\s*[\"']([^\"']+)", text):
                    deps.append(self._dependency(name, version, "swiftpm", path.name))
        return deps, limits

    @staticmethod
    def _dependency(name, version, ecosystem, manifest):
        usage = DependencyUsageFact(name, version, ecosystem, USAGE_DECLARED, manifest, [manifest], False)
        return PackageDependency(name, version, ecosystem, None, [usage], 0.0, False)

    def _files(self, include):
        extensions = self._EXTENSIONS[self.language]
        if include is not None: return tuple(sorted(str(item).replace("\\", "/") for item in include if Path(str(item)).suffix.lower() in extensions))
        return tuple(sorted(path.relative_to(self.workspace).as_posix() for ext in extensions for path in self.workspace.rglob(f"*{ext}") if path.is_file() and not any(part in path.parts for part in ("Pods", "node_modules", "build", "DerivedData", ".dart_tool", ".git"))))

    def _declaration(self, kind, text):
        patterns = {"swift": {"class_declaration": ("CLASS", r"\b(?:class|struct|enum|actor)\s+(\w+)"), "function_declaration": ("FUNCTION", r"\bfunc\s+(\w+)"), "protocol_declaration": ("INTERFACE", r"\bprotocol\s+(\w+)")}, "objc": {"class_interface": ("CLASS", r"@interface\s+(\w+)"), "class_implementation": ("CLASS", r"@implementation\s+(\w+)"), "protocol_declaration": ("INTERFACE", r"@protocol\s+(\w+)")}, "dart": {"class_definition": ("CLASS", r"\bclass\s+(\w+)"), "mixin_declaration": ("TYPE", r"\bmixin\s+(\w+)"), "enum_declaration": ("TYPE", r"\benum\s+(\w+)"), "function_signature": ("FUNCTION", r"\b(?:\w+\s+)?(\w+)\s*\(")}}.get(self.language, {})
        item = patterns.get(kind)
        if not item: return None
        match = re.search(item[1], text); return (item[0], match.group(1)) if match else None

    @staticmethod
    def _import_value(text):
        match = re.search(r"(?:import|#import|use)\s+(?:[<\"'])([^>\"']+)", text)
        return match.group(1) if match else (re.search(r"import\s+([\w.]+)", text).group(1) if re.search(r"import\s+([\w.]+)", text) else None)

    @staticmethod
    def _is_call(kind): return kind in {"call_expression", "call", "message_expression", "method_invocation", "expression_statement", "function_body"}
    @staticmethod
    def _callee(text):
        match = re.search(r"(?:\[\s*\w+\s+)?([A-Za-z_][\w.]+)\s*\(", text); return match.group(1) if match else None
    @staticmethod
    def _is_http_call(text): return bool(re.search(r"\b(URLSession|URLRequest|http|fetch|HttpClient)\b", text, re.I))
    @staticmethod
    def _literal_target(text):
        match = re.search(r"[\"']([^\"']+)[\"']", text); return match.group(1) if match else None
    @staticmethod
    def _key(relative, line, kind, value): return f"mobile:{kind.lower()}:{hashlib.sha1(json.dumps([relative, line, kind, value], sort_keys=True).encode()).hexdigest()[:12]}"
