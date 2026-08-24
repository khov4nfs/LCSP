from __future__ import annotations

import pytest

from tools.common.llm.prompt_safety import PromptSafetyViolation, check_prompt_safety


def test_raw_source_remains_forbidden_outside_code_context_protocol() -> None:
    with pytest.raises(PromptSafetyViolation):
        check_prompt_safety('{"task":"inspect", "source":"def run(value): return value"}')


def test_commit_pinned_ast_code_context_protocol_allows_bounded_source_page() -> None:
    check_prompt_safety(
        '{"lcspCodeContextProtocol": "AST_SYMBOL_CHUNKS_V1", '
        '"recentToolResults":[{"sourceLines":[{"line":12,"text":"def run(value):"}]}]}'
    )
