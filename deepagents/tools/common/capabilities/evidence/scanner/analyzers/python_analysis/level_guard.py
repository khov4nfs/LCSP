from __future__ import annotations

import ast
from pathlib import Path


UNSUPPORTED_DYNAMIC_FLOW = "UNSUPPORTED_DYNAMIC_FLOW"


class LevelGuard:
    """Keeps static analysis inside supported repository paths and flow shapes."""

    def dynamic_flow_for_call(self, node: ast.Call, file_path: str) -> dict | None:
        """Describe call patterns whose target cannot be resolved safely statically.

        Args:
            node: Python call expression being analyzed.
            file_path: Repository-relative path used in the emitted finding.

        Returns:
            A limitation finding for dynamic dispatch/argument forwarding, or ``None``
            when the call is within the supported static-analysis level.
        """
        reason = None
        if isinstance(node.func, ast.Call) and self._name_of(node.func.func) == "getattr":
            reason = "getattr dynamic dispatch"
        elif self._name_of(node.func) == "getattr":
            reason = "getattr dynamic dispatch"
        elif any(keyword.arg is None for keyword in node.keywords):
            reason = "**kwargs forwarding"

        if reason is None:
            return None
        return {
            "file": file_path,
            "line": getattr(node, "lineno", 1),
            "reason": reason,
            "finding_type": UNSUPPORTED_DYNAMIC_FLOW,
        }

    def allowed_path(self, path: Path) -> bool:
        """Exclude generated/vendor/runtime directories from repository analysis."""
        excluded = {"venv", ".venv", ".tox", "node_modules", "__pycache__", "dist", "build"}
        return not any(part in excluded for part in path.parts)

    def _name_of(self, node: ast.AST) -> str:
        """Resolve a simple dotted AST name without executing repository code."""
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base = self._name_of(node.value)
            return f"{base}.{node.attr}" if base else node.attr
        return ""

