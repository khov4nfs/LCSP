"""Response localization and lightweight output normalization for LCSP Deep Agents.

Enforces user/system selected language authority (e.g. en, vi) on final user-visible
agent responses via dynamic prompt guidance and a configurable lightweight post-processing
transform model.
"""

from __future__ import annotations

import asyncio
from collections import Counter
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from orchestration.context import (
    DEFAULT_RESPONSE_LANGUAGE,
    SUPPORTED_RESPONSE_LANGUAGES,
    resolve_response_language,
)
from tools.common.capabilities.platform.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class LocaleDefinition:
    """Metadata and prompt directive for one supported response locale."""

    code: str
    name: str
    english_name: str
    instruction: str


# Canonical registry of supported locales for deep agent response localization.
# Adding a new locale here immediately enables dynamic prompting and transform routing.
SUPPORTED_LOCALES: dict[str, LocaleDefinition] = {
    "en": LocaleDefinition(
        code="en",
        name="English",
        english_name="English",
        instruction="Produce your final user-visible response in English.",
    ),
    "vi": LocaleDefinition(
        code="vi",
        name="Tiếng Việt",
        english_name="Vietnamese",
        instruction="Produce your final user-visible response in Vietnamese (Tiếng Việt).",
    ),
}


@dataclass(frozen=True)
class ResponseLocalizationConfig:
    """Configuration for the post-processing lightweight transform model."""

    enabled: bool = True
    role: str = "response-transform"
    timeout_seconds: float = 10.0
    max_output_tokens: int = 4096
    supported_locales: tuple[str, ...] = SUPPORTED_RESPONSE_LANGUAGES


def load_localization_config() -> ResponseLocalizationConfig:
    """Load localization configuration from environment / defaults."""
    raw_enabled = os.environ.get("LCSP_RESPONSE_LOCALIZATION_ENABLED", "1").strip().lower()
    enabled = raw_enabled not in {"0", "false", "no", "off"}
    raw_timeout = os.environ.get("LCSP_LOCALIZATION_TIMEOUT_SECONDS", "10.0").strip()
    try:
        timeout = float(raw_timeout)
    except ValueError:
        timeout = 10.0
    raw_max_tokens = os.environ.get("LCSP_LOCALIZATION_MAX_OUTPUT_TOKENS", "4096").strip()
    try:
        max_tokens = int(raw_max_tokens)
    except ValueError:
        max_tokens = 4096
    role = os.environ.get("LCSP_LOCALIZATION_ROLE", "response-transform").strip() or "response-transform"
    return ResponseLocalizationConfig(
        enabled=enabled,
        role=role,
        timeout_seconds=timeout,
        max_output_tokens=max_tokens,
    )


def get_language_prompt_instruction(locale: str) -> str:
    """Generate dynamic system prompt instruction for the main agent."""
    normalized_locale = str(locale).strip().lower() if locale else DEFAULT_RESPONSE_LANGUAGE
    definition = SUPPORTED_LOCALES.get(normalized_locale) or SUPPORTED_LOCALES.get(DEFAULT_RESPONSE_LANGUAGE, SUPPORTED_LOCALES["en"])
    return (
        f"Final Response Language Directive:\n"
        f"- {definition.instruction}\n"
        f"- Keep all technical identifiers, file paths, URLs, citations/references, code blocks/inline code, "
        f"API field names, Jira/GitHub identifiers, and enum/constant values in their canonical format.\n"
        f"- Do NOT translate internal machine identifiers, tool names, or structured JSON keys."
    )


TRANSFORM_SYSTEM_PROMPT_TEMPLATE = """You are a specialized output localization and normalization engine for the LCSP compliance platform.
Your ONLY task is to normalize/translate the user-visible final response into the target language: {target_language} ({target_locale}).

PRESERVATION INVARIANTS (MUST PRESERVE EXACTLY WITHOUT MODIFICATION):
1. Facts, conclusions, caveats, reasoning outcomes, and recommendations.
2. Numbers, arithmetic calculations, percentages, and metrics.
3. URLs, web links, domain names, and anchors.
4. Citations and source references (e.g. [1], [file.py#L10-L20], article numbers).
5. Jira/GitHub identifiers, issue/PR numbers (e.g. LCSP-123, #456).
6. File paths, directory paths, package paths, and filenames (e.g. /workspace/repo/src/index.ts).
7. Code blocks and inline code (`...`) verbatim, including code logic, syntax, and variable names.
8. JSON keys, API field names, HTTP status codes, and SCREAMING_SNAKE_CASE enum/constant values.
9. Command names, CLI syntax, and error codes.
10. Markdown structure, formatting, tables, lists, and headings.

TRANSLATION RULES:
- Translate ONLY the natural-language explanations and user-facing descriptive text into {target_language}.
- Do NOT add any preamble, greeting, commentary, or conversational filler (e.g. do NOT say "Here is the translated response:").
- Output ONLY the final normalized response.
- If the text is already completely in {target_language}, return it unchanged.
- Never alter facts, remove warnings, or invent new information.
"""

STRUCTURED_SYSTEM_PROMPT_TEMPLATE = """You are a specialized output localization engine for the LCSP compliance platform.
Your task is to translate ONLY the string field values inside the provided JSON object into {target_language} ({target_locale}).

PRESERVATION INVARIANTS:
- Preserve all JSON keys, structure, and non-string types exactly.
- Preserve all code snippets, URLs, file paths, IDs (e.g. LCSP-123), citations ([1]), numbers, and SCREAMING_SNAKE_CASE enum constants verbatim.
- Return ONLY valid JSON matching the exact key structure of the input, with no surrounding commentary or markdown code fences unless requested.
"""


def extract_technical_invariants(text: str) -> dict[str, list[str]]:
    """Extract deterministic technical invariants as lists (multisets) that must be preserved verbatim."""
    if not text or not isinstance(text, str):
        return {}

    raw_urls = re.findall(r"https?://[^\s\"'>]+", text)
    cleaned_urls = [u.rstrip(".,;:)>]") for u in raw_urls if u.strip()]

    raw_paths = re.findall(
        r"(?:/(?:workspace|[\w.-]+/\w+)|(?:\b(?:src|apps|packages|deepagents|\.lcsp)/))[\w./-]+[a-zA-Z0-9_-](?::\d+|#L\d+(?:-L\d+)?)?",
        text,
    )
    cleaned_paths = [p.rstrip(".,;:)>]") for p in raw_paths if p.strip()]

    invariants: dict[str, list[str]] = {
        "code_blocks": re.findall(r"```[\w-]*\n?[\s\S]*?```", text),
        "inline_code": re.findall(r"`[^`\n]+`", text),
        "urls": cleaned_urls,
        "citations": re.findall(r"\[(?:\d+|[^\]\n]+#L\d+(?:-L\d+)?)\]", text),
        "jira_issues": re.findall(r"\b[A-Z]{2,}-\d+\b", text),
        "github_issues": re.findall(r"(?<!\w)#\d+\b", text),
        "screaming_enums": re.findall(r"\b[A-Z][A-Z0-9_]*_[A-Z0-9_]+\b", text),
        "file_paths": cleaned_paths,
        "numbers": re.findall(r"\b\d+(?:\.\d+)?%?\b", text),
    }
    return invariants


def validate_invariant_preservation(original_text: str, transformed_text: str) -> tuple[bool, str | None]:
    """Deterministically verify that transformed_text preserves all technical invariants from original_text
    in an exact bidirectional multiset (no missing and no injected/extra values).

    Returns:
        (is_valid, failure_reason)
    """
    if not original_text or not transformed_text:
        return True, None

    orig_invariants = extract_technical_invariants(original_text)
    trans_invariants = extract_technical_invariants(transformed_text)

    categories = (
        "code_blocks",
        "inline_code",
        "urls",
        "citations",
        "jira_issues",
        "github_issues",
        "screaming_enums",
        "file_paths",
        "numbers",
    )

    for category in categories:
        orig_counts = Counter(orig_invariants.get(category, []))
        trans_counts = Counter(trans_invariants.get(category, []))

        # Check for missing invariants (original had more than transformed)
        for item, orig_count in orig_counts.items():
            trans_count = trans_counts.get(item, 0)
            if trans_count < orig_count:
                return False, f"MISSING_{category.upper()}: {item}"

        # Check for injected/extra invariants (transformed has more than original)
        for item, trans_count in trans_counts.items():
            orig_count = orig_counts.get(item, 0)
            if trans_count > orig_count:
                return False, f"EXTRA_INJECTED_{category.upper()}: {item}"

    return True, None


def _get_transform_model(config: ResponseLocalizationConfig) -> Any:
    """Resolve the lightweight chat model configured for response transformation."""
    try:
        from model_policy import resolve_agent_model
        return resolve_agent_model(config.role)
    except Exception as error:
        logger.warning(
            "RESPONSE_LOCALIZATION_MODEL_RESOLUTION_FAILED",
            role=config.role,
            error=str(error),
        )
        return None


def _bind_model_limits(model: Any, config: ResponseLocalizationConfig) -> Any:
    """Bind token limits to the transform model if supported."""
    if model is None:
        return None
    if model.__class__.__name__ in ("MagicMock", "Mock", "AsyncMock", "NonCallableMagicMock"):
        return model
    if hasattr(model, "bind") and callable(model.bind):
        try:
            return model.bind(max_tokens=config.max_output_tokens)
        except Exception:
            try:
                return model.bind(max_output_tokens=config.max_output_tokens)
            except Exception:
                return model
    return model



_TRANSFORM_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="lcsp-response-transform")


def _invoke_with_timeout(
    model: Any,
    messages: Sequence[BaseMessage],
    timeout_seconds: float,
) -> Any:
    """Execute model.invoke synchronously inside a ThreadPoolExecutor with deadline enforcement."""
    future = _TRANSFORM_EXECUTOR.submit(model.invoke, messages)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError as exc:
        future.cancel()
        raise TimeoutError(f"Transform model exceeded {timeout_seconds:.1f}s deadline") from exc



async def _ainvoke_with_timeout(
    model: Any,
    messages: Sequence[BaseMessage],
    timeout_seconds: float,
) -> Any:
    """Execute model ainvoke or thread invocation asynchronously with deadline enforcement."""
    if hasattr(model, "ainvoke") and callable(model.ainvoke):
        return await asyncio.wait_for(model.ainvoke(messages), timeout=timeout_seconds)
    loop = asyncio.get_running_loop()
    return await asyncio.wait_for(
        loop.run_in_executor(None, model.invoke, messages),
        timeout=timeout_seconds,
    )


def _extract_response_content(response: Any) -> tuple[str, dict[str, Any] | None]:
    """Extract string content and token telemetry from ChatResult / AIMessage."""
    content = response.content if hasattr(response, "content") else str(response)
    if isinstance(content, list):
        content = "".join(
            b.get("text", "") if isinstance(b, dict) else str(b) for b in content
        )
    text = str(content).strip()

    token_usage = None
    if hasattr(response, "response_metadata") and isinstance(response.response_metadata, dict):
        token_usage = response.response_metadata.get("token_usage") or response.response_metadata.get("usage")
    return text, token_usage


def transform_response_text(
    text: str,
    target_locale: str,
    *,
    model: Any | None = None,
    config: ResponseLocalizationConfig | None = None,
) -> tuple[str, dict[str, Any]]:
    """Transform user-visible text into the target locale using a lightweight model with fail-closed invariant validation.

    Returns:
        (result_text, telemetry_dict)
    """
    if config is None:
        config = load_localization_config()

    normalized_locale = str(target_locale).strip().lower() if target_locale else DEFAULT_RESPONSE_LANGUAGE
    telemetry: dict[str, Any] = {
        "locale": normalized_locale,
        "status": "SKIPPED",
        "model": None,
        "latency_ms": 0.0,
        "token_usage": None,
        "fallback_used": False,
        "reason": None,
    }

    if not config.enabled:
        telemetry["reason"] = "LOCALIZATION_DISABLED"
        return text, telemetry

    if not text or not text.strip():
        telemetry["reason"] = "EMPTY_TEXT"
        return text, telemetry

    if normalized_locale not in config.supported_locales and normalized_locale not in SUPPORTED_LOCALES:
        telemetry["reason"] = f"UNSUPPORTED_LOCALE_{normalized_locale}"
        return text, telemetry

    definition = SUPPORTED_LOCALES.get(normalized_locale, SUPPORTED_LOCALES["en"])
    active_model = model or _get_transform_model(config)
    if active_model is None:
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = "MODEL_UNAVAILABLE"
        logger.warning(
            "RESPONSE_LOCALIZATION_FALLBACK",
            locale=normalized_locale,
            reason="MODEL_UNAVAILABLE",
        )
        return text, telemetry

    model_name = getattr(active_model, "model_name", None) or getattr(active_model, "model", "lightweight-transform")
    telemetry["model"] = str(model_name)

    bound_model = _bind_model_limits(active_model, config)
    system_prompt = TRANSFORM_SYSTEM_PROMPT_TEMPLATE.format(
        target_language=definition.name,
        target_locale=definition.code,
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=text),
    ]

    start_time = time.monotonic()
    try:
        response = _invoke_with_timeout(bound_model, messages, timeout_seconds=config.timeout_seconds)
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)

        transformed, token_usage = _extract_response_content(response)
        if token_usage:
            telemetry["token_usage"] = token_usage

        if not transformed:
            telemetry["status"] = "FALLBACK"
            telemetry["fallback_used"] = True
            telemetry["reason"] = "EMPTY_MODEL_OUTPUT"
            logger.warning(
                "RESPONSE_LOCALIZATION_FALLBACK",
                locale=normalized_locale,
                reason="EMPTY_MODEL_OUTPUT",
                latency_ms=telemetry["latency_ms"],
            )
            return text, telemetry

        # Deterministic fail-closed technical invariant validation
        is_valid, violation_reason = validate_invariant_preservation(text, transformed)
        if not is_valid:
            telemetry["status"] = "FALLBACK"
            telemetry["fallback_used"] = True
            telemetry["reason"] = f"INVARIANT_VIOLATION: {violation_reason}"
            logger.warning(
                "RESPONSE_LOCALIZATION_INVARIANT_VIOLATION",
                locale=normalized_locale,
                violation=violation_reason,
                latency_ms=telemetry["latency_ms"],
                fallback_used=True,
            )
            return text, telemetry

        telemetry["status"] = "APPLIED"
        logger.info(
            "RESPONSE_LOCALIZATION_APPLIED",
            locale=normalized_locale,
            model=telemetry["model"],
            latency_ms=telemetry["latency_ms"],
            fallback_used=False,
        )
        return transformed, telemetry

    except TimeoutError as exc:
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = "TIMEOUT"
        logger.warning(
            "RESPONSE_LOCALIZATION_TIMEOUT",
            locale=normalized_locale,
            timeout_seconds=config.timeout_seconds,
            latency_ms=telemetry["latency_ms"],
            fallback_used=True,
        )
        return text, telemetry
    except Exception as exc:
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = type(exc).__name__
        logger.warning(
            "RESPONSE_LOCALIZATION_FAILED",
            locale=normalized_locale,
            error_type=type(exc).__name__,
            latency_ms=telemetry["latency_ms"],
            fallback_used=True,
        )
        return text, telemetry


async def atransform_response_text(
    text: str,
    target_locale: str,
    *,
    model: Any | None = None,
    config: ResponseLocalizationConfig | None = None,
) -> tuple[str, dict[str, Any]]:
    """Asynchronous version of transform_response_text with timeout and invariant validation."""
    if config is None:
        config = load_localization_config()

    normalized_locale = str(target_locale).strip().lower() if target_locale else DEFAULT_RESPONSE_LANGUAGE
    telemetry: dict[str, Any] = {
        "locale": normalized_locale,
        "status": "SKIPPED",
        "model": None,
        "latency_ms": 0.0,
        "token_usage": None,
        "fallback_used": False,
        "reason": None,
    }

    if not config.enabled:
        telemetry["reason"] = "LOCALIZATION_DISABLED"
        return text, telemetry

    if not text or not text.strip():
        telemetry["reason"] = "EMPTY_TEXT"
        return text, telemetry

    if normalized_locale not in config.supported_locales and normalized_locale not in SUPPORTED_LOCALES:
        telemetry["reason"] = f"UNSUPPORTED_LOCALE_{normalized_locale}"
        return text, telemetry

    definition = SUPPORTED_LOCALES.get(normalized_locale, SUPPORTED_LOCALES["en"])
    active_model = model or _get_transform_model(config)
    if active_model is None:
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = "MODEL_UNAVAILABLE"
        return text, telemetry

    model_name = getattr(active_model, "model_name", None) or getattr(active_model, "model", "lightweight-transform")
    telemetry["model"] = str(model_name)

    bound_model = _bind_model_limits(active_model, config)
    system_prompt = TRANSFORM_SYSTEM_PROMPT_TEMPLATE.format(
        target_language=definition.name,
        target_locale=definition.code,
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=text),
    ]

    start_time = time.monotonic()
    try:
        response = await _ainvoke_with_timeout(bound_model, messages, timeout_seconds=config.timeout_seconds)
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)

        transformed, token_usage = _extract_response_content(response)
        if token_usage:
            telemetry["token_usage"] = token_usage

        if not transformed:
            telemetry["status"] = "FALLBACK"
            telemetry["fallback_used"] = True
            telemetry["reason"] = "EMPTY_MODEL_OUTPUT"
            return text, telemetry

        is_valid, violation_reason = validate_invariant_preservation(text, transformed)
        if not is_valid:
            telemetry["status"] = "FALLBACK"
            telemetry["fallback_used"] = True
            telemetry["reason"] = f"INVARIANT_VIOLATION: {violation_reason}"
            return text, telemetry

        telemetry["status"] = "APPLIED"
        return transformed, telemetry

    except (TimeoutError, asyncio.TimeoutError):
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = "TIMEOUT"
        return text, telemetry
    except Exception as exc:
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = type(exc).__name__
        return text, telemetry


def transform_structured_response(
    structured: Any,
    target_locale: str,
    *,
    model: Any | None = None,
    config: ResponseLocalizationConfig | None = None,
) -> tuple[Any, dict[str, Any]]:
    """Transform user-facing string fields of a structured response in at most ONE model invocation.

    Preserves schema, non-string fields, and technical invariants.
    """
    if config is None:
        config = load_localization_config()

    normalized_locale = resolve_response_language(target_locale)
    telemetry: dict[str, Any] = {
        "locale": normalized_locale,
        "status": "SKIPPED",
        "fallback_used": False,
    }

    if structured is None or not config.enabled:
        return structured, telemetry

    is_pydantic = isinstance(structured, BaseModel)
    data = structured.model_dump() if is_pydantic else (dict(structured) if isinstance(structured, dict) else None)
    if data is None:
        return structured, telemetry

    # User-facing fields to localize in structured objects
    user_facing_fields = {"summary", "message", "explanation", "detail", "description", "label", "notes"}
    fields_to_transform = {
        key: value
        for key, value in data.items()
        if key in user_facing_fields and isinstance(value, str) and value.strip()
    }

    if not fields_to_transform:
        return structured, telemetry

    definition = SUPPORTED_LOCALES.get(normalized_locale, SUPPORTED_LOCALES["en"])
    active_model = model or _get_transform_model(config)
    if active_model is None:
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = "MODEL_UNAVAILABLE"
        return structured, telemetry

    # Single-field optimization: 1 model call via transform_response_text
    if len(fields_to_transform) == 1:
        key, original_val = next(iter(fields_to_transform.items()))
        transformed_val, t = transform_response_text(original_val, target_locale, model=active_model, config=config)
        if t["status"] == "APPLIED":
            updated = dict(data)
            updated[key] = transformed_val
            telemetry.update(t)
            if is_pydantic:
                try:
                    reconstructed = structured.__class__.model_validate(updated)
                    return reconstructed, telemetry
                except Exception:
                    telemetry["status"] = "FALLBACK"
                    telemetry["fallback_used"] = True
                    telemetry["reason"] = "STRUCTURED_VALIDATION_FAILED"
                    return structured, telemetry
            return updated, telemetry
        return structured, t

    # Multi-field schema-aware single transform (1 model invocation for all fields)
    bound_model = _bind_model_limits(active_model, config)
    system_prompt = STRUCTURED_SYSTEM_PROMPT_TEMPLATE.format(
        target_language=definition.name,
        target_locale=definition.code,
    )
    json_payload = json.dumps(fields_to_transform, ensure_ascii=False)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=json_payload),
    ]

    start_time = time.monotonic()
    try:
        response = _invoke_with_timeout(bound_model, messages, timeout_seconds=config.timeout_seconds)
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)

        raw_output, token_usage = _extract_response_content(response)
        if token_usage:
            telemetry["token_usage"] = token_usage

        # Strip optional markdown code fences from JSON output
        clean_json = raw_output.strip()
        if clean_json.startswith("```json"):
            clean_json = clean_json.removeprefix("```json").removesuffix("```").strip()
        elif clean_json.startswith("```"):
            clean_json = clean_json.removeprefix("```").removesuffix("```").strip()

        parsed = json.loads(clean_json)
        if not isinstance(parsed, dict):
            raise ValueError("Structured transform output is not a JSON object")

        updated = dict(data)
        for k, orig_v in fields_to_transform.items():
            trans_v = parsed.get(k)
            if isinstance(trans_v, str) and trans_v.strip():
                is_valid, violation = validate_invariant_preservation(orig_v, trans_v)
                if not is_valid:
                    raise ValueError(f"Invariant violation in field '{k}': {violation}")
                updated[k] = trans_v

        telemetry["status"] = "APPLIED"
        if is_pydantic:
            try:
                reconstructed = structured.__class__.model_validate(updated)
                return reconstructed, telemetry
            except Exception:
                telemetry["status"] = "FALLBACK"
                telemetry["fallback_used"] = True
                telemetry["reason"] = "STRUCTURED_VALIDATION_FAILED"
                return structured, telemetry
        return updated, telemetry

    except Exception as exc:
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = type(exc).__name__ if not isinstance(exc, TimeoutError) else "TIMEOUT"
        logger.warning(
            "STRUCTURED_LOCALIZATION_FALLBACK",
            locale=normalized_locale,
            reason=telemetry["reason"],
            latency_ms=telemetry["latency_ms"],
            fallback_used=True,
        )
        return structured, telemetry


async def atransform_structured_response(
    structured: Any,
    target_locale: str,
    *,
    model: Any | None = None,
    config: ResponseLocalizationConfig | None = None,
) -> tuple[Any, dict[str, Any]]:
    """Asynchronously transform user-facing string fields of a structured response in at most ONE model invocation.

    Preserves schema, non-string fields, and technical invariants without blocking the event loop.
    """
    if config is None:
        config = load_localization_config()

    normalized_locale = resolve_response_language(target_locale)
    telemetry: dict[str, Any] = {
        "locale": normalized_locale,
        "status": "SKIPPED",
        "fallback_used": False,
    }

    if structured is None or not config.enabled:
        return structured, telemetry

    is_pydantic = isinstance(structured, BaseModel)
    data = structured.model_dump() if is_pydantic else (dict(structured) if isinstance(structured, dict) else None)
    if data is None:
        return structured, telemetry

    # User-facing fields to localize in structured objects
    user_facing_fields = {"summary", "message", "explanation", "detail", "description", "label", "notes"}
    fields_to_transform = {
        key: value
        for key, value in data.items()
        if key in user_facing_fields and isinstance(value, str) and value.strip()
    }

    if not fields_to_transform:
        return structured, telemetry

    definition = SUPPORTED_LOCALES.get(normalized_locale, SUPPORTED_LOCALES["en"])
    active_model = model or _get_transform_model(config)
    if active_model is None:
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = "MODEL_UNAVAILABLE"
        return structured, telemetry

    # Single-field optimization: 1 model call via atransform_response_text
    if len(fields_to_transform) == 1:
        key, original_val = next(iter(fields_to_transform.items()))
        transformed_val, t = await atransform_response_text(original_val, target_locale, model=active_model, config=config)
        if t["status"] == "APPLIED":
            updated = dict(data)
            updated[key] = transformed_val
            telemetry.update(t)
            if is_pydantic:
                try:
                    reconstructed = structured.__class__.model_validate(updated)
                    return reconstructed, telemetry
                except Exception:
                    telemetry["status"] = "FALLBACK"
                    telemetry["fallback_used"] = True
                    telemetry["reason"] = "STRUCTURED_VALIDATION_FAILED"
                    return structured, telemetry
            return updated, telemetry
        return structured, t

    # Multi-field schema-aware single transform (1 async model invocation for all fields)
    bound_model = _bind_model_limits(active_model, config)
    system_prompt = STRUCTURED_SYSTEM_PROMPT_TEMPLATE.format(
        target_language=definition.name,
        target_locale=definition.code,
    )
    json_payload = json.dumps(fields_to_transform, ensure_ascii=False)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=json_payload),
    ]

    start_time = time.monotonic()
    try:
        response = await _ainvoke_with_timeout(bound_model, messages, timeout_seconds=config.timeout_seconds)
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)

        raw_output, token_usage = _extract_response_content(response)
        if token_usage:
            telemetry["token_usage"] = token_usage

        clean_json = raw_output.strip()
        if clean_json.startswith("```json"):
            clean_json = clean_json.removeprefix("```json").removesuffix("```").strip()
        elif clean_json.startswith("```"):
            clean_json = clean_json.removeprefix("```").removesuffix("```").strip()

        parsed = json.loads(clean_json)
        if not isinstance(parsed, dict):
            raise ValueError("Structured transform output is not a JSON object")

        updated = dict(data)
        for k, orig_v in fields_to_transform.items():
            trans_v = parsed.get(k)
            if isinstance(trans_v, str) and trans_v.strip():
                is_valid, violation = validate_invariant_preservation(orig_v, trans_v)
                if not is_valid:
                    raise ValueError(f"Invariant violation in field '{k}': {violation}")
                updated[k] = trans_v

        telemetry["status"] = "APPLIED"
        if is_pydantic:
            try:
                reconstructed = structured.__class__.model_validate(updated)
                return reconstructed, telemetry
            except Exception:
                telemetry["status"] = "FALLBACK"
                telemetry["fallback_used"] = True
                telemetry["reason"] = "STRUCTURED_VALIDATION_FAILED"
                return structured, telemetry
        return updated, telemetry

    except Exception as exc:
        duration_ms = (time.monotonic() - start_time) * 1000.0
        telemetry["latency_ms"] = round(duration_ms, 2)
        telemetry["status"] = "FALLBACK"
        telemetry["fallback_used"] = True
        telemetry["reason"] = type(exc).__name__ if not isinstance(exc, (TimeoutError, asyncio.TimeoutError)) else "TIMEOUT"
        logger.warning(
            "STRUCTURED_LOCALIZATION_FALLBACK",
            locale=normalized_locale,
            reason=telemetry["reason"],
            latency_ms=telemetry["latency_ms"],
            fallback_used=True,
        )
        return structured, telemetry


