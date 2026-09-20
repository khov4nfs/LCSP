from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

from tree_sitter import Language, Parser
import tree_sitter_ruby

from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_PARTIAL,
    ANALYZER_SUCCESS,
)
from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)
from .protocol import FrameworkAnalysisResult, FrameworkCapability


class RailsFrameworkDetector:
    name = "rails"

    def detect(self, project, workspace: Path, ruby_result) -> tuple[str, ...]:
        manifests = [workspace / value for value in project.manifest_paths]
        for manifest in manifests:
            if manifest.name == "Gemfile":
                try:
                    text = manifest.read_text(encoding="utf-8")
                except (OSError, UnicodeError):
                    continue
                if re.search(r"^\s*gem\s+['\"]rails['\"]", text, re.MULTILINE):
                    return ("rails",)
        return ()


class RailsFrameworkAdapter:
    framework = "rails"

    def __init__(self) -> None:
        self._parser = Parser(Language(tree_sitter_ruby.language()))

    def supports(self, framework: str) -> bool:
        return framework == self.framework

    def capabilities(self) -> FrameworkCapability:
        return FrameworkCapability(
            routes=True,
            controllers=True,
            persistence_models=True,
            jobs=True,
            callbacks=False,
            dynamic_resolution=False,
        )

    def analyze(self, project, workspace: Path, ruby_result) -> FrameworkAnalysisResult:
        program = SemanticProgram()
        limitations: list[str] = []
        evidence: list[str] = []
        files = self._project_files(project, workspace)
        for relative in files:
            if relative == "config/routes.rb":
                self._routes(relative, workspace / relative, ruby_result, program, limitations, evidence)
            elif "/app/controllers/" in f"/{relative}" or relative.startswith("app/controllers/"):
                self._roles(relative, workspace / relative, ruby_result, program, "CONTROLLER", "ApplicationController", evidence)
            elif "/app/models/" in f"/{relative}" or relative.startswith("app/models/"):
                self._roles(relative, workspace / relative, ruby_result, program, "ENTITY", "ApplicationRecord", evidence)
            elif "/app/jobs/" in f"/{relative}" or relative.startswith("app/jobs/"):
                self._roles(relative, workspace / relative, ruby_result, program, "BACKGROUND_JOB", "ApplicationJob", evidence)
        status = ANALYZER_PARTIAL if limitations else ANALYZER_SUCCESS
        return FrameworkAnalysisResult(
            framework=self.framework,
            project_id=project.project_id,
            status=status,
            capabilities=self.capabilities(),
            semantic_program=program,
            coverage_limitations=tuple(sorted(set(limitations))),
            evidence=tuple(sorted(set(evidence))),
        )

    def _project_files(self, project, workspace: Path) -> list[str]:
        # ``workspace`` is the project-scoped execution unit.  Using it as the
        # enumeration authority avoids silently dropping Rails files when a
        # descriptor carries a repository-relative or empty root marker.
        workspace = workspace.resolve(strict=False)
        root = workspace
        try:
            return sorted(
                relative.as_posix()
                for path in root.rglob("*.rb")
                if path.is_file()
                for relative in (path.relative_to(workspace),)
                if not any(
                    part in {"vendor", "tmp", "coverage", "build", ".git"}
                    for part in relative.parts
                )
            )
        except OSError:
            return []

    def _roles(self, relative, path, ruby_result, program, role, base_class, evidence) -> None:
        try:
            source = path.read_bytes()
        except (OSError, UnicodeError):
            return
        tree = self._parser.parse(source)
        for node in self._descendants(tree.root_node):
            if node.type != "class":
                continue
            text = node.text.decode("utf-8", errors="replace")
            match = re.search(r"\bclass\s+([A-Z][\w:]*)\s*<\s*([A-Z][\w:]*)", text)
            if not match or match.group(2) != base_class:
                continue
            name = match.group(1)
            evidence.append(f"{relative}:{node.start_point[0] + 1}:{role}")
            self._annotate_existing(ruby_result, program, relative, name, role)

    def _annotate_existing(self, ruby_result, program, relative, name, role) -> None:
        for node in ruby_result.semantic_program.nodes:
            if node.node_type != "CLASS" or node.label.split("::")[-1] != name.split("::")[-1]:
                continue
            if node.file_path != relative:
                continue
            semantic_types = tuple(sorted(set((*node.semantic_types, role))))
            attributes = {**node.attributes, "framework": "rails", "frameworkRole": role}
            program.add_node(replace(node, semantic_types=semantic_types, attributes=attributes))

    def _routes(self, relative, path, ruby_result, program, limitations, evidence) -> None:
        try:
            source = path.read_bytes()
        except (OSError, UnicodeError):
            limitations.append(f"rails_routes_read_failed: file={relative}")
            return
        tree = self._parser.parse(source)
        if tree.root_node.has_error:
            limitations.append(f"rails_routes_parse_partial: file={relative}")
        for node in self._descendants(tree.root_node):
            if node.type != "call":
                continue
            text = node.text.decode("utf-8", errors="replace")
            method = self._call_method(text)
            if method in {"get", "post", "put", "patch", "delete"}:
                path_match = re.search(r"\b(?:get|post|put|patch|delete)\s+['\"]([^'\"]+)", text)
                target_match = re.search(r"to:\s*['\"]([^'\"]+)['\"]", text)
                if not path_match:
                    line = node.start_point[0] + 1
                    limitations.append(f"rails_dynamic_route: file={relative}:{line}")
                    program.unresolved_frontiers.append(f"rails:route:{relative}:{line}:dynamic")
                    continue
                route_path = path_match.group(1)
                target = target_match.group(1) if target_match else None
                self._emit_route(relative, node, method.upper(), route_path, target, ruby_result, program, limitations, evidence)
            elif method == "resources":
                resource = re.search(r"resources\s+:([a-zA-Z_][\w]*)", text)
                if not resource:
                    limitations.append(f"rails_dynamic_resources: file={relative}:{node.start_point[0] + 1}")
                    continue
                # The standard REST expansion is deterministic and source-anchored.
                name = resource.group(1)
                controller = f"{name.title().replace('_', '')}Controller"
                for verb, path_suffix, action in (
                    ("GET", f"/{name}", "index"),
                    ("POST", f"/{name}", "create"),
                    ("GET", f"/{name}/:id", "show"),
                    ("PATCH", f"/{name}/:id", "update"),
                    ("DELETE", f"/{name}/:id", "destroy"),
                ):
                    self._emit_route(relative, node, verb, path_suffix, f"{name}#{action}", ruby_result, program, limitations, evidence, controller)

    def _emit_route(self, relative, node, method, route_path, target, ruby_result, program, limitations, evidence, controller=None) -> None:
        line = node.start_point[0] + 1
        route_key = f"rails:route:{relative}:{line}:{method}:{route_path}"
        program.add_node(SemanticNodeFact(route_key, "HTTP_ROUTE", f"{method} {route_path}", relative, line, node.end_point[0] + 1, attributes={"framework": "rails", "method": method, "route": route_path}, semantic_types=("RAILS_ROUTE",)))
        evidence.append(f"{relative}:{line}:route")
        if not target:
            limitations.append(f"rails_route_handler_unresolved: file={relative}:{line}")
            program.unresolved_frontiers.append(route_key)
            return
        target_controller, action = target.split("#", 1) if "#" in target else (controller or target, None)
        target_controller = controller or f"{target_controller.title().replace('_', '')}Controller"
        handler = next(
            (item for item in ruby_result.semantic_program.nodes if item.file_path and item.label.endswith(f"{target_controller}::#{action}")),
            None,
        ) if action else None
        if handler is None:
            limitations.append(f"rails_route_handler_unresolved: {target}")
            program.unresolved_frontiers.append(route_key)
            return
        program.add_edge(SemanticEdgeFact("HANDLED_BY", route_key, handler.key, attributes={"framework": "rails"}, evidence_refs=(f"evidence:{relative}:{line}",)))

    @staticmethod
    def _call_method(text: str) -> str | None:
        match = re.match(r"\s*([a-zA-Z_][\w]*)", text)
        return match.group(1) if match else None

    @staticmethod
    def _descendants(node):
        for child in node.children:
            yield child
            yield from RailsFrameworkAdapter._descendants(child)
