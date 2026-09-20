"""Repository-wide static semantic extraction for Program Evidence Graph construction.

Raw source is consumed only inside the ephemeral scanner workspace. The extractor emits
normalized structure/data/control/integration facts and never emits source bodies or
literal personal/secret values.
"""
from __future__ import annotations
import ast, re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.lineage.sensitive.sensitive_data import (
    safe_external_host,
    safe_literal_metadata,
    semantic_types_for_identifier,
)

EXCLUDED_PARTS = {".git", "node_modules", "dist", "build", ".next", "coverage", "vendor", ".venv", "venv", "__pycache__"}
TEXT_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".go", ".cs", ".rs"}
JS_TEXT_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
AI_HINTS = (("OPENAI", ("openai", "chat.completions", "responses.create", "embeddings.create")), ("ANTHROPIC", ("anthropic", "messages.create")), ("GEMINI", ("google.genai", "generatecontent", "models.generate_content")), ("AZURE_OPENAI", ("azureopenai", "azure.openai")), ("BEDROCK", ("bedrock", "invoke_model", "converse")), ("HUGGINGFACE", ("huggingface", "hfinference", "inferenceclient")), ("OPENROUTER", ("openrouter",)), ("DEEPSEEK", ("deepseek",)), ("MOONSHOT", ("moonshot", "kimi")), ("LOCAL_INFERENCE", ("ollama", "localhost:11434", "/v1/chat/completions")))
HTTP_HINTS = ("requests.get", "requests.post", "requests.put", "requests.patch", "requests.delete", "httpx.get", "httpx.post", "httpx.put", "httpx.patch", "httpx.delete", "urllib.request", "fetch", "axios.get", "axios.post", "axios.put", "axios.patch", "axios.delete", "httpclient", "resttemplate", "okhttp")
HTTP_INSTANCE_METHODS = {"get", "post", "put", "patch", "delete", "request"}
BUSINESS_HINTS = (("approve", "APPROVAL", "APPROVES"), ("accept", "APPROVAL", "APPROVES"), ("reject", "REJECTION", "REJECTS"), ("deny", "REJECTION", "REJECTS"), ("rank", "RANKING", "RANKS"), ("recommend", "RECOMMENDATION", "RECOMMENDS"), ("notify", "NOTIFICATION", "TRIGGERS"), ("update_status", "STATUS_CHANGE", "UPDATES_STATUS"), ("set_status", "STATUS_CHANGE", "UPDATES_STATUS"))
HUMAN_REVIEW_HINTS = ("human_review", "manual_review", "reviewer", "manager_approval", "review_queue", "approval_queue")
HUMAN_OVERRIDE_HINTS = ("manual_override", "override", "cancel_ai", "disable_ai", "pause_ai")
PARSE_HINTS = ("json.loads", "json.parse", "safeparse", "model_validate", "parse")
SERIALIZE_HINTS = ("json.dumps", "json.stringify", "model_dump", "serialize")
VALIDATE_HINTS = ("validate", "safeparse", "schema.parse", "model_validate")
SANITIZE_HINTS = ("sanitize", "redact", "anonymize", "mask", "hash")
EVENT_HINTS = ("publish", "emit", "produce", "send_event")
DB_WRITE_HINTS = ("save", "insert", "update", "delete", "upsert", "commit")
DB_READ_HINTS = ("find", "find_one", "find_many", "select", "query", "execute")

@dataclass
class _PyFile:
    relative: str
    module: str
    tree: ast.Module
    imports: dict[str, tuple[str, str | None]] = field(default_factory=dict)
    definitions: dict[str, str] = field(default_factory=dict)
    http_clients: dict[int, dict[str, list[tuple[int, bool]]]] = field(default_factory=dict)


@dataclass(frozen=True)
class _TextClass:
    name: str
    key: str
    start_line: int
    end_line: int
    body_open: int
    body_close: int
    exported: bool


@dataclass(frozen=True)
class _TextCallable:
    name: str
    key: str
    node_type: str
    start_line: int
    end_line: int
    body_start_line: int
    params: tuple[str, ...]
    declaration_scope: int
    exported: bool
    owner_class: str | None = None
    is_static: bool = False


def _text_split_top_level(value: str, delimiter: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    quote: str | None = None
    escaped = False
    for index, char in enumerate(value):
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"', "`"}:
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif char == delimiter and depth == 0:
            parts.append(value[start:index])
            start = index + 1
    parts.append(value[start:])
    return parts


def _text_strip_js_outer_parentheses(expression: str) -> str:
    value = expression.strip()
    while value.startswith("(") and value.endswith(")"):
        depth = 0
        closes_at_end = True
        quote: str | None = None
        escaped = False
        for index, char in enumerate(value):
            if quote is not None:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = None
                continue
            if char in {"'", '"', "`"}:
                quote = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and index != len(value) - 1:
                    closes_at_end = False
                    break
        if depth != 0 or not closes_at_end:
            break
        value = value[1:-1].strip()
    return value


def _text_normalize_js_receiver(expression: str) -> tuple[str, str]:
    value = expression.strip()
    for _ in range(4):
        previous = value
        value = _text_strip_js_outer_parentheses(value)
        value = re.sub(r"^<[^>\n]+>\s*", "", value)
        value = re.sub(
            r"\s+(?:as|satisfies)\s+"
            r"[A-Za-z_$][\w$<>,.\[\]\s|&?]*$",
            "",
            value,
        ).strip()
        value = re.sub(r"!\s*$", "", value).strip()
        value = _text_strip_js_outer_parentheses(value)
        if value == previous:
            break
    if value == "this":
        return value, "THIS"
    if re.fullmatch(
        r"(?:this|[A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*)*",
        value,
    ):
        return value, "MEMBER_PROJECTION" if "." in value else "LEXICAL"
    if re.fullmatch(
        r"new\s+[A-Za-z_$][\w$]*\s*\([^()\n]*\)", value
    ):
        return value, "NEW_INSTANCE"
    if re.fullmatch(
        r"(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*\s*\([^()\n]*\)",
        value,
    ):
        return value, "CALL_RESULT"
    return value, "UNRESOLVED_RECEIVER"


def _text_computed_receiver_candidates(
    source: str,
) -> list[tuple[int, int, str, str]]:
    """Extract computed dispatch receivers over a bounded source span.

    The scanner needs the complete receiver/key/call shape, not a physical-line
    approximation. Keep the bracket expression bounded so malformed source cannot
    make this pass consume the rest of a file; callers treat an unparsed escape as
    technical uncertainty through the surrounding coverage rules.
    """
    candidates: list[tuple[int, int, str, str]] = []
    dispatch_matches = list(
        re.finditer(
            r"(?:\?\.\s*)?\[[^\]]{0,256}\]\s*\(",
            source,
            re.DOTALL,
        )
    )
    # A long but balanced computed key is still a real dispatch. Mark it as an
    # unresolved receiver rather than silently dropping it at the normalizer's
    # budget boundary.
    dispatch_matches.extend(
        re.finditer(
            r"(?:\?\.\s*)?\[[^\]]{257,4096}\]\s*\(",
            source,
            re.DOTALL,
        )
    )
    matched_brackets = {match.start() for match in dispatch_matches}
    for dispatch in dispatch_matches:
        segment = re.split(r"[;{}]", source[: dispatch.start()])[-1]
        assignment = re.search(r"(?<![=!<>])=(?!=|>)", segment)
        if assignment:
            segment = segment[assignment.end() :]
        segment = re.sub(r"^\s*(?:return|throw)\s+", "", segment)
        if re.match(r"\s*(?:if|while|for|switch)\b", segment):
            close = segment.rfind(")")
            if close >= 0:
                segment = segment[close + 1 :]
        normalized, kind = _text_normalize_js_receiver(segment)
        if normalized:
            line_no = source.count("\n", 0, dispatch.start()) + 1
            candidates.append((line_no, dispatch.start(), normalized, kind))

    # Preserve a bounded unresolved frontier for malformed or truncated source
    # where the closing bracket is absent but the token after it is visibly being
    # called. This is deliberately limited to lexical/member roots so ordinary
    # array indexing remains outside the computed-dispatch boundary.
    for opener in re.finditer(
        r"(?<![\w$])(?:this|[A-Za-z_$][\w$]*"
        r"(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\[",
        source,
    ):
        bracket_start = opener.end() - 1
        if bracket_start in matched_brackets:
            continue
        tail = source[opener.end() : opener.end() + 4096]
        # Determine ownership of the opener's closing bracket instead of
        # looking for any `]` in a broad look-ahead window. A later array or
        # object literal must not make a malformed receiver appear complete.
        depth = 1
        quote: str | None = None
        escaped = False
        line_comment = False
        block_comment = False
        statement_tail = tail
        completed = False
        index = 0
        while index < len(tail):
            character = tail[index]
            next_character = tail[index + 1] if index + 1 < len(tail) else ""
            if line_comment:
                if character == "\n":
                    line_comment = False
                index += 1
                continue
            if block_comment:
                if character == "*" and next_character == "/":
                    block_comment = False
                    index += 2
                    continue
                index += 1
                continue
            if quote is not None:
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == quote:
                    quote = None
                index += 1
                continue
            if character == "/" and next_character == "/":
                line_comment = True
                index += 2
                continue
            if character == "/" and next_character == "*":
                block_comment = True
                index += 2
                continue
            if character in {'"', "'", "`"}:
                quote = character
                index += 1
                continue
            if character == "[":
                depth += 1
            elif character == "]":
                depth -= 1
                if depth == 0:
                    completed = True
                    break
            elif character == ";" and depth == 1:
                statement_tail = tail[:index]
                break
            index += 1
        if completed:
            continue
        if not re.search(
            r"(?:[A-Za-z_$][\w$]*|['\"`])\s*\(",
            statement_tail,
            re.DOTALL,
        ):
            continue
        receiver, _kind = _text_normalize_js_receiver(
            opener.group(0)[:-1].strip()
        )
        if receiver:
            line_no = source.count("\n", 0, bracket_start) + 1
            candidates.append(
                (line_no, bracket_start, receiver, "UNRESOLVED_RECEIVER")
            )
    return candidates


class RepositorySemanticExtractor:
    """Scan every supported source file before any law/LLM-driven investigation."""
    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def extract(self, include_files: Iterable[str] | None = None) -> SemanticProgram:
        paths = self._files(include_files); program = SemanticProgram(); py = self._index_python([p for p in paths if p.suffix.lower() == ".py"], program)
        self._python(py, program)
        for path in paths:
            if path.suffix.lower() in TEXT_EXTENSIONS: self._text(path, program)
        return program

    def _files(self, include_files: Iterable[str] | None) -> list[Path]:
        values = [(self.workspace / p).resolve(strict=False) for p in include_files] if include_files is not None else [p for p in self.workspace.rglob("*") if p.is_file()]
        result = []
        for path in values:
            try: relative = path.relative_to(self.workspace)
            except ValueError: continue
            if any(part in EXCLUDED_PARTS for part in relative.parts): continue
            if path.suffix.lower() == ".py" or path.suffix.lower() in TEXT_EXTENSIONS: result.append(path)
        return sorted(set(result))

    def _index_python(self, paths: list[Path], program: SemanticProgram) -> list[_PyFile]:
        result = []
        for path in paths:
            relative = path.relative_to(self.workspace).as_posix()
            try: tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=relative)
            except (OSError, SyntaxError) as exc:
                program.coverage_notes.append(f"python_parse_failed:file={relative}:reason={type(exc).__name__}"); continue
            item = _PyFile(relative, _module(relative), tree)
            for node in tree.body:
                if isinstance(node, ast.Import):
                    for alias in node.names: item.imports[alias.asname or alias.name.split(".")[0]] = (alias.name, None)
                elif isinstance(node, ast.ImportFrom):
                    for alias in node.names: item.imports[alias.asname or alias.name] = (node.module or "", alias.name)
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): item.definitions[node.name] = _symbol_key(relative, node.name)
            item.http_clients = _python_http_client_aliases(tree, item.imports)
            result.append(item)
        return result

    def _python(self, files: list[_PyFile], program: SemanticProgram) -> None:
        modules = {item.module: item for item in files}; symbols = {(item.module, name): key for item in files for name, key in item.definitions.items()}
        for item in files:
            fkey, mkey = f"file:{item.relative}", f"module:{item.module}"
            program.add_node(SemanticNodeFact(fkey, "FILE", item.relative, file_path=item.relative, start_line=1))
            program.add_node(SemanticNodeFact(mkey, "MODULE", item.module, file_path=item.relative, start_line=1, symbol_ref=item.module)); program.add_edge(SemanticEdgeFact("CONTAINS", fkey, mkey))
            for alias, (source, symbol) in sorted(item.imports.items()):
                if symbol and (source, symbol) in symbols: target = symbols[(source, symbol)]
                elif source in modules: target = f"module:{source}"
                else:
                    package = (source.split(".")[0] if source else alias); target = f"package:{package}"; program.add_node(SemanticNodeFact(target, "PACKAGE", package, attributes={"import": source or alias}))
                program.add_edge(SemanticEdgeFact("IMPORTS", mkey, target, attributes={"alias": alias}))
            _PythonVisitor(item, program, symbols).visit(item.tree)

    def _text(self, path: Path, program: SemanticProgram) -> None:
        relative = path.relative_to(self.workspace).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            program.coverage_notes.append(
                f"text_read_failed:file={relative}:reason={type(exc).__name__}"
            )
            return
        fkey, mkey = f"file:{relative}", f"module:{relative}"
        program.add_node(
            SemanticNodeFact(
                fkey, "FILE", relative, file_path=relative, start_line=1
            )
        )
        program.add_node(
            SemanticNodeFact(
                mkey,
                "MODULE",
                relative,
                file_path=relative,
                start_line=1,
                symbol_ref=relative,
            )
        )
        program.add_edge(SemanticEdgeFact("CONTAINS", fkey, mkey))
        imports = list(
            re.finditer(
                r"(?:import\s+(?:[^'\";]+?\s+from\s+)?|require\s*\()\s*['\"]([^'\"]+)['\"]",
                text,
            )
        )
        for match in imports:
            package = (
                match.group(1).split("/")[0]
                if not match.group(1).startswith("@")
                else "/".join(match.group(1).split("/")[:2])
            )
            key = f"package:{package}"
            program.add_node(
                SemanticNodeFact(
                    key, "PACKAGE", package, attributes={"import": match.group(1)}
                )
            )
            program.add_edge(SemanticEdgeFact("IMPORTS", mkey, key))

        is_js_text = path.suffix.lower() in JS_TEXT_EXTENSIONS
        source_lines = text.splitlines()
        code_lines = _text_strip_comments(text).splitlines()
        scope_paths = _text_lexical_scope_paths(source_lines) if is_js_text else []
        exported_names = _text_exported_callable_names(text) if is_js_text else set()
        classes: tuple[_TextClass, ...] = ()
        callables: tuple[_TextCallable, ...] = ()

        if is_js_text:
            classes = _text_js_classes(text, relative, exported_names)
            callables = _text_js_callables(
                text, relative, source_lines, scope_paths, exported_names, classes
            )
            for item in classes:
                program.add_node(
                    SemanticNodeFact(
                        item.key,
                        "CLASS",
                        item.name,
                        relative,
                        item.start_line,
                        item.end_line,
                        item.name,
                        attributes={
                            "externalReachability": (
                                "POSSIBLE" if item.exported else "REPOSITORY_LOCAL"
                            )
                        },
                    )
                )
                program.add_edge(SemanticEdgeFact("DECLARES", mkey, item.key))
            class_by_name = {item.name: item for item in classes}
            for item in callables:
                attrs: dict[str, object] = {
                    "externalReachability": (
                        "POSSIBLE" if item.exported else "REPOSITORY_LOCAL"
                    ),
                    "bodyStartLine": item.body_start_line,
                    "callableKind": (
                        "METHOD" if item.node_type == "METHOD" else "FUNCTION"
                    ),
                }
                if item.owner_class:
                    attrs["ownerClass"] = item.owner_class
                    attrs["static"] = item.is_static
                program.add_node(
                    SemanticNodeFact(
                        item.key,
                        item.node_type,
                        item.name,
                        relative,
                        item.start_line,
                        item.end_line,
                        (
                            f"{item.owner_class}.{item.name}"
                            if item.owner_class
                            else item.name
                        ),
                        attributes=attrs,
                    )
                )
                owner_key = (
                    class_by_name[item.owner_class].key
                    if item.owner_class and item.owner_class in class_by_name
                    else mkey
                )
                program.add_edge(SemanticEdgeFact("DECLARES", owner_key, item.key))
                for position, param in enumerate(item.params):
                    pkey = f"param:{item.key}:{param}"
                    program.add_node(
                        SemanticNodeFact(
                            pkey,
                            "PARAMETER",
                            param,
                            relative,
                            item.start_line,
                            item.start_line,
                            (
                                f"{item.owner_class}.{item.name}:{param}"
                                if item.owner_class
                                else f"{item.name}:{param}"
                            ),
                            semantic_types=semantic_types_for_identifier(param),
                        )
                    )
                    program.add_edge(
                        SemanticEdgeFact(
                            "HAS_PARAMETER",
                            item.key,
                            pkey,
                            attributes={"position": position},
                        )
                    )
                # Keep callable return provenance in the graph so callers can
                # follow a receiver through a helper before dispatching it.
                return_key = f"return:{item.key}"
                program.add_node(
                    SemanticNodeFact(
                        return_key,
                        "RETURN_VALUE",
                        f"{item.name}:return",
                        relative,
                        item.body_start_line,
                        item.end_line,
                        item.key,
                    )
                )
                program.add_edge(SemanticEdgeFact("DECLARES", item.key, return_key))
        else:
            for match in re.finditer(
                r"\b(class|interface|function|def|func)\s+([A-Za-z_$][\w$]*)",
                text,
            ):
                kind, name = match.group(1), match.group(2)
                ntype = (
                    "INTERFACE"
                    if kind == "interface"
                    else "CLASS"
                    if kind == "class"
                    else "FUNCTION"
                )
                line = text.count("\n", 0, match.start()) + 1
                key = _symbol_key(relative, name)
                program.add_node(
                    SemanticNodeFact(
                        key, ntype, name, relative, line, line, name
                    )
                )
                program.add_edge(SemanticEdgeFact("DECLARES", mkey, key))

        function_targets: dict[str, list[_TextCallable]] = {}
        method_targets: dict[tuple[str, str], list[_TextCallable]] = {}
        class_by_name = {item.name: item for item in classes}
        for item in callables:
            if item.node_type == "METHOD" and item.owner_class:
                method_targets.setdefault((item.owner_class, item.name), []).append(item)
            elif item.node_type == "FUNCTION":
                function_targets.setdefault(item.name, []).append(item)

        def js_declaration_bindings(
            structural: str,
        ) -> list[tuple[str, str | None]]:
            declaration = re.search(r"\b(?:const|let|var)\b(.*)", structural)
            if not declaration:
                return []
            statement = declaration.group(1)

            def split_top_level(value: str, delimiter: str) -> list[str]:
                parts: list[str] = []
                start = 0
                bracket_depth = 0
                angle_depth = 0
                seen_assignment = False
                for index, char in enumerate(value):
                    if char in "([{":
                        bracket_depth += 1
                    elif char in ")]}":
                        bracket_depth = max(0, bracket_depth - 1)
                    elif (
                        not seen_assignment
                        and bracket_depth == 0
                        and char == "<"
                    ):
                        angle_depth += 1
                    elif (
                        not seen_assignment
                        and bracket_depth == 0
                        and char == ">"
                        and angle_depth > 0
                    ):
                        angle_depth -= 1
                    elif (
                        char == "="
                        and bracket_depth == 0
                        and angle_depth == 0
                    ):
                        seen_assignment = True
                    if (
                        char == delimiter
                        and bracket_depth == 0
                        and angle_depth == 0
                    ):
                        parts.append(value[start:index])
                        start = index + 1
                        seen_assignment = False
                    if (
                        char == ";"
                        and bracket_depth == 0
                        and angle_depth == 0
                    ):
                        parts.append(value[start:index])
                        return parts
                parts.append(value[start:])
                return parts

            def split_assignment(value: str) -> tuple[str, str | None]:
                bracket_depth = 0
                angle_depth = 0
                for index, char in enumerate(value):
                    if char in "([{":
                        bracket_depth += 1
                    elif char in ")]}":
                        bracket_depth = max(0, bracket_depth - 1)
                    elif bracket_depth == 0 and char == "<":
                        angle_depth += 1
                    elif bracket_depth == 0 and char == ">" and angle_depth > 0:
                        angle_depth -= 1
                    elif char == "=" and bracket_depth == 0 and angle_depth == 0:
                        return value[:index], value[index + 1 :]
                return value, None

            bindings: list[tuple[str, str | None]] = []
            for declarator in split_top_level(statement, ","):
                lhs, rhs = split_assignment(declarator)
                simple = re.fullmatch(
                    r"\s*([A-Za-z_$][\w$]*)(?:\s*:[^=]+)?\s*",
                    lhs,
                )
                if simple:
                    bindings.append((simple.group(1), rhs))
                    continue
                stripped = lhs.strip()
                if stripped.startswith(("{", "[")):
                    # Destructuring can introduce local bindings that shadow an
                    # outer class receiver. Record every identifier as unknown
                    # rather than allowing outer provenance to leak through.
                    bindings.extend(
                        (name, None)
                        for name in re.findall(r"[A-Za-z_$][\w$]*", stripped)
                    )
            return bindings

        def js_declaration_needs_continuation(structural: str) -> bool:
            declaration = re.search(r"\b(?:const|let|var)\b(.*)", structural)
            if not declaration:
                return False
            tail = declaration.group(1).strip()
            if tail.endswith(","):
                return True
            if tail.startswith(("{", "[")):
                depth = 0
                for char in tail:
                    if char in "[{":
                        depth += 1
                    elif char in "]}":
                        depth = max(0, depth - 1)
                return depth > 0
            return False

        instance_bindings: dict[
            int, dict[str, list[tuple[int, str | None]]]
        ] = {}
        if is_js_text:
            declaration_records: list[
                tuple[int, int, int, list[tuple[str, str | None]]]
            ] = []
            pending_start: int | None = None
            pending_scope: int | None = None
            pending_parts: list[str] = []

            for line_no, line in enumerate(code_lines, start=1):
                structural = re.sub(
                    r"(['\"\x60]).*?(?<!\\)\1", "", line
                ).split("//", 1)[0]
                if pending_start is not None:
                    pending_parts.append(structural)
                    combined = " ".join(pending_parts)
                    if js_declaration_needs_continuation(combined):
                        continue
                    declaration_records.append(
                        (
                            pending_start,
                            line_no,
                            pending_scope or 0,
                            js_declaration_bindings(combined),
                        )
                    )
                    pending_start = None
                    pending_scope = None
                    pending_parts = []
                    continue

                if not re.search(r"\b(?:const|let|var)\b", structural):
                    continue
                scope_id = scope_paths[line_no - 1][-1]
                if js_declaration_needs_continuation(structural):
                    pending_start = line_no
                    pending_scope = scope_id
                    pending_parts = [structural]
                    continue
                declaration_records.append(
                    (
                        line_no,
                        line_no,
                        scope_id,
                        js_declaration_bindings(structural),
                    )
                )

            if pending_start is not None:
                declaration_records.append(
                    (
                        pending_start,
                        len(source_lines),
                        pending_scope or 0,
                        js_declaration_bindings(" ".join(pending_parts)),
                    )
                )

            declared_names_by_line: dict[int, set[str]] = {}
            declared_binding_keys: dict[tuple[int, str], str] = {}
            for start_line, end_line, scope_id, bindings in declaration_records:
                names = {name for name, _rhs in bindings}
                for covered_line in range(start_line, end_line + 1):
                    declared_names_by_line.setdefault(covered_line, set()).update(names)
                for declared_name, rhs in bindings:
                    declared_binding_keys.setdefault(
                        (scope_id, declared_name),
                        f"var:{relative}:{scope_id}:{declared_name}",
                    )
                    value = rhs or ""
                    constructor = re.match(
                        r"\s*new\s+([A-Za-z_$][\w$]*)\s*\(", value
                    )
                    owner_class = (
                        constructor.group(1)
                        if constructor
                        and constructor.group(1) in class_by_name
                        else None
                    )
                    instance_bindings.setdefault(scope_id, {}).setdefault(
                        declared_name, []
                    ).append((start_line, owner_class))

            # Reassignments invalidate only the concrete lexical binding they
            # reach, and only from the reassignment line onward. Same-named
            # bindings in unrelated scopes must not erase proven provenance.
            for line_no, line in enumerate(code_lines, start=1):
                structural = re.sub(
                    r"(['\"\x60]).*?(?<!\\)\1", "", line
                ).split("//", 1)[0]
                declared_names = declared_names_by_line.get(line_no, set())
                for assignment in re.finditer(
                    r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*=(?!=|>)",
                    structural,
                ):
                    name = assignment.group(1)
                    if name in declared_names:
                        continue
                    enclosing_callables = [
                        item
                        for item in callables
                        if item.start_line <= line_no <= item.end_line
                    ]
                    if any(name in item.params for item in enclosing_callables):
                        # Parameter provenance is never inferred as a class
                        # instance here, so its mutation needs no outer binding
                        # invalidation.
                        continue
                    binding_scope = next(
                        (
                            candidate
                            for candidate in reversed(scope_paths[line_no - 1])
                            if name in instance_bindings.get(candidate, {})
                        ),
                        None,
                    )
                    if binding_scope is None:
                        binding_scope = scope_paths[line_no - 1][-1]
                    instance_bindings.setdefault(binding_scope, {}).setdefault(
                        name, []
                    ).append((line_no, None))

        def js_binding_key(name: str, line_no: int) -> str:
            if not is_js_text or line_no < 1 or line_no > len(scope_paths):
                return f"var:{relative}:unknown:{name}"
            visible_scopes = scope_paths[line_no - 1]
            parameter_candidates = [
                item
                for item in callables
                if item.start_line <= line_no <= item.end_line
                and name in item.params
                and item.declaration_scope in visible_scopes
            ]
            if parameter_candidates:
                nearest_scope = max(
                    visible_scopes.index(item.declaration_scope)
                    for item in parameter_candidates
                )
                nearest = [
                    item
                    for item in parameter_candidates
                    if visible_scopes.index(item.declaration_scope)
                    == nearest_scope
                ]
                item = min(
                    nearest,
                    key=lambda candidate: candidate.end_line - candidate.start_line,
                )
                return f"param:{item.key}:{name}"
            for scope_id in reversed(visible_scopes):
                key = declared_binding_keys.get((scope_id, name))
                if key:
                    return key
            return f"var:{relative}:{visible_scopes[-1]}:{name}"

        def resolve_instance(name: str, line_no: int) -> str | None:
            if not is_js_text or line_no < 1 or line_no > len(scope_paths):
                return None
            # Parameters are lexical bindings even though they do not appear as
            # local declaration statements. They must prevent fallback to an
            # outer same-named class instance.
            enclosing_callables = [
                item
                for item in callables
                if item.start_line <= line_no <= item.end_line
            ]
            if any(name in item.params for item in enclosing_callables):
                return None
            for scope_id in reversed(scope_paths[line_no - 1]):
                events = instance_bindings.get(scope_id, {}).get(name)
                if events is None:
                    continue
                prior = [event for event in events if event[0] <= line_no]
                # A declaration in the nearest scope shadows any outer receiver
                # provenance even before the declaration executes (TDZ / lexical
                # binding semantics). Unknown/aliased declarations carry None.
                return prior[-1][1] if prior else None
            return None

        def enclosing_class(line_no: int) -> _TextClass | None:
            matches = [
                item
                for item in classes
                if item.start_line <= line_no <= item.end_line
            ]
            return min(
                matches,
                key=lambda item: item.end_line - item.start_line,
                default=None,
            )

        http_clients = _text_http_client_aliases(text)

        def js_call_target(call_name: str, line_no: int) -> _TextCallable | None:
            if "." in call_name:
                parts = call_name.split(".")
                if len(parts) != 2:
                    return None
                receiver, method_name = parts
                owner_class: str | None = None
                if receiver == "this":
                    owner = enclosing_class(line_no)
                    owner_class = owner.name if owner else None
                else:
                    owner_class = resolve_instance(receiver, line_no)
                targets = (
                    method_targets.get((owner_class, method_name), [])
                    if owner_class
                    else []
                )
            else:
                visible = [
                    item for item in function_targets.get(call_name, [])
                    if item.declaration_scope in scope_paths[line_no - 1]
                ]
                if not visible:
                    return None
                nearest_scope = max(
                    (
                        scope_paths[line_no - 1].index(item.declaration_scope)
                        for item in visible
                    ),
                    default=-1,
                )
                targets = [
                    item for item in visible
                    if scope_paths[line_no - 1].index(item.declaration_scope) == nearest_scope
                ]
            return targets[0] if len(targets) == 1 else None

        def js_expression_references(expression: str) -> set[str]:
            # Emit governed value-flow facts for every identifier/member-chain
            # referenced by an assignment or return expression. The scanner uses
            # these graph edges, rather than re-parsing alias syntax itself.
            expression = re.sub(r"(['\"\x60]).*?(?<!\\)\1", "", expression)
            return {
                re.sub(r"\s+", "", match.group(1))
                for match in re.finditer(
                    r"(?<![\w$])([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)",
                    expression,
                )
                if match.group(1)
                not in {
                    "return",
                    "new",
                    "as",
                    "satisfies",
                    "true",
                    "false",
                    "null",
                    "undefined",
                }
            }

        def add_js_call_arguments(
            call_name: str,
            line_no: int,
            line: str,
            call_start: int,
            target: _TextCallable | None,
        ) -> None:
            if target is None or not target.params:
                return
            open_paren = line.find("(", call_start)
            close_paren = line.rfind(")")
            if open_paren < 0 or close_paren <= open_paren:
                return
            args = _text_split_top_level(line[open_paren + 1 : close_paren], ",")
            for position, argument in enumerate(args):
                if position >= len(target.params):
                    break
                parameter_key = f"param:{target.key}:{target.params[position]}"
                for source in js_expression_references(argument):
                    source_key = js_binding_key(source, line_no)
                    if not source_key.startswith("param:"):
                        program.add_node(
                            SemanticNodeFact(
                                source_key,
                                "VARIABLE",
                                source,
                                relative,
                                line_no,
                                line_no,
                                semantic_types=semantic_types_for_identifier(source),
                            )
                        )
                    program.add_edge(
                        SemanticEdgeFact(
                            "PASSES_ARGUMENT",
                            source_key,
                            parameter_key,
                            attributes={"position": position},
                        )
                    )

        # Return expressions are value-flow edges, not textual alias hints. An
        # expression that cannot be reduced is retained as an unresolved return
        # boundary so downstream closure cannot mistake omission for absence.
        for item in callables:
            return_key = f"return:{item.key}"
            for return_line_no in range(item.body_start_line, item.end_line + 1):
                return_line = source_lines[return_line_no - 1]
                return_match = re.search(r"\breturn\b\s+(.+?)(?:;|$)", return_line)
                if not return_match:
                    continue
                return_expression = return_match.group(1).strip()
                # Provider invocations are already represented by their canonical
                # call-site nodes. They are not receiver-return boundaries and must
                # not create a second unresolved frontier for the guarded method.
                if re.search(
                    r"(?:responses\.create|chat\.completions|messages\.create|"
                    r"generate[_A-Za-z]*|invoke[_A-Za-z]*model)",
                    return_expression,
                    re.I,
                ):
                    continue
                unresolved_return = (
                    "(" in return_expression
                    or "{" in return_expression
                    or "?" in return_expression
                )
                if unresolved_return:
                    program.nodes = [
                        SemanticNodeFact(
                            node.key,
                            node.node_type,
                            node.label,
                            node.file_path,
                            node.start_line,
                            node.end_line,
                            node.symbol_ref,
                            {**node.attributes, "unresolvedValueFlow": True},
                            node.semantic_types,
                            node.evidence_refs,
                            node.coverage_state,
                            node.origin,
                            "UNRESOLVED",
                            node.support_refs,
                        )
                        if node.key == return_key
                        else node
                        for node in program.nodes
                    ]
                for source in js_expression_references(return_expression):
                    source_key = js_binding_key(source, return_line_no)
                    if not source_key.startswith("param:"):
                        program.add_node(
                            SemanticNodeFact(
                                source_key,
                                "VARIABLE",
                                source,
                                relative,
                                return_line_no,
                                return_line_no,
                                semantic_types=semantic_types_for_identifier(source),
                            )
                        )
                    program.add_edge(
                        SemanticEdgeFact(
                            "RETURNS",
                            source_key,
                            return_key,
                        )
                    )

        def parse_object_property_part(
            property_part: str,
        ) -> tuple[str, str] | None:
            property_match = re.fullmatch(
                r"\s*(?:(?P<name>[A-Za-z_$][\w$]*)|"
                r"\[\s*(?P<dynamic>[^\]\n]+)\s*\])"
                r"\s*(?::\s*(?P<value>.+))?\s*",
                property_part,
                re.DOTALL,
            )
            if not property_match:
                return None
            name = property_match.group("name")
            dynamic = (property_match.group("dynamic") or "").strip()
            literal = re.fullmatch(
                r"(['\"`])([A-Za-z_$][\w$]*)\1", dynamic
            )
            property_name = name or (literal.group(2) if literal else "*")
            property_value = property_match.group("value")
            if property_value is None:
                if not name:
                    return None
                property_value = name
            return property_name, property_value

        def add_projection_value_flow(
            holder_key: str,
            holder_name: str,
            property_path: str,
            property_value: str,
            line_no: int,
        ) -> None:
            """Emit one canonical member path and recursively model object values."""
            projection_key = f"projection:{holder_key}:{property_path}"
            program.add_node(
                SemanticNodeFact(
                    projection_key,
                    "VARIABLE",
                    f"{holder_name}.{property_path}",
                    relative,
                    line_no,
                    line_no,
                    attributes={"memberProjection": True},
                )
            )
            nested_object = re.fullmatch(
                r"\s*\{(.*)\}\s*", property_value, re.DOTALL
            )
            if nested_object:
                for nested_part in _text_split_top_level(
                    nested_object.group(1), ","
                ):
                    nested_property = parse_object_property_part(nested_part)
                    if nested_property is None:
                        continue
                    nested_name, nested_value = nested_property
                    add_projection_value_flow(
                        holder_key,
                        holder_name,
                        f"{property_path}.{nested_name}",
                        nested_value,
                        line_no,
                    )
                return
            for source in js_expression_references(property_value):
                source_key = js_binding_key(source, line_no)
                if not source_key.startswith("param:"):
                    program.add_node(
                        SemanticNodeFact(
                            source_key,
                            "VARIABLE",
                            source,
                            relative,
                            line_no,
                            line_no,
                            semantic_types=semantic_types_for_identifier(
                                source
                            ),
                        )
                    )
                program.add_edge(
                    SemanticEdgeFact(
                        "ALIASES",
                        source_key,
                        projection_key,
                        attributes={
                            "property": property_path,
                            "projectionLine": line_no,
                        },
                    )
                )

        computed_dispatches_by_line: dict[
            int, list[tuple[int, str, str]]
        ] = {}
        if is_js_text:
            for (
                dispatch_line_no,
                dispatch_start,
                receiver,
                receiver_kind,
            ) in _text_computed_receiver_candidates(text):
                computed_dispatches_by_line.setdefault(
                    dispatch_line_no, []
                ).append((dispatch_start, receiver, receiver_kind))

        for line_no, line in enumerate(source_lines, start=1):
            assignment_source = (
                code_lines[line_no - 1] if line_no <= len(code_lines) else ""
            )
            assignment = re.search(
                r"\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$.]*)",
                assignment_source,
            )
            if assignment:
                left, right = assignment.group(1), assignment.group(2)
                if right not in {"async", "function"}:
                    lkey = js_binding_key(left, line_no)
                    rkey = js_binding_key(right, line_no)
                    program.add_node(
                        SemanticNodeFact(
                            lkey,
                            "VARIABLE",
                            left,
                            relative,
                            line_no,
                            line_no,
                            attributes={
                                "jsAssignment": True,
                                "assignmentLine": line_no,
                                "assignmentRhs": right,
                                "assignmentSourceKey": (
                                    js_binding_key(right, line_no)
                                    if re.fullmatch(
                                        r"[A-Za-z_$][\w$]*", right
                                    )
                                    else ""
                                ),
                                "assignmentDeclaration": bool(
                                    re.match(r"\s*(?:const|let|var)\b", line)
                                ),
                            },
                            semantic_types=semantic_types_for_identifier(left),
                        )
                    )
                    if right != "new":
                        program.add_node(
                            SemanticNodeFact(
                                rkey,
                                "VARIABLE",
                                right,
                                relative,
                                line_no,
                                line_no,
                                semantic_types=semantic_types_for_identifier(right),
                            )
                        )
                        program.add_edge(SemanticEdgeFact("ALIASES", rkey, lkey))

            # Preserve all direct value references in conditional/coalesced and
            # asserted RHS expressions as explicit graph aliases. The graph can
            # then decide whether a receiver reaches a governed method without
            # teaching the scanner every JavaScript expression form.
            full_assignment = re.search(
                r"\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)"
                r"(?:\s*:\s*[^=,;]+)?\s*=\s*(.+?)(?:;|$)",
                assignment_source,
            )
            if (
                is_js_text
                and full_assignment
                and "=>" not in full_assignment.group(2)
            ):
                left_name, rhs_expression = (
                    full_assignment.group(1),
                    full_assignment.group(2),
                )
                left_key = js_binding_key(left_name, line_no)
                program.add_node(
                    SemanticNodeFact(
                        left_key,
                        "VARIABLE",
                        left_name,
                        relative,
                        line_no,
                        line_no,
                        attributes={
                            "jsAssignment": True,
                            "assignmentLine": line_no,
                            "assignmentRhs": rhs_expression,
                            "assignmentDeclaration": bool(
                                re.match(
                                    r"\s*(?:const|let|var)\b",
                                    assignment_source,
                                )
                            ),
                            "assignmentSourceKey": (
                                js_binding_key(
                                    rhs_expression.strip(), line_no
                                )
                                if re.fullmatch(
                                    r"[A-Za-z_$][\w$]*",
                                    rhs_expression.strip(),
                                )
                                else ""
                            ),
                        },
                        semantic_types=semantic_types_for_identifier(left_name),
                    )
                )
                object_literal = re.fullmatch(
                    r"\s*\{(.*)\}\s*", rhs_expression
                )
                if object_literal:
                    for property_part in _text_split_top_level(
                        object_literal.group(1), ","
                    ):
                        property = parse_object_property_part(property_part)
                        if property is None:
                            continue
                        property_name, property_value = property
                        add_projection_value_flow(
                            left_key,
                            left_name,
                            property_name,
                            property_value,
                            line_no,
                        )
                for source in js_expression_references(rhs_expression):
                    if source == left_name:
                        continue
                    source_key = js_binding_key(source, line_no)
                    if not source_key.startswith("param:"):
                        program.add_node(
                            SemanticNodeFact(
                                source_key,
                                "VARIABLE",
                                source,
                                relative,
                                line_no,
                                line_no,
                                semantic_types=semantic_types_for_identifier(source),
                            )
                        )
                    program.add_edge(SemanticEdgeFact("ALIASES", source_key, left_key))

            assignment_call = re.search(
                r"\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*"
                r"([A-Za-z_$][\w$.]*)\s*\(",
                line,
            )
            if is_js_text and assignment_call:
                result_name, result_call = (
                    assignment_call.group(1),
                    assignment_call.group(2),
                )
                target = js_call_target(result_call, line_no)
                if target is not None:
                    call_key = f"call:{relative}:{line_no}:{result_call}"
                    result_key = js_binding_key(result_name, line_no)
                    program.add_node(
                        SemanticNodeFact(
                            result_key,
                            "VARIABLE",
                            result_name,
                            relative,
                            line_no,
                            line_no,
                            semantic_types=semantic_types_for_identifier(result_name),
                        )
                    )
                    program.add_edge(
                        SemanticEdgeFact("RECEIVES_RETURN", call_key, result_key)
                    )
            route = re.search(
                r"@(Get|Post|Put|Patch|Delete)\s*\(\s*['\"]([^'\"]*)['\"]",
                line,
                re.I,
            )
            if route:
                key = f"route:{relative}:{line_no}"
                program.add_node(
                    SemanticNodeFact(
                        key,
                        "HTTP_ROUTE",
                        f"{route.group(1).upper()} {route.group(2)}",
                        relative,
                        line_no,
                        line_no,
                        attributes={
                            "method": route.group(1).upper(),
                            "route": route.group(2),
                        },
                    )
                )
                program.add_edge(SemanticEdgeFact("DECLARES", mkey, key))

            for call in re.finditer(
                r"\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(",
                line,
            ):
                call_name = call.group(1)
                resolves_to: str | None = None
                receiver_binding_key: str | None = None
                if is_js_text:
                    parts = call_name.split(".")
                    if len(parts) == 2:
                        receiver, method_name = parts
                        if receiver != "this":
                            receiver_binding_key = js_binding_key(receiver, line_no)
                        owner_class: str | None = None
                        if receiver == "this":
                            owner = enclosing_class(line_no)
                            owner_class = owner.name if owner else None
                        else:
                            owner_class = resolve_instance(receiver, line_no)
                        targets = (
                            method_targets.get((owner_class, method_name), [])
                            if owner_class
                            else []
                        )
                        if len(targets) == 1:
                            resolves_to = targets[0].key
                self._text_call(
                    program,
                    relative,
                    line_no,
                    call_name,
                    line,
                    mkey,
                    http_clients.get(line_no, set()),
                    resolves_to=resolves_to,
                    receiver_binding_key=receiver_binding_key,
                )
                add_js_call_arguments(
                    call_name,
                    line_no,
                    line,
                    call.start(1),
                    js_call_target(call_name, line_no) if is_js_text else None,
                )

            if is_js_text:
                for call in re.finditer(
                    r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(", line
                ):
                    name = call.group(1)
                    if _is_text_function_declaration(
                        line, call.start(1), name
                    ):
                        continue
                    method_declaration = any(
                        item.node_type == "METHOD"
                        and item.name == name
                        and item.start_line == line_no
                        for item in callables
                    )
                    if method_declaration and re.fullmatch(
                        r"\s*(?:(?:public|private|protected|static|async|override|abstract)\s+)*",
                        line[: call.start(1)],
                    ):
                        continue
                    visible = [
                        item
                        for item in function_targets.get(name, [])
                        if item.declaration_scope in scope_paths[line_no - 1]
                    ]
                    if not visible:
                        continue
                    nearest_scope = max(
                        (
                            scope_paths[line_no - 1].index(item.declaration_scope)
                            for item in visible
                        ),
                        default=-1,
                    )
                    targets = [
                        item
                        for item in visible
                        if scope_paths[line_no - 1].index(item.declaration_scope)
                        == nearest_scope
                    ]
                    if len(targets) != 1:
                        continue
                    self._text_call(
                        program,
                        relative,
                        line_no,
                        name,
                        line,
                        mkey,
                        http_clients.get(line_no, set()),
                        resolves_to=targets[0].key,
                    )
                    add_js_call_arguments(
                        name, line_no, line, call.start(1), targets[0]
                    )

                for dispatch_start, receiver, receiver_kind in (
                    computed_dispatches_by_line.get(line_no, [])
                ):
                    receiver_key: str | None
                    receiver_root_key: str | None = None
                    receiver_call_name: str | None = None
                    constructor_class: str | None = None
                    receiver_projection_key: str | None = None
                    receiver_reference_keys: list[str] = []
                    for reference in js_expression_references(receiver):
                        if reference == "this":
                            continue
                        reference_root = reference.split(".", 1)[0]
                        reference_key = js_binding_key(reference_root, line_no)
                        if reference_key not in receiver_reference_keys:
                            receiver_reference_keys.append(reference_key)
                    if receiver_kind == "THIS":
                        owner_class = enclosing_class(line_no)
                        receiver_key = (
                            f"this:{owner_class.name}"
                            if owner_class is not None
                            else None
                        )
                    elif receiver_kind == "MEMBER_PROJECTION":
                        receiver_root = receiver.split(".", 1)[0]
                        receiver_key = js_binding_key(receiver_root, line_no)
                        receiver_root_key = receiver_key
                        receiver_projection_key = (
                            f"projection:{receiver_key}:{receiver.split('.', 1)[1]}"
                        )
                    elif receiver_kind == "LEXICAL":
                        receiver_key = js_binding_key(receiver, line_no)
                    elif receiver_kind == "CALL_RESULT":
                        receiver_call_name = re.sub(
                            r"\s*\([^()\n]*\)\s*$", "", receiver
                        )
                        receiver_root = receiver_call_name.split(".", 1)[0]
                        receiver_key = js_binding_key(receiver_root, line_no)
                        receiver_root_key = receiver_key
                    elif receiver_kind == "NEW_INSTANCE":
                        receiver_key = None
                        constructor = re.match(
                            r"new\s+([A-Za-z_$][\w$]*)", receiver
                        )
                        constructor_class = (
                            constructor.group(1) if constructor else None
                        )
                    else:
                        receiver_key = None
                        root = re.match(r"(?:this|[A-Za-z_$][\w$]*)", receiver)
                        if root:
                            receiver_root_key = js_binding_key(
                                root.group(0), line_no
                            )
                    self._text_call(
                        program,
                        relative,
                        line_no,
                        f"{receiver}[computed:{dispatch_start}]",
                        line,
                        mkey,
                        http_clients.get(line_no, set()),
                        receiver_binding_key=receiver_key,
                        element_dispatch=True,
                        receiver_kind=receiver_kind,
                        receiver_root_binding_key=receiver_root_key,
                        receiver_call_name=receiver_call_name,
                        receiver_projection_key=receiver_projection_key,
                        receiver_reference_binding_keys=receiver_reference_keys,
                        constructor_class=constructor_class,
                    )

                property_assignment = re.search(
                    r"(?<![\w$.])(?P<holder>[A-Za-z_$][\w$]*)"
                    r"(?P<property_path>(?:\s*\.\s*[A-Za-z_$][\w$]*|"
                    r"\s*\[\s*[^\]\n]+\s*\])+?)\s*"
                    r"=(?!=|>)\s*(?P<rhs>.+?)(?:;|$)",
                    line,
                )
                if is_js_text and property_assignment:
                    holder_name = property_assignment.group("holder")
                    property_path = property_assignment.group(
                        "property_path"
                    )
                    property_parts: list[str] = []
                    for property_match in re.finditer(
                        r"\.\s*([A-Za-z_$][\w$]*)|"
                        r"\[\s*([^\]\n]+)\s*\]",
                        property_path,
                    ):
                        dot_name, bracket_expression = property_match.groups()
                        if dot_name:
                            property_parts.append(dot_name)
                            continue
                        literal_property = re.fullmatch(
                            r"(['\"`])([A-Za-z_$][\w$]*)\1",
                            (bracket_expression or "").strip(),
                        )
                        property_parts.append(
                            literal_property.group(2)
                            if literal_property
                            else "*"
                        )
                    if not property_parts:
                        continue
                    property_name = ".".join(property_parts)
                    rhs_expression = property_assignment.group("rhs")
                    holder_key = js_binding_key(holder_name, line_no)
                    projection_key = (
                        f"projection:{holder_key}:{property_name}"
                    )
                    program.add_node(
                        SemanticNodeFact(
                            projection_key,
                            "VARIABLE",
                            f"{holder_name}.{property_name}",
                            relative,
                            line_no,
                            line_no,
                            attributes={"memberProjection": True},
                        )
                    )
                    for source in js_expression_references(rhs_expression):
                        source_key = js_binding_key(source, line_no)
                        if not source_key.startswith("param:"):
                            program.add_node(
                                SemanticNodeFact(
                                    source_key,
                                    "VARIABLE",
                                    source,
                                    relative,
                                    line_no,
                                    line_no,
                                    semantic_types=semantic_types_for_identifier(
                                        source
                                    ),
                                )
                            )
                        program.add_edge(
                            SemanticEdgeFact(
                                "ALIASES",
                                source_key,
                                projection_key,
                                attributes={
                                    "property": property_name,
                                    "projectionLine": line_no,
                                },
                            )
                        )

    def _text_call(self, program: SemanticProgram, relative: str, line: int, name: str, body: str, owner: str, http_clients: set[str], *, resolves_to: str | None = None, receiver_binding_key: str | None = None, element_dispatch: bool = False, receiver_kind: str | None = None, receiver_call_name: str | None = None, receiver_root_binding_key: str | None = None, receiver_projection_key: str | None = None, receiver_reference_binding_keys: list[str] | None = None, constructor_class: str | None = None) -> None:
        lower = name.lower(); ntype, attrs = _call_type(lower, http_clients); key = f"call:{relative}:{line}:{name}"
        if receiver_binding_key:
            attrs = {**attrs, "receiverBindingKey": receiver_binding_key}
        if element_dispatch:
            attrs = {**attrs, "elementDispatch": True}
        for attr_name, value in (
            ("receiverKind", receiver_kind),
            ("receiverCallName", receiver_call_name),
            ("receiverRootBindingKey", receiver_root_binding_key),
            ("receiverProjectionKey", receiver_projection_key),
            ("constructorClass", constructor_class),
        ):
            if value:
                attrs = {**attrs, attr_name: value}
        if receiver_reference_binding_keys:
            attrs = {
                **attrs,
                "receiverReferenceBindingKeys": receiver_reference_binding_keys,
            }
        program.add_node(SemanticNodeFact(key, ntype, name, relative, line, line, attributes=attrs)); program.add_edge(SemanticEdgeFact("CALLS", owner, key))
        if resolves_to:
            program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, resolves_to))
        _call_edges(program, key, name, relative, line)
        urls = re.findall(r"https?://[^'\"\s)]+", body)
        for raw in urls:
            host = safe_external_host(raw)
            if host and _is_http_call(lower, http_clients):
                external = f"external:{host}"; program.add_node(SemanticNodeFact(external, "EXTERNAL_API", host, attributes={"host": host})); program.add_edge(SemanticEdgeFact("SENDS_TO_EXTERNAL", key, external))

class _PythonVisitor(ast.NodeVisitor):
    def __init__(self, item: _PyFile, program: SemanticProgram, symbols: dict[tuple[str, str], str]) -> None:
        self.item, self.program, self.symbols = item, program, symbols; self.stack: list[str] = [f"module:{item.module}"]; self.scope_stack: list[ast.AST] = [item.tree]
    @property
    def owner(self) -> str: return self.stack[-1]

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        key = _symbol_key(self.item.relative, node.name); self.program.add_node(SemanticNodeFact(key, "CLASS", node.name, self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno), node.name)); self.program.add_edge(SemanticEdgeFact("DECLARES", self.owner, key))
        for base in node.bases:
            name = _name(base)
            if name:
                target = f"type:{name}"; self.program.add_node(SemanticNodeFact(target, "TYPE", name)); self.program.add_edge(SemanticEdgeFact("EXTENDS", key, target))
        self.stack.append(key); self.scope_stack.append(node); self.generic_visit(node); self.scope_stack.pop(); self.stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None: self._function(node)
    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None: self._function(node)
    def _function(self, node) -> None:
        parent_scope = self.scope_stack[-1]
        nested_callable = isinstance(parent_scope, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
        key = _python_callable_key(self.item.relative, node, nested=nested_callable)
        ntype = "METHOD" if isinstance(parent_scope, ast.ClassDef) else "FUNCTION"; symbol = node.name
        externally_reachable = isinstance(parent_scope, (ast.Module, ast.ClassDef))
        attrs = {"externalReachability": "POSSIBLE" if externally_reachable else "REPOSITORY_LOCAL"}
        self.program.add_node(SemanticNodeFact(key, ntype, node.name, self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno), symbol, attributes=attrs)); self.program.add_edge(SemanticEdgeFact("DECLARES", self.owner, key))
        for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
            pkey = f"param:{key}:{arg.arg}"; self.program.add_node(SemanticNodeFact(pkey, "PARAMETER", arg.arg, self.item.relative, arg.lineno, arg.lineno, f"{symbol}:{arg.arg}", semantic_types=semantic_types_for_identifier(arg.arg))); self.program.add_edge(SemanticEdgeFact("HAS_PARAMETER", key, pkey))
        rkey = f"return:{key}"; self.program.add_node(SemanticNodeFact(rkey, "RETURN_VALUE", f"{symbol}:return", self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno), f"{symbol}:return"))
        self.stack.append(key); self.scope_stack.append(node); [self.visit(item) for item in node.body]; self.scope_stack.pop(); self.stack.pop()

    def visit_Assign(self, node: ast.Assign) -> None:
        sources = _value_refs(node.value)
        for target_node in node.targets:
            for target in _targets(target_node):
                tkey = f"var:{self.item.relative}:{self.owner}:{target}"; self.program.add_node(SemanticNodeFact(tkey, "VARIABLE", target, self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno), semantic_types=semantic_types_for_identifier(target))); self.program.add_edge(SemanticEdgeFact("DECLARES_VARIABLE", self.owner, tkey))
                for source in sources:
                    skey = f"var:{self.item.relative}:{self.owner}:{source}"; self.program.add_node(SemanticNodeFact(skey, "VARIABLE", source, self.item.relative, node.lineno, node.lineno, semantic_types=semantic_types_for_identifier(source))); self.program.add_edge(SemanticEdgeFact("ALIASES" if _name(node.value) == source else "ASSIGNS", skey, tkey))
                if isinstance(node.value, ast.Call): self._call(node.value, result_key=tkey)
        if not isinstance(node.value, ast.Call): self.generic_visit(node.value)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None: self.visit_Assign(ast.Assign(targets=[node.target], value=node.value, lineno=node.lineno, col_offset=node.col_offset))

    def visit_Return(self, node: ast.Return) -> None:
        if node.value:
            for source in _value_refs(node.value):
                skey = f"var:{self.item.relative}:{self.owner}:{source}"; self.program.add_node(SemanticNodeFact(skey, "VARIABLE", source, self.item.relative, node.lineno, node.lineno, semantic_types=semantic_types_for_identifier(source))); self.program.add_edge(SemanticEdgeFact("RETURNS", skey, f"return:{self.owner}"))
            self.visit(node.value)

    def visit_If(self, node: ast.If) -> None:
        key = f"branch:{self.item.relative}:{node.lineno}"; self.program.add_node(SemanticNodeFact(key, "BRANCH", "if", self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno))); self.program.add_edge(SemanticEdgeFact("BRANCHES_ON", self.owner, key)); self.generic_visit(node)
    def visit_For(self, node: ast.For) -> None: self._loop(node, "for")
    def visit_While(self, node: ast.While) -> None: self._loop(node, "while")
    def _loop(self, node, label: str) -> None:
        key = f"loop:{self.item.relative}:{node.lineno}"; self.program.add_node(SemanticNodeFact(key, "LOOP", label, self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno))); self.program.add_edge(SemanticEdgeFact("LOOPS_OVER", self.owner, key)); self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None: self._call(node)
    def _call(self, node: ast.Call, result_key: str | None = None) -> str:
        name = _name(node.func); line = getattr(node, "lineno", 1)
        if not name:
            key = f"dynamic:{self.item.relative}:{line}"; self.program.add_node(SemanticNodeFact(key, "UNRESOLVED_DYNAMIC_TARGET", "dynamic_call", self.item.relative, line, getattr(node, "end_lineno", line), coverage_state="LIMITED")); self.program.unresolved_frontiers.append(key); self.program.add_edge(SemanticEdgeFact("CALLS_DYNAMICALLY", self.owner, key, coverage_state="LIMITED")); return key
        root = name.split(".")[0].lower(); active_http_clients = {root} if self._http_client_is_active(root, line) else set()
        ntype, attrs = _call_type(name.lower(), active_http_clients); key = f"call:{self.item.relative}:{line}:{name}"
        self.program.add_node(SemanticNodeFact(key, ntype, name, self.item.relative, line, getattr(node, "end_lineno", line), attributes=attrs)); self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, key)); _call_edges(self.program, key, name, self.item.relative, line)
        root = name.split(".")[0]; imported = self.item.imports.get(root)
        if imported:
            module, symbol = imported; target = self.symbols.get((module, symbol or name.split(".")[-1]))
            if target: self.program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, target))
        elif isinstance(node.func, ast.Name):
            target = self._local_callable_target(name)
            if target:
                self.program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, target))
        for index, arg in enumerate(node.args):
            for source in _value_refs(arg):
                skey = f"var:{self.item.relative}:{self.owner}:{source}"; self.program.add_node(SemanticNodeFact(skey, "VARIABLE", source, self.item.relative, line, line, semantic_types=semantic_types_for_identifier(source))); self.program.add_edge(SemanticEdgeFact("PASSES_ARGUMENT", skey, key, attributes={"position": index}))
            self.visit(arg)
        for kw in node.keywords:
            for source in _value_refs(kw.value):
                skey = f"var:{self.item.relative}:{self.owner}:{source}"; self.program.add_node(SemanticNodeFact(skey, "VARIABLE", source, self.item.relative, line, line, semantic_types=semantic_types_for_identifier(source))); self.program.add_edge(SemanticEdgeFact("PASSES_ARGUMENT", skey, key, attributes={"name": kw.arg or "**"}))
            self.visit(kw.value)
        if result_key: self.program.add_edge(SemanticEdgeFact("RECEIVES_RETURN", key, result_key))
        for arg in [*node.args, *(kw.value for kw in node.keywords)]:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                host = safe_external_host(arg.value)
                if host and _is_http_call(name.lower(), active_http_clients):
                    external = f"external:{host}"; self.program.add_node(SemanticNodeFact(external, "EXTERNAL_API", host, attributes={"host": host})); self.program.add_edge(SemanticEdgeFact("SENDS_TO_EXTERNAL", key, external))
                metadata = safe_literal_metadata(arg.value)
                if metadata:
                    literal = f"literal:{self.item.relative}:{line}:{metadata['literalType']}"; self.program.add_node(SemanticNodeFact(literal, "SECRET" if metadata["literalType"] == "SECRET" else "SENSITIVE_DATA", str(metadata["literalType"]), self.item.relative, line, line, attributes=metadata, semantic_types=(str(metadata["literalType"]),))); self.program.add_edge(SemanticEdgeFact("PASSES_ARGUMENT", literal, key))
        return key

    def _local_callable_target(self, name: str) -> str | None:
        """Resolve an unqualified Python call against the nearest lexical def."""
        for scope in reversed(self.scope_stack):
            if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)) and scope.name == name:
                nested = any(
                    parent is not scope
                    and isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
                    for parent in self.scope_stack
                )
                return _python_callable_key(self.item.relative, scope, nested=nested)
            if isinstance(scope, ast.ClassDef):
                # Method bodies do not close over class-body names as bare identifiers.
                continue
            body = getattr(scope, "body", ())
            matches = [
                child
                for child in body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                and child.name == name
            ]
            if len(matches) == 1:
                child = matches[0]
                nested = isinstance(
                    scope, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)
                )
                return _python_callable_key(self.item.relative, child, nested=nested)
            if len(matches) > 1:
                return None
        return None

    def _http_client_is_active(self, name: str, line: int) -> bool:
        lowered = name.lower()
        inside_function = False
        for scope in reversed(self.scope_stack):
            if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                inside_function = True
            elif inside_function and isinstance(scope, ast.ClassDef):
                # Python method bodies do not close over their class-body namespace.
                continue
            events = self.item.http_clients.get(id(scope), {}).get(lowered)
            if events is None:
                continue
            prior = [is_http for event_line, is_http in events if event_line <= line]
            # Any local binding shadows the same identifier in an outer scope.
            # If the local binding is declared only later, do not inherit provenance.
            return prior[-1] if prior else False
        return False

def _python_callable_key(
    relative: str, node: ast.FunctionDef | ast.AsyncFunctionDef, *, nested: bool
) -> str:
    base = _symbol_key(relative, node.name)
    return f"{base}:{node.lineno}" if nested else base


def _text_line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1


def _text_matching_delimiter(
    text: str, start: int, opening: str, closing: str
) -> int | None:
    if start < 0 or start >= len(text) or text[start] != opening:
        return None
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    index = start
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                index += 2
                continue
            index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and nxt == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and nxt == "*":
            block_comment = True
            index += 2
            continue
        if char in {'"', "'", chr(96)}:
            quote = char
            index += 1
            continue
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return None


def _text_strip_comments(source: str) -> str:
    """Remove JS comments while preserving strings and line positions."""
    result: list[str] = []
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    index = 0
    while index < len(source):
        character = source[index]
        next_character = source[index + 1] if index + 1 < len(source) else ""
        if line_comment:
            if character == "\n":
                line_comment = False
                result.append(character)
            else:
                result.append(" ")
            index += 1
            continue
        if block_comment:
            if character == "*" and next_character == "/":
                block_comment = False
                result.extend((" ", " "))
                index += 2
            elif character == "\n":
                result.append(character)
                index += 1
            else:
                result.append(" ")
                index += 1
            continue
        if quote is not None:
            result.append(character)
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            index += 1
            continue
        if character == "/" and next_character == "/":
            line_comment = True
            result.extend((" ", " "))
            index += 2
            continue
        if character == "/" and next_character == "*":
            block_comment = True
            result.extend((" ", " "))
            index += 2
            continue
        result.append(character)
        if character in {'"', "'", "`"}:
            quote = character
        index += 1
    return "".join(result)


def _text_parameter_names(raw: str) -> tuple[str, ...]:
    result: list[str] = []
    depth = 0
    current: list[str] = []
    parts: list[str] = []
    pairs = {"(": ")", "[": "]", "{": "}", "<": ">"}
    closers: list[str] = []
    quote: str | None = None
    escaped = False
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
        if char in {'"', "'", chr(96)}:
            quote = char
            current.append(char)
            continue
        if char in pairs:
            closers.append(pairs[char])
            depth += 1
            current.append(char)
            continue
        if closers and char == closers[-1]:
            closers.pop()
            depth -= 1
            current.append(char)
            continue
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    for part in parts:
        token = part.strip()
        token = re.sub(r"^(?:public|private|protected|readonly)\s+", "", token)
        token = token.lstrip(".")
        match = re.match(r"([A-Za-z_$][\w$]*)", token)
        if match and match.group(1) not in {"this"}:
            result.append(match.group(1))
    return tuple(result)


def _text_callable_body(
    text: str, close_paren: int, *, arrow: bool
) -> tuple[int, int] | None:
    limit = min(len(text), close_paren + 1000)
    if arrow:
        arrow_index = text.find("=>", close_paren + 1, limit)
        if arrow_index < 0:
            return None
        open_brace = text.find("{", arrow_index + 2, limit)
    else:
        open_brace = text.find("{", close_paren + 1, limit)
        semicolon = text.find(";", close_paren + 1, limit)
        if semicolon >= 0 and open_brace >= 0 and semicolon < open_brace:
            return None
    if open_brace < 0:
        return None
    close_brace = _text_matching_delimiter(text, open_brace, "{", "}")
    if close_brace is None:
        return None
    return open_brace, close_brace


def _text_js_classes(
    text: str, relative: str, exported_names: set[str]
) -> tuple[_TextClass, ...]:
    result: list[_TextClass] = []
    pattern = re.compile(
        r"\b(?P<export>export\s+)?(?:default\s+)?class\s+"
        r"(?P<name>[A-Za-z_$][\w$]*)[^{]*\{",
        re.MULTILINE,
    )
    for match in pattern.finditer(text):
        name = match.group("name")
        open_brace = text.find("{", match.start(), match.end())
        close_brace = _text_matching_delimiter(text, open_brace, "{", "}")
        if open_brace < 0 or close_brace is None:
            continue
        result.append(
            _TextClass(
                name=name,
                key=_symbol_key(relative, name),
                start_line=_text_line(text, match.start()),
                end_line=_text_line(text, close_brace),
                body_open=open_brace,
                body_close=close_brace,
                exported=bool(match.group("export")) or name in exported_names,
            )
        )
    return tuple(result)


def _text_js_callables(
    text: str,
    relative: str,
    lines: list[str],
    scope_paths: list[tuple[int, ...]],
    exported_names: set[str],
    classes: tuple[_TextClass, ...],
) -> tuple[_TextCallable, ...]:
    result: list[_TextCallable] = []
    seen: set[tuple[int, str, str | None]] = set()

    def declaration_scope(line_no: int) -> int:
        if line_no < 1 or line_no > len(scope_paths):
            return 0
        return scope_paths[line_no - 1][-1]

    def add_function(
        name: str,
        start: int,
        open_paren: int,
        close_paren: int,
        *,
        arrow: bool,
        exported: bool,
    ) -> None:
        body = _text_callable_body(text, close_paren, arrow=arrow)
        if body is None:
            return
        open_brace, close_brace = body
        start_line = _text_line(text, start)
        scope_id = declaration_scope(start_line)
        key = (
            _symbol_key(relative, name)
            if scope_id == 0
            else f"{_symbol_key(relative, name)}:{start_line}"
        )
        identity = (start_line, name, None)
        if identity in seen:
            return
        seen.add(identity)
        result.append(
            _TextCallable(
                name=name,
                key=key,
                node_type="FUNCTION",
                start_line=start_line,
                end_line=_text_line(text, close_brace),
                body_start_line=_text_line(text, open_brace),
                params=_text_parameter_names(text[open_paren + 1 : close_paren]),
                declaration_scope=scope_id,
                exported=exported or name in exported_names,
            )
        )

    function_re = re.compile(
        r"\b(?P<export>export\s+)?(?:default\s+)?(?:async\s+)?function\s+"
        r"(?P<name>[A-Za-z_$][\w$]*)\s*\(",
        re.MULTILINE,
    )
    for match in function_re.finditer(text):
        open_paren = match.end() - 1
        close_paren = _text_matching_delimiter(text, open_paren, "(", ")")
        if close_paren is not None:
            add_function(
                match.group("name"),
                match.start(),
                open_paren,
                close_paren,
                arrow=False,
                exported=bool(match.group("export")),
            )

    arrow_re = re.compile(
        r"\b(?P<export>export\s+)?(?:const|let|var)\s+"
        r"(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(",
        re.MULTILINE,
    )
    for match in arrow_re.finditer(text):
        open_paren = match.end() - 1
        close_paren = _text_matching_delimiter(text, open_paren, "(", ")")
        if close_paren is not None:
            tail = text[close_paren + 1 : min(len(text), close_paren + 1000)]
            if "=>" not in tail:
                continue
            add_function(
                match.group("name"),
                match.start(),
                open_paren,
                close_paren,
                arrow=True,
                exported=bool(match.group("export")),
            )

    function_expr_re = re.compile(
        r"\b(?P<export>export\s+)?(?:const|let|var)\s+"
        r"(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(",
        re.MULTILINE,
    )
    for match in function_expr_re.finditer(text):
        open_paren = match.end() - 1
        close_paren = _text_matching_delimiter(text, open_paren, "(", ")")
        if close_paren is not None:
            add_function(
                match.group("name"),
                match.start(),
                open_paren,
                close_paren,
                arrow=False,
                exported=bool(match.group("export")),
            )

    method_re = re.compile(
        r"(?m)^[ \t]*(?P<mods>(?:(?:public|private|protected|static|async|override|abstract)\s+)*)"
        r"(?P<name>[A-Za-z_$][\w$]*)\s*\("
    )
    for cls in classes:
        class_scope: int | None = None
        open_line = _text_line(text, cls.body_open)
        if open_line < len(scope_paths):
            class_scope = scope_paths[open_line][-1]
        body = text[cls.body_open + 1 : cls.body_close]
        for match in method_re.finditer(body):
            name = match.group("name")
            if name in {"if", "for", "while", "switch", "catch"}:
                continue
            absolute_start = cls.body_open + 1 + match.start()
            start_line = _text_line(text, absolute_start)
            if (
                class_scope is not None
                and start_line <= len(scope_paths)
                and scope_paths[start_line - 1][-1] != class_scope
            ):
                continue
            open_paren = cls.body_open + 1 + match.end() - 1
            close_paren = _text_matching_delimiter(text, open_paren, "(", ")")
            if close_paren is None:
                continue
            callable_body = _text_callable_body(text, close_paren, arrow=False)
            if callable_body is None:
                continue
            open_brace, close_brace = callable_body
            if close_brace > cls.body_close:
                continue
            identity = (start_line, name, cls.name)
            if identity in seen:
                continue
            seen.add(identity)
            result.append(
                _TextCallable(
                    name=name,
                    key=f"symbol:{relative}:{cls.name}.{name}:{start_line}",
                    node_type="METHOD",
                    start_line=start_line,
                    end_line=_text_line(text, close_brace),
                    body_start_line=_text_line(text, open_brace),
                    params=_text_parameter_names(
                        text[open_paren + 1 : close_paren]
                    ),
                    declaration_scope=class_scope or 0,
                    exported=cls.exported,
                    owner_class=cls.name,
                    is_static="static" in (match.group("mods") or "").split(),
                )
            )
    return tuple(
        sorted(
            result,
            key=lambda item: (
                item.start_line,
                item.owner_class or "",
                item.name,
            ),
        )
    )


def _text_lexical_scope_paths(lines: list[str]) -> list[tuple[int, ...]]:
    """Return conservative brace-scope ancestry for JS/TS source lines."""
    paths: list[tuple[int, ...]] = []
    stack = [0]
    next_scope = 1

    def scrub(line: str) -> str:
        value = re.sub(r"(['\"\x60]).*?(?<!\\)\1", "", line)
        return value.split("//", 1)[0]

    for line in lines:
        structural = scrub(line)
        leading = len(structural) - len(structural.lstrip("}"))
        for _ in range(min(leading, max(0, len(stack) - 1))):
            stack.pop()
        paths.append(tuple(stack))
        remainder = structural.lstrip("}") if leading else structural
        for char in remainder:
            if char == "{":
                stack.append(next_scope)
                next_scope += 1
            elif char == "}" and len(stack) > 1:
                stack.pop()
    return paths


def _text_exported_callable_names(text: str) -> set[str]:
    """Return JS/TS callable names explicitly exposed by module syntax."""
    exported = {
        match.group(1)
        for match in re.finditer(
            r"\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)",
            text,
        )
    }
    exported.update(
        match.group(1)
        for match in re.finditer(
            r"\bexport\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)",
            text,
        )
    )
    exported.update(
        match.group(1)
        for match in re.finditer(
            r"\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)",
            text,
        )
    )
    for match in re.finditer(r"\bexport\s*\{([^}]*)\}", text, re.S):
        for item in match.group(1).split(","):
            raw = item.strip()
            if not raw:
                continue
            exported.add(re.split(r"\s+as\s+", raw, maxsplit=1)[0].strip())
    exported.update(
        match.group(1)
        for match in re.finditer(
            r"\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=",
            text,
        )
    )
    for match in re.finditer(r"\bmodule\.exports\s*=\s*\{([^}]*)\}", text, re.S):
        for item in match.group(1).split(","):
            name_match = re.match(r"\s*([A-Za-z_$][\w$]*)", item)
            if name_match:
                exported.add(name_match.group(1))
    return exported


def _is_text_function_declaration(line: str, name_start: int, name: str) -> bool:
    prefix = line[:name_start]
    return bool(
        re.search(r"(?:\bfunction|\bdef|\bfunc)\s*$", prefix)
        or re.search(rf"\b(?:const|let|var)\s+{re.escape(name)}\s*=\s*(?:async\s*)?$", prefix)
    )


def _is_http_call(lower: str, http_clients: set[str] | None = None) -> bool:
    if any(h in lower for h in HTTP_HINTS):
        return True
    root, _, method = lower.partition(".")
    return bool(http_clients and root in http_clients and method in HTTP_INSTANCE_METHODS)

def _call_type(lower: str, http_clients: set[str] | None = None) -> tuple[str, dict[str, object]]:
    for provider, hints in AI_HINTS:
        if any(h in lower for h in hints): return "AI_MODEL_INVOCATION", {"provider": provider}
    if _is_http_call(lower, http_clients): return "CALL_SITE", {"integrationType": "HTTP"}
    if any(h in lower for h in PARSE_HINTS): return "PARSER", {}
    if any(h in lower for h in SERIALIZE_HINTS): return "SERIALIZER", {}
    if any(h in lower for h in VALIDATE_HINTS): return "VALIDATOR", {}
    if any(h in lower for h in HUMAN_REVIEW_HINTS): return "HUMAN_REVIEW", {}
    if any(h in lower for h in HUMAN_OVERRIDE_HINTS): return "HUMAN_OVERRIDE", {}
    return "CALL_SITE", {}


def _resolved_import_name(name: str, imports: dict[str, tuple[str, str | None]]) -> str:
    root, *rest = name.split(".")
    imported = imports.get(root)
    if not imported:
        return name
    module, symbol = imported
    prefix = ".".join(part for part in (module, symbol) if part)
    return ".".join(part for part in (prefix, *rest) if part)

def _is_python_http_constructor(name: str, imports: dict[str, tuple[str, str | None]]) -> bool:
    resolved = _resolved_import_name(name, imports).lower()
    return resolved in {"httpx.asyncclient", "httpx.client", "requests.session"}

def _python_http_client_aliases(
    tree: ast.Module, imports: dict[str, tuple[str, str | None]]
) -> dict[int, dict[str, list[tuple[int, bool]]]]:
    """Index HTTP client provenance by lexical scope and binding event."""
    result: dict[int, dict[str, list[tuple[int, bool]]]] = {}
    scope_types = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)

    def add(table: dict[str, list[tuple[int, bool]]], name: str, line: int, is_http: bool) -> None:
        table.setdefault(name.lower(), []).append((line, is_http))

    def scope_nodes(scope: ast.AST):
        stack = list(reversed(list(getattr(scope, "body", []))))
        while stack:
            node = stack.pop()
            yield node
            if isinstance(node, scope_types):
                continue
            stack.extend(reversed(list(ast.iter_child_nodes(node))))

    def nested_scopes(scope: ast.AST):
        stack = list(reversed(list(getattr(scope, "body", []))))
        while stack:
            node = stack.pop()
            if isinstance(node, scope_types):
                yield node
                continue
            stack.extend(reversed(list(ast.iter_child_nodes(node))))

    def collect(scope: ast.AST) -> None:
        table: dict[str, list[tuple[int, bool]]] = {}
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            args = scope.args
            params = [*args.posonlyargs, *args.args, *args.kwonlyargs]
            if args.vararg:
                params.append(args.vararg)
            if args.kwarg:
                params.append(args.kwarg)
            for arg in params:
                add(table, arg.arg, getattr(arg, "lineno", getattr(scope, "lineno", 1)), False)

        for node in scope_nodes(scope):
            if isinstance(node, ast.Assign):
                is_http = isinstance(node.value, ast.Call) and _is_python_http_constructor(_name(node.value.func), imports)
                for target in node.targets:
                    for name in _targets(target):
                        add(table, name, node.lineno, is_http)
            elif isinstance(node, ast.AnnAssign):
                value = node.value
                is_http = isinstance(value, ast.Call) and _is_python_http_constructor(_name(value.func), imports)
                for name in _targets(node.target):
                    add(table, name, node.lineno, is_http)
            elif isinstance(node, (ast.With, ast.AsyncWith)):
                for item in node.items:
                    if item.optional_vars is None:
                        continue
                    context = item.context_expr
                    is_http = isinstance(context, ast.Call) and _is_python_http_constructor(_name(context.func), imports)
                    for name in _targets(item.optional_vars):
                        add(table, name, node.lineno, is_http)
            elif isinstance(node, (ast.For, ast.AsyncFor)):
                for name in _targets(node.target):
                    add(table, name, node.lineno, False)
            elif isinstance(node, ast.AugAssign):
                for name in _targets(node.target):
                    add(table, name, node.lineno, False)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    add(table, alias.asname or alias.name.split(".")[0], node.lineno, False)

        for events in table.values():
            events.sort(key=lambda item: item[0])
        result[id(scope)] = table
        for nested in nested_scopes(scope):
            collect(nested)

    collect(tree)
    return result

def _text_http_client_aliases(text: str) -> dict[int, set[str]]:
    """Resolve text-language HTTP clients per lexical scope and source line."""
    lines = text.splitlines()
    paths: list[tuple[int, ...]] = []
    opened_by_line: dict[int, list[int]] = {}
    stack = [0]
    next_scope = 1

    def scrub(line: str) -> str:
        value = re.sub(r"(['\"`]).*?(?<!\\)\1", "", line)
        return value.split("//", 1)[0]

    for line_no, line in enumerate(lines, start=1):
        structural = scrub(line)
        leading = len(structural) - len(structural.lstrip("}"))
        for _ in range(min(leading, max(0, len(stack) - 1))):
            stack.pop()
        paths.append(tuple(stack))
        opened: list[int] = []
        remainder = structural.lstrip("}") if leading else structural
        for char in remainder:
            if char == "{":
                stack.append(next_scope)
                opened.append(next_scope)
                next_scope += 1
            elif char == "}" and len(stack) > 1:
                stack.pop()
        if opened:
            opened_by_line[line_no] = opened

    bindings: dict[int, dict[str, list[tuple[int, bool]]]] = {}
    positive_patterns = (
        r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*axios\.create\s*\(",
        r"\b([A-Za-z_$][\w$]*)\s*=\s*requests\.Session\s*\(",
        r"\b([A-Za-z_$][\w$]*)\s*=\s*httpx\.(?:AsyncClient|Client)\s*\(",
    )

    def add(scope_id: int, name: str, line_no: int, value: bool) -> None:
        bindings.setdefault(scope_id, {}).setdefault(name.lower(), []).append((line_no, value))

    for line_no, line in enumerate(lines, start=1):
        scope_id = paths[line_no - 1][-1]
        positives: set[str] = set()
        for pattern in positive_patterns:
            for match in re.finditer(pattern, line, re.I):
                positives.add(match.group(1).lower())
                add(scope_id, match.group(1), line_no, True)
        assignment = re.search(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", line)
        if assignment and assignment.group(1).lower() not in positives:
            add(scope_id, assignment.group(1), line_no, False)
        opened = opened_by_line.get(line_no, [])
        if opened and (re.search(r"\bfunction\b|=>", line) or re.match(r"\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(", line)):
            params = re.search(r"\(([^)]*)\)", line)
            if params:
                for raw in params.group(1).split(","):
                    match = re.match(r"\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)", raw)
                    if match:
                        add(opened[0], match.group(1), line_no, False)

    names = {name for scope in bindings.values() for name in scope}
    active_by_line: dict[int, set[str]] = {}
    for line_no, path in enumerate(paths, start=1):
        active: set[str] = set()
        for name in names:
            for scope_id in reversed(path):
                events = bindings.get(scope_id, {}).get(name)
                if events is None:
                    continue
                prior = [value for event_line, value in events if event_line <= line_no]
                if prior and prior[-1]:
                    active.add(name)
                break
        active_by_line[line_no] = active
    return active_by_line

def _call_edges(program: SemanticProgram, call_key: str, name: str, file_path: str, line: int) -> None:
    lower = name.lower()
    for provider, hints in AI_HINTS:
        if any(h in lower for h in hints):
            pkey = f"ai-provider:{provider}"; program.add_node(SemanticNodeFact(pkey, "AI_PROVIDER", provider, attributes={"provider": provider})); program.add_edge(SemanticEdgeFact("SENDS_TO_AI", call_key, pkey)); break
    transform = "PARSES" if any(h in lower for h in PARSE_HINTS) else "SERIALIZES" if any(h in lower for h in SERIALIZE_HINTS) else "VALIDATES" if any(h in lower for h in VALIDATE_HINTS) else "SANITIZES" if any(h in lower for h in SANITIZE_HINTS) else None
    if transform:
        tkey = f"transform:{file_path}:{line}:{name}"; ntype = {"PARSES": "PARSER", "SERIALIZES": "SERIALIZER", "VALIDATES": "VALIDATOR", "SANITIZES": "TRANSFORMATION"}[transform]; program.add_node(SemanticNodeFact(tkey, ntype, name, file_path, line, line)); program.add_edge(SemanticEdgeFact(transform, call_key, tkey))
    for hint, ntype, edge in BUSINESS_HINTS:
        if hint in lower:
            akey = f"business:{file_path}:{line}:{ntype}"; program.add_node(SemanticNodeFact(akey, ntype, name, file_path, line, line, attributes={"actionCategory": ntype})); program.add_edge(SemanticEdgeFact(edge, call_key, akey)); break
    if any(h in lower for h in EVENT_HINTS):
        ekey = f"event:{file_path}:{line}"; program.add_node(SemanticNodeFact(ekey, "EVENT", "event", file_path, line, line)); program.add_edge(SemanticEdgeFact("PUBLISHES_EVENT", call_key, ekey))
    if any(lower.endswith(f".{h}") or lower == h for h in DB_WRITE_HINTS):
        dkey = f"persistence:{file_path}:{line}:write"; program.add_node(SemanticNodeFact(dkey, "REPOSITORY_ACCESS", name, file_path, line, line, attributes={"operation": "WRITE"})); program.add_edge(SemanticEdgeFact("WRITES_TO", call_key, dkey))
    elif any(lower.endswith(f".{h}") or lower == h for h in DB_READ_HINTS):
        dkey = f"persistence:{file_path}:{line}:read"; program.add_node(SemanticNodeFact(dkey, "REPOSITORY_ACCESS", name, file_path, line, line, attributes={"operation": "READ"})); program.add_edge(SemanticEdgeFact("READS_FROM", call_key, dkey))

def _module(relative: str) -> str:
    value = relative[:-3] if relative.endswith(".py") else relative; return value.replace("/", ".").rstrip(".__init__")
def _symbol_key(path: str, name: str) -> str: return f"symbol:{path}:{name}"
def _name(node: ast.AST | None) -> str:
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Attribute):
        base = _name(node.value); return f"{base}.{node.attr}" if base else node.attr
    return ""
def _targets(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Name): return [node.id]
    if isinstance(node, ast.Attribute): return [_name(node)]
    if isinstance(node, (ast.Tuple, ast.List)): return [v for item in node.elts for v in _targets(item)]
    return []
def _value_refs(node: ast.AST) -> list[str]:
    values = []
    for item in ast.walk(node):
        if isinstance(item, ast.Name): values.append(item.id)
        elif isinstance(item, ast.Attribute):
            name = _name(item)
            if name: values.append(name)
    return list(dict.fromkeys(values))[:100]
