"""Bounded scanner parsers grouped by parsing strategy."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from pathlib import Path
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "python": frozenset({"python_ast_parser", "python_cst_parser"}),
    "structural": frozenset(
        {"structural_augmentor", "structural_types", "tree_sitter_parser"}
    ),
}
_PREFIX = f"{__name__}."
_ROOT = Path(__file__).resolve().parent


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _physical_path(fullname: str) -> Path | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts:
        return None
    if parts[0] in _CAPABILITY_MODULES:
        if len(parts) < 2:
            return None
        owner = _owner(parts[1])
        if owner is None or owner == parts[0]:
            return None
        return _ROOT / owner / f"{parts[1]}.py"
    owner = _owner(parts[0])
    return _ROOT / owner / f"{parts[0]}.py" if owner is not None else None


class _ParserCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        module_path = _physical_path(fullname)
        if module_path is None or not module_path.is_file():
            return None
        return importlib.util.spec_from_file_location(fullname, module_path)


if not any(isinstance(finder, _ParserCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _ParserCapabilityAliasFinder())
