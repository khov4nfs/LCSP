---
task_id: MW-scan-py-010
module: python-workers/scanner
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/09-ai-invocation-detector.md
---

# Decision Flow Tracer

## Outcome

Detect `AUTOMATED_DECISION_SIGNAL`, `HUMAN_REVIEW_SIGNAL`, `HUMAN_OVERSIGHT_CONTROL_SIGNAL`, `AI_INTERACTION_DISCLOSURE_SIGNAL`, and `INCIDENT_HANDLING_SIGNAL` patterns from the fused finding set and AST/CST analysis results. An `AUTOMATED_DECISION_SIGNAL` requires: AI output + bounded condition/threshold/rule + state-changing action with no evidenced human-review step in the same flow. A `HUMAN_REVIEW_SIGNAL` requires positive evidence of a human gating step in the output path. `HUMAN_OVERSIGHT_CONTROL_SIGNAL`, `AI_INTERACTION_DISCLOSURE_SIGNAL`, and `INCIDENT_HANDLING_SIGNAL` require positive evidence of a control-flow shape around the AI invocation (override/kill-switch guard, disclosure render, or exception/monitoring wrap) — same no-evidence discipline as `HUMAN_REVIEW_SIGNAL`: absence is never inferred from silence, only asserted when the bounded path is fully resolved and no matching pattern is found (see No-Evidence Rule).

All five signal types feed `docs/specs/ai-usage-flow-domain-spec.md` claim categories `AUTOMATED_DECISION`, `HUMAN_REVIEW`, `HUMAN_OVERSIGHT_CONTROL`, `AI_INTERACTION_DISCLOSURE`, and `INCIDENT_HANDLING` respectively — this is the scanner-side evidence source for those five `AIUsageFlowSummary` fields. This is deliberately a bounded, pattern-name-only extraction (see `evidence_patterns: list[str]` in the output schema) rather than passing AST/CST content to an LLM: the control-flow shape around an AI invocation is exactly the signal needed for these fields, but it must be produced by deterministic pattern matching, never by an LLM reading the subtree, to preserve evidence-ref traceability and reproducibility.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/analyzers/decision_flow_tracer.py` | Create | Trace AI output → condition → action flows |
| `deepagents/tools/graph/scanner/analyzers/human_review_detector.py` | Create | Detect positive human-review evidence patterns |
| `deepagents/tools/graph/scanner/analyzers/decision_patterns.py` | Create | Rule tables for automated-decision and human-review patterns |

## AUTOMATED_DECISION_SIGNAL — Detection Criteria

All four conditions must be met to emit:

| # | Condition | Example patterns |
|---|---|---|
| 1 | **AI output present** | AI call site found in same function/module (from findings) |
| 2 | **Bounded condition** | `if score > threshold`, `if prediction == class`, `if result["label"] == "..."`, `match result:` branch on AI output |
| 3 | **State-changing action** | DB write, status update, email send, webhook call, API POST/PUT/DELETE, queue message |
| 4 | **No human-review evidence** in same bounded flow | No HUMAN_REVIEW_SIGNAL within same L2 scope |

Emit `AUTOMATED_DECISION_SIGNAL` when all 4 met. Confidence follows standard formula.

## AUTOMATED_DECISION_SIGNAL — Python Patterns

```python
AUTOMATED_DECISION_PATTERNS_PY = [
    # Pattern: if AI score/prediction triggers a write
    {
        "rule_id": "py-auto-decision-score-branch",
        "pattern_description": "AI score branch → state change",
        "ast_pattern": {
            "if_test": ["Compare", "score", "threshold", "confidence", "probability", "prediction"],
            "body_contains": ["Call", "db.", "session.", ".save(", ".update(", ".create(", ".delete("]
        },
        "finding_type": "AUTOMATED_DECISION_SIGNAL",
        "base_confidence": 0.65,
    },
    # Pattern: AI output directly assigned then used in state change
    {
        "rule_id": "py-auto-decision-direct-assign",
        "pattern_description": "AI result assigned → action taken without human gate",
        "ast_pattern": {
            "assign_from": "ai_call_site",
            "then_write": True,
        },
        "finding_type": "AUTOMATED_DECISION_SIGNAL",
        "base_confidence": 0.60,
    },
    # Pattern: LangChain agent executor → action tool call
    {
        "rule_id": "py-auto-decision-agent-tool",
        "pattern_description": "AgentExecutor with action tools",
        "semgrep_rule_ids": ["lcsp-langchain-agent-py"],
        "requires": "tools_list_not_empty",
        "finding_type": "AUTOMATED_DECISION_SIGNAL",
        "base_confidence": 0.70,
    },
]
```

## AUTOMATED_DECISION_SIGNAL — TS/JS Patterns

```python
AUTOMATED_DECISION_PATTERNS_JS = [
    {
        "rule_id": "ts-auto-decision-score-branch",
        "finding_type": "AUTOMATED_DECISION_SIGNAL",
        "base_confidence": 0.65,
    },
    {
        "rule_id": "ts-auto-decision-agent-tool",
        "finding_type": "AUTOMATED_DECISION_SIGNAL",
        "base_confidence": 0.70,
    },
]
```

## HUMAN_REVIEW_SIGNAL — Positive Evidence Patterns

Human review is ONLY emitted when positive evidence is found. Absence of automated-decision patterns is NOT sufficient evidence of human review.

```python
HUMAN_REVIEW_PATTERNS_PY = [
    # Explicit human-in-loop functions
    {
        "rule_id": "py-human-review-function",
        "patterns": [
            "require_human_approval", "await_human_review", "human_review",
            "manual_review", "human_in_the_loop", "hitl",
            "request_approval", "send_for_review",
        ],
        "finding_type": "HUMAN_REVIEW_SIGNAL",
        "base_confidence": 0.80,
    },
    # Explicit approval gating
    {
        "rule_id": "py-human-approval-gate",
        "patterns": [
            "status == 'pending_review'", "status == 'awaiting_approval'",
            "approved_by =", "reviewer_id =",
            "approval_required", "requires_approval",
        ],
        "finding_type": "HUMAN_REVIEW_SIGNAL",
        "base_confidence": 0.75,
    },
    # Workflow/task assignment to human
    {
        "rule_id": "py-human-task-assignment",
        "patterns": [
            "assign_to_reviewer", "create_task(assignee=", "notify_reviewer",
            "send_review_notification", "create_review_request",
        ],
        "finding_type": "HUMAN_REVIEW_SIGNAL",
        "base_confidence": 0.70,
    },
]

HUMAN_REVIEW_PATTERNS_JS = [
    {
        "rule_id": "ts-human-review-function",
        "patterns": [
            "requireHumanApproval", "awaitHumanReview", "humanReview",
            "manualReview", "humanInTheLoop", "requestApproval",
        ],
        "finding_type": "HUMAN_REVIEW_SIGNAL",
        "base_confidence": 0.80,
    },
]
```

## HUMAN_OVERSIGHT_CONTROL_SIGNAL — Positive Evidence Patterns

Distinct from `HUMAN_REVIEW_SIGNAL`: this detects a system-level intervention/kill-switch capability (can an operator halt or override the automated path), not per-decision review. Only emitted on positive pattern match, checked on the same bounded path as an `AUTOMATED_DECISION_SIGNAL` or a high-impact `MODEL_INVOCATION`.

```python
HUMAN_OVERSIGHT_CONTROL_PATTERNS_PY = [
    {
        "rule_id": "py-oversight-kill-switch",
        "patterns": [
            "kill_switch", "circuit_breaker", "emergency_stop",
            "pause_automation", "halt_automation", "is_paused",
        ],
        "finding_type": "HUMAN_OVERSIGHT_CONTROL_SIGNAL",
        "base_confidence": 0.75,
    },
    {
        "rule_id": "py-oversight-manual-override",
        "patterns": [
            "manual_override", "override_enabled", "disable_ai(",
            "feature_flag", "admin_disable",
        ],
        "finding_type": "HUMAN_OVERSIGHT_CONTROL_SIGNAL",
        "base_confidence": 0.65,
    },
]

HUMAN_OVERSIGHT_CONTROL_PATTERNS_JS = [
    {
        "rule_id": "ts-oversight-kill-switch",
        "patterns": [
            "killSwitch", "circuitBreaker", "emergencyStop",
            "pauseAutomation", "isPaused",
        ],
        "finding_type": "HUMAN_OVERSIGHT_CONTROL_SIGNAL",
        "base_confidence": 0.75,
    },
    {
        "rule_id": "ts-oversight-manual-override",
        "patterns": [
            "manualOverride", "overrideEnabled", "disableAi(",
            "featureFlag", "adminDisable",
        ],
        "finding_type": "HUMAN_OVERSIGHT_CONTROL_SIGNAL",
        "base_confidence": 0.65,
    },
]
```

## AI_INTERACTION_DISCLOSURE_SIGNAL — Positive Evidence Patterns

Only applies on a direct human-facing interaction surface (chat/voice/assistant route or component) resolved in the same or a one-hop-linked module as the AI invocation.

```python
AI_INTERACTION_DISCLOSURE_PATTERNS_PY = [
    {
        "rule_id": "py-disclosure-banner",
        "patterns": [
            "ai_disclosure", "is_ai_generated", "ai_disclaimer",
            "chatbot_notice", "ai_assistant_notice", "you_are_chatting_with_ai",
        ],
        "finding_type": "AI_INTERACTION_DISCLOSURE_SIGNAL",
        "base_confidence": 0.65,
    },
]

AI_INTERACTION_DISCLOSURE_PATTERNS_JS = [
    {
        "rule_id": "ts-disclosure-banner",
        "patterns": [
            "aiDisclosure", "isAiGenerated", "aiDisclaimer",
            "chatbotNotice", "aiAssistantNotice",
        ],
        "finding_type": "AI_INTERACTION_DISCLOSURE_SIGNAL",
        "base_confidence": 0.65,
    },
]
```

## INCIDENT_HANDLING_SIGNAL — Positive Evidence Patterns

Checked on the bounded path wrapping a `MODEL_INVOCATION` finding — exception handling alone (a bare `try/except`) is not sufficient; the except/monitoring branch must reference a reporting/alerting/logging action.

```python
INCIDENT_HANDLING_PATTERNS_PY = [
    {
        "rule_id": "py-incident-exception-report",
        "ast_pattern": {
            "wraps": "ai_call_site",
            "except_body_contains": [
                "logger.error", "logger.exception", "sentry", "capture_exception",
                "alert(", "notify_oncall(", "report_incident(",
            ],
        },
        "finding_type": "INCIDENT_HANDLING_SIGNAL",
        "base_confidence": 0.60,
    },
    {
        "rule_id": "py-incident-monitoring-hook",
        "patterns": [
            "track_error(", "increment_error_metric(", "monitor(",
        ],
        "finding_type": "INCIDENT_HANDLING_SIGNAL",
        "base_confidence": 0.55,
    },
]

INCIDENT_HANDLING_PATTERNS_JS = [
    {
        "rule_id": "ts-incident-exception-report",
        "ast_pattern": {
            "wraps": "ai_call_site",
            "catch_body_contains": [
                "console.error", "Sentry.captureException", "reportIncident(",
                "notifyOncall(",
            ],
        },
        "finding_type": "INCIDENT_HANDLING_SIGNAL",
        "base_confidence": 0.60,
    },
]
```

## Bounded Flow Analysis

The tracer operates within L2 scope (same module/file). For L3 cross-module:

- Follow up to a configured maximum number of calls (default 5) to statically resolvable imported functions if the function name matches a state-change pattern, per ADR-023 Phase 5.2M bounded static call-chain depth.
- Do NOT follow dynamic calls.
- If the AI output flows to an external callback or event (cannot trace statically), or the static chain exceeds the configured max hop depth, emit `UNSUPPORTED_DYNAMIC_FLOW`.

## No-Evidence Rule (Critical)

If neither `AUTOMATED_DECISION_SIGNAL` nor `HUMAN_REVIEW_SIGNAL` pattern is detected in a flow that contains AI output:

- Do NOT emit either finding.
- Do NOT infer "human review" from absence of automated patterns.
- Do NOT infer "automated decision" from presence of AI output alone.

This is the L4 boundary: uncertain flow disposition → `UNSUPPORTED_DYNAMIC_FLOW` if call is dynamic, otherwise no finding.

The same discipline applies to `HUMAN_OVERSIGHT_CONTROL_SIGNAL`, `AI_INTERACTION_DISCLOSURE_SIGNAL`, and `INCIDENT_HANDLING_SIGNAL`: no pattern match on a fully-resolved bounded path means no finding is emitted (which `ai-usage-flow-domain-spec.md` maps to `ABSENT`, not silence) — the tracer must not stay silent when the path is resolved and the pattern is genuinely missing, and must not guess when the path is unresolved/dynamic (`UNSUPPORTED_DYNAMIC_FLOW`, which maps to `UNCLEAR`).

## Output Schema

```python
@dataclass
class DecisionFlowTrace:
    finding_id: str
    finding_type: str   # 'AUTOMATED_DECISION_SIGNAL' | 'HUMAN_REVIEW_SIGNAL'
    file_path: str      # Relative
    line_number: int
    matched_rule_id: str
    analysis_level: str
    ai_output_source_finding_id: str   # Link to the triggering AI_PROVIDER_USAGE finding
    evidence_patterns: list[str]       # Pattern names that matched (no source content)
    has_human_review_in_scope: bool    # True if HUMAN_REVIEW_SIGNAL found in same flow
    confidence: float

@dataclass
class ControlFlowSignalTrace:
    finding_id: str
    finding_type: str   # 'HUMAN_OVERSIGHT_CONTROL_SIGNAL' | 'AI_INTERACTION_DISCLOSURE_SIGNAL' | 'INCIDENT_HANDLING_SIGNAL'
    file_path: str      # Relative
    line_number: int
    matched_rule_id: str
    analysis_level: str
    ai_output_source_finding_id: str   # Link to the triggering AI_PROVIDER_USAGE/AUTOMATED_DECISION_SIGNAL finding
    evidence_patterns: list[str]       # Pattern names that matched (no source content)
    path_resolved: bool                # False when path is dynamic/unresolved — maps to UNCLEAR, not ABSENT
    confidence: float
```

## Business Rules

1. `AUTOMATED_DECISION_SIGNAL` requires all 4 conditions (AI output, condition, state change, no human review in scope).
2. `HUMAN_REVIEW_SIGNAL` requires positive pattern match — absence of automated patterns is not sufficient.
3. Both findings reference `ai_output_source_finding_id` linking to the triggering AI finding.
4. Do not emit `AUTOMATED_DECISION_SIGNAL` if `HUMAN_REVIEW_SIGNAL` found in same bounded flow.
5. Dynamic dispatch in decision flow → `UNSUPPORTED_DYNAMIC_FLOW`.
6. No raw source in `evidence_patterns` — pattern names only (e.g. `"py-human-review-function"`).
7. `HUMAN_OVERSIGHT_CONTROL_SIGNAL`, `AI_INTERACTION_DISCLOSURE_SIGNAL`, `INCIDENT_HANDLING_SIGNAL` each require positive pattern match — absence of the pattern is not itself evidence; it becomes an explicit `ABSENT` value only when `path_resolved = true` and no matching pattern was found.
8. `INCIDENT_HANDLING_SIGNAL` requires a reporting/alerting/logging action inside the except/catch body, not a bare `try/except` alone.
9. `AI_INTERACTION_DISCLOSURE_SIGNAL` only applies when a direct human-facing interaction surface is present; it does not apply to non-interactive/backend-only AI usage (`NOT_APPLICABLE` per `ai-usage-flow-domain-spec.md`).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `score = model.predict(X); if score > 0.8: db.update(status="approved")` | `AUTOMATED_DECISION_SIGNAL` |
| T02 | Same as T01 + `require_human_approval()` before db.update | `HUMAN_REVIEW_SIGNAL` emitted, `AUTOMATED_DECISION_SIGNAL` NOT emitted |
| T03 | AI call with output going into log only (no state change) | No decision signal emitted |
| T04 | AgentExecutor with `tools=[send_email_tool]` | `AUTOMATED_DECISION_SIGNAL` (agent-tool pattern) |
| T05 | Flow: AI output → event bus (dynamic) | `UNSUPPORTED_DYNAMIC_FLOW` |
| T06 | `require_human_approval(result)` with no AI call site visible | `HUMAN_REVIEW_SIGNAL` (positive evidence regardless) |
| T07 | No AI call in module | No decision signals emitted |
| T08 | `evidence_patterns` field | Contains pattern rule IDs only, no source content |
| T09 | L3 cross-module: AI result passed to imported `apply_decision()` | Follow one hop, check for state change |
| T10 | `approved_by = reviewer_id` after AI output | `HUMAN_REVIEW_SIGNAL` |
| T11 | `if kill_switch.is_paused(): return` before AI-triggered action | `HUMAN_OVERSIGHT_CONTROL_SIGNAL` |
| T12 | Automated-decision path with no override/kill-switch pattern found, path fully resolved | `interventionControlPresent = ABSENT` (no finding emitted, resolved) |
| T13 | Chat route rendering `"ai_disclosure_banner"` before response | `AI_INTERACTION_DISCLOSURE_SIGNAL` |
| T14 | Backend-only AI usage, no interaction surface | `AI_INTERACTION_DISCLOSURE_SIGNAL` not applicable |
| T15 | `try: model.invoke(...) except Exception as e: sentry.capture_exception(e)` | `INCIDENT_HANDLING_SIGNAL` |
| T16 | `try: model.invoke(...) except Exception: pass` (no reporting action) | No `INCIDENT_HANDLING_SIGNAL` |

## Definition of Done

- `AUTOMATED_DECISION_SIGNAL` only emitted when all 4 conditions met.
- `HUMAN_REVIEW_SIGNAL` only emitted on positive pattern match.
- `HUMAN_OVERSIGHT_CONTROL_SIGNAL`, `AI_INTERACTION_DISCLOSURE_SIGNAL`, `INCIDENT_HANDLING_SIGNAL` only emitted on positive pattern match, with `path_resolved` correctly distinguishing `ABSENT` from `UNCLEAR`.
- All signals link to triggering AI finding via `ai_output_source_finding_id`.
- No source content in any output field.
- Dynamic decision flows emit `UNSUPPORTED_DYNAMIC_FLOW`.
