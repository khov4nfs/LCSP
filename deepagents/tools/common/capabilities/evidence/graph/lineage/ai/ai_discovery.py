"""Deterministic Scanner/PGE AI-discovery enrichment and gate projection.

This module is deliberately pre-Interview. It may inspect raw source only inside the
ephemeral scanner workspace, but emits metadata/source anchors only. It never assigns a
custom endpoint to a provider without repository evidence and never treats a package or
provider reference as proof of model execution.
"""
from __future__ import annotations

import hashlib
import re
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, replace
from pathlib import Path
from urllib.parse import urlsplit

from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)
from tools.common.capabilities.evidence.graph.schema.source_roles import is_test_source_path


AI_DISCOVERY_SCHEMA_VERSION = "1.0.0"
AI_CONFIRMED = "AI_CONFIRMED"
AI_ABSENT_CONFIRMED = "AI_ABSENT_CONFIRMED"
AI_UNKNOWN = "AI_UNKNOWN"

CONFIRMED_AI_CALL = "CONFIRMED_AI_CALL"
POSSIBLE_AI_CALL = "POSSIBLE_AI_CALL"
AI_PROVIDER_REFERENCE = "AI_PROVIDER_REFERENCE"
UNRESOLVED_DYNAMIC = "UNRESOLVED_DYNAMIC"

_SOURCE_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".java",
    ".kt",
    ".cs",
}
# Source-like languages that can contain executable client/control flow but are not yet
# represented by the deterministic semantic extractor. Their presence preserves a
# bounded technical frontier instead of allowing a false AI-absence conclusion.
_SOURCE_LIKE_EXTENSIONS = frozenset(
    {
        *_SOURCE_EXTENSIONS,
        ".go",
        ".rs",
        ".rb",
        ".php",
        ".swift",
        ".scala",
        ".dart",
        ".c",
        ".cc",
        ".cpp",
        ".cxx",
        ".h",
        ".hh",
        ".hpp",
        ".fs",
        ".fsx",
        ".ex",
        ".exs",
        ".lua",
        ".ps1",
    }
)
_EXCLUDED_PARTS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
}
_ENV_PATTERNS = (
    re.compile(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)"),
    re.compile(r"process\.env\[['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\]"),
    re.compile(r"os\.getenv\(\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]"),
    re.compile(r"os\.environ(?:\.get\()?\s*\[?\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]"),
    re.compile(r"Environment\.GetEnvironmentVariable\(\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]"),
    re.compile(r"System\.getenv\(\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]"),
)
_HTTP_CALL_RE = re.compile(
    r"\b(fetch|axios(?:\.(?:get|post|put|patch|delete|request))?|"
    r"requests\.(?:get|post|put|patch|delete)|httpx\.(?:get|post|put|patch|delete)|"
    r"urllib\.request|(?:\w+\.)?HttpClient\.(?:GetAsync|PostAsync|SendAsync)|"
    r"(?:\w+\.)?(?:WebClient|RestTemplate|OkHttpClient)\.\w+)\s*\(",
    re.I,
)
_INSTANCE_HTTP_CALL_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|request)\s*\(", re.I
)
_HTTP_CLIENT_BINDINGS = (
    (
        "HTTPX",
        re.compile(
            r"\b(?:async\s+)?with\s+httpx\.(?:AsyncClient|Client)\s*\([^)]*\)\s+as\s+([A-Za-z_][\w]*)",
            re.I,
        ),
    ),
    (
        "HTTPX",
        re.compile(
            r"\b([A-Za-z_$][\w$]*)\s*=\s*httpx\.(?:AsyncClient|Client)\s*\(", re.I
        ),
    ),
    (
        "REQUESTS",
        re.compile(r"\b([A-Za-z_$][\w$]*)\s*=\s*requests\.Session\s*\(", re.I),
    ),
    (
        "AXIOS",
        re.compile(
            r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*axios\.create\s*\(",
            re.I,
        ),
    ),
)
_URL_RE = re.compile(r"https?://[^'\"\s)`},]+", re.I)
_AI_PAYLOAD_KEY_RE = re.compile(
    r"(?:['\"](?:model|messages|prompt|input|tools|embedding|contents)['\"]\s*:|"
    r"\b(?:model|messages|prompt|input|tools|embedding|contents)\s*(?::|=))",
    re.I,
)
_AI_ENDPOINT_RE = re.compile(
    r"/(?:v\d+/)?(?:chat/completions|completions|responses|messages|embeddings|"
    r"models/[^/]+:generateContent|invoke|converse)(?=[/'\"?\s,)}`]|$)",
    re.I,
)
_AI_ENV_RE = re.compile(
    r"(?:AI|LLM|MODEL|GPT|OPENAI|ANTHROPIC|GEMINI|GENAI|BEDROCK|OLLAMA)", re.I
)
_ENDPOINT_ENV_RE = re.compile(r"(?:URL|URI|HOST|ENDPOINT|GATEWAY|BASE|API)", re.I)
_FEATURE_ENV_RE = re.compile(
    r"(?:ENABLE|ENABLED|FEATURE|USE|DISABLE).*(?:AI|LLM|MODEL)|"
    r"(?:AI|LLM|MODEL).*(?:ENABLE|ENABLED|FEATURE|USE|DISABLE)",
    re.I,
)
_FEATURE_GUARD_TOKEN_RE = re.compile(
    r"\b(?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\b"
)
_CONDITION_RE = re.compile(r"\bif\s*\(|^\s*if\b|\bwhen\s*\(", re.I)
_ASSIGNMENT_RE = re.compile(
    r"\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=|^\s*([A-Za-z_][\w]*)\s*="
)

_UNMODELED_OUTBOUND_CLIENT_PATTERNS = (
    (
        "GRAPHQL_CLIENT",
        re.compile(r"@apollo/client|\bApolloClient\b|graphql-request|\bGraphQLClient\b|\burql\b", re.I),
    ),
    (
        "GRPC_CLIENT",
        re.compile(
            r"@grpc/grpc-js|\bgrpc\.(?:Dial|insecure_channel|secure_channel)\b|"
            r"\bManagedChannelBuilder\b|\bGrpcChannel\.ForAddress\b|"
            r"tonic::transport::Channel",
            re.I,
        ),
    ),
    (
        "RETROFIT_CLIENT",
        re.compile(
            r"\bRetrofit\.Builder\b|\bretrofit2\.|"
            r"@(?:GET|POST|PUT|PATCH|DELETE|HTTP)\s*\(",
            re.I,
        ),
    ),
)

# Discovery confirmation is source-seeded, but coverage is graph-owned.  These
# relations are deliberately broader than lexical HTTP detection so parameters,
# config objects, helpers, DI/service dispatch, GraphQL/gRPC and cross-module hops
# remain in one deterministic bounded frontier.
_AI_GRAPH_EDGES = frozenset(
    {
        "CALLS", "CALLS_DYNAMICALLY", "CALLS_EXTERNAL", "CALLS_API",
        "DEPENDS_ON", "IMPORTS", "RESOLVES_TO", "IMPLEMENTS", "EXTENDS",
        "HANDLED_BY", "INVOKES_BOUNDARY", "CONFIGURES", "CONTROLS", "GUARDS",
        "HAS_PARAMETER", "PASSES_ARGUMENT", "RETURNS", "RECEIVES_RETURN",
        "ASSIGNS", "ALIASES", "READS_PROPERTY", "WRITES_PROPERTY", "MAPS_TO",
        "FLOWS_TO", "CARRIES_DATA", "SENDS_TO_EXTERNAL", "RECEIVES_FROM_EXTERNAL",
        "SENDS_TO_AI", "RECEIVES_FROM_AI", "INVOKES_AI",
        "PUBLISHES_EVENT", "CONSUMES_EVENT", "PUBLISHES_COMMAND", "HANDLES_COMMAND",
        "PUBLISHES_QUERY", "HANDLES_QUERY",
    }
)
_AI_BOUNDARY_TYPES = frozenset(
    {"EXTERNAL_API", "GRAPHQL_OPERATION", "GRPC_METHOD", "CALL_SITE", "AI_GATEWAY"}
)
_AI_STRONG_TYPES = frozenset(
    {"AI_MODEL_INVOCATION", "AI_API_CANDIDATE", "AI_GATEWAY", "AI_CAPABILITY"}
)
_AI_GRAPH_STRONG_RE = re.compile(
    r"(?:^|[^a-z0-9])(?:ai|llm|openai|anthropic|gemini|genai|bedrock|ollama|"
    r"huggingface|openrouter|inference|embedding|chatgpt)(?:[^a-z0-9]|$)", re.I
)
_AI_GRAPH_PAYLOAD_RE = re.compile(
    r"(?:^|[^a-z0-9])(?:prompt|messages|model|tools|contents|completion|response_format)(?:[^a-z0-9]|$)",
    re.I,
)
_AI_GRAPH_TRANSPORT_RE = re.compile(r"graphql|grpc|retrofit|gateway|client|endpoint|transport", re.I)
_MAX_GRAPH_HOPS = 12

_PROVIDER_HOSTS = (
    ("OPENAI", ("api.openai.com",)),
    ("AZURE_OPENAI", ("openai.azure.com",)),
    ("ANTHROPIC", ("api.anthropic.com",)),
    (
        "GOOGLE_GENAI",
        ("generativelanguage.googleapis.com", "aiplatform.googleapis.com"),
    ),
    ("AWS_BEDROCK", ("bedrock-runtime.",)),
    ("HUGGINGFACE", ("api-inference.huggingface.co",)),
    ("OPENROUTER", ("openrouter.ai",)),
)


def _env_names(text: str) -> list[str]:
    values: list[str] = []
    for pattern in _ENV_PATTERNS:
        values.extend(match.group(1) for match in pattern.finditer(text))
    return list(dict.fromkeys(values))


def _provider_for_host(host: str) -> str | None:
    lower = host.lower().rstrip(".")
    for provider, hints in _PROVIDER_HOSTS:
        for hint in hints:
            normalized = hint.lower().rstrip(".")
            if hint.endswith("."):
                if (
                    provider == "AWS_BEDROCK"
                    and lower.startswith(f"{normalized}.")
                    and lower.endswith(".amazonaws.com")
                ):
                    return provider
                continue
            if lower == normalized or lower.endswith(f".{normalized}"):
                return provider
    return None


def _method_for_call(name: str) -> str | None:
    lower = name.lower()
    for method in ("get", "post", "put", "patch", "delete"):
        if lower.endswith(f".{method}") or lower.endswith(f"{method}async"):
            return method.upper()
    return None


@dataclass(frozen=True)
class _HttpClientBinding:
    line_no: int
    transport: str | None
    config_names: tuple[str, ...] = ()


class _ScopedHttpClientProvenance:
    def __init__(
        self,
        scope_paths: list[tuple[int, ...]],
        bindings: dict[int, dict[str, list[_HttpClientBinding]]],
    ) -> None:
        self.scope_paths = scope_paths
        self.bindings = bindings

    def resolve(self, name: str, line_no: int) -> _HttpClientBinding | None:
        if line_no < 1 or line_no > len(self.scope_paths):
            return None
        for scope_id in reversed(self.scope_paths[line_no - 1]):
            events = self.bindings.get(scope_id, {}).get(name)
            if events is None:
                continue
            prior = [event for event in events if event.line_no <= line_no]
            # A declaration/binding in the nearest lexical scope shadows outer
            # provenance even if this particular use precedes that binding.
            return prior[-1] if prior else None
        return None


def _scrub_structure(line: str) -> str:
    scrubbed = re.sub(r"(['\"`]).*?(?<!\\)\1", "", line)
    return scrubbed.split("//", 1)[0].split("#", 1)[0]


def _lexical_scope_paths(
    lines: list[str], *, python_source: bool
) -> tuple[list[tuple[int, ...]], dict[int, list[int]]]:
    """Return lexical scope ancestry for each source line.

    This is intentionally bounded rather than a full parser for text languages. Python
    uses indentation; brace languages use structural braces after quoted/comment text is
    removed. Every nested block is a safe shadowing boundary, which is conservative for
    provenance and prevents cross-function identifier fabrication.
    """
    paths: list[tuple[int, ...]] = []
    opened_by_line: dict[int, list[int]] = {}
    next_id = 1
    if python_source:
        stack: list[tuple[int, int]] = [(-1, 0)]
        for line_no, line in enumerate(lines, start=1):
            stripped = line.strip()
            indent = len(line) - len(line.lstrip())
            if stripped and not stripped.startswith("#"):
                while len(stack) > 1 and indent <= stack[-1][0]:
                    stack.pop()
            paths.append(tuple(scope_id for _, scope_id in stack))
            if re.match(r"\s*(?:async\s+def|def|class)\b", line) and stripped.endswith(":"):
                scope_id = next_id
                next_id += 1
                opened_by_line[line_no] = [scope_id]
                stack.append((indent, scope_id))
        return paths, opened_by_line

    stack = [0]
    for line_no, line in enumerate(lines, start=1):
        scrubbed = _scrub_structure(line)
        # Leading close braces belong to the enclosing scope.
        leading_closes = len(scrubbed) - len(scrubbed.lstrip("}"))
        for _ in range(min(leading_closes, max(0, len(stack) - 1))):
            stack.pop()
        paths.append(tuple(stack))
        opened: list[int] = []
        remainder = scrubbed.lstrip("}") if leading_closes else scrubbed
        for char in remainder:
            if char == "{":
                scope_id = next_id
                next_id += 1
                stack.append(scope_id)
                opened.append(scope_id)
            elif char == "}" and len(stack) > 1:
                stack.pop()
        if opened:
            opened_by_line[line_no] = opened
    return paths, opened_by_line


def _parameter_names(line: str) -> list[str]:
    if not (
        re.search(r"\bfunction\b|=>", line)
        or re.match(r"\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(", line)
    ):
        return []
    match = re.search(r"\(([^)]*)\)", line)
    if not match:
        return []
    result: list[str] = []
    for raw in match.group(1).split(","):
        token = raw.strip()
        token = re.sub(r"^(?:\.\.\.)", "", token)
        name_match = re.match(r"([A-Za-z_$][\w$]*)", token)
        if name_match:
            result.append(name_match.group(1))
    return result


def _python_parameter_names(line: str) -> list[str]:
    match = re.match(r"\s*(?:async\s+def|def)\s+[A-Za-z_]\w*\s*\(([^)]*)\)", line)
    if not match:
        return []
    result: list[str] = []
    for raw in match.group(1).split(","):
        token = raw.strip().lstrip("*")
        name_match = re.match(r"([A-Za-z_]\w*)", token)
        if name_match and name_match.group(1) not in {"self", "cls"}:
            result.append(name_match.group(1))
    return result


def _http_client_provenance(
    lines: list[str], *, relative: str = ""
) -> _ScopedHttpClientProvenance:
    """Resolve HTTP client instances by lexical scope and def-use identity."""
    python_source = relative.lower().endswith(".py")
    scope_paths, opened_by_line = _lexical_scope_paths(
        lines, python_source=python_source
    )
    bindings: dict[int, dict[str, list[_HttpClientBinding]]] = {}

    def add(scope_id: int, name: str, binding: _HttpClientBinding) -> None:
        bindings.setdefault(scope_id, {}).setdefault(name, []).append(binding)

    for line_no, line in enumerate(lines, start=1):
        current_scope = scope_paths[line_no - 1][-1]
        positive: set[str] = set()
        for transport, pattern in _HTTP_CLIENT_BINDINGS:
            match = pattern.search(line)
            if match:
                name = match.group(1)
                positive.add(name)
                add(
                    current_scope,
                    name,
                    _HttpClientBinding(line_no, transport, tuple(_env_names(line))),
                )

        # Record ordinary assignments/declarations too: they are shadowing facts, not
        # HTTP provenance. This is what prevents a same-named object in another scope
        # from inheriting a file-level client identity.
        assignment = _ASSIGNMENT_RE.search(line)
        if assignment:
            name = assignment.group(1) or assignment.group(2)
            if name and name not in positive:
                add(current_scope, name, _HttpClientBinding(line_no, None))

        opened = opened_by_line.get(line_no, [])
        if opened:
            parameter_scope = opened[0]
            params = (
                _python_parameter_names(line)
                if python_source
                else _parameter_names(line)
            )
            for name in params:
                add(parameter_scope, name, _HttpClientBinding(line_no, None))

    for scope in bindings.values():
        for events in scope.values():
            events.sort(key=lambda item: item.line_no)
    return _ScopedHttpClientProvenance(scope_paths, bindings)


def _http_call_on_line(
    line: str, clients: _ScopedHttpClientProvenance, line_no: int
) -> tuple[str, int, bool, tuple[str, ...]] | None:
    direct = _HTTP_CALL_RE.search(line)
    if direct:
        return direct.group(1), direct.end(), True, ()
    instance = _INSTANCE_HTTP_CALL_RE.search(line)
    if not instance:
        return None
    call_name = f"{instance.group(1)}.{instance.group(2)}"
    provenance = clients.resolve(instance.group(1), line_no)
    if provenance is None or provenance.transport is None:
        return call_name, instance.end(), False, ()
    return call_name, instance.end(), True, provenance.config_names


def _http_target_expression(window: str, call_end: int) -> str:
    """Return only the first request-target argument for a recognized HTTP call."""
    chars: list[str] = []
    stack: list[str] = []
    quote: str | None = None
    escaped = False
    pairs = {"(": ")", "[": "]", "{": "}"}
    for char in window[call_end:]:
        if quote is not None:
            chars.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"', "`"}:
            quote = char
            chars.append(char)
            continue
        if char in pairs:
            stack.append(pairs[char])
            chars.append(char)
            continue
        if stack and char == stack[-1]:
            stack.pop()
            chars.append(char)
            continue
        if not stack and char in {",", ")"}:
            break
        chars.append(char)
    return "".join(chars).strip()


def _condition_env_names(line: str, aliases: dict[str, str]) -> list[str]:
    names = _env_names(line)
    names.extend(
        env_name
        for alias, env_name in aliases.items()
        if re.search(rf"\b{re.escape(alias)}\b", line)
    )
    return list(dict.fromkeys(names))


def _condition_guard_names(line: str, aliases: dict[str, str]) -> list[str]:
    """Resolve direct env guards first, then bounded symbolic feature/config guards."""
    env_names = _condition_env_names(line, aliases)
    if env_names:
        return env_names
    names = []
    for token in _FEATURE_GUARD_TOKEN_RE.findall(line):
        normalized = token.replace(".", "_")
        if _FEATURE_ENV_RE.search(normalized):
            names.append(token)
    return list(dict.fromkeys(names))


def _brace_delta(line: str) -> int:
    # Structural-only approximation: remove quoted strings and line comments before
    # counting braces, so URLs/payload literals cannot affect block containment.
    scrubbed = re.sub(r"(['\"]).*?(?<!\\)\1", "", line)
    scrubbed = scrubbed.split("//", 1)[0]
    return scrubbed.count("{") - scrubbed.count("}")


def _brace_depths(lines: list[str]) -> list[int]:
    depths: list[int] = []
    depth = 0
    for line in lines:
        depths.append(depth)
        depth = max(0, depth + _brace_delta(line))
    return depths


def _verified_guard_line(
    lines: list[str], invocation_index: int, aliases: dict[str, str]
) -> tuple[int, list[str], str] | None:
    if invocation_index < 0 or invocation_index >= len(lines):
        return None
    depths = _brace_depths(lines)
    invocation_line = lines[invocation_index]
    same_names = _condition_guard_names(invocation_line, aliases)
    if same_names and _CONDITION_RE.search(invocation_line):
        return invocation_index + 1, same_names, "WHEN_TRUE"

    invocation_indent = len(invocation_line) - len(invocation_line.lstrip())
    for index in range(invocation_index - 1, -1, -1):
        line = lines[index]
        names = _condition_guard_names(line, aliases)
        if not names or not _CONDITION_RE.search(line):
            continue
        if "{" in line and depths[invocation_index] > depths[index]:
            depth = depths[index] + max(1, _brace_delta(line))
            enclosed = True
            for middle in range(index + 1, invocation_index):
                depth += _brace_delta(lines[middle])
                if depth <= depths[index]:
                    enclosed = False
                    break
            if enclosed:
                return index + 1, names, "WHEN_TRUE"
        if re.search(r"\b(?:return|throw|continue)\b", line) and depths[index] == depths[invocation_index]:
            return index + 1, names, "AFTER_EARLY_EXIT"
        stripped = line.rstrip()
        condition_indent = len(line) - len(line.lstrip())
        if stripped.endswith(":") and invocation_indent > condition_indent:
            enclosed = True
            for middle in range(index + 1, invocation_index):
                candidate = lines[middle]
                if not candidate.strip() or candidate.lstrip().startswith("#"):
                    continue
                indent = len(candidate) - len(candidate.lstrip())
                if indent <= condition_indent:
                    enclosed = False
                    break
            if enclosed:
                return index + 1, names, "WHEN_TRUE"
    return None


@dataclass(frozen=True)
class _BoolBinding:
    line_no: int
    value: bool | None
    technical_frontier: bool = False


@dataclass(frozen=True)
class _FunctionBoolContext:
    name: str
    params: tuple[str, ...]
    exported: bool
    declaration_line: int


class _ScopedBoolFacts:
    def __init__(
        self,
        scope_paths: list[tuple[int, ...]],
        bindings: dict[int, dict[str, list[_BoolBinding]]],
        functions: dict[int, _FunctionBoolContext],
    ) -> None:
        self.scope_paths = scope_paths
        self.bindings = bindings
        self.functions = functions

    def binding(self, name: str, line_no: int) -> _BoolBinding | None:
        if line_no < 1 or line_no > len(self.scope_paths):
            return None
        for scope_id in reversed(self.scope_paths[line_no - 1]):
            events = self.bindings.get(scope_id, {}).get(name)
            if events is None:
                continue
            prior = [event for event in events if event.line_no <= line_no]
            return prior[-1] if prior else None
        return None

    def resolve(self, name: str, line_no: int) -> bool | None:
        binding = self.binding(name, line_no)
        return binding.value if binding is not None else None

    def parameter_context(
        self, name: str, line_no: int
    ) -> tuple[_FunctionBoolContext, int] | None:
        if line_no < 1 or line_no > len(self.scope_paths):
            return None
        for scope_id in reversed(self.scope_paths[line_no - 1]):
            context = self.functions.get(scope_id)
            if context and name in context.params:
                return context, context.params.index(name)
        return None


def _function_context(line: str, *, python_source: bool) -> _FunctionBoolContext | None:
    if python_source:
        match = re.match(r"\s*(?:async\s+def|def)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)", line)
        if not match:
            return None
        params = tuple(_python_parameter_names(line))
        # Python exportability is derived from the PGE symbol/module scope, never from
        # an underscore naming convention.
        return _FunctionBoolContext(match.group(1), params, False, 0)
    for pattern in (
        r"\s*(?P<export>export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)\s*\((?P<params>[^)]*)\)",
        r"\s*(?P<export>export\s+)?(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\((?P<params>[^)]*)\)\s*=>",
    ):
        match = re.match(pattern, line)
        if match:
            return _FunctionBoolContext(
                match.group("name"), tuple(_parameter_names(line)), bool(match.group("export")), 0
            )
    return None


def _pge_callable_contexts(
    program: SemanticProgram, relative: str
) -> dict[int, list[_FunctionBoolContext]]:
    node_by_key = {node.key: node for node in program.nodes}
    params_by_symbol: dict[str, list[tuple[int, str]]] = {}
    for edge in program.edges:
        if edge.edge_type != "HAS_PARAMETER":
            continue
        param = node_by_key.get(edge.target_key)
        if param is None or param.node_type != "PARAMETER":
            continue
        position = int((edge.attributes or {}).get("position", 0))
        params_by_symbol.setdefault(edge.source_key, []).append(
            (position, param.label)
        )

    result: dict[int, list[_FunctionBoolContext]] = {}
    for node in program.nodes:
        if (
            node.file_path != relative
            or node.node_type not in {"FUNCTION", "METHOD"}
            or not node.start_line
        ):
            continue
        body_start = (node.attributes or {}).get("bodyStartLine")
        if not isinstance(body_start, int) or body_start < 1:
            continue
        params = tuple(
            label
            for _, label in sorted(
                params_by_symbol.get(node.key, []),
                key=lambda item: item[0],
            )
        )
        external = str(
            (node.attributes or {}).get("externalReachability") or ""
        ).upper()
        result.setdefault(body_start, []).append(
            _FunctionBoolContext(
                node.label,
                params,
                external == "POSSIBLE",
                int(node.start_line),
            )
        )
    return result


def _static_bool_facts(
    lines: list[str],
    relative: str,
    program: SemanticProgram | None = None,
) -> _ScopedBoolFacts:
    python_source = relative.lower().endswith(".py")
    scope_paths, opened_by_line = _lexical_scope_paths(lines, python_source=python_source)
    bindings: dict[int, dict[str, list[_BoolBinding]]] = {}
    functions: dict[int, _FunctionBoolContext] = {}
    pge_contexts = (
        _pge_callable_contexts(program, relative)
        if program is not None
        else {}
    )

    def add(
        scope_id: int,
        name: str,
        line_no: int,
        value: bool | None,
        *,
        technical_frontier: bool = False,
    ) -> None:
        bindings.setdefault(scope_id, {}).setdefault(name, []).append(
            _BoolBinding(line_no, value, technical_frontier)
        )

    for line_no, line in enumerate(lines, start=1):
        current_scope = scope_paths[line_no - 1][-1]
        direct = re.search(
            r"\b(?:(const|let|var)\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*(true|false)\b",
            line, re.I
        )
        if direct:
            declaration, name, literal = direct.groups()
            # Only a primitive const binding is closed by language semantics. Mutable
            # bindings and object properties may be changed through sibling helpers,
            # aliases, callbacks, or module initialization that this lexical pass does
            # not model. They are retained as shadowing facts but never as proof of
            # reachability.
            authoritative = (declaration or "").lower() == "const" and "." not in name
            add(
                current_scope,
                name,
                line_no,
                literal.lower() == "true" if authoritative else None,
                technical_frontier=not authoritative,
            )
        py_direct = re.match(
            r"\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*=\s*(True|False)\b", line
        )
        if py_direct:
            # Python names may be rebound via global/nonlocal/callback flows. Until the
            # PGE proves write closure, a lexical assignment is not authoritative.
            add(
                current_scope,
                py_direct.group(1),
                line_no,
                None,
                technical_frontier=True,
            )
        object_match = re.search(
            r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{(.*)\}", line
        )
        if object_match:
            root, body = object_match.group(1), object_match.group(2)
            for item in re.finditer(r"([A-Za-z_$][\w$]*)\s*:\s*(true|false)\b", body, re.I):
                # A const object does not make its properties immutable. Object-property
                # guards therefore remain unresolved unless a future def-use/PGE proof
                # closes every relevant write and alias.
                add(
                    current_scope,
                    f"{root}.{item.group(1)}",
                    line_no,
                    None,
                    technical_frontier=True,
                )
        opened = opened_by_line.get(line_no, [])
        contexts = pge_contexts.get(line_no, [])
        if opened and contexts:
            # The callable body is the innermost brace opened on its body-start line.
            # This maps multiline signatures and class/arrow callables to the same
            # lexical parameter scope used by guard resolution.
            function_scope = opened[-1]
            context = min(
                contexts,
                key=lambda item: abs(item.declaration_line - line_no),
            )
            functions[function_scope] = context
            for param in context.params:
                add(function_scope, param, context.declaration_line, None)
        elif opened:
            context = _function_context(line, python_source=python_source)
            if context:
                function_scope = opened[0]
                functions[function_scope] = replace(
                    context, declaration_line=line_no
                )
                for param in context.params:
                    add(function_scope, param, line_no, None)
    for scope in bindings.values():
        for events in scope.values():
            events.sort(key=lambda item: item.line_no)
    return _ScopedBoolFacts(scope_paths, bindings, functions)


def _condition_expression(line: str) -> str | None:
    paren = re.search(r"\bif\s*\((.*?)\)", line, re.I)
    if paren:
        return paren.group(1).strip()
    python_if = re.match(r"\s*if\s+(.+?)\s*:\s*(?:#.*)?$", line)
    return python_if.group(1).strip() if python_if else None


def _predicate_value(expr: str, name: str, value: bool) -> bool | None:
    if re.search(r"(?:&&|\|\||\band\b|\bor\b)", expr):
        return None
    escaped = re.escape(name)
    normalized = expr.strip()
    if re.fullmatch(rf"!?\s*{escaped}", normalized):
        return (not value) if normalized.lstrip().startswith("!") else value
    if re.fullmatch(rf"not\s+{escaped}", normalized, re.I):
        return not value
    comparison = re.fullmatch(
        rf"{escaped}\s*(===|==|!==|!=)\s*(true|false|True|False)", normalized
    )
    if comparison:
        expected = comparison.group(2).lower() == "true"
        equal = value == expected
        return not equal if comparison.group(1) in {"!==", "!="} else equal
    return None


def _split_top_level_args(raw: str) -> list[str]:
    args: list[str] = []
    current: list[str] = []
    depth = 0
    quote: str | None = None
    escaped = False
    closers: list[str] = []
    pairs = {"(": ")", "[": "]", "{": "}"}
    for char in raw:
        if quote:
            current.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"', "`"}:
            quote = char
            current.append(char)
        elif char in pairs:
            depth += 1
            closers.append(pairs[char])
            current.append(char)
        elif closers and char == closers[-1]:
            closers.pop()
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            args.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    if current or raw.strip():
        args.append("".join(current).strip())
    return args


def _literal_bool(raw: str) -> bool | None:
    value = raw.strip().rstrip(";")
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    return None


def _call_arguments_text(text: str, open_paren: int) -> str | None:
    if open_paren < 0 or open_paren >= len(text) or text[open_paren] != "(":
        return None
    chars: list[str] = []
    depth = 1
    quote: str | None = None
    escaped = False
    index = open_paren + 1
    while index < len(text):
        char = text[index]
        if quote is not None:
            chars.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            quote = char
            chars.append(char)
        elif char == "(":
            depth += 1
            chars.append(char)
        elif char == ")":
            depth -= 1
            if depth == 0:
                return "".join(chars)
            chars.append(char)
        else:
            chars.append(char)
        index += 1
    return None




class AIDiscoveryEnricher:
    """Add only AI-material config/control/outbound facts to a semantic graph."""

    def __init__(
        self, workspace_path: str | Path, *, include_files: Iterable[str] | None = None
    ) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)
        self._include_files = (
            {str(value).replace("\\", "/").lstrip("./") for value in include_files}
            if include_files is not None
            else None
        )
        self._bool_call_cache: dict[tuple[str, int], tuple[bool | None, bool]] = {}

    def _in_scope(self, relative: str) -> bool:
        return self._include_files is None or relative in self._include_files

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        self._preserve_uncovered_source_frontiers(program)
        invocation_by_file: dict[str, list[SemanticNodeFact]] = {}
        for node in program.nodes:
            if node.node_type == "AI_MODEL_INVOCATION" and node.file_path:
                invocation_by_file.setdefault(
                    node.file_path.replace("\\", "/"), []
                ).append(node)

        for path in self._source_files():
            relative = path.relative_to(self.workspace).as_posix()
            try:
                lines = path.read_text(
                    encoding="utf-8", errors="replace"
                ).splitlines()
            except OSError as exc:
                program.coverage_notes.append(
                    f"ai_discovery_read_failed:file={relative}:reason={type(exc).__name__}"
                )
                continue
            aliases = _env_aliases(lines)
            http_clients = _http_client_provenance(lines, relative=relative)
            self._environment_and_conditions(program, relative, lines, aliases)
            self._preserve_unmodeled_transport_frontiers(program, relative, lines)
            self._outbound_candidates(
                program, relative, lines, aliases, http_clients
            )
            self._guard_invocations(
                program,
                relative,
                lines,
                invocation_by_file.get(relative, []),
                aliases,
            )
        return program

    def finalize(self, program: SemanticProgram) -> SemanticProgram:
        """Resolve AI-material frontiers from the completed semantic PGE IR.

        Traversal is directional and trust-aware. Only OBSERVED/CORROBORATED,
        sufficiently covered edges/nodes may establish a Customer-owned AI relation.
        Unresolved/inferred continuations remain Scanner/PGE-owned frontiers.
        """
        node_by_key = {node.key: node for node in program.nodes}
        adjacency: dict[str, list[tuple[str, SemanticEdgeFact]]] = {}
        for edge in program.edges:
            if edge.edge_type not in _AI_GRAPH_EDGES:
                continue
            if edge.source_key not in node_by_key or edge.target_key not in node_by_key:
                continue
            # Preserve semantic direction. Reversing CALLS/HANDLED_BY/etc. lets a
            # boundary walk through a shared caller into unrelated sibling calls.
            adjacency.setdefault(edge.source_key, []).append((edge.target_key, edge))

        replacements: dict[str, SemanticNodeFact] = {}
        added_candidates: set[str] = set()
        for boundary in list(program.nodes):
            if boundary.node_type not in _AI_BOUNDARY_TYPES or boundary.node_type == "AI_API_CANDIDATE":
                continue
            evidence = self._walk_ai_frontier(boundary.key, node_by_key, adjacency)

            uncertain_keys = set(evidence["unresolved"]) | set(evidence["uncertain"])
            if uncertain_keys and (
                evidence["ai_material"]
                or boundary.node_type in {"EXTERNAL_API", "GRAPHQL_OPERATION", "GRPC_METHOD", "AI_GATEWAY"}
            ):
                for unresolved_key in uncertain_keys:
                    unresolved = node_by_key.get(unresolved_key)
                    if unresolved is None:
                        continue
                    attrs = dict(unresolved.attributes or {})
                    if attrs.get("aiMaterial") is not True:
                        attrs["aiMaterial"] = True
                        attrs["aiDiscoveryReason"] = "PGE_UNTRUSTED_OR_UNRESOLVED_FRONTIER"
                        replacements[unresolved.key] = replace(
                            unresolved,
                            attributes=attrs,
                            coverage_state="LIMITED",
                            resolution_state="UNRESOLVED",
                        )
                    if unresolved.key not in program.unresolved_frontiers:
                        program.unresolved_frontiers.append(unresolved.key)

            if evidence["truncated"]:
                frontier_key = f"ai-frontier:{boundary.key}"
                if frontier_key not in node_by_key:
                    frontier = SemanticNodeFact(
                        frontier_key,
                        "UNRESOLVED_DYNAMIC_TARGET",
                        "AI-relevant PGE traversal frontier",
                        boundary.file_path,
                        boundary.start_line,
                        boundary.end_line,
                        boundary.symbol_ref,
                        attributes={
                            "aiMaterial": True,
                            "aiDiscoveryReason": "MAX_GRAPH_HOPS_REACHED",
                        },
                        coverage_state="LIMITED",
                        resolution_state="UNRESOLVED",
                    )
                    program.add_node(frontier)
                    node_by_key[frontier_key] = frontier
                if frontier_key not in program.unresolved_frontiers:
                    program.unresolved_frontiers.append(frontier_key)

            # Customer clarification is allowed only after a deterministic trusted path
            # established the AI relation. Technical uncertainty never becomes a
            # Customer-owned confirmation question.
            if not evidence["ai_material"] or evidence["technical_uncertainty"]:
                continue
            if boundary.node_type in {"EXTERNAL_API", "GRAPHQL_OPERATION", "GRPC_METHOD", "AI_GATEWAY"} or evidence["transport"]:
                candidate_key = f"ai-api-candidate:pge:{boundary.key}"
                if candidate_key in node_by_key or candidate_key in added_candidates:
                    continue
                payload_hints = sorted(evidence["payload_hints"])[:8]
                attrs: dict[str, object] = {
                    "discoveryState": POSSIBLE_AI_CALL,
                    "clarificationOwner": "CUSTOMER",
                    "clarificationKind": "OUTBOUND_AI_CONFIRMATION",
                    "endpointSource": "PGE_MULTI_HOP",
                    "graphHopCount": evidence["hops"],
                }
                if payload_hints:
                    attrs["payloadHints"] = payload_hints
                candidate = SemanticNodeFact(
                    candidate_key,
                    "AI_API_CANDIDATE",
                    "PGE-connected unresolved AI-capable outbound API",
                    boundary.file_path,
                    boundary.start_line,
                    boundary.end_line,
                    boundary.symbol_ref,
                    attributes=attrs,
                    coverage_state=boundary.coverage_state,
                    resolution_state="UNRESOLVED",
                    support_refs=tuple(sorted(set(boundary.evidence_refs + boundary.support_refs))),
                )
                program.add_node(candidate)
                program.add_edge(
                    SemanticEdgeFact(
                        "CALLS_EXTERNAL",
                        boundary.key,
                        candidate_key,
                        coverage_state=candidate.coverage_state,
                        resolution_state="UNRESOLVED",
                    )
                )
                node_by_key[candidate_key] = candidate
                added_candidates.add(candidate_key)

        if replacements:
            program.nodes = [replacements.get(node.key, node) for node in program.nodes]
            node_by_key.update(replacements)
        self._reconcile_unmodeled_transport_frontiers(program, node_by_key, adjacency)
        return program

    @staticmethod
    def _edge_is_trusted(edge: SemanticEdgeFact) -> bool:
        return (
            str(edge.resolution_state or "").upper() in {"OBSERVED", "CORROBORATED"}
            and str(edge.coverage_state or "").upper() in {"SUFFICIENT", "READY"}
            and float(edge.confidence) >= 0.8
        )

    @staticmethod
    def _node_is_trusted(node: SemanticNodeFact) -> bool:
        return (
            str(node.resolution_state or "").upper() in {"OBSERVED", "CORROBORATED"}
            and str(node.coverage_state or "").upper() in {"SUFFICIENT", "READY"}
        )

    @classmethod
    def _walk_ai_frontier(
        cls,
        start: str,
        node_by_key: dict[str, SemanticNodeFact],
        adjacency: dict[str, list[tuple[str, SemanticEdgeFact]]],
    ) -> dict[str, object]:
        queue = deque([(start, 0)])
        seen: set[str] = set()
        strong = False
        ai_named = False
        transport = False
        payload_hints: set[str] = set()
        unresolved: set[str] = set()
        uncertain: set[str] = set()
        truncated = False
        max_hops = 0
        while queue:
            key, depth = queue.popleft()
            if key in seen:
                continue
            seen.add(key)
            max_hops = max(max_hops, depth)
            node = node_by_key.get(key)
            if node is None:
                continue
            trusted_node = cls._node_is_trusted(node)
            text = cls._node_signal_text(node)
            attrs = node.attributes or {}
            if not trusted_node:
                uncertain.add(key)
                if node.node_type == "UNRESOLVED_DYNAMIC_TARGET":
                    unresolved.add(key)
                # Do not let evidence beyond an inferred/unresolved node establish AI.
                if key != start:
                    continue
            if trusted_node and (
                node.node_type in _AI_STRONG_TYPES
                or (node.node_type == "SDK_CLIENT" and str(attrs.get("semanticRole") or "").startswith("PROVIDER_"))
                or attrs.get("aiRelevant") is True
            ):
                strong = True
            if trusted_node and _AI_GRAPH_STRONG_RE.search(text):
                ai_named = True
            if trusted_node and (node.node_type in {"GRAPHQL_OPERATION", "GRPC_METHOD", "AI_GATEWAY"} or _AI_GRAPH_TRANSPORT_RE.search(text)):
                transport = True
            if trusted_node:
                for match in _AI_GRAPH_PAYLOAD_RE.finditer(text):
                    payload_hints.add(match.group(1).lower() if match.lastindex else match.group(0).strip(" _.-").lower())
            if node.node_type == "UNRESOLVED_DYNAMIC_TARGET":
                unresolved.add(key)

            neighbors = sorted(adjacency.get(key, []), key=lambda item: (item[1].edge_type, item[0]))
            if depth >= _MAX_GRAPH_HOPS:
                if any(
                    nxt not in seen
                    and cls._edge_is_trusted(edge)
                    and cls._node_is_trusted(node_by_key[nxt])
                    for nxt, edge in neighbors
                    if nxt in node_by_key
                ):
                    truncated = True
                continue
            for nxt, edge in neighbors:
                if nxt in seen:
                    continue
                target = node_by_key.get(nxt)
                if target is None:
                    continue
                if not cls._edge_is_trusted(edge) or not cls._node_is_trusted(target):
                    uncertain.add(nxt)
                    if target.node_type == "UNRESOLVED_DYNAMIC_TARGET" or str(target.resolution_state).upper() == "UNRESOLVED":
                        unresolved.add(nxt)
                    continue
                queue.append((nxt, depth + 1))

        ai_material = strong or (ai_named and (bool(payload_hints) or transport))
        technical_uncertainty = bool(unresolved or uncertain or truncated)
        return {
            "ai_material": ai_material,
            "strong": strong,
            "transport": transport,
            "payload_hints": payload_hints,
            "unresolved": unresolved,
            "uncertain": uncertain,
            "truncated": truncated,
            "technical_uncertainty": technical_uncertainty,
            "hops": max_hops,
        }

    @classmethod
    def _reconcile_unmodeled_transport_frontiers(
        cls,
        program: SemanticProgram,
        node_by_key: dict[str, SemanticNodeFact],
        adjacency: dict[str, list[tuple[str, SemanticEdgeFact]]],
    ) -> None:
        transport_types = {
            "GRAPHQL_CLIENT": {"GRAPHQL_OPERATION", "EXTERNAL_API", "CALL_SITE"},
            "GRPC_CLIENT": {"GRPC_METHOD", "EXTERNAL_API", "CALL_SITE"},
            "RETROFIT_CLIENT": {"EXTERNAL_API", "CALL_SITE"},
        }
        proof_edge_types = {
            "RESOLVES_TO",
            "CALLS_EXTERNAL",
            "CALLS_API",
            "HANDLED_BY",
            "INVOKES_BOUNDARY",
        }
        remove: set[str] = set()
        for frontier in list(program.nodes):
            attrs = frontier.attributes or {}
            if attrs.get("aiDiscoveryReason") != "UNMODELED_OUTBOUND_CLIENT_FLOW":
                continue
            transport_name = str(attrs.get("transport") or "")
            expected_types = transport_types.get(transport_name, set())
            boundaries = []
            for node in program.nodes:
                if (
                    node.file_path != frontier.file_path
                    or node.node_type not in expected_types
                    or not cls._node_is_trusted(node)
                ):
                    continue
                frontier_line = frontier.start_line or 0
                node_start = node.start_line or 0
                node_end = node.end_line or node_start
                if frontier_line and not (node_start <= frontier_line <= node_end):
                    continue
                trusted_proof = any(
                    edge.edge_type in proof_edge_types
                    and cls._edge_is_trusted(edge)
                    and target_key in node_by_key
                    and cls._node_is_trusted(node_by_key[target_key])
                    for target_key, edge in adjacency.get(node.key, [])
                )
                if trusted_proof:
                    boundaries.append(node)
            if not boundaries:
                continue
            results = [cls._walk_ai_frontier(node.key, node_by_key, adjacency) for node in boundaries]
            if all(
                not result["ai_material"]
                and not result["technical_uncertainty"]
                for result in results
            ):
                remove.add(frontier.key)
                prefix = (
                    f"ai_discovery_unmodeled_transport:transport={transport_name}:"
                    f"file={frontier.file_path}:"
                )
                program.coverage_notes = [
                    note for note in program.coverage_notes if not note.startswith(prefix)
                ]
        if not remove:
            return
        program.nodes = [node for node in program.nodes if node.key not in remove]
        program.edges = [
            edge
            for edge in program.edges
            if edge.source_key not in remove and edge.target_key not in remove
        ]
        program.unresolved_frontiers = [
            key for key in program.unresolved_frontiers if key not in remove
        ]

    @staticmethod
    def _node_signal_text(node: SemanticNodeFact) -> str:
        attrs = node.attributes or {}
        safe_values: list[str] = []
        for key, value in attrs.items():
            if key in {"name", "semanticRole", "provider", "host", "path", "endpointSource", "configNames", "payloadHints", "protocol", "service", "method"}:
                if isinstance(value, list):
                    safe_values.extend(str(item) for item in value[:16])
                else:
                    safe_values.append(str(value))
        return " ".join([node.node_type, node.label or "", node.symbol_ref or "", *node.semantic_types, *safe_values])

    def _preserve_uncovered_source_frontiers(self, program: SemanticProgram) -> None:
        """Prevent absence closure when executable source is outside PGE language coverage."""
        examples: dict[str, str] = {}
        for path in self.workspace.rglob("*"):
            if not path.is_file():
                continue
            try:
                relative = path.relative_to(self.workspace)
            except ValueError:
                continue
            if any(part in _EXCLUDED_PARTS for part in relative.parts):
                continue
            rel = relative.as_posix()
            if not self._in_scope(rel):
                continue
            if is_test_source_path(rel):
                continue
            suffix = path.suffix.lower()
            if suffix in _SOURCE_LIKE_EXTENSIONS and suffix not in _SOURCE_EXTENSIONS:
                examples.setdefault(suffix, rel)

        for suffix, rel in sorted(examples.items()):
            language = suffix.lstrip(".") or "unknown"
            key = f"ai-coverage-unresolved:unsupported-language:{language}"
            program.add_node(
                SemanticNodeFact(
                    key,
                    "UNRESOLVED_DYNAMIC_TARGET",
                    f"AI discovery unsupported source language: {suffix}",
                    rel,
                    1,
                    1,
                    attributes={
                        "aiMaterial": True,
                        "aiDiscoveryReason": "UNSUPPORTED_SOURCE_LANGUAGE",
                        "sourceExtension": suffix,
                    },
                    coverage_state="LIMITED",
                    resolution_state="UNRESOLVED",
                )
            )
            if key not in program.unresolved_frontiers:
                program.unresolved_frontiers.append(key)
            note = f"ai_discovery_unsupported_source:extension={suffix}:example={rel}"
            if note not in program.coverage_notes:
                program.coverage_notes.append(note)

    @staticmethod
    def _preserve_unmodeled_transport_frontiers(
        program: SemanticProgram, relative: str, lines: list[str]
    ) -> None:
        """Keep client-framework flows unresolved until PGE models them end-to-end."""
        for transport, pattern in _UNMODELED_OUTBOUND_CLIENT_PATTERNS:
            for line_no, line in enumerate(lines, start=1):
                if not pattern.search(line):
                    continue
                key = f"ai-coverage-unresolved:transport:{transport}:{relative}"
                program.add_node(
                    SemanticNodeFact(
                        key,
                        "UNRESOLVED_DYNAMIC_TARGET",
                        f"unmodeled outbound client flow: {transport}",
                        relative,
                        line_no,
                        line_no,
                        attributes={
                            "aiMaterial": True,
                            "aiDiscoveryReason": "UNMODELED_OUTBOUND_CLIENT_FLOW",
                            "transport": transport,
                        },
                        coverage_state="LIMITED",
                        resolution_state="UNRESOLVED",
                    )
                )
                if key not in program.unresolved_frontiers:
                    program.unresolved_frontiers.append(key)
                note = (
                    "ai_discovery_unmodeled_transport:"
                    f"transport={transport}:file={relative}:line={line_no}"
                )
                if note not in program.coverage_notes:
                    program.coverage_notes.append(note)
                break

    def _source_files(self) -> list[Path]:
        result: list[Path] = []
        for path in self.workspace.rglob("*"):
            if (
                not path.is_file()
                or path.suffix.lower() not in _SOURCE_EXTENSIONS
            ):
                continue
            relative = path.relative_to(self.workspace)
            rel = relative.as_posix()
            if not self._in_scope(rel):
                continue
            if any(part in _EXCLUDED_PARTS for part in relative.parts):
                continue
            if is_test_source_path(rel):
                continue
            result.append(path)
        return sorted(result)

    def _environment_and_conditions(
        self,
        program: SemanticProgram,
        relative: str,
        lines: list[str],
        aliases: dict[str, str],
    ) -> None:
        for line_no, line in enumerate(lines, start=1):
            names = _env_names(line)
            if _CONDITION_RE.search(line):
                names.extend(
                    env_name
                    for alias, env_name in aliases.items()
                    if re.search(rf"\b{re.escape(alias)}\b", line)
                )
                names = list(dict.fromkeys(names))
            for name in names:
                env_key = self._env_node(program, relative, line_no, name)
                if _FEATURE_ENV_RE.search(name):
                    feature_key = f"feature-flag:{relative}:{name}"
                    program.add_node(
                        SemanticNodeFact(
                            feature_key,
                            "FEATURE_FLAG",
                            name,
                            relative,
                            line_no,
                            line_no,
                            attributes={"sourceKind": "ENV_NAME"},
                            resolution_state="UNRESOLVED",
                        )
                    )
                    program.add_edge(
                        SemanticEdgeFact(
                            "CONFIGURES",
                            env_key,
                            feature_key,
                            resolution_state="OBSERVED",
                        )
                    )
            if names and _CONDITION_RE.search(line):
                condition_key = f"control-condition:{relative}:{line_no}"
                program.add_node(
                    SemanticNodeFact(
                        condition_key,
                        "CONTROL_CONDITION",
                        "runtime configuration condition",
                        relative,
                        line_no,
                        line_no,
                        attributes={"configNames": sorted(names)},
                        resolution_state="UNRESOLVED",
                    )
                )
                for name in names:
                    program.add_edge(
                        SemanticEdgeFact(
                            "CONTROLS",
                            f"env:{relative}:{name}",
                            condition_key,
                            resolution_state="OBSERVED",
                        )
                    )

    def _outbound_candidates(
        self,
        program: SemanticProgram,
        relative: str,
        lines: list[str],
        aliases: dict[str, str],
        http_clients: _ScopedHttpClientProvenance,
    ) -> None:
        for index, line in enumerate(lines):
            call = _http_call_on_line(line, http_clients, index + 1)
            if call is None:
                continue
            call_name, call_end, transport_proven, client_config_names = call
            line_no = index + 1
            window = "\n".join(lines[index : min(len(lines), index + 5)])
            target_expression = _http_target_expression(window, call_end)
            urls = _URL_RE.findall(target_expression)
            env_names = _env_names(target_expression)
            env_names.extend(client_config_names)
            env_names.extend(
                env_name
                for alias, env_name in aliases.items()
                if re.search(rf"\b{re.escape(alias)}\b", target_expression)
            )
            env_names = list(dict.fromkeys(env_names))
            payload_hints = sorted(
                {
                    _payload_hint_name(item.group(0))
                    for item in _AI_PAYLOAD_KEY_RE.finditer(window)
                }
            )[:8]
            host = ""
            path_value = ""
            provider: str | None = None
            if urls:
                parsed = urlsplit(urls[0])
                host = parsed.hostname or ""
                path_value = parsed.path or "/"
                provider = _provider_for_host(host)
            endpoint_signature = bool(
                _AI_ENDPOINT_RE.search(path_value or target_expression)
            )
            payload_signature = bool(payload_hints)
            strong_payload_signature = len(
                set(payload_hints)
                & {"model", "messages", "prompt", "input", "tools", "contents"}
            ) >= 2
            ai_named_envs = [
                name
                for name in env_names
                if _AI_ENV_RE.search(name) and _ENDPOINT_ENV_RE.search(name)
            ]

            if not transport_proven:
                if provider or endpoint_signature or ai_named_envs or strong_payload_signature:
                    self._dynamic_outbound_frontier(
                        program,
                        relative,
                        line_no,
                        call_name,
                        reason="UNRESOLVED_HTTP_CLIENT_PROVENANCE",
                    )
                continue

            if provider and endpoint_signature:
                state = CONFIRMED_AI_CALL
                resolution = "CORROBORATED"
                clarification = "AI_PURPOSE_FEATURE_MAPPING"
            elif provider or endpoint_signature or (
                ai_named_envs and payload_signature
            ):
                state = POSSIBLE_AI_CALL
                resolution = "UNRESOLVED"
                clarification = "OUTBOUND_AI_CONFIRMATION"
            elif strong_payload_signature:
                # The endpoint may be propagated through a parameter/config object.
                # Strong AI-shaped payload evidence is enough to keep it unresolved
                # even when the destination is not lexically visible at this callsite.
                state = POSSIBLE_AI_CALL
                resolution = "UNRESOLVED"
                clarification = "OUTBOUND_AI_CONFIRMATION"
            else:
                # A literal, non-AI REST destination can remain ordinary PGE evidence.
                # A dynamic outbound target cannot prove AI absence: preserve a bounded
                # technical frontier so PGE reanalysis can follow parameters/config/DI.
                if not urls:
                    self._dynamic_outbound_frontier(
                        program, relative, line_no, call_name
                    )
                continue

            key = f"ai-api-candidate:{relative}:{line_no}:{call_name}"
            attrs: dict[str, object] = {
                "discoveryState": state,
                "clarificationOwner": "CUSTOMER",
                "clarificationKind": clarification,
                "endpointSource": (
                    "LITERAL"
                    if urls
                    else f"ENV:{ai_named_envs[0]}"
                    if ai_named_envs
                    else "DYNAMIC"
                ),
            }
            method = _method_for_call(call_name)
            if provider:
                attrs["provider"] = provider
            if host:
                attrs["host"] = host
            if path_value:
                attrs["path"] = path_value
            if method:
                attrs["method"] = method
            if payload_hints:
                attrs["payloadHints"] = payload_hints
            if ai_named_envs:
                attrs["configNames"] = sorted(ai_named_envs)
            program.add_node(
                SemanticNodeFact(
                    key,
                    "AI_API_CANDIDATE",
                    (
                        "known AI API call"
                        if state == CONFIRMED_AI_CALL
                        else "unresolved AI-capable outbound API"
                    ),
                    relative,
                    line_no,
                    line_no,
                    attributes=attrs,
                    resolution_state=resolution,
                )
            )
            call = self._call_node(program, relative, line_no)
            if call:
                program.add_edge(
                    SemanticEdgeFact(
                        "CALLS_EXTERNAL",
                        call.key,
                        key,
                        resolution_state=resolution,
                    )
                )
            for name in ai_named_envs:
                env_key = self._env_node(program, relative, line_no, name)
                program.add_edge(
                    SemanticEdgeFact(
                        "CONFIGURES",
                        env_key,
                        key,
                        resolution_state="OBSERVED",
                    )
                )

    def _dynamic_outbound_frontier(
        self,
        program: SemanticProgram,
        relative: str,
        line_no: int,
        call_name: str,
        *,
        reason: str = "DYNAMIC_OUTBOUND_TARGET",
    ) -> None:
        key = f"ai-transport-frontier:{relative}:{line_no}:{call_name}"
        program.add_node(
            SemanticNodeFact(
                key,
                "UNRESOLVED_DYNAMIC_TARGET",
                "unresolved outbound transport target",
                relative,
                line_no,
                line_no,
                attributes={
                    "aiMaterial": True,
                    "aiDiscoveryReason": reason,
                    "transport": call_name,
                },
                coverage_state="LIMITED",
                resolution_state="UNRESOLVED",
            )
        )
        call = self._call_node(program, relative, line_no)
        if call:
            program.add_edge(
                SemanticEdgeFact(
                    "CALLS_DYNAMICALLY",
                    call.key,
                    key,
                    coverage_state="LIMITED",
                    resolution_state="UNRESOLVED",
                )
            )
        if key not in program.unresolved_frontiers:
            program.unresolved_frontiers.append(key)

    def _guard_invocations(
        self,
        program: SemanticProgram,
        relative: str,
        lines: list[str],
        invocations: list[SemanticNodeFact],
        aliases: dict[str, str],
    ) -> None:
        bool_facts = _static_bool_facts(lines, relative, program)
        for invocation in invocations:
            if not invocation.start_line:
                continue
            invocation_index = invocation.start_line - 1
            invocation_window = "\n".join(
                lines[invocation_index : min(len(lines), invocation_index + 5)]
            )
            config_names = _env_names(invocation_window)
            config_names.extend(
                env_name
                for alias, env_name in aliases.items()
                if re.search(rf"\b{re.escape(alias)}\b", invocation_window)
            )
            for name in dict.fromkeys(config_names):
                env_key = self._env_node(
                    program, relative, invocation.start_line, name
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "CONFIGURES",
                        env_key,
                        invocation.key,
                        resolution_state="OBSERVED",
                    )
                )

            verified = _verified_guard_line(lines, invocation_index, aliases)
            if verified is None:
                continue
            condition_line, names, guard_mode = verified
            reachability, technical_uncertainty = self._guard_reachability(
                program,
                relative,
                lines,
                condition_line,
                names,
                guard_mode,
                bool_facts,
            )
            reachability_state = (
                "REACHABLE"
                if reachability is True
                else "UNREACHABLE"
                if reachability is False
                else "UNKNOWN"
            )
            condition_key = f"control-condition:{relative}:{condition_line}"
            program.add_node(
                SemanticNodeFact(
                    condition_key,
                    "CONTROL_CONDITION",
                    "runtime configuration condition",
                    relative,
                    condition_line,
                    condition_line,
                    attributes={
                        "configNames": sorted(names),
                        "aiMaterial": True,
                        "resolvedReachability": reachability_state,
                        "resolutionSource": (
                            "REPOSITORY_STATIC_DEF_USE"
                            if reachability is not None
                            else "UNRESOLVED_TECHNICAL_DEF_USE"
                            if technical_uncertainty
                            else "UNRESOLVED_RUNTIME"
                        ),
                    },
                    resolution_state=(
                        "CORROBORATED" if reachability is not None else "OBSERVED"
                    ),
                )
            )
            condition_source = lines[condition_line - 1]
            env_names = set(_condition_env_names(condition_source, aliases))
            for name in names:
                if name in env_names:
                    source_key = self._env_node(
                        program, relative, condition_line, name
                    )
                else:
                    source_key = f"feature-flag:{relative}:{condition_line}:{name}"
                    program.add_node(
                        SemanticNodeFact(
                            source_key,
                            "FEATURE_FLAG",
                            name,
                            relative,
                            condition_line,
                            condition_line,
                            attributes={
                                "sourceKind": "SYMBOLIC_RUNTIME_GUARD",
                                "name": name,
                                "resolvedReachability": reachability_state,
                            },
                            resolution_state=(
                                "CORROBORATED"
                                if reachability is not None
                                else "OBSERVED"
                            ),
                        )
                    )
                program.add_edge(
                    SemanticEdgeFact(
                        "CONTROLS",
                        source_key,
                        condition_key,
                        resolution_state=(
                            "CORROBORATED"
                            if reachability is not None
                            else "OBSERVED"
                        ),
                    )
                )
            program.add_edge(
                SemanticEdgeFact(
                    "GUARDS",
                    condition_key,
                    invocation.key,
                    resolution_state=(
                        "CORROBORATED" if reachability is not None else "OBSERVED"
                    ),
                )
            )
            if technical_uncertainty:
                frontier_key = f"ai-guard-frontier:{relative}:{condition_line}"
                program.add_node(
                    SemanticNodeFact(
                        frontier_key,
                        "UNRESOLVED_DYNAMIC_TARGET",
                        "unproven AI guard reachability",
                        relative,
                        condition_line,
                        condition_line,
                        attributes={
                            "aiMaterial": True,
                            "aiDiscoveryReason": "UNPROVEN_GUARD_DEF_USE_CLOSURE",
                            "configNames": sorted(names),
                        },
                        coverage_state="LIMITED",
                        resolution_state="UNRESOLVED",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "CONTROLS",
                        frontier_key,
                        condition_key,
                        coverage_state="LIMITED",
                        resolution_state="UNRESOLVED",
                    )
                )
                if frontier_key not in program.unresolved_frontiers:
                    program.unresolved_frontiers.append(frontier_key)

    def _guard_reachability(
        self,
        program: SemanticProgram,
        relative: str,
        lines: list[str],
        condition_line: int,
        names: list[str],
        guard_mode: str,
        facts: _ScopedBoolFacts,
    ) -> tuple[bool | None, bool]:
        expression = _condition_expression(lines[condition_line - 1])
        if not expression:
            return None, False
        technical_uncertainty = False
        for name in names:
            binding = facts.binding(name, condition_line)
            value = binding.value if binding is not None else None
            if binding is not None and binding.technical_frontier:
                technical_uncertainty = True
            if value is None:
                parameter = facts.parameter_context(name, condition_line)
                if parameter is not None:
                    context, index = parameter
                    value, parameter_technical = self._parameter_literal_value(
                        program, relative, context, index
                    )
                    technical_uncertainty = technical_uncertainty or parameter_technical
            if value is None:
                continue
            condition_value = _predicate_value(expression, name, value)
            if condition_value is None:
                continue
            return (
                (
                    not condition_value
                    if guard_mode == "AFTER_EARLY_EXIT"
                    else condition_value
                ),
                False,
            )
        return None, technical_uncertainty

    def _parameter_literal_value(
        self,
        program: SemanticProgram,
        relative: str,
        context: _FunctionBoolContext,
        parameter_index: int,
    ) -> tuple[bool | None, bool]:
        """Resolve a boolean parameter only from a closed, trusted PGE call set.

        Source text may veto completeness, but it never establishes call identity.
        Positive authority comes exclusively from trusted RESOLVES_TO edges targeting
        the exact repository-local function symbol.
        """
        cache_key = (
            f"{relative}:{context.name}:{context.declaration_line}:pge",
            parameter_index,
        )
        cached = self._bool_call_cache.get(cache_key)
        if cached is not None:
            return cached

        def unresolved(*, technical: bool = True) -> tuple[None, bool]:
            result = (None, technical)
            self._bool_call_cache[cache_key] = result
            return result

        symbol_candidates = [
            node
            for node in program.nodes
            if node.file_path == relative
            and node.label == context.name
            and node.start_line == context.declaration_line
            and node.node_type in {"FUNCTION", "METHOD"}
        ]
        if len(symbol_candidates) != 1:
            return unresolved()
        symbol = symbol_candidates[0]
        if not self._node_is_trusted(symbol):
            return unresolved()

        external_reachability = str(
            (symbol.attributes or {}).get("externalReachability") or ""
        ).upper()
        if external_reachability == "POSSIBLE":
            # An explicitly exported JS/TS callable or module/class-visible Python
            # callable may have callers outside repository evidence. That is a runtime
            # boundary, not a Scanner proof gap.
            return unresolved(technical=False)
        if external_reachability != "REPOSITORY_LOCAL":
            # Older/partial graph facts cannot establish closure. JS syntax still gives
            # a conservative fallback for explicit export, but never positive authority.
            if context.exported:
                return unresolved(technical=False)
            return unresolved()

        symbol_key = symbol.key
        owner_class = str((symbol.attributes or {}).get("ownerClass") or "")
        try:
            source_text = (self.workspace / relative).read_text(
                encoding="utf-8", errors="replace"
            )
        except OSError:
            return unresolved()
        node_by_key = {node.key: node for node in program.nodes}
        element_dispatch_nodes = [
            node
            for node in program.nodes
            if node.file_path == relative
            and node.node_type == "CALL_SITE"
            and (node.attributes or {}).get("elementDispatch") is True
        ]

        # Object projections belong to the abstract object, not to one lexical
        # variable spelling. Preserve every occurrence because the same binding
        # can be rebound and later write the same property on a different object.
        projection_occurrences: list[tuple[str, str, str, int]] = []
        for node in program.nodes:
            if (
                node.file_path != relative
                or (node.attributes or {}).get("memberProjection") is not True
                or not node.key.startswith("projection:")
            ):
                continue
            holder_key, property_name = node.key[len("projection:") :].rsplit(
                ":", 1
            )
            projection_occurrences.append(
                (node.key, holder_key, property_name, int(node.start_line or 0))
            )
        for node in element_dispatch_nodes:
            key = str((node.attributes or {}).get("receiverProjectionKey") or "")
            if not key.startswith("projection:"):
                continue
            holder_key, property_name = key[len("projection:") :].rsplit(
                ":", 1
            )
            projection_occurrences.append(
                (key, holder_key, property_name, int(node.start_line or 0))
            )
        projection_keys = {item[0] for item in projection_occurrences}
        # Keep alias state at the binding and source position. A variable key
        # can be assigned several times, so a file-wide union would let a
        # future write erase an alias that was valid at an earlier dispatch.
        holder_assignment_events: dict[
            str, list[tuple[int, str | None, bool, bool]]
        ] = {}
        for assignment_node in program.nodes:
            if assignment_node.file_path != relative:
                continue
            attributes = assignment_node.attributes or {}
            if (
                assignment_node.node_type != "VARIABLE"
                or attributes.get("jsAssignment") is not True
            ):
                continue
            line_no = int(attributes.get("assignmentLine") or 0)
            if line_no < 1:
                continue
            source_key = str(attributes.get("assignmentSourceKey") or "")
            rhs = str(attributes.get("assignmentRhs") or "").strip()
            rhs_references = set(
                re.findall(r"\b[A-Za-z_$][\w$]*\b", rhs)
            )
            rhs_references.difference_update(
                {"const", "let", "var", "new", "true", "false", "null"}
            )
            constructor = re.match(
                r"^new\s+([A-Za-z_$][\w$]*)\b", rhs
            )
            if constructor:
                rhs_references.discard(constructor.group(1))
            complete_object = rhs.startswith("{") and rhs.endswith("}")
            complete_array = rhs.startswith("[") and rhs.endswith("]")
            primitive = bool(
                re.match(
                    r"^(?:['\"`]|[-+]?\d|true\b|false\b|null\b)",
                    rhs,
                )
            )
            foreign = bool(
                (not source_key and primitive)
                or (not source_key and complete_object and not rhs_references)
                or (not source_key and complete_array and not rhs_references)
                or (
                    not source_key
                    and constructor is not None
                    and not rhs_references
                    and ")" in rhs
                )
            )
            holder_assignment_events.setdefault(assignment_node.key, []).append(
                (
                    line_no,
                    source_key or None,
                    bool(attributes.get("assignmentDeclaration")),
                    foreign,
                )
            )

        for events in holder_assignment_events.values():
            events.sort(key=lambda item: item[0])

        holder_reassignments: dict[str, list[tuple[int, bool]]] = {}
        for holder_key, events in holder_assignment_events.items():
            for line_no, source_key, declaration, foreign in events:
                if source_key is None and not declaration:
                    holder_reassignments.setdefault(holder_key, []).append(
                        (line_no, foreign)
                    )
                    continue
                if source_key is None:
                    continue
                source_events = holder_assignment_events.get(source_key, [])
                source_event = next(
                    (
                        event
                        for event in reversed(source_events)
                        if event[0] <= line_no
                    ),
                    None,
                )
                if (
                    source_event is not None
                    and source_event[1] is None
                    and not source_event[2]
                    and not source_event[3]
                ):
                    # The target captured an unresolved source value at this
                    # assignment, so its later projection dispatch stays
                    # technical even if the source binding is subsequently
                    # rebound.
                    holder_reassignments.setdefault(holder_key, []).append(
                        (line_no, False)
                    )

        def projection_paths_overlap(left: str, right: str) -> bool:
            left_segments = left.split(".")
            right_segments = right.split(".")
            return len(left_segments) == len(right_segments) and all(
                left_segment == right_segment
                or left_segment == "*"
                or right_segment == "*"
                for left_segment, right_segment in zip(
                    left_segments, right_segments
                )
            )

        def value_component_at(
            key: str,
            at_line: int,
            seen: frozenset[tuple[str, int]] = frozenset(),
        ) -> tuple[str, str]:
            """Resolve the object/value captured by a binding at a source line."""
            state_key = (key, at_line)
            if state_key in seen:
                return ("unresolved", f"unresolved:{key}:{at_line}")
            events = [
                event
                for event in holder_assignment_events.get(key, [])
                if event[0] <= at_line
            ]
            if not events:
                return ("known", key)
            line_no, source_key, declaration, foreign = events[-1]
            if source_key is not None:
                return value_component_at(
                    source_key,
                    line_no,
                    seen | {state_key},
                )
            if declaration:
                return ("known", key)
            if foreign:
                return ("foreign", f"foreign:{key}:{line_no}")
            return ("unresolved", f"unresolved:{key}:{line_no}")

        def projection_equivalents_at(
            receiver_holder_key: str,
            receiver_property: str,
            dispatch_line: int,
        ) -> set[str]:
            """Resolve projection aliases from value snapshots, not names."""
            receiver_state, receiver_component = value_component_at(
                receiver_holder_key, dispatch_line
            )
            if receiver_state == "unresolved":
                return set()

            def occurrence_is_relevant(
                candidate_key: str,
                candidate_line: int,
            ) -> bool:
                for edge in program.edges:
                    if (
                        edge.edge_type != "ALIASES"
                        or edge.target_key != candidate_key
                        or edge.source_key not in relevant_method_receiver_keys
                    ):
                        continue
                    edge_line = int(
                        (edge.attributes or {}).get("projectionLine") or 0
                    )
                    if edge_line == candidate_line:
                        return True
                return False

            result: set[str] = set()
            for (
                candidate_key,
                candidate_holder,
                candidate_property,
                candidate_line,
            ) in projection_occurrences:
                candidate_state, candidate_component = value_component_at(
                    candidate_holder, candidate_line or dispatch_line
                )
                if (
                    projection_paths_overlap(candidate_property, receiver_property)
                    and candidate_state != "unresolved"
                    and candidate_component == receiver_component
                    and occurrence_is_relevant(candidate_key, candidate_line)
                ):
                    result.add(candidate_key)
            return result

        # This catches local aliases, Python aliases, and callbacks represented as
        # PASSES_ARGUMENT without pretending their eventual target is known.
        for edge in program.edges:
            if edge.edge_type not in {"ALIASES", "ASSIGNS", "PASSES_ARGUMENT"}:
                continue
            source = node_by_key.get(edge.source_key)
            target = node_by_key.get(edge.target_key)
            if any(
                node is not None
                and node.file_path == relative
                and node.label == context.name
                for node in (source, target)
            ):
                return unresolved()

        resolved_edges = [
            edge
            for edge in program.edges
            if edge.edge_type == "RESOLVES_TO" and edge.target_key == symbol_key
        ]
        if not resolved_edges or any(
            not self._edge_is_trusted(edge) for edge in resolved_edges
        ):
            return unresolved()

        call_nodes: list[SemanticNodeFact] = []
        for edge in resolved_edges:
            call = node_by_key.get(edge.source_key)
            if (
                call is None
                or call.node_type != "CALL_SITE"
                or not self._node_is_trusted(call)
                or call.file_path != relative
                or not call.start_line
            ):
                return unresolved()
            call_nodes.append(call)

        trusted_call_targets: dict[tuple[int, str], set[str]] = {}
        for edge in program.edges:
            if edge.edge_type != "RESOLVES_TO" or not self._edge_is_trusted(edge):
                continue
            call = node_by_key.get(edge.source_key)
            target = node_by_key.get(edge.target_key)
            if (
                call is None
                or target is None
                or call.node_type != "CALL_SITE"
                or call.file_path != relative
                or not call.start_line
                or not self._node_is_trusted(call)
                or not self._node_is_trusted(target)
            ):
                continue
            trusted_call_targets.setdefault(
                (int(call.start_line), call.label), set()
            ).add(target.key)

        for call in call_nodes:
            if trusted_call_targets.get(
                (int(call.start_line or 0), call.label), set()
            ) != {symbol_key}:
                return unresolved()

        def resolves_to_foreign_callable(line_no: int, label: str) -> bool:
            targets = trusted_call_targets.get((line_no, label), set())
            return len(targets) == 1 and symbol_key not in targets

        relevant_method_receivers: set[str] = set()
        if symbol.node_type == "METHOD":
            method_suffix = f".{context.name}"
            relevant_method_receivers.update(
                call.label[: -len(method_suffix)]
                for call in call_nodes
                if call.label.endswith(method_suffix)
            )
            if owner_class:
                relevant_method_receivers.update(
                    match.group(1)
                    for match in re.finditer(
                        rf"\b([A-Za-z_$][\w$]*)\s*"
                        rf"(?:\:\s*[^=,;]+)?=\s*new\s+"
                        rf"{re.escape(owner_class)}\s*\(",
                        source_text,
                    )
                )

            # Receiver escape/alias closure is graph-owned. Follow only trusted
            # value-flow facts emitted by the semantic extractor, including
            # assignment, parameter, return and call-result provenance. This keeps
            # unrelated computed calls out of the target method's frontier while
            # preserving uncertainty for unresolved helper boundaries.
            flow_edges = {
                "ALIASES",
                "ASSIGNS",
                "PASSES_ARGUMENT",
                "RETURNS",
                "RECEIVES_RETURN",
                "DECLARES",
                "RESOLVES_TO",
            }
            node_by_key = {node.key: node for node in program.nodes}
            outgoing: dict[str, list[SemanticEdgeFact]] = {}
            for edge in program.edges:
                if edge.edge_type not in flow_edges or not self._edge_is_trusted(edge):
                    continue
                source_node = node_by_key.get(edge.source_key)
                target_node = node_by_key.get(edge.target_key)
                if not source_node or not target_node:
                    continue
                if source_node.file_path != relative and target_node.file_path != relative:
                    continue
                if edge.edge_type == "DECLARES" and target_node.node_type == "RETURN_VALUE":
                    # return value -> callable owner (reverse declaration edge)
                    outgoing.setdefault(edge.target_key, []).append(edge)
                elif edge.edge_type == "RESOLVES_TO" and target_node.node_type in {"FUNCTION", "METHOD"}:
                    # callable -> call site (reverse target identity)
                    outgoing.setdefault(edge.target_key, []).append(edge)
                elif edge.edge_type != "DECLARES":
                    outgoing.setdefault(edge.source_key, []).append(edge)

            queue: list[tuple[str, int]] = []
            seen_flow: set[str] = set()
            flow_incomplete = False
            reached_receiver_call_names: set[str] = set()
            relevant_method_receiver_keys: set[str] = set()
            seeded_binding_keys = {
                str((call.attributes or {}).get("receiverBindingKey"))
                for call in call_nodes
                if (call.attributes or {}).get("receiverBindingKey")
            }
            # Every concrete instance of the owning class is a governed receiver
            # for the method, including a sibling instance created in the same
            # file. Seed those declaration bindings by line rather than by label
            # so unrelated lexical shadows cannot enter the closure.
            if owner_class:
                relevant_method_receiver_keys = {
                    f"this:{owner_class}"
                }
            else:
                relevant_method_receiver_keys = set()
            if owner_class:
                instance_declaration_re = re.compile(
                    rf"\b([A-Za-z_$][\w$]*)\s*"
                    rf"(?:\:\s*[^=,;]+)?=\s*new\s+"
                    rf"{re.escape(owner_class)}\s*\("
                )
                for match in instance_declaration_re.finditer(source_text):
                    line_no = source_text.count("\n", 0, match.start()) + 1
                    name = match.group(1)
                    seeded_binding_keys.update(
                        node.key
                        for node in program.nodes
                        if node.file_path == relative
                        and node.node_type == "VARIABLE"
                        and node.label == name
                        and int(node.start_line or 0) == line_no
                    )
            relevant_method_receiver_keys.update(seeded_binding_keys)
            if seeded_binding_keys:
                queue.extend((key, 0) for key in seeded_binding_keys)
            else:
                for receiver in relevant_method_receivers:
                    for node in node_by_key.values():
                        if node.file_path == relative and node.label == receiver:
                            queue.append((node.key, 0))
            while queue:
                current, depth = queue.pop()
                if current in seen_flow:
                    continue
                seen_flow.add(current)
                current_node = node_by_key.get(current)
                if current_node is not None and not self._node_is_trusted(current_node):
                    if current_node.node_type == "RETURN_VALUE":
                        flow_incomplete = True
                    else:
                        continue
                if current_node is not None and current_node.node_type == "CALL_SITE":
                    reached_receiver_call_names.add(current_node.label)
                if depth >= _MAX_GRAPH_HOPS:
                    flow_incomplete = flow_incomplete or bool(outgoing.get(current))
                    continue
                for edge in outgoing.get(current, []):
                    next_key = edge.source_key if (
                        edge.edge_type in {"DECLARES", "RESOLVES_TO"}
                        and edge.target_key == current
                    ) else edge.target_key
                    next_node = node_by_key.get(next_key)
                    if not next_node or next_node.file_path != relative:
                        continue
                    if next_node.node_type in {"VARIABLE", "PARAMETER"}:
                        relevant_method_receiver_keys.add(next_key)
                        relevant_method_receivers.add(next_node.label)
                    queue.append((next_key, depth + 1))
            if flow_incomplete:
                return unresolved()

        declaration_spans = [
            (
                int(candidate.start_line),
                int(
                    (candidate.attributes or {}).get("bodyStartLine")
                    or candidate.start_line
                ),
            )
            for candidate in program.nodes
            if candidate.file_path == relative
            and candidate.node_type in {"FUNCTION", "METHOD"}
            and candidate.label == context.name
            and candidate.start_line
        ]
        is_declaration_line = lambda line_no: any(
            start <= line_no <= end for start, end in declaration_spans
        )
        method_call_re = re.compile(
            rf"\b(?:[A-Za-z_$][\w$]*\.)+{re.escape(context.name)}\s*\("
        )
        function_call_re = re.compile(
            rf"(?<![\w$.]){re.escape(context.name)}\s*\("
        )
        completeness_re = (
            method_call_re
            if symbol.node_type == "METHOD"
            else function_call_re
        )

        # Source text remains veto-only. Declarations are skipped using the governed
        # symbol's declaration/body span, so arrows, methods and multiline signatures
        # cannot be mistaken for callable escapes.
        for source_line_no, raw_line in enumerate(
            source_text.splitlines(), start=1
        ):
            if is_declaration_line(source_line_no):
                continue
            if symbol.node_type == "METHOD":
                element_dispatch_lines = {
                    int(node.start_line)
                    for node in element_dispatch_nodes
                    if node.start_line
                }
                for element_dispatch in element_dispatch_nodes:
                    attributes = element_dispatch.attributes or {}
                    receiver_key = str(
                        attributes.get("receiverBindingKey")
                        or ""
                    )
                    receiver_root_key = str(
                        attributes.get("receiverRootBindingKey") or ""
                    )
                    receiver_kind = str(attributes.get("receiverKind") or "")
                    receiver_call_name = str(
                        attributes.get("receiverCallName") or ""
                    )
                    constructor_class = str(
                        attributes.get("constructorClass") or ""
                    )
                    receiver_projection_key = str(
                        attributes.get("receiverProjectionKey") or ""
                    )
                    receiver_reference_keys = {
                        str(value)
                        for value in (
                            attributes.get("receiverReferenceBindingKeys")
                            or []
                        )
                        if value
                    }
                    binding_relevant = (
                        receiver_key in relevant_method_receiver_keys
                        or receiver_root_key in relevant_method_receiver_keys
                        or bool(
                            receiver_reference_keys
                            & relevant_method_receiver_keys
                        )
                    )
                    if receiver_kind == "MEMBER_PROJECTION":
                        receiver_holder_key = ""
                        receiver_property = ""
                        if receiver_projection_key.startswith("projection:"):
                            projection_value = receiver_projection_key[
                                len("projection:") :
                            ]
                            receiver_holder_key, receiver_property = (
                                projection_value.rsplit(":", 1)
                            )
                        equivalent_projection_keys = (
                            projection_equivalents_at(
                                receiver_holder_key,
                                receiver_property,
                                int(element_dispatch.start_line or 0),
                            )
                            if receiver_holder_key and receiver_property
                            else set()
                        )
                        prior_reassignments = [
                            item
                            for item in holder_reassignments.get(
                                receiver_holder_key, []
                            )
                            if item[0] < int(element_dispatch.start_line or 0)
                        ]
                        unresolved_reassignment = bool(
                            prior_reassignments
                            and not prior_reassignments[-1][1]
                        )
                        receiver_value_unresolved = False
                        if receiver_holder_key:
                            receiver_value_unresolved = (
                                value_component_at(
                                    receiver_holder_key,
                                    int(element_dispatch.start_line or 0),
                                )[0]
                                == "unresolved"
                            )
                        binding_relevant = (
                            bool(equivalent_projection_keys)
                            or unresolved_reassignment
                            or receiver_value_unresolved
                        )
                    if (
                        binding_relevant
                        or (
                            receiver_kind == "CALL_RESULT"
                            and receiver_call_name in reached_receiver_call_names
                        )
                        or (
                            receiver_kind == "NEW_INSTANCE"
                            and constructor_class == owner_class
                        )
                    ):
                        return unresolved()
                for element_call in re.finditer(
                    r"(?<![\w$])(?P<receiver>\(*\s*[A-Za-z_$][\w$]*"
                    r"(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\)*)"
                    r"\s*(?:\?\.\s*)?\[[^\]\n]+\]\s*\(",
                    raw_line.split("//", 1)[0],
                ):
                    receiver = re.sub(
                        r"[\s()]", "", element_call.group("receiver")
                    )
                    if (
                        source_line_no not in element_dispatch_lines
                        and receiver in relevant_method_receivers
                    ):
                        # This receiver can reach the governed method, but element
                        # dispatch has no canonical PGE identity. It can only veto
                        # closure; unrelated receiver dispatch is outside this call set.
                        return unresolved()
                for result_call in re.finditer(
                    r"(?<![\w$.])(?P<call>[A-Za-z_$][\w$]*)\s*\([^\n]*\)"
                    r"\s*(?:\?\.\s*)?\[[^\]\n]+\]\s*\(",
                    raw_line.split("//", 1)[0],
                ):
                    if result_call.group("call") in reached_receiver_call_names:
                        return unresolved()
            structural = _scrub_structure(raw_line)
            for reference in re.finditer(
                rf"(?<![\w$]){re.escape(context.name)}(?![\w$])",
                structural,
            ):
                prefix = structural[: reference.start()]
                suffix = structural[reference.end() :]
                direct_call = bool(re.match(r"\s*\(", suffix))
                call_label: str | None = None
                dotted = prefix.rstrip().endswith(".")
                if direct_call:
                    if dotted:
                        receiver = re.search(
                            r"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.$",
                            prefix.rstrip(),
                        )
                        if receiver:
                            call_label = f"{receiver.group(1)}.{context.name}"
                    else:
                        call_label = context.name
                if symbol.node_type == "METHOD":
                    if direct_call and dotted:
                        if call_label:
                            targets = trusted_call_targets.get(
                                (source_line_no, call_label), set()
                            )
                            if targets == {symbol_key} or resolves_to_foreign_callable(
                                source_line_no, call_label
                            ):
                                continue
                        # Optional chaining and any other dotted-looking method
                        # call without canonical PGE identity must break closure.
                        return unresolved()
                elif direct_call and not dotted:
                    continue
                if (
                    direct_call
                    and call_label
                    and resolves_to_foreign_callable(source_line_no, call_label)
                ):
                    continue
                return unresolved()

        possible_lines: list[int] = []
        for match in completeness_re.finditer(source_text):
            line_no = source_text.count("\n", 0, match.start()) + 1
            if is_declaration_line(line_no):
                continue
            label = match.group(0).split("(", 1)[0].strip()
            if resolves_to_foreign_callable(line_no, label):
                continue
            possible_lines.append(line_no)

        # Multiple calls on one line cannot be distinguished by the line-keyed call
        # identity. Treat that as incomplete technical closure rather than guessing.
        if len(possible_lines) != len(set(possible_lines)):
            return unresolved()

        trusted_lines = [int(node.start_line or 0) for node in call_nodes]
        if sorted(possible_lines) != sorted(trusted_lines):
            return unresolved()

        lines_for_call = source_text.splitlines()
        values: list[bool] = []
        for call in call_nodes:
            index = int(call.start_line or 0) - 1
            if index < 0 or index >= len(lines_for_call):
                return unresolved()
            window = "\n".join(
                lines_for_call[index : min(len(lines_for_call), index + 12)]
            )
            call_label_re = re.compile(
                rf"\b{re.escape(call.label)}\s*\("
                if "." in call.label
                else rf"(?<![\w$.]){re.escape(call.label)}\s*\("
            )
            match = call_label_re.search(window)
            if match is None:
                return unresolved()
            raw_args = _call_arguments_text(window, match.end() - 1)
            if raw_args is None:
                return unresolved()
            args = _split_top_level_args(raw_args)
            if parameter_index >= len(args):
                return unresolved()
            value = _literal_bool(args[parameter_index])
            if value is None:
                return unresolved()
            values.append(value)

        result = values[0] if values and len(set(values)) == 1 else None
        resolved = (result, result is None)
        self._bool_call_cache[cache_key] = resolved
        return resolved

    @staticmethod
    def _call_node(
        program: SemanticProgram, relative: str, line_no: int
    ) -> SemanticNodeFact | None:
        return next(
            (
                node
                for node in program.nodes
                if node.file_path == relative
                and node.start_line == line_no
                and node.node_type in {"CALL_SITE", "AI_MODEL_INVOCATION"}
            ),
            None,
        )

    @staticmethod
    def _env_node(
        program: SemanticProgram, relative: str, line_no: int, name: str
    ) -> str:
        key = f"env:{relative}:{name}"
        program.add_node(
            SemanticNodeFact(
                key,
                "ENV_SOURCE",
                name,
                relative,
                line_no,
                line_no,
                attributes={"name": name, "valuePersisted": False},
                resolution_state="UNRESOLVED",
            )
        )
        return key


def _payload_hint_name(raw: str) -> str:
    match = re.search(
        r"(?:model|messages|prompt|input|tools|embedding|contents)", raw, re.I
    )
    return match.group(0).lower() if match else "ai-payload"


def _env_aliases(lines: list[str]) -> dict[str, str]:
    """Resolve one-hop local aliases without persisting environment values."""
    aliases: dict[str, str] = {}
    for line in lines:
        names = _env_names(line)
        if not names:
            continue
        match = _ASSIGNMENT_RE.search(line)
        if not match:
            continue
        alias = match.group(1) or match.group(2)
        if alias:
            aliases[alias] = names[0]
    return aliases


def summarize_ai_discovery(graph: ProgramEvidenceGraph) -> dict[str, object]:
    """Project the full PGE into a small privacy-safe Scanner→Interview contract."""
    coverage = _coverage_state(graph.coverage_state)
    nodes = [item for item in graph.nodes if isinstance(item, dict)]
    edges = [item for item in graph.edges if isinstance(item, dict)]
    by_id = {str(node.get("node_id") or ""): node for node in nodes}
    incoming_guards: dict[str, list[dict]] = {}
    for edge in edges:
        if edge.get("edge_type") == "GUARDS":
            incoming_guards.setdefault(
                str(edge.get("target_node_id") or ""), []
            ).append(edge)

    findings: list[dict[str, object]] = []
    material_frontiers: set[str] = set()
    unguarded_confirmed = False
    guarded_confirmed = False

    for node in nodes:
        node_type = str(node.get("node_type") or "")
        attrs = (
            node.get("attributes")
            if isinstance(node.get("attributes"), dict)
            else {}
        )
        finding: dict[str, object] | None = None
        if node_type == "AI_MODEL_INVOCATION" and str(
            node.get("resolution_state") or ""
        ) in {"OBSERVED", "CORROBORATED"}:
            guards = incoming_guards.get(str(node.get("node_id") or ""), [])
            guard_name, guard_reachability, guard_resolution_source = _guard_details(guards, by_id)
            guard_technical = guard_resolution_source == "UNRESOLVED_TECHNICAL_DEF_USE"
            if guard_reachability == "UNREACHABLE":
                # Repository evidence proves this invocation cannot execute. It must
                # not fabricate a runtime Customer question or a confirmed AI call.
                continue
            if guard_name and guard_reachability != "REACHABLE":
                guarded_confirmed = True
            else:
                unguarded_confirmed = True
            finding = _finding(
                graph,
                node,
                state=CONFIRMED_AI_CALL,
                kind="SDK_INVOCATION",
                clarification_owner=("TECHNICAL" if guard_technical else "CUSTOMER"),
                clarification_kind=(
                    "TARGETED_TECHNICAL_REANALYSIS"
                    if guard_technical
                    else "AI_RUNTIME_REACHABILITY"
                    if guard_name and guard_reachability != "REACHABLE"
                    else "AI_PURPOSE_FEATURE_MAPPING"
                ),
                runtime_guard=guard_name,
            )
        elif node_type == "AI_API_CANDIDATE":
            state = str(attrs.get("discoveryState") or POSSIBLE_AI_CALL)
            if state == CONFIRMED_AI_CALL:
                unguarded_confirmed = True
            finding = _finding(
                graph,
                node,
                state=state,
                kind="OUTBOUND_API",
                clarification_owner=str(
                    attrs.get("clarificationOwner") or "CUSTOMER"
                ),
                clarification_kind=str(
                    attrs.get("clarificationKind")
                    or "OUTBOUND_AI_CONFIRMATION"
                ),
            )
        elif node_type == "SDK_CLIENT" and str(
            attrs.get("semanticRole") or ""
        ).startswith("PROVIDER_"):
            finding = _finding(
                graph,
                node,
                state=AI_PROVIDER_REFERENCE,
                kind="PROVIDER_REFERENCE",
                clarification_owner="TECHNICAL",
                clarification_kind="TARGETED_TECHNICAL_REANALYSIS",
            )
        elif (
            node_type == "PACKAGE_DEPENDENCY"
            and attrs.get("aiRelevant") is True
        ):
            finding = _finding(
                graph,
                node,
                state=AI_PROVIDER_REFERENCE,
                kind="PROVIDER_REFERENCE",
                clarification_owner="TECHNICAL",
                clarification_kind="TARGETED_TECHNICAL_REANALYSIS",
            )
        elif (
            node_type == "UNRESOLVED_DYNAMIC_TARGET"
            and attrs.get("aiMaterial") is True
        ):
            material_frontiers.add(str(node.get("node_id") or ""))
            finding = _finding(
                graph,
                node,
                state=UNRESOLVED_DYNAMIC,
                kind="DYNAMIC_TARGET",
                clarification_owner="TECHNICAL",
                clarification_kind="TARGETED_TECHNICAL_REANALYSIS",
            )
        if finding:
            findings.append(finding)

    findings = _dedupe_findings(findings)
    possible = any(
        item.get("state")
        in {POSSIBLE_AI_CALL, AI_PROVIDER_REFERENCE, UNRESOLVED_DYNAMIC}
        for item in findings
    )
    if unguarded_confirmed:
        gate = AI_CONFIRMED
    elif guarded_confirmed or possible or material_frontiers or coverage != "READY":
        gate = AI_UNKNOWN
    else:
        gate = AI_ABSENT_CONFIRMED

    return {
        "schema_version": AI_DISCOVERY_SCHEMA_VERSION,
        "gate": gate,
        "coverage_state": coverage,
        "findings": findings[:64],
        "material_unresolved_frontiers": sorted(material_frontiers)[:64],
    }


def _coverage_state(value: object) -> str:
    normalized = str(value or "").strip().upper()
    if normalized in {"READY", "SUFFICIENT"}:
        return "READY"
    if normalized in {"PARTIAL", "LIMITED"}:
        return "PARTIAL"
    return "UNAVAILABLE"


def _guard_details(
    guards: list[dict], by_id: dict[str, dict]
) -> tuple[str | None, str | None, str | None]:
    for edge in guards:
        source = by_id.get(str(edge.get("source_node_id") or ""), {})
        attrs = (
            source.get("attributes")
            if isinstance(source.get("attributes"), dict)
            else {}
        )
        names = attrs.get("configNames")
        name = str(names[0]) if isinstance(names, list) and names else None
        reachability = str(attrs.get("resolvedReachability") or "").upper() or None
        resolution_source = str(attrs.get("resolutionSource") or "").upper() or None
        if name or reachability or resolution_source:
            return name, reachability, resolution_source
    return None, None, None


def _finding(
    graph: ProgramEvidenceGraph,
    node: dict,
    *,
    state: str,
    kind: str,
    clarification_owner: str,
    clarification_kind: str,
    runtime_guard: str | None = None,
) -> dict[str, object]:
    attrs = (
        node.get("attributes")
        if isinstance(node.get("attributes"), dict)
        else {}
    )
    node_id = str(node.get("node_id") or "")
    evidence_id = "ai-evidence:" + hashlib.sha256(
        f"{graph.snapshot_id}|{node_id}|{state}|{clarification_kind}".encode()
    ).hexdigest()[:24]
    result: dict[str, object] = {
        "evidence_id": evidence_id,
        "state": state,
        "resolution_state": str(
            node.get("resolution_state") or "UNRESOLVED"
        ),
        "kind": kind,
        "clarification_owner": clarification_owner,
        "clarification_kind": clarification_kind,
        "evidence_refs": sorted(
            str(value) for value in (node.get("evidence_refs") or []) if value
        ),
    }
    for output, attr in (
        ("provider", "provider"),
        ("host", "host"),
        ("path", "path"),
        ("method", "method"),
        ("endpoint_source", "endpointSource"),
    ):
        if attrs.get(attr):
            result[output] = str(attrs[attr])[:240]
    hints = attrs.get("payloadHints")
    if isinstance(hints, list):
        result["payload_hints"] = [
            str(value)[:80] for value in hints[:8]
        ]
    if runtime_guard:
        result["runtime_guard"] = runtime_guard[:120]
    source = (
        node.get("source") if isinstance(node.get("source"), dict) else None
    )
    if source and source.get("file_path") and source.get("start_line"):
        start = max(1, int(source["start_line"]))
        raw_end = int(source.get("end_line") or start)
        end = max(start, min(raw_end, start + 6))
        source_hash = str(source.get("source_hash") or "")
        # The snippet resolver verifies the complete pinned file bytes, so only emit a
        # customer-display locator when PGE carries that exact full-file digest. A
        # synthetic locator hash would be unverifiable and must not reach Interview.
        if re.fullmatch(r"sha256:[0-9a-f]{64}", source_hash, re.I):
            result["snippet_ref"] = {
                "snapshot_id": graph.snapshot_id,
                "commit_sha": graph.commit_sha,
                "file_path": str(source["file_path"]),
                "symbol": source.get("symbol_ref"),
                "start_line": start,
                "end_line": end,
                "evidence_hash": source_hash.lower(),
                "snippet_policy": "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
            }
    return result


def _dedupe_findings(
    findings: list[dict[str, object]],
) -> list[dict[str, object]]:
    seen: set[tuple[object, ...]] = set()
    result: list[dict[str, object]] = []
    for item in sorted(
        findings, key=lambda row: str(row.get("evidence_id") or "")
    ):
        snippet = (
            item.get("snippet_ref")
            if isinstance(item.get("snippet_ref"), dict)
            else {}
        )
        key = (
            item.get("state"),
            item.get("kind"),
            snippet.get("file_path"),
            snippet.get("start_line"),
            item.get("provider"),
            item.get("endpoint_source"),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


__all__ = [
    "AIDiscoveryEnricher",
    "summarize_ai_discovery",
    "AI_CONFIRMED",
    "AI_ABSENT_CONFIRMED",
    "AI_UNKNOWN",
]
