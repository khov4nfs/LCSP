"""Evidence-bound Python/TS framework adapters.

These adapters deliberately stay small: the language analyzers remain the syntax
authority while framework adapters interpret literal decorators, package metadata,
and route declarations.  Existing architecture resolvers continue to provide the
broader legacy behavior; the adapters add a single registered production boundary
for framework selection and bounded canonical facts.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any

from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)
from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_PARTIAL,
    ANALYZER_SUCCESS,
)
from .protocol import FrameworkAnalysisResult, FrameworkCapability


def _files(project, workspace: Path, extensions: set[str]) -> list[str]:
    root = Path(project.root_path)
    try:
        return sorted(
            path.relative_to(workspace).as_posix()
            for path in root.rglob("*")
            if path.is_file()
            and path.suffix.lower() in extensions
            and not any(part in {"node_modules", "dist", "build", ".next", "coverage", "vendor", ".venv", "__pycache__"} for part in path.parts)
        )
    except OSError:
        return []


def _manifest_text(project, workspace: Path, names: set[str]) -> str:
    for manifest in getattr(project, "manifest_paths", ()):
        path = workspace / str(manifest)
        if path.name in names:
            try:
                return path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return ""
    return ""


def _package_json(project, workspace: Path) -> dict[str, Any]:
    text = _manifest_text(project, workspace, {"package.json"})
    try:
        return json.loads(text) if text else {}
    except json.JSONDecodeError:
        return {}


def _python_evidence(project, workspace: Path) -> str:
    return "\n".join(
        _manifest_text(project, workspace, {"pyproject.toml", "requirements.txt", "requirements-dev.txt", "Pipfile"})
        for _ in (0,)
    )


class _Detector:
    language = ""
    name = ""

    def _has_python(self, project, workspace: Path, needles: tuple[str, ...]) -> bool:
        text = _python_evidence(project, workspace).lower()
        if any(needle.lower() in text for needle in needles):
            return True
        # Source imports are supporting evidence only.  Detection is intentionally
        # manifest/project-bound so a registry pass never rescans a large project.
        return any((Path(project.root_path) / name).is_file() for name in ("manage.py", "settings.py")) and any(
            needle in {"manage.py", "settings.py"} for needle in needles
        )

    def _has_js(self, project, workspace: Path, needles: tuple[str, ...]) -> bool:
        package = _package_json(project, workspace)
        deps = {str(key).lower() for key in [*(package.get("dependencies") or {}), *(package.get("devDependencies") or {})]}
        if any(needle.lower() in deps for needle in needles):
            return True
        return False


class DjangoFrameworkDetector(_Detector):
    name = "django"

    def detect(self, project, workspace, language_result):
        return ("django",) if self._has_python(project, workspace, ("django", "manage.py", "django.urls")) else ()


class FlaskFrameworkDetector(_Detector):
    name = "flask"

    def detect(self, project, workspace, language_result):
        return ("flask",) if self._has_python(project, workspace, ("flask", "from flask", "import flask")) else ()


class FastApiFrameworkDetector(_Detector):
    name = "fastapi"

    def detect(self, project, workspace, language_result):
        return ("fastapi",) if self._has_python(project, workspace, ("fastapi", "from fastapi")) else ()


class _PackageDetector(_Detector):
    package_names: tuple[str, ...] = ()

    def detect(self, project, workspace, language_result):
        return (self.name,) if self._has_js(project, workspace, self.package_names) else ()


class ExpressFrameworkDetector(_PackageDetector):
    name, package_names = "express", ("express",)


class NestJsFrameworkDetector(_PackageDetector):
    name, package_names = "nestjs", ("@nestjs/core", "@nestjs/common")


class ReactFrameworkDetector(_PackageDetector):
    name, package_names = "react", ("react",)


class NextJsFrameworkDetector(_PackageDetector):
    name, package_names = "nextjs", ("next",)


class VueFrameworkDetector(_PackageDetector):
    name, package_names = "vue", ("vue",)


class NuxtFrameworkDetector(_PackageDetector):
    name, package_names = "nuxt", ("nuxt", "nuxt3")


class AngularFrameworkDetector(_PackageDetector):
    name, package_names = "angular", ("@angular/core",)


class SvelteFrameworkDetector(_PackageDetector):
    name, package_names = "svelte", ("svelte",)


class SvelteKitFrameworkDetector(_PackageDetector):
    name, package_names = "sveltekit", ("@sveltejs/kit",)


class ElectronFrameworkDetector(_PackageDetector):
    name, package_names = "electron", ("electron",)


class _PythonTsAdapter:
    framework = ""
    extensions: set[str] = set()

    def supports(self, framework: str) -> bool:
        return framework == self.framework

    def capabilities(self) -> FrameworkCapability:
        return FrameworkCapability(routes=True, controllers=True, persistence_models=False, jobs=False, dynamic_resolution=False)

    def analyze(self, project, workspace: Path, language_result: Any) -> FrameworkAnalysisResult:
        program = SemanticProgram()
        limitations: list[str] = []
        for relative in _files(project, workspace, self.extensions):
            try:
                source = (workspace / relative).read_text(encoding="utf-8", errors="replace")
            except OSError:
                limitations.append(f"{self.framework}_read_failed:file={relative}")
                continue
            if self.extensions == {".py"}:
                self._python(relative, source, program, limitations)
            else:
                self._javascript(relative, source, program, limitations)
        return FrameworkAnalysisResult(
            self.framework,
            project.project_id,
            ANALYZER_PARTIAL if limitations else ANALYZER_SUCCESS,
            self.capabilities(),
            program,
            tuple(sorted(set(limitations))),
        )

    def _python(self, relative: str, source: str, program: SemanticProgram, limitations: list[str]) -> None:
        try:
            tree = ast.parse(source, filename=relative)
        except SyntaxError:
            limitations.append(f"{self.framework}_parse_partial:file={relative}")
            return
        functions = {node.name: node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Call, ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in node.decorator_list:
                    text = ast.unparse(decorator) if hasattr(ast, "unparse") else ""
                    match = re.search(r"\b(?:get|post|put|patch|delete|route|path)\s*\(\s*['\"]([^'\"]+)", text)
                    if match:
                        method = "GET" if ".get" in text or text.startswith("get") else "POST" if ".post" in text else "GET"
                        self._route(relative, node.lineno, method, match.group(1), node.name, program)
                continue
            call = ast.unparse(node.func) if hasattr(ast, "unparse") else ""
            if call.endswith(".path") and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                self._route(relative, node.lineno, "GET", node.args[0].value, None, program)

    def _javascript(self, relative: str, source: str, program: SemanticProgram, limitations: list[str]) -> None:
        route_re = re.compile(r"\b(?:app|router|server)\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*([A-Za-z_$][\w$]*)", re.I)
        for match in route_re.finditer(source):
            self._route(relative, source[: match.start()].count("\n") + 1, match.group(1).upper(), match.group(2), match.group(3), program)
        if self.framework == "nestjs":
            for match in re.finditer(r"@(Get|Post|Put|Patch|Delete)\s*\(\s*['\"]?([^'\")\s]*)", source):
                self._route(relative, source[: match.start()].count("\n") + 1, match.group(1).upper(), match.group(2), None, program)

    def _route(self, relative: str, line: int, method: str, path: str, handler: str | None, program: SemanticProgram) -> None:
        route_key = f"http-route:{method}:{path}"
        program.add_node(SemanticNodeFact(route_key, "HTTP_ROUTE", f"{method} {path}", relative, line, line, attributes={"method": method, "route": path, "framework": self.framework}))
        if handler:
            target = f"symbol:{relative}:{handler}"
            program.add_node(SemanticNodeFact(target, "FUNCTION", handler, relative, line, line))
            program.add_edge(SemanticEdgeFact("HANDLED_BY", route_key, target, attributes={"framework": self.framework}))


class DjangoFrameworkAdapter(_PythonTsAdapter):
    framework, extensions = "django", {".py"}
    def capabilities(self): return FrameworkCapability(routes=True, controllers=True, persistence_models=True, jobs=True)


class FlaskFrameworkAdapter(_PythonTsAdapter):
    framework, extensions = "flask", {".py"}


class FastApiFrameworkAdapter(_PythonTsAdapter):
    framework, extensions = "fastapi", {".py"}


class ExpressFrameworkAdapter(_PythonTsAdapter):
    framework, extensions = "express", {".js", ".ts", ".jsx", ".tsx"}


class NestJsFrameworkAdapter(_PythonTsAdapter):
    framework, extensions = "nestjs", {".js", ".ts", ".jsx", ".tsx"}
    def capabilities(self): return FrameworkCapability(routes=True, controllers=True, jobs=True)


class _FrontendAdapter(_PythonTsAdapter):
    def _javascript(self, relative: str, source: str, program: SemanticProgram, limitations: list[str]) -> None:
        route_pattern = re.compile(r"(?:<Route\s+path\s*=|path\s*:)\s*['\"]([^'\"]+)['\"](?P<tail>[^\n]*)", re.MULTILINE)
        for match in route_pattern.finditer(source):
            path = match.group(1)
            target_match = re.search(r"(?:element|component)\s*=\s*\{?<?([A-Z][\w$]*)", match.group("tail"))
            target = target_match.group(1) if target_match else None
            if self.framework in {"nextjs", "nuxt", "sveltekit"} and (
                "/api/" in f"/{relative}" or "/server/" in f"/{relative}"
            ):
                route_key = f"http-route:GET:{path}"
                program.add_node(SemanticNodeFact(route_key, "HTTP_ROUTE", f"GET {path}", relative, source[: match.start()].count("\n") + 1, attributes={"method": "GET", "route": path, "framework": self.framework}))
                continue
            route_key = f"ui-route:{self.framework}:{relative}:{path}"
            program.add_node(SemanticNodeFact(route_key, "FUNCTION", path, relative, source[: match.start()].count("\n") + 1, attributes={"framework": self.framework, "uiRoute": path, "role": "PAGE"}))
            if target:
                target_key = f"symbol:{relative}:{target}"
                program.add_node(SemanticNodeFact(target_key, "FUNCTION", target, relative, source[: match.start()].count("\n") + 1, semantic_types=("UI_PAGE",)))
                program.add_edge(SemanticEdgeFact("NAVIGATES_TO", route_key, target_key, attributes={"framework": self.framework}))


class ReactFrameworkAdapter(_FrontendAdapter): framework, extensions = "react", {".js", ".jsx", ".ts", ".tsx"}
class NextJsFrameworkAdapter(_FrontendAdapter): framework, extensions = "nextjs", {".js", ".jsx", ".ts", ".tsx"}
class VueFrameworkAdapter(_FrontendAdapter): framework, extensions = "vue", {".js", ".ts", ".vue"}
class NuxtFrameworkAdapter(_FrontendAdapter): framework, extensions = "nuxt", {".js", ".ts", ".vue"}
class AngularFrameworkAdapter(_FrontendAdapter): framework, extensions = "angular", {".ts", ".html"}
class SvelteFrameworkAdapter(_FrontendAdapter): framework, extensions = "svelte", {".js", ".ts", ".svelte"}
class SvelteKitFrameworkAdapter(_FrontendAdapter): framework, extensions = "sveltekit", {".js", ".ts", ".svelte"}


class ElectronFrameworkAdapter(_PythonTsAdapter):
    framework, extensions = "electron", {".js", ".ts", ".jsx", ".tsx"}
    def capabilities(self): return FrameworkCapability(routes=False, controllers=False, jobs=True, dynamic_resolution=False)
