"""Normalize framework metadata before the immutable graph privacy boundary.

Graph attributes intentionally reject credential-like keys such as ``token``. DI
frameworks also use the word token for harmless symbolic binding identities. Keep the
privacy rule strict and rename only framework-declared DI metadata to ``bindingKey``
before ProgramGraphBuilder validates attributes.
"""
from __future__ import annotations

from dataclasses import replace

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticProgram


def normalize_framework_binding_metadata(program: SemanticProgram) -> int:
    changed = 0
    nodes = []
    for node in program.nodes:
        attrs = dict(node.attributes)
        boundary = str(attrs.get("frameworkBoundary") or "").upper()
        if "token" in attrs and ("DI" in boundary or boundary in {"INJECTOR", "CONTAINER"}):
            attrs.setdefault("bindingKey", attrs.pop("token"))
            node = replace(node, attributes=attrs)
            changed += 1
        nodes.append(node)
    program.nodes = nodes
    return changed
