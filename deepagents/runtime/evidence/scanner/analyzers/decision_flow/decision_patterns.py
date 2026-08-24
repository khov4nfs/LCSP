AUTOMATED_DECISION_PATTERNS_PY = [
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
    {
        "rule_id": "py-auto-decision-agent-tool",
        "pattern_description": "AgentExecutor with action tools",
        "semgrep_rule_ids": ["lcsp-langchain-agent-py"],
        "requires": "tools_list_not_empty",
        "finding_type": "AUTOMATED_DECISION_SIGNAL",
        "base_confidence": 0.70,
    },
]

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

HUMAN_REVIEW_PATTERNS_PY = [
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
