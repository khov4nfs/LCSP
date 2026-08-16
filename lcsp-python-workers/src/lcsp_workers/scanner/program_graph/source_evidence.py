"""Privacy-safe source evidence projection while the restricted workspace exists."""
from __future__ import annotations
import ast, re
from pathlib import Path
from .models import ProgramEvidenceGraph
from .sensitive_data import safe_literal_metadata, semantic_types_for_identifier

class SourceEvidenceReader:
    def __init__(self, workspace_path: str | Path, graph: ProgramEvidenceGraph | dict) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False); self.graph = graph if isinstance(graph, ProgramEvidenceGraph) else ProgramEvidenceGraph.from_dict(graph)
        self.anchors = {str(a["anchor_id"]): a for a in self.graph.source_anchors}

    def inspect(self, anchor_ref: str) -> dict:
        anchor = self.anchors.get(anchor_ref)
        if not anchor: raise KeyError("source evidence anchor not found")
        path = (self.workspace / str(anchor["file_path"])).resolve(strict=False); path.relative_to(self.workspace)
        if not path.is_file(): raise FileNotFoundError("ephemeral source is no longer available; request pinned reanalysis")
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines(); start = max(1, int(anchor.get("start_line") or 1)); end = min(len(lines), int(anchor.get("end_line") or start))
        return {"anchorRef": anchor_ref, "filePath": anchor["file_path"], "symbolRef": anchor.get("symbol_ref"), "lineRange": {"start": start, "end": end}, "sourceHash": anchor["source_hash"], "semanticStatements": self._project(path.suffix.lower(), lines[start - 1:end], start)}

    def _project(self, suffix: str, lines: list[str], start: int) -> list[dict]:
        text = "\n".join(lines)
        if suffix == ".py":
            try: tree = ast.parse(text)
            except SyntaxError: tree = None
            if tree:
                result = []
                for node in ast.walk(tree):
                    line = start + int(getattr(node, "lineno", 1)) - 1
                    if isinstance(node, ast.Call): result.append({"kind": "CALL", "name": _name(node.func), "line": line, "argumentCount": len(node.args) + len(node.keywords)})
                    elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
                        names = sorted({n.id for n in ast.walk(node) if isinstance(n, ast.Name)}); result.append({"kind": "ASSIGNMENT", "identifiers": names, "semanticTypes": sorted({t for name in names for t in semantic_types_for_identifier(name)}), "line": line})
                    elif isinstance(node, ast.Return): result.append({"kind": "RETURN", "line": line})
                    elif isinstance(node, (ast.If, ast.Match)): result.append({"kind": "BRANCH", "line": line})
                return result[:200]
        result = []
        for offset, line in enumerate(lines):
            ids = list(dict.fromkeys(re.findall(r"\b[A-Za-z_$][A-Za-z0-9_.$]*\b", line)))[:30]
            literals = [safe_literal_metadata(m.group(2)) for m in re.finditer(r"(['\"])(.*?)(\1)", line)]; literals = [v for v in literals if v]
            result.append({"kind": "STATEMENT", "line": start + offset, "identifiers": ids, "semanticTypes": sorted({t for name in ids for t in semantic_types_for_identifier(name)}), "literalCategories": literals[:10]})
        return result[:200]

def _name(node: ast.AST) -> str:
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Attribute):
        base = _name(node.value); return f"{base}.{node.attr}" if base else node.attr
    return "dynamic_call"
