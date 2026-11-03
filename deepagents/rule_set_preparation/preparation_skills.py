"""Controlled Preparation skill library and server-bound development scope overlay."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from langchain_core.tools import tool


_SKILLS_ROOT = Path(__file__).resolve().parents[1] / "skills"
_SCOPE_OVERLAY = Path(__file__).with_name("instructions-development.md")
_SKILLS = {
    "rule-preparation-actor-stage": "Distinguish legal addressees, regulated activities, and development from deployment and operations.",
    "rule-preparation-mixed-claims": "Separate legal modalities and actors in a single clause without losing material modifiers.",
    "rule-preparation-material-context": "Retain material legal ancestors, definitions, conditions, exceptions and references.",
    "rule-preparation-scope-quality": "Audit developer-only selection without inventing duties or deleting legal-source accounting.",
}
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
    body = _SCOPE_OVERLAY.read_text(encoding="utf-8").strip()
    if not body:
        raise ValueError("development scope instruction overlay is empty")
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
    filename = "SKILL.md" if locale == "en" else "SKILL.vi.md"
    body = (_SKILLS_ROOT / name / filename).read_text(encoding="utf-8").strip()
    if not body:
        raise ValueError("preparation skill file is empty")
    return {
        "name": name,
        "locale": locale,
        "body": body,
        "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }


def build_preparation_skill_tools() -> list:
    """Business purpose: Expose two read-only, allowlisted skill tools to Preparation agents.

    Business rules:
    - Skill loading conveys methodology only; it never grants tools, source authority or mutations.

    Execution flow:
    1. Create a catalog tool exposing the exact allowlist.
    2. Create a named file reader with a strict locale parameter.
    3. Return these tools for the phase-specific server allowlist.

    Failure cases:
    - Malformed parameters are rejected by tool schemas; missing skills fail closed.

    Side effects:
    - Returns tool definitions; invocation only reads packaged files.
    """

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
                {"name": key, "purpose": value}
                for key, value in _SKILLS.items()
            ], "authority": "METHODOLOGY_ONLY", "legalSource": "PINNED_SOURCE_ONLY"},
            ensure_ascii=False,
        )

    @tool
    def load_preparation_skill(name: str, locale: str = "en") -> str:
        """Business purpose: Load one bounded methodology skill into the current Preparation context.

        Business rules:
        - The skill name and language must satisfy fixed allowlists, with no fallback or arbitrary path.

        Execution flow:
        1. Delegate source validation and bounded local file loading to read_preparation_skill.
        2. Return the skill content, locale and SHA-256 through a JSON tool result.

        Failure cases:
        - Invalid names, locale values, or missing local skill files cause a returned tool error.

        Side effects:
        - Reads one local skill package and returns JSON without touching legal source or drafts.
        """
        return json.dumps(read_preparation_skill(name, locale), ensure_ascii=False)

    return [list_preparation_skills, load_preparation_skill]
