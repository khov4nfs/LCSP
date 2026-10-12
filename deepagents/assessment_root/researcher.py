"""The bounded, ephemeral Repository Researcher (native ``task()`` subagent).

It is read-only for assessment semantics and shared memory: no governed tools, no write
permission to the repository, no human or lifecycle authority. It returns candidate findings
with source references; only the Root verifies and accepts evidence.
"""

from __future__ import annotations

from typing import Any

from deepagents.middleware.filesystem import FilesystemPermission

RESEARCHER_NAME = "repository-researcher"

RESEARCHER_PROMPT = """You are a read-only Repository Researcher helping the Assessment Root.

You receive ONE self-contained question about the assessed repository. Answer it by reading and
searching the repository (native filesystem tools; you may also use code-graph search tools if
present). You cannot and must not change files, decide legal applicability or compliance, or decide
whether anything is sufficient evidence.

Return a short report:
- Findings: each one a plain statement tied to `path:start-end` line ranges you actually read.
- Not found / gaps: what you searched (paths, patterns) and did not find, and what you could not
  check. Never present "I found nothing" as proof of absence.
Keep it concise and factual. Your findings are candidates; the Root verifies every range itself."""


def read_only_permissions() -> list[FilesystemPermission]:
    """Reads everywhere; writes nowhere. The first matching rule wins."""
    return [
        FilesystemPermission(["read"], ["/**"], mode="allow"),
        FilesystemPermission(["write"], ["/**"], mode="deny"),
    ]


def researcher_subagent(graph_tools: list[Any]) -> dict[str, Any]:
    return {
        "name": RESEARCHER_NAME,
        "description": (
            "Read-only bounded repository research. Give it one self-contained question; it "
            "returns candidate findings with file/line ranges and the gaps it could not cover. "
            "It cannot record evidence or decide anything."
        ),
        "system_prompt": RESEARCHER_PROMPT,
        # Explicit empty/read-only tool set: no governed assessment tool is ever inherited.
        "tools": list(graph_tools),
        "permissions": read_only_permissions(),
    }
