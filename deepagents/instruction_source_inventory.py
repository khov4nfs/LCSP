"""Source integrity and construction-site audit for the VI instruction migration.

The ledger records legacy consumers, not approval or runtime activation. New
construction patterns require a reviewer to extend the scanner and classification.
"""
from __future__ import annotations

import ast
from copy import deepcopy
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path, PureWindowsPath
import re
from string import Formatter

from runtime_instruction_bundle import RuntimeInstructionBundleError

ROOT = Path(__file__).resolve().parent
INVENTORY = ROOT / "instructions" / "inventory.json"
SCAN_ROOTS = ("assessment_root", "rule_set_preparation", "middleware", "orchestration", "tools")
# Preserve the original discovery query so all 98 baseline hits are accountable.
DISCOVERY = re.compile(r'system_prompt=|HumanMessage\(content=|description=|def .*prompt|PROMPT|INSTRUCTIONS|SKILL\.md|SKILL\.vi\.md')
_DISCOVERY_CACHE = {}


def source_digest(data: bytes) -> str:
    return sha256(data).hexdigest()


def safe_path(root: Path, raw: str) -> Path:
    """Reject traversal, Windows drive/UNC paths, symlinks outside root and aliases."""
    path = Path(raw)
    win = PureWindowsPath(raw)
    if not raw or path.is_absolute() or win.drive or ".." in path.parts or "\\" in raw:
        raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_UNSAFE_PATH")
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_UNSAFE_PATH")
    return resolved


def discover(root: Path = ROOT) -> list[dict]:
    """Record each baseline search hit with its actual enclosing Python symbol."""
    # Cache only parsed results, keyed by actual bytes of every scanned file.
    # A content edit, added file or removed file always invalidates the cache.
    files = [(path, path.read_bytes()) for folder in SCAN_ROOTS for path in sorted((root / folder).rglob("*.py"))]
    cache_key = (str(root.resolve()), tuple((str(path), source_digest(data)) for path, data in files))
    if cache_key in _DISCOVERY_CACHE:
        return deepcopy(_DISCOVERY_CACHE[cache_key])
    sites = []
    for folder in SCAN_ROOTS:
        for path in sorted((root / folder).rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            tree = ast.parse(text)
            symbols = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
            occurrences: Counter = Counter()
            for line_number, line in enumerate(text.splitlines(), 1):
                if not DISCOVERY.search(line):
                    continue
                owners = [n for n in symbols if n.lineno <= line_number <= n.end_lineno]
                symbol = min(owners, key=lambda n: n.end_lineno - n.lineno).name if owners else "<module>"
                relative = path.relative_to(root).as_posix()
                fingerprint = source_digest(line.strip().encode("utf-8"))
                key = (relative, symbol, fingerprint)
                occurrences[key] += 1
                sites.append({"siteId": f"{relative}::{symbol}::{fingerprint[:16]}::{occurrences[key]}",
                              "filePath": relative, "lineNumber": line_number, "symbolName": symbol,
                              "constructionSha256": fingerprint, "evidence": line.strip()})
            # AST coverage complements the historical line query: multiline
            # schema descriptions, tool decorators and factories were omitted.
            for node in ast.walk(tree):
                kind, value = None, None
                if isinstance(node, ast.keyword) and node.arg in {"description", "system_prompt", "task_description", "prompt", "instruction"}:
                    kind, value = "KEYWORD_" + node.arg.upper(), node.value
                elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"HumanMessage", "SystemMessage"}:
                    value = next((kw.value for kw in node.keywords if kw.arg == "content"), node.args[0] if node.args else None)
                    kind = "MESSAGE_" + node.func.id.upper()
                elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in {"read_text", "read_bytes"} and (
                    path.relative_to(root).as_posix() in {"assessment_root/agent.py", "assessment_root/researcher.py", "rule_set_preparation/preparation_skills.py", "tools/common/capabilities/agent_runtime/skill_loader.py"}):
                    kind, value = "INSTRUCTION_ASSET_READ", node
                elif isinstance(node, ast.Dict):
                    for key, item in zip(node.keys, node.values):
                        if isinstance(key, ast.Constant) and key.value == "description":
                            sites.append(_ast_site(path, root, symbols, item, "SCHEMA_DESCRIPTION", text))
                elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Attribute) and t.attr == "description" for t in node.targets):
                    kind, value = "DESCRIPTION_OVERRIDE", node.value
                elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and (
                    t.id in {"prompt", "instructions", "child_prompt", "child_assignment", "context_block", "workflow", "FINALIZE_INSTRUCTION", "TRIMMED_TOOL_RESULT_PLACEHOLDER", "CATALOG", "CATALOG_VI", "_SKILLS", "_SKILLS_VI", "_SKILL_TOOL_ERRORS"}
                    or "PROMPT_TEMPLATE" in t.id) for t in node.targets):
                    kind, value = "INSTRUCTION_COMPOSITION", node.value
                elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) and t.value.id == "feedback" for t in node.targets):
                    kind, value = "OBSERVATION_GUIDANCE", node.value
                elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "lines" and node.func.attr == "append" and path.name == "authoring_state.py" and node.args:
                    kind, value = "AUTHORING_STATE_GUIDANCE", node.args[0]
                elif isinstance(node, ast.Tuple) and len(node.elts) >= 3 and isinstance(node.elts[0], ast.Constant) and isinstance(node.elts[0].value, str) and isinstance(node.elts[1], ast.Constant) and isinstance(node.elts[1].value, str) and len(node.elts[1].value.split()) > 5:
                    kind, value = "FACTORY_TOOL_DESCRIPTION", node.elts[1]
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    decorated = any((isinstance(d, ast.Name) and d.id == "tool") or (isinstance(d, ast.Call) and isinstance(d.func, ast.Name) and d.func.id == "tool") for d in node.decorator_list)
                    root_registered = path.name == "tools.py" and path.parent.name == "assessment_root" and any(isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id == "tool" and c.args and isinstance(c.args[0], ast.Name) and c.args[0].id == node.name for c in ast.walk(tree))
                    if (decorated or root_registered) and ast.get_docstring(node):
                        kind, value = "PROMOTED_TOOL_DOCSTRING", node.body[0].value
                    elif (path.name == "authoring_state.py" and node.name in {"digest", "next_actions"}) or node.name in {"_finalize_instruction", "_project_lcsp_runtime_context", "get_language_prompt_instruction", "materialize_legal_source"}:
                        kind, value = "INSTRUCTION_BUILDER", node
                if kind and value is not None:
                    sites.append(_ast_site(path, root, symbols, value, kind, text))
    result = sorted(sites, key=lambda item: item["siteId"])
    _DISCOVERY_CACHE.clear()
    _DISCOVERY_CACHE[cache_key] = deepcopy(result)
    return result


def _ast_site(path, root, symbols, node, kind, text):
    """Fingerprint the complete expression rather than its opening source line."""
    owners = [n for n in symbols if n.lineno <= node.lineno <= n.end_lineno]
    symbol = min(owners, key=lambda n: n.end_lineno - n.lineno).name if owners else "<module>"
    relative = path.relative_to(root).as_posix()
    evidence = ast.get_source_segment(text, node)
    digest = source_digest(ast.dump(node, include_attributes=False).encode("utf-8"))
    return {"siteId": f"ast:{relative}::{symbol}::{kind}::{node.lineno}:{digest[:16]}",
            "filePath": relative, "lineNumber": node.lineno, "symbolName": symbol,
            "constructionSha256": digest, "evidence": evidence, "astKind": kind}


def validate_inventory(root: Path = ROOT, inventory_path: Path = INVENTORY, *, require_complete: bool = False, require_framework_control: bool = True) -> dict:
    """Validate declared sources without requiring translations or approvals."""
    payload = json.loads(inventory_path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != "LCSP_EN_RUNTIME_BUNDLE_V1":
        raise RuntimeInstructionBundleError("INSTRUCTION_INVENTORY_VERSION")
    seen, paths = set(), set()
    consumer_symbols = {}
    for row in payload["entries"]:
        identity = row["sourceId"]
        path = safe_path(root, row["vietnameseSourcePath"])
        if identity in seen or path in paths:
            raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_DUPLICATE")
        seen.add(identity)
        paths.add(path)
        try:
            data = path.read_bytes()
            content = data.decode("utf-8")
        except (OSError, UnicodeError) as error:
            raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_MISSING_OR_INVALID") from error
        if not content.strip() or source_digest(data) != row["sourceSha256"]:
            raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_DIGEST_MISMATCH")
        for field in ("runtimeRole", "instructionKind", "vietnameseSourceRevision", "runtimeEntryId", "reviewStatus"):
            if not row.get(field):
                raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_METADATA_MISSING")
        if row["runtimeEntryId"] != identity or not isinstance(row["required"], bool):
            raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_IDENTITY_MISMATCH")
        if not row.get("consumers"):
            raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_CONSUMER_MISSING")
        for consumer in row["consumers"]:
            consumer_path = safe_path(root, consumer["filePath"])
            if consumer_path not in consumer_symbols:
                tree = ast.parse(consumer_path.read_text(encoding="utf-8"))
                symbols = {node.name for node in ast.walk(tree) if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))}
                symbols.update(node.id for node in ast.walk(tree) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store))
                consumer_symbols[consumer_path] = symbols
            symbols = consumer_symbols[consumer_path]
            if consumer["symbolName"] != "<module>" and consumer["symbolName"] not in symbols:
                raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_CONSUMER_MISSING")
        if row.get("templateSyntax") == "FORMAT":
            validate_template_fields(content, row["placeholderSchema"])
    if set(payload.get("requiredSourceIds", [])) != seen:
        raise RuntimeInstructionBundleError("INSTRUCTION_REQUIRED_SOURCES_MISMATCH")
    source_folder = root / "instructions" / "vi"
    owned_files = {path.resolve() for path in source_folder.rglob("*") if path.is_file() and path.suffix in {".md", ".json"}}
    if owned_files - paths:
        raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_UNREGISTERED_FILE")
    declared = payload["constructionSites"]
    current = {site["siteId"]: site for site in discover(root)}
    if set(current) != {site["siteId"] for site in declared} or len(declared) != len(current):
        raise RuntimeInstructionBundleError("INSTRUCTION_CONSTRUCTION_COVERAGE_DRIFT")
    required = {"constructionType", "modelFacingConsumer", "runtimeRole", "runtimePhase", "contentAuthority", "migrationDecision", "viSourceId", "existingSourcePath", "placeholderSchema", "migrationStatus"}
    for site in declared:
        if not required.issubset(site):
            raise RuntimeInstructionBundleError("INSTRUCTION_CONSTRUCTION_UNCLASSIFIED")
        if site["viSourceId"] is not None and site["viSourceId"] not in seen:
            raise RuntimeInstructionBundleError("INSTRUCTION_SOURCE_UNREGISTERED")
    if require_complete:
        allowed = {"BOUND_TO_VI_SOURCE", "SHARED_SOURCE_CONSUMER", "RUNTIME_DATA", "NON_MODEL_FACING", "THIRD_PARTY_CONTROLLED"}
        for site in declared:
            if site["migrationDecision"] not in allowed or not site.get("dispositionEvidence"):
                raise RuntimeInstructionBundleError("INSTRUCTION_MIGRATION_INCOMPLETE")
            if site["migrationDecision"] in {"BOUND_TO_VI_SOURCE", "SHARED_SOURCE_CONSUMER"} and not site.get("viSourceId"):
                raise RuntimeInstructionBundleError("INSTRUCTION_MIGRATION_INCOMPLETE")
        from framework_instruction_audit import validate_framework_surfaces

        validate_framework_surfaces(payload.get("frameworkInstructions", []))
        if require_framework_control and any(row["controlStatus"] != "CONTROLLED" for row in payload.get("frameworkInstructions", [])):
            raise RuntimeInstructionBundleError("INSTRUCTION_MIGRATION_INCOMPLETE:FRAMEWORK_ADAPTERS_REQUIRED")
    return payload


def validate_template_fields(content: str, schema: dict) -> None:
    """Reject undeclared placeholders, conversions and attribute traversal."""
    fields = set()
    for _, name, spec, conversion in Formatter().parse(content):
        if name is not None:
            if not name.isidentifier() or spec or conversion:
                raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_UNSAFE_FIELD")
            fields.add(name)
    if fields != set(schema):
        raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_FIELDS_MISMATCH")


def render_enum_template(content: str, schema: dict, values: dict) -> str:
    """Render closed server-owned enum parameters without free-text injection."""
    validate_template_fields(content, schema)
    if set(values) != set(schema):
        raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_FIELDS_MISMATCH")
    for key, rule in schema.items():
        if not isinstance(rule, dict) or rule.get("type") != "ENUM" or values[key] not in rule.get("values", []):
            raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_PARAMETER_INVALID")
    if {"target_locale", "target_language"} <= set(values):
        expected = {"en": {"English"}, "vi": {"Vietnamese", "Tiếng Việt"}}
        if values["target_language"] not in expected.get(values["target_locale"], set()):
            raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_LOCALE_MISMATCH")
    return content.format_map(values)


def translation_readiness(payload: dict) -> dict:
    """Report all missing candidates; do not convert VI completeness into approval."""
    missing = [row["sourceId"] for row in payload["entries"] if not row.get("englishCandidatePath")]
    return {"status": "PENDING_TRANSLATION" if missing else "CANDIDATES_DECLARED", "missingEnglishCandidates": sorted(missing)}


def render_numeric_template(content: str, schema: dict, values: dict) -> str:
    """Render only trusted nonnegative integer metadata; evidence is never accepted.

    This deliberately supports no free-text, attribute lookup, format conversion
    or nested formatting. Expansion requires a separately reviewed contract.
    """
    fields = set()
    for _, name, spec, conversion in Formatter().parse(content):
        if name is not None:
            if not name.isidentifier() or spec or conversion:
                raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_UNSAFE_FIELD")
            fields.add(name)
    if fields != set(schema) or fields != set(values):
        raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_FIELDS_MISMATCH")
    if any(schema[key] != "NONNEGATIVE_INTEGER" or type(values[key]) is not int or values[key] < 0 for key in fields):
        raise RuntimeInstructionBundleError("INSTRUCTION_TEMPLATE_PARAMETER_INVALID")
    return content.format_map(values)
