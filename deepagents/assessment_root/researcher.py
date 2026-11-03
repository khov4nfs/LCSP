"""The bounded, ephemeral Repository Researcher (native ``task()`` subagent).

It is read-only for assessment semantics and shared memory: no governed tools, no write
permission to the repository, no human or lifecycle authority. It returns candidate findings
with source references; only the Root verifies and accepts evidence.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence

from orchestration.context import resolve_response_language

from deepagents.middleware.filesystem import FilesystemPermission

RESEARCHER_NAME = "repository-researcher"

RESEARCHER_PROMPT = (Path(__file__).with_name("researcher.en.md")).read_text(encoding="utf-8")
RESEARCHER_PROMPT_VI = (Path(__file__).with_name("researcher.vi.md")).read_text(encoding="utf-8")


def researcher_prompt_for_locale(locale: str) -> str:
    """Business purpose:
    Select the canonical locale-specific read-only researcher instructions.

    Business rules:
    - Supported locales are en/vi; only the language changes, never permissions.
    Execution flow:
    1. Normalize trusted run locale and select its checked-in researcher prompt.
    Failure cases:
    - Unknown locales use the product's canonical response-language fallback.
    Side effects:
    - Pure prompt selection; no repository or Assessment mutation.
    """
    return RESEARCHER_PROMPT_VI if resolve_response_language(locale) == "vi" else RESEARCHER_PROMPT


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


def researcher_subagent(graph_tools: list[Any], *, middleware: Sequence[Any] = (), locale: str = "en") -> dict[str, Any]:
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
            ("Điều tra kỹ thuật repository ở chế độ chỉ đọc; truy vết đường xử lý, "
             "phản chứng và giới hạn tìm kiếm; không sửa mã nguồn hay quyết định pháp lý."
             if resolve_response_language(locale) == "vi" else
             "Read-only technical investigation with causal source tracing, "
             "counterevidence and bounded search gaps. No coding, source mutation "
             "or legal decision authority.")
        ),
        "system_prompt": researcher_prompt_for_locale(locale),
        # Explicit empty/read-only tool set: no governed assessment tool is ever inherited.
        "tools": list(graph_tools),
        "middleware": list(middleware),
        "permissions": read_only_permissions(),
    }
