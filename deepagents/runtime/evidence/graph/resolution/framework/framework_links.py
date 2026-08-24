"""Static framework-boundary extraction independent of any legal rule.

This pass creates shared route/event/queue/CQRS nodes so control/data navigation does
not stop at framework boundaries. It intentionally uses only statically visible names.
"""
from __future__ import annotations
import re
from pathlib import Path
from .semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from .sensitive_data import safe_external_host

SOURCE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".go", ".cs", ".rs"}
CONFIG_EXTENSIONS = {".json", ".yaml", ".yml", ".toml", ".tf", ".properties", ".ini", ".env", ".conf"}
CONFIG_NAMES = {"dockerfile", "docker-compose.yml", "docker-compose.yaml", "package.json", "pyproject.toml", "requirements.txt", "pom.xml", "build.gradle", "build.gradle.kts", "go.mod", "cargo.toml", "serverless.yml", "serverless.yaml"}
EXCLUDED = {".git", "node_modules", "dist", "build", ".next", "coverage", "vendor", ".venv", "venv", "__pycache__"}

class FrameworkBoundaryExtractor:
    def __init__(self, workspace_path: str | Path) -> None: self.workspace = Path(workspace_path).resolve(strict=False)
    def extract(self) -> SemanticProgram:
        out = SemanticProgram()
        for path in sorted(p for p in self.workspace.rglob("*") if p.is_file()):
            relative = path.relative_to(self.workspace)
            if any(part in EXCLUDED for part in relative.parts): continue
            suffix, name = path.suffix.lower(), path.name.lower()
            if suffix not in SOURCE_EXTENSIONS and suffix not in CONFIG_EXTENSIONS and name not in CONFIG_NAMES and not name.startswith("dockerfile"): continue
            rel = relative.as_posix(); fkey = f"file:{rel}"
            out.add_node(SemanticNodeFact(fkey, "FILE", rel, rel, 1, 1, attributes=self._file_attributes(rel)))
            try: text = path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc: out.coverage_notes.append(f"framework_boundary_read_failed:file={rel}:reason={type(exc).__name__}"); continue
            if suffix in SOURCE_EXTENSIONS: self._source(rel, text, out)
            else: self._config(rel, text, out)
        return out

    def _source(self, rel: str, text: str, out: SemanticProgram) -> None:
        lines = text.splitlines(); controller_prefix = self._controller_prefix(text)
        dynamic_callables = set(re.findall(r"\b([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.]*\s*\[[^\]]+\]", text))
        for line_no, line in enumerate(lines, 1):
            for name in dynamic_callables:
                if re.search(rf"\b{re.escape(name)}\s*\(", line):
                    key = f"dynamic:{rel}:{line_no}:{name}"
                    out.add_node(SemanticNodeFact(key, "UNRESOLVED_DYNAMIC_TARGET", name, rel, line_no, line_no, coverage_state="LIMITED"))
                    out.add_edge(SemanticEdgeFact("CALLS_DYNAMICALLY", f"module:{rel}", key, coverage_state="LIMITED")); out.unresolved_frontiers.append(key)
            route = re.search(r"@(Get|Post|Put|Patch|Delete)\s*\(\s*['\"]([^'\"]*)['\"]", line, re.I)
            py_route = re.search(r"@(?:app|router|blueprint)\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]", line, re.I)
            match = route or py_route
            if match:
                method = match.group(1).upper(); path = self._join_route(controller_prefix, match.group(2)); rkey = self._route_key(method, path); out.add_node(SemanticNodeFact(rkey, "HTTP_ROUTE", f"{method} {path}", attributes={"method": method, "route": path})); out.add_edge(SemanticEdgeFact("HANDLED_BY", rkey, f"module:{rel}"))
            http = re.search(r"\baxios\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]", line, re.I)
            fetch = re.search(r"\bfetch\s*\(\s*['\"]([^'\"]+)['\"]", line)
            if http or fetch:
                method = http.group(1).upper() if http else self._fetch_method(line); target = http.group(2) if http else fetch.group(1); call_key = f"call:{rel}:{line_no}:{'axios.' + http.group(1) if http else 'fetch'}"
                out.add_node(SemanticNodeFact(call_key, "CALL_SITE", "HTTP client call", rel, line_no, line_no, attributes={"integrationType": "HTTP", "method": method}))
                host = safe_external_host(target)
                if host:
                    ekey = f"external:{host}"; out.add_node(SemanticNodeFact(ekey, "EXTERNAL_API", host, attributes={"host": host})); out.add_edge(SemanticEdgeFact("SENDS_TO_EXTERNAL", call_key, ekey))
                else:
                    rkey = self._route_key(method, self._normalize_route(target)); out.add_node(SemanticNodeFact(rkey, "HTTP_ROUTE", f"{method} {self._normalize_route(target)}", attributes={"method": method, "route": self._normalize_route(target)})); out.add_edge(SemanticEdgeFact("CALLS_API", call_key, rkey))
            boundary = re.search(r"@(EventPattern|MessagePattern|OnEvent)\s*\(\s*['\"]([^'\"]+)['\"]", line)
            if boundary:
                ekey = f"event:{boundary.group(2)}"; out.add_node(SemanticNodeFact(ekey, "EVENT", boundary.group(2))); out.add_edge(SemanticEdgeFact("CONSUMES_EVENT", ekey, f"module:{rel}"))
            queue = re.search(r"@(Processor|Process)\s*\(\s*['\"]([^'\"]+)['\"]", line)
            if queue:
                qkey = f"queue:{queue.group(2)}"; out.add_node(SemanticNodeFact(qkey, "QUEUE", queue.group(2))); out.add_edge(SemanticEdgeFact("CONSUMES_FROM_QUEUE", qkey, f"module:{rel}"))
            command_handler = re.search(r"@CommandHandler\s*\(\s*([A-Za-z_$][\w$]*)", line)
            query_handler = re.search(r"@QueryHandler\s*\(\s*([A-Za-z_$][\w$]*)", line)
            if command_handler:
                ckey = f"command:{command_handler.group(1)}"; out.add_node(SemanticNodeFact(ckey, "COMMAND", command_handler.group(1))); out.add_edge(SemanticEdgeFact("HANDLES_COMMAND", ckey, f"module:{rel}"))
            if query_handler:
                qkey = f"query:{query_handler.group(1)}"; out.add_node(SemanticNodeFact(qkey, "QUERY", query_handler.group(1))); out.add_edge(SemanticEdgeFact("HANDLES_QUERY", qkey, f"module:{rel}"))
            producer = re.search(r"\b(?:emit|publish|produce|sendEvent|send_event)\s*\(\s*['\"]([^'\"]+)['\"]", line)
            if producer:
                call = f"call:{rel}:{line_no}:publish"; ekey = f"event:{producer.group(1)}"; out.add_node(SemanticNodeFact(call, "CALL_SITE", "publish", rel, line_no, line_no)); out.add_node(SemanticNodeFact(ekey, "EVENT", producer.group(1))); out.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call, ekey))
            queue_producer = re.search(r"\b(?:queue|client|producer)\.(?:add|send|enqueue)\s*\(\s*['\"]([^'\"]+)['\"]", line, re.I)
            if queue_producer:
                call = f"call:{rel}:{line_no}:queue"; qkey = f"queue:{queue_producer.group(1)}"; out.add_node(SemanticNodeFact(call, "CALL_SITE", "queue publish", rel, line_no, line_no)); out.add_node(SemanticNodeFact(qkey, "QUEUE", queue_producer.group(1))); out.add_edge(SemanticEdgeFact("PUBLISHES_TO_QUEUE", call, qkey))
            command = re.search(r"commandBus\.execute\s*\(\s*new\s+([A-Za-z_$][\w$]*)", line)
            query_call = re.search(r"queryBus\.execute\s*\(\s*new\s+([A-Za-z_$][\w$]*)", line)
            if command:
                call = f"call:{rel}:{line_no}:commandBus.execute"; ckey = f"command:{command.group(1)}"; out.add_node(SemanticNodeFact(call, "CALL_SITE", "commandBus.execute", rel, line_no, line_no)); out.add_node(SemanticNodeFact(ckey, "COMMAND", command.group(1))); out.add_edge(SemanticEdgeFact("PUBLISHES_COMMAND", call, ckey))
            if query_call:
                call = f"call:{rel}:{line_no}:queryBus.execute"; qkey = f"query:{query_call.group(1)}"; out.add_node(SemanticNodeFact(call, "CALL_SITE", "queryBus.execute", rel, line_no, line_no)); out.add_node(SemanticNodeFact(qkey, "QUERY", query_call.group(1))); out.add_edge(SemanticEdgeFact("PUBLISHES_QUERY", call, qkey))

    def _config(self, rel: str, text: str, out: SemanticProgram) -> None:
        fkey = f"file:{rel}"; out.add_node(SemanticNodeFact(f"config:{rel}", "MODULE", rel, rel, 1, 1, attributes=self._file_attributes(rel))); out.add_edge(SemanticEdgeFact("CONTAINS", fkey, f"config:{rel}"))
        for match in re.finditer(r"https?://[^\s'\"<>]+", text):
            host = safe_external_host(match.group(0))
            if host:
                key = f"external:{host}"; out.add_node(SemanticNodeFact(key, "EXTERNAL_SERVICE", host, attributes={"host": host, "declaredInConfig": True})); out.add_edge(SemanticEdgeFact("SUPPORTED_BY", key, fkey))

    @staticmethod
    def _controller_prefix(text: str) -> str:
        match = re.search(r"@Controller\s*\(\s*['\"]([^'\"]*)['\"]", text); return FrameworkBoundaryExtractor._normalize_route(match.group(1)) if match else ""
    @staticmethod
    def _join_route(prefix: str, suffix: str) -> str:
        if not prefix: return FrameworkBoundaryExtractor._normalize_route(suffix)
        return FrameworkBoundaryExtractor._normalize_route(prefix.rstrip("/") + "/" + suffix.lstrip("/"))
    @staticmethod
    def _normalize_route(value: str) -> str:
        path = value.split("?", 1)[0].strip(); return "/" + path.strip("/") if path.strip("/") else "/"
    @staticmethod
    def _route_key(method: str, path: str) -> str: return f"http-route:{method.upper()}:{FrameworkBoundaryExtractor._normalize_route(path)}"
    @staticmethod
    def _fetch_method(line: str) -> str:
        match = re.search(r"method\s*:\s*['\"](GET|POST|PUT|PATCH|DELETE)['\"]", line, re.I); return match.group(1).upper() if match else "GET"
    @staticmethod
    def _file_attributes(rel: str) -> dict[str, object]:
        lower = rel.lower(); kinds = []
        if "docker" in lower: kinds.append("CONTAINER")
        if any(v in lower for v in ("k8s", "kubernetes", "helm")): kinds.append("KUBERNETES")
        if any(v in lower for v in (".github/workflows", ".gitlab-ci", "jenkins")): kinds.append("CI_CD")
        if lower.endswith(".tf"): kinds.append("INFRASTRUCTURE")
        return {"manifestKinds": kinds} if kinds else {}
