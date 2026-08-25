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
AI_HINTS = (("OPENAI", ("openai", "chat.completions", "responses.create", "embeddings.create")), ("ANTHROPIC", ("anthropic", "messages.create")), ("GEMINI", ("google.genai", "generatecontent", "models.generate_content")), ("AZURE_OPENAI", ("azureopenai", "azure.openai")), ("BEDROCK", ("bedrock", "invoke_model", "converse")), ("HUGGINGFACE", ("huggingface", "hfinference", "inferenceclient")), ("OPENROUTER", ("openrouter",)), ("DEEPSEEK", ("deepseek",)), ("MOONSHOT", ("moonshot", "kimi")), ("LOCAL_INFERENCE", ("ollama", "localhost:11434", "/v1/chat/completions")))
HTTP_HINTS = ("requests.get", "requests.post", "requests.put", "requests.patch", "requests.delete", "httpx.get", "httpx.post", "httpx.put", "httpx.patch", "httpx.delete", "urllib.request", "fetch", "axios.get", "axios.post", "axios.put", "axios.patch", "axios.delete", "httpclient", "resttemplate", "okhttp")
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
        try: text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            program.coverage_notes.append(f"text_read_failed:file={relative}:reason={type(exc).__name__}"); return
        fkey, mkey = f"file:{relative}", f"module:{relative}"
        program.add_node(SemanticNodeFact(fkey, "FILE", relative, file_path=relative, start_line=1)); program.add_node(SemanticNodeFact(mkey, "MODULE", relative, file_path=relative, start_line=1, symbol_ref=relative)); program.add_edge(SemanticEdgeFact("CONTAINS", fkey, mkey))
        imports = list(re.finditer(r"(?:import\s+(?:[^'\";]+?\s+from\s+)?|require\s*\()\s*['\"]([^'\"]+)['\"]", text))
        for match in imports:
            package = match.group(1).split("/")[0] if not match.group(1).startswith("@") else "/".join(match.group(1).split("/")[:2]); key = f"package:{package}"
            program.add_node(SemanticNodeFact(key, "PACKAGE", package, attributes={"import": match.group(1)})); program.add_edge(SemanticEdgeFact("IMPORTS", mkey, key))
        symbols: list[tuple[str, str]] = []
        for match in re.finditer(r"\b(class|interface|function|def|func)\s+([A-Za-z_$][\w$]*)", text):
            kind, name = match.group(1), match.group(2); ntype = "INTERFACE" if kind == "interface" else "CLASS" if kind == "class" else "FUNCTION"; line = text.count("\n", 0, match.start()) + 1; key = _symbol_key(relative, name)
            program.add_node(SemanticNodeFact(key, ntype, name, relative, line, line, name)); program.add_edge(SemanticEdgeFact("DECLARES", mkey, key)); symbols.append((name, key))
        for line_no, line in enumerate(text.splitlines(), start=1):
            assignment = re.search(r"\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$.]*)", line)
            if assignment:
                left, right = assignment.group(1), assignment.group(2); lkey, rkey = f"var:{relative}:{left}", f"var:{relative}:{right}"
                program.add_node(SemanticNodeFact(lkey, "VARIABLE", left, relative, line_no, line_no, semantic_types=semantic_types_for_identifier(left))); program.add_node(SemanticNodeFact(rkey, "VARIABLE", right, relative, line_no, line_no, semantic_types=semantic_types_for_identifier(right))); program.add_edge(SemanticEdgeFact("ALIASES", rkey, lkey))
            route = re.search(r"@(Get|Post|Put|Patch|Delete)\s*\(\s*['\"]([^'\"]*)['\"]", line, re.I)
            if route:
                key = f"route:{relative}:{line_no}"; program.add_node(SemanticNodeFact(key, "HTTP_ROUTE", f"{route.group(1).upper()} {route.group(2)}", relative, line_no, line_no, attributes={"method": route.group(1).upper(), "route": route.group(2)})); program.add_edge(SemanticEdgeFact("DECLARES", mkey, key))
            for call in re.finditer(r"\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(", line): self._text_call(program, relative, line_no, call.group(1), line, mkey)

    def _text_call(self, program: SemanticProgram, relative: str, line: int, name: str, body: str, owner: str) -> None:
        lower = name.lower(); ntype, attrs = _call_type(lower); key = f"call:{relative}:{line}:{name}"
        program.add_node(SemanticNodeFact(key, ntype, name, relative, line, line, attributes=attrs)); program.add_edge(SemanticEdgeFact("CALLS", owner, key))
        _call_edges(program, key, name, relative, line)
        urls = re.findall(r"https?://[^'\"\s)]+", body)
        for raw in urls:
            host = safe_external_host(raw)
            if host:
                external = f"external:{host}"; program.add_node(SemanticNodeFact(external, "EXTERNAL_API", host, attributes={"host": host})); program.add_edge(SemanticEdgeFact("SENDS_TO_EXTERNAL", key, external))

class _PythonVisitor(ast.NodeVisitor):
    def __init__(self, item: _PyFile, program: SemanticProgram, symbols: dict[tuple[str, str], str]) -> None:
        self.item, self.program, self.symbols = item, program, symbols; self.stack: list[str] = [f"module:{item.module}"]
    @property
    def owner(self) -> str: return self.stack[-1]

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        key = _symbol_key(self.item.relative, node.name); self.program.add_node(SemanticNodeFact(key, "CLASS", node.name, self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno), node.name)); self.program.add_edge(SemanticEdgeFact("DECLARES", self.owner, key))
        for base in node.bases:
            name = _name(base)
            if name:
                target = f"type:{name}"; self.program.add_node(SemanticNodeFact(target, "TYPE", name)); self.program.add_edge(SemanticEdgeFact("EXTENDS", key, target))
        self.stack.append(key); self.generic_visit(node); self.stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None: self._function(node)
    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None: self._function(node)
    def _function(self, node) -> None:
        key = _symbol_key(self.item.relative, node.name); ntype = "METHOD" if self.owner.startswith("symbol:") else "FUNCTION"; symbol = node.name
        self.program.add_node(SemanticNodeFact(key, ntype, node.name, self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno), symbol)); self.program.add_edge(SemanticEdgeFact("DECLARES", self.owner, key))
        for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
            pkey = f"param:{key}:{arg.arg}"; self.program.add_node(SemanticNodeFact(pkey, "PARAMETER", arg.arg, self.item.relative, arg.lineno, arg.lineno, f"{symbol}:{arg.arg}", semantic_types=semantic_types_for_identifier(arg.arg))); self.program.add_edge(SemanticEdgeFact("HAS_PARAMETER", key, pkey))
        rkey = f"return:{key}"; self.program.add_node(SemanticNodeFact(rkey, "RETURN_VALUE", f"{symbol}:return", self.item.relative, node.lineno, getattr(node, "end_lineno", node.lineno), f"{symbol}:return"))
        self.stack.append(key); [self.visit(item) for item in node.body]; self.stack.pop()

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
        ntype, attrs = _call_type(name.lower()); key = f"call:{self.item.relative}:{line}:{name}"
        self.program.add_node(SemanticNodeFact(key, ntype, name, self.item.relative, line, getattr(node, "end_lineno", line), attributes=attrs)); self.program.add_edge(SemanticEdgeFact("CALLS", self.owner, key)); _call_edges(self.program, key, name, self.item.relative, line)
        root = name.split(".")[0]; imported = self.item.imports.get(root)
        if imported:
            module, symbol = imported; target = self.symbols.get((module, symbol or name.split(".")[-1]))
            if target: self.program.add_edge(SemanticEdgeFact("RESOLVES_TO", key, target))
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
                if host and any(h in name.lower() for h in HTTP_HINTS):
                    external = f"external:{host}"; self.program.add_node(SemanticNodeFact(external, "EXTERNAL_API", host, attributes={"host": host})); self.program.add_edge(SemanticEdgeFact("SENDS_TO_EXTERNAL", key, external))
                metadata = safe_literal_metadata(arg.value)
                if metadata:
                    literal = f"literal:{self.item.relative}:{line}:{metadata['literalType']}"; self.program.add_node(SemanticNodeFact(literal, "SECRET" if metadata["literalType"] == "SECRET" else "SENSITIVE_DATA", str(metadata["literalType"]), self.item.relative, line, line, attributes=metadata, semantic_types=(str(metadata["literalType"]),))); self.program.add_edge(SemanticEdgeFact("PASSES_ARGUMENT", literal, key))
        return key

def _call_type(lower: str) -> tuple[str, dict[str, object]]:
    for provider, hints in AI_HINTS:
        if any(h in lower for h in hints): return "AI_MODEL_INVOCATION", {"provider": provider}
    if any(h in lower for h in HTTP_HINTS): return "CALL_SITE", {"integrationType": "HTTP"}
    if any(h in lower for h in PARSE_HINTS): return "PARSER", {}
    if any(h in lower for h in SERIALIZE_HINTS): return "SERIALIZER", {}
    if any(h in lower for h in VALIDATE_HINTS): return "VALIDATOR", {}
    if any(h in lower for h in HUMAN_REVIEW_HINTS): return "HUMAN_REVIEW", {}
    if any(h in lower for h in HUMAN_OVERRIDE_HINTS): return "HUMAN_OVERRIDE", {}
    return "CALL_SITE", {}

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
