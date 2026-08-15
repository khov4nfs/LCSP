"""Reject prompts that appear to contain raw source code before LLM calls."""

import re


class PromptSafetyViolation(Exception):
    """Raised when a prompt violates the worker prompt-safety policy."""

    pass


FORBIDDEN_PROMPT_PATTERNS = [
    r'def\s+\w+\s*\(',          # Python function definition
    r'function\s+\w+\s*\(',      # JS function definition
    r'class\s+\w+[:\{]',        # Class definition
    r'import\s+\w+',             # Import statement (heuristic)
    r'```[\s\S]{500,}```',       # Long code block
]

_COMPILED_PATTERNS = [re.compile(pattern) for pattern in FORBIDDEN_PROMPT_PATTERNS]


def check_prompt_safety(prompt: str) -> None:
    """Validate a prompt against source-code leakage heuristics.

    The check runs before provider dispatch so unsafe content cannot be made
    acceptable merely by falling back to a different LLM provider.

    Args:
        prompt: Prompt text proposed for an external LLM call.

    Raises:
        PromptSafetyViolation: If any forbidden pattern matches the prompt.
    """
    for pattern in _COMPILED_PATTERNS:
        if pattern.search(prompt):
            raise PromptSafetyViolation("Prompt failed safety check (forbidden pattern matched).")
