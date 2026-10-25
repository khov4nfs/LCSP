#!/usr/bin/env python3
"""AST inventory of Python production business logic for the LCSP documentation gate."""

from __future__ import annotations

import ast
import hashlib
import json
import re
import sys
from typing import Any

_SKIP_METHODS = {"__init__", "__new__", "__str__", "__repr__", "__hash__", "__eq__", "__post_init__"}


def scan_file(path: str, source: str) -> list[dict[str, Any]]:
    tree = ast.parse(source, filename=path)
    records: list[dict[str, Any]] = []
    duplicates: dict[str, int] = {}

    def walk(node: ast.AST, scope: tuple[str, ...]) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                walk(child, (*scope, child.name))
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if child.name not in _SKIP_METHODS:
                    full_name = ".".join((*scope, child.name))
                    duplicates[full_name] = duplicates.get(full_name, 0) + 1
                    occurrence = duplicates[full_name]
                    suffix = f"#{occurrence}" if occurrence > 1 else ""
                    source_text = ast.get_source_segment(source, child) or ""
                    fingerprint = hashlib.sha256(
                        re.sub(r"\s+", " ", source_text).strip().encode("utf-8")
                    ).hexdigest()
                    records.append(
                        {
                            "key": f"{path}::{full_name}{suffix}",
                            "hash": fingerprint,
                            "name": full_name,
                            "path": path,
                            "line": child.lineno,
                            "documentation": ast.get_docstring(child, clean=False),
                        }
                    )
                walk(child, (*scope, child.name))
            else:
                walk(child, scope)

    walk(tree, ())
    return records


def main() -> None:
    payload = json.load(sys.stdin)
    all_records: list[dict[str, Any]] = []
    for file in payload["files"]:
        try:
            all_records.extend(scan_file(file["path"], file["source"]))
        except SyntaxError as error:
            raise RuntimeError(
                f"Unable to check Python business documentation in {file['path']}:{error.lineno}"
            ) from error
    json.dump(all_records, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
