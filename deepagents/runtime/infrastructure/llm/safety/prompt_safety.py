"""Reject accidental raw-source prompt leakage outside governed code-context tools."""

import re


class PromptSafetyViolation(Exception):
    """Raised when a prompt violates the worker prompt-safety policy."""

    pass


FORBIDDEN_PROMPT_PATTERNS = [
    r"def\s+\w+\s*\(",  # Python function definition
    r"function\s+\w+\s*\(",  # JS function definition
    r"class\s+\w+[:\{]",  # Class definition
    r"import\s+\w+",  # Import statement (heuristic)
    r"```[\s\S]{500,}```",  # Long code block
]

_COMPILED_PATTERNS = [re.compile(pattern) for pattern in FORBIDDEN_PROMPT_PATTERNS]
_CODE_CONTEXT_PROTOCOL_MARKER = '"lcspCodeContextProtocol": "AST_SYMBOL_CHUNKS_V1"'


def check_prompt_safety(prompt: str) -> None:
    """Validate a prompt against accidental repository-source leakage.

    Raw source remains forbidden for ordinary LLM calls. The only exception is the
    orchestrator-generated ``AST_SYMBOL_CHUNKS_V1`` envelope used by the commit-pinned
    CodeContextSession. That path already enforces semantic symbol boundaries,
    cursor paging, per-turn working-context budgets, snapshot provenance and secret
    redaction before provider dispatch. This makes bounded source an explicit tool
    capability rather than an accidental prompt dump.

    Args:
        prompt: Prompt text proposed for an external LLM call.

    Raises:
        PromptSafetyViolation: If source-like content appears outside the governed
            code-context protocol.
    """
    if _CODE_CONTEXT_PROTOCOL_MARKER in prompt:
        return
    for pattern in _COMPILED_PATTERNS:
        if pattern.search(prompt):
            raise PromptSafetyViolation(
                "Prompt failed safety check (raw source outside code-context protocol)."
            )
