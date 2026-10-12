# LCSP Deep Agent Response Localization Architecture

## Overview

The LCSP Deep Agent architecture enforces user/system response language control (e.g. `en`, `vi`) so that final user-visible agent responses strictly follow the configured system/user setting, regardless of the language detected in individual prompt queries.

```
User / System Setting (authoritative, e.g. "vi" or "en")
       │
       ▼
LCSPRunContext.response_language ("en" | "vi" | extensible)
       │
       ▼
Deep Agent Invocation (propagates context through Deep Agent graph)
       │
       ├─► Dynamic Prompt Directive (Instructs primary model to answer in response_language)
       │
       ├─► Tool & Subagent Execution (Executes normally without intermediate translations)
       │
       ▼
Final Agent Synthesis Turn (Parent boundary only)
       │
       ▼
ResponseLocalizationMiddleware (after_agent hook)
       │
       ├─► Lightweight Transform Model (Validates & normalizes final visible output)
       │   - Invariants strictly preserved: code blocks, inline code, URLs, citations,
       │     file paths, Jira/GitHub IDs, JSON keys, SCREAMING_SNAKE_CASE enums, error codes
       │   - Structured output: translates user-facing strings, validates schema integrity
       │   - Fallback: on transform timeout/failure, preserves primary response without failing turn
       │
       ▼
Localized Final Response returned to UI & Streams
```

---

## Language Authority & Fallback Strategy

1. **Authority Priority**:
   - Explicit persisted user/system language selection (`appLocale` / `lcsp_locale` cookie / workspace setting).
   - Application default (`vi` / `DEFAULT_RESPONSE_LANGUAGE`) when no selection exists.
   - User input in an opposite language (e.g. English prompt while setting is Vietnamese) does **not** override the selected response language.

2. **Extensible Runtime Context**:
   - `LCSPRunContext.response_language` carries the typed locale identifier and is automatically propagated to child subagents.
   - Dynamic prompt injection via `ResponseLocalizationMiddleware.wrap_model_call` informs the primary model before text generation.

3. **Lightweight Transform Model Isolation**:
   - Configured independently via `deepagents/config/model_routes.yaml` (role: `response-transform`) or environment variables (`LCSP_LOCALIZATION_ROLE`, `LCSP_RESPONSE_LOCALIZATION_ENABLED`).
   - Runs **at most once** per completed parent turn on the final visible response.
   - Never runs on intermediate tool calls, tool results, or internal subagents.
   - If the transform model times out or encounters an error, the execution safely falls back to the primary model's generation and records structured operational telemetry without exposing sensitive content.

---

## How to Add Additional Locales

Adding a new locale (for example, Japanese `ja` or French `fr`) requires zero changes to the underlying execution graph, tool signatures, or subagents:

### 1. Contract Definition (`packages/contracts/src/shared/locale.ts`)
Add the new locale key to `LOCALES` and `RESPONSE_LANGUAGES`:
```typescript
export const LOCALES = ["en", "vi", "ja"] as const;

export const RESPONSE_LANGUAGES = {
  en: "en",
  vi: "vi",
  ja: "ja",
} as const;
```

### 2. Python Locale Definition (`deepagents/orchestration/localization.py`)
Add the locale descriptor to `SUPPORTED_LOCALES` and `SUPPORTED_RESPONSE_LANGUAGES`:
```python
SUPPORTED_LOCALES["ja"] = LocaleDefinition(
    code="ja",
    name="日本語",
    english_name="Japanese",
    instruction="Produce your final user-visible response in Japanese (日本語).",
)
```

### 3. Verification
Run the regression test suite:
```bash
uv run pytest tests/test_response_localization.py
```
The new locale will immediately be available for runtime context resolution, dynamic prompt directive generation, and lightweight transform post-processing.
