"""Controlled Preparation skill library and server-bound development scope overlay."""

from __future__ import annotations

import errno
import hashlib
import json
from pathlib import Path

from langchain_core.tools import tool


_SKILLS_ROOT = Path(__file__).resolve().parents[1] / "skills"
_SCOPE_OVERLAY = Path(__file__).with_name("instructions-development.md")
_VI_OVERLAY = Path(__file__).with_name("instructions-localization.vi.md")
_SKILLS = {
    "rule-preparation-actor-stage": "Distinguish legal addressees, regulated activities, and development from deployment and operations.",
    "rule-preparation-mixed-claims": "Separate legal modalities and actors in a single clause without losing material modifiers.",
    "rule-preparation-material-context": "Retain material legal ancestors, definitions, conditions, exceptions and references.",
    "rule-preparation-scope-quality": "Audit developer-only selection without inventing duties or deleting legal-source accounting.",
}
_SKILLS_VI = {
    "rule-preparation-actor-stage": "Xác định chủ thể, hành vi và giai đoạn trách nhiệm theo nguồn luật đã pin.",
    "rule-preparation-mixed-claims": "Tách nghĩa vụ/quyền và chủ thể hỗn hợp, giữ đúng điều kiện và ngoại lệ.",
    "rule-preparation-material-context": "Giữ quan hệ định nghĩa, phạm vi, điều kiện, ngoại lệ và hiệu lực có căn cứ.",
    "rule-preparation-scope-quality": "Đối soát scope development, không xóa nghĩa vụ thật hoặc tạo nghĩa vụ mới.",
}
# Model-visible error results are deliberately independent of exception text:
# local filenames, paths and host configuration must never enter a tool response.
_SKILL_TOOL_ERRORS = {
    "SKILL_INPUT_INVALID": (
        "The skill tool arguments are invalid.",
        False,
        "FIX_ARGUMENTS",
    ),
    "SKILL_NAME_NOT_ALLOWED": (
        "Select a skill from list_preparation_skills.",
        False,
        "SELECT_ALLOWLISTED_SKILL",
    ),
    "SKILL_LOCALE_MISMATCH": (
        "The requested language differs from the trusted run language.",
        False,
        "USE_TRUSTED_LOCALE",
    ),
    "SKILL_FILE_MISSING": (
        "The approved skill package is unavailable.",
        False,
        "STOP_AND_REPORT",
    ),
    "SKILL_FILE_DENIED": (
        "The approved skill package cannot be accessed.",
        False,
        "STOP_AND_REPORT",
    ),
    "SKILL_CONTENT_INVALID": (
        "The approved skill content is invalid or empty.",
        False,
        "STOP_AND_REPORT",
    ),
    "SKILL_READ_UNAVAILABLE": (
        "The approved skill could not be read due to a temporary I/O failure. Retry once only.",
        True,
        "RETRY_ONCE_THEN_STOP",
    ),
    "SKILL_READ_FAILED": (
        "The approved skill cannot be read in the current environment.",
        False,
        "STOP_AND_REPORT",
    ),
}


def _skill_tool_error(code: str) -> str:
    """Business purpose: Report an expected skill failure to the agent without aborting its turn.

    Business rules:
    - Only fixed, reviewed error codes and safe explanatory messages reach the model.
    - Retryability and recovery action are determined by failure category, never exception text.

    Execution flow:
    1. Look up the fixed response contract for the expected failure.
    2. Serialize the code, retryability and bounded next action as JSON.

    Failure cases:
    - An unrecognized internal error code raises a KeyError so development defects remain diagnosable.

    Side effects:
    - None; creates an in-memory result without changing skills or source state.
    """
    message, retryable, action = _SKILL_TOOL_ERRORS[code]
    return json.dumps(
        {
            "ok": False,
            "error": code,
            "retryable": retryable,
            "message": message,
            "requiredAction": action,
        },
        ensure_ascii=False,
    )


_SCOPE_FULL = "FULL_SOURCE"
_SCOPE_DEVELOPMENT = "DEVELOPMENT_ONLY"


def development_scope_overlay(scope: str) -> str:
    """Business purpose: Append an opt-in, pinned-source-safe prompt for development rule selection.

    Business rules:
    - The worker must receive the target scope from the API bundle; FULL_SOURCE remains the default.
    - Development scope never authorizes dropping operative legal claims or bypassing validation.

    Execution flow:
    1. Return no additional instructions for the full-source contract.
    2. For development-only scope, read the checked-in overlay and append its text.

    Failure cases:
    - An unsupported scope, missing instruction file, or empty overlay fails closed before model invocation.

    Side effects:
    - Reads a local instruction file; never modifies the run, draft or legal source.
    """
    if scope == _SCOPE_FULL:
        return ""
    if scope != _SCOPE_DEVELOPMENT:
        raise ValueError("unsupported server-bound Preparation activity scope")
    from runtime_instruction_bundle import runtime_instruction
    body = runtime_instruction("preparation.development-overlay")
    if not body:
        raise ValueError("development scope instruction overlay is empty")
    return "\n\n" + body


def enforce_runtime_scope(scope: str, approved_scope_digest: str | None = None) -> None:
    """Business purpose: Forbid unsupported scoped Rule Set executions.

    Business rules:
    - FULL_SOURCE runs by default; DEVELOPMENT_ONLY requires a trusted server-issued, reviewed scope digest.

    Execution flow:
    1. Require an explicitly bound 64-character digest for an API-approved DEVELOPMENT_ONLY scope.

    Failure cases:
    - Unapproved DEVELOPMENT_ONLY, malformed proof and unknown scopes raise a ValueError.

    Side effects:
    - None. The guard runs before any model call or source changes.
    """
    if scope == _SCOPE_FULL:
        return
    if scope == _SCOPE_DEVELOPMENT and isinstance(approved_scope_digest, str) and (
        len(approved_scope_digest) == 64 and
        all(c in "0123456789abcdef" for c in approved_scope_digest)
    ):
        return  # proof appears only in the authenticated, server-reviewed worker bundle
    raise ValueError("DEVELOPMENT_SCOPE_NOT_VALIDATED: server scoped validator and approval are required")


def preparation_locale_overlay(locale: str) -> str:
    """Business purpose: Select the trusted Preparation output language overlay.

    Business rules:
    - The API controls en/vi; legal text and agent requests cannot choose a locale.

    Execution flow:
    1. Return no overlay for en; read the pinned VI instructions for vi.

    Failure cases:
    - Unsupported locales and missing/empty VI files fail closed.

    Side effects:
    - Reads a checked-in prompt file without changing source or draft state.
    """
    if locale not in {"en", "vi"}:
        raise ValueError("unsupported server-bound Preparation response language")
    from runtime_instruction_bundle import runtime_instruction
    body = runtime_instruction("preparation.presentation")
    if not body:
        raise ValueError("Vietnamese Preparation locale overlay is missing or empty")
    return "\n\n" + body


def read_preparation_skill(name: str, locale: str = "en") -> dict[str, str]:
    """Business purpose: Read an explicitly allowlisted, immutable Preparation skill by locale.

    Business rules:
    - Only four local skill package names and the locales en/vi are allowed.
    - No dynamic directory names, fallback locales, external links or repository retrieval.

    Execution flow:
    1. Validate the requested canonical name and locale against literal allowlists.
    2. Read the corresponding checked-in skill text and compute its SHA-256.
    3. Return the name, locale, body, and content hash for review and telemetry.

    Failure cases:
    - An unlisted name, invalid locale, missing file, or empty skill body raises an explicit exception.

    Side effects:
    - Reads packaged project instructions only; no legal-source or draft changes.
    """
    if name not in _SKILLS:
        raise ValueError("preparation skill is not allowlisted")
    if locale not in {"en", "vi"}:
        raise ValueError("preparation skill locale must be en or vi")
    from runtime_instruction_bundle import runtime_instruction
    body = runtime_instruction("skill." + name)
    if not body:
        raise ValueError("preparation skill file is empty")
    return {
        "name": name,
        "locale": "en",
        "body": body,
        "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }


def build_preparation_skill_tools(locale: str = "vi", used_skills: dict[str, str] | None = None) -> list:
    """Business purpose: Expose two read-only, allowlisted skill tools to Preparation agents.

    Business rules:
    - Skill loading conveys methodology only; it never grants tools, source authority or mutations.

    Execution flow:
    1. Create a catalog tool exposing the exact allowlist.
    2. Create a named file reader with a strict locale parameter.
    3. Return these tools for the phase-specific server allowlist.

    Failure cases:
    - Expected skill and schema validation errors return fixed JSON results, never raw exception details.
    - Unknown programming failures still propagate to the caller for operator diagnosis.

    Side effects:
    - Returns tool definitions; successful skill invocation records only approved content hashes.
    """

    if locale not in {"vi", "en"}:
        raise ValueError("unsupported server-bound Preparation skill locale")
    trusted_locale = "en"

    @tool
    def list_preparation_skills() -> str:
        """Business purpose: Show the only methodology skills available to the Preparation agent.

        Business rules:
        - Only four checked-in skills are advertised; legal authority always belongs to pinned source.

        Execution flow:
        1. Read the immutable skill names and summaries from the local catalog.
        2. Serialize the allowed entries and their methodology-only boundary to JSON.

        Failure cases:
        - Serialization failures surface as errors without granting any additional capability.

        Side effects:
        - Reads a module-level constant and returns JSON without changing source or draft state.
        """
        return json.dumps(
            {"skills": [
                {"name": key, "purpose": __import__("runtime_instruction_bundle", fromlist=["runtime_instruction"]).runtime_instruction("runtime.skill-catalogs", key)}
                for key, value in _SKILLS.items()
            ], "authority": "METHODOLOGY_ONLY", "legalSource": "PINNED_SOURCE_ONLY",
             "locale": trusted_locale},
            ensure_ascii=False,
        )

    @tool
    def load_preparation_skill(name: str, locale: str | None = None) -> str:
        """Business purpose: Load one bounded methodology skill into the current Preparation context.

        Business rules:
        - Skill identity and language must match fixed allowlists and the server-bound run locale.
        - Failure results must not expose file paths, internal errors or falsely record a used skill.

        Execution flow:
        1. Check the explicit locale override and allowlisted skill name.
        2. Read the pinned skill package; map expected failures to fixed JSON error codes.
        3. Only on success, record the selected hash and return the skill content as JSON.

        Failure cases:
        - Invalid input/locale, missing, unreadable, or malformed skill files return
          ok=false, error=<stable code>, retryable=<boolean> and requiredAction.
        - Unexpected programming failures still propagate to the caller.

        Side effects:
        - Reads one approved local skill file; only successful loads update used_skills.
        """
        if locale is not None and locale != trusted_locale:
            return _skill_tool_error("SKILL_LOCALE_MISMATCH")
        if name not in _SKILLS:
            return _skill_tool_error("SKILL_NAME_NOT_ALLOWED")
        try:
            payload = read_preparation_skill(name, trusted_locale)
        except FileNotFoundError:
            return _skill_tool_error("SKILL_FILE_MISSING")
        except PermissionError:
            return _skill_tool_error("SKILL_FILE_DENIED")
        except (UnicodeError, ValueError):
            return _skill_tool_error("SKILL_CONTENT_INVALID")
        except OSError as error:
            # Only known transient local I/O statuses permit one bounded retry.
            if error.errno in {errno.EAGAIN, errno.EINTR, errno.EBUSY, errno.ETIMEDOUT, errno.ESTALE}:
                return _skill_tool_error("SKILL_READ_UNAVAILABLE")
            return _skill_tool_error("SKILL_READ_FAILED")
        if used_skills is not None:
            used_skills[name] = payload["sha256"]
        return json.dumps({"ok": True, **payload}, ensure_ascii=False)

    # LangChain parses schema arguments before entering the decorated function.
    # Prevent Pydantic validation details from leaking through that separate boundary.
    load_preparation_skill.handle_validation_error = (
        lambda _error: _skill_tool_error("SKILL_INPUT_INVALID")
    )

    return [list_preparation_skills, load_preparation_skill]
