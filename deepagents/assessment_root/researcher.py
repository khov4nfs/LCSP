"""The bounded, ephemeral Repository Researcher (native ``task()`` subagent).

It is read-only for assessment semantics and shared memory: no governed tools, no write
permission to the repository, no human or lifecycle authority. It returns candidate findings
with source references; only the Root verifies and accepts evidence.
"""

from __future__ import annotations

from typing import Any, Sequence

from deepagents.middleware.filesystem import FilesystemPermission

RESEARCHER_NAME = "repository-researcher"

RESEARCHER_PROMPT = """You are a read-only Repository Researcher helping the Assessment Root.

You receive ONE self-contained question about the assessed repository. Answer it by reading and
searching the repository (native filesystem tools; you may also use code-graph search tools if
present). You cannot and must not change files, decide legal applicability or compliance, or decide
whether anything is sufficient evidence.

Focus strictly on what the codebase files implement and state. Never make claims or draw inferences
about the legal status, organizational identity, or external real-world practices of the entity
operating the software.

Return a short report:
- Findings: each one a plain statement tied to `path:start-end` line ranges you actually read.
- Not found / gaps: what you searched (paths, patterns) and did not find, and what you could not
  check. Never present "I found nothing" as proof of absence.
Keep it concise and factual. Your findings are candidates; the Root verifies every range itself."""


def read_only_permissions() -> list[FilesystemPermission]:
    """Business purpose: Restrict the native researcher to source inspection and candidate findings.

    Business rules:
    - Allow reads and deny writes to both visible source paths and reserved runtime state, including Root scratch.
    - The production repository backend independently rejects source mutation, including hidden paths omitted by native globs.

    Execution flow:
    1. Return native read permission followed by explicit reserved-state and source-write denials.

    Failure cases:
    - Matching mutations return native permission errors; the researcher cannot accept evidence, facts or decisions.

    Side effects:
    - Pure permission configuration; no repository or Assessment state changes.
    """
    return [
        FilesystemPermission(["read"], ["/**"], mode="allow"),
        FilesystemPermission(["write"], ["/.lcsp/**", "/**"], mode="deny"),
    ]


def researcher_subagent(graph_tools: list[Any], *, middleware: Sequence[Any] = ()) -> dict[str, Any]:
    """Business purpose: Configure the Root's existing read-only native research delegate with its model-governance policy.

    Business rules:
    - Explicit research tools prevent inheritance of governed Assessment tools; filesystem writes and domain decisions remain unavailable.
    - Supplied middleware governs delegated inference without making research findings authoritative facts or decisions.

    Execution flow:
    1. Bind the researcher instructions, allowed graph tools and read-only filesystem permissions.
    2. Attach the supplied inference middleware and return the native subagent specification.

    Failure cases:
    - Native subagent compilation and model/tool failures remain visible to the Root; this factory does not synthesize findings.

    Side effects:
    - Constructs a subagent configuration; native invocation may read the pinned repository and perform governed model inference.
    """
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
        "middleware": list(middleware),
        "permissions": read_only_permissions(),
    }
