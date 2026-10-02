"""Python mirror of @lcsp/contracts evidence/rule-assessment.ts value sets."""

from __future__ import annotations

# NOT_OBSERVED is epistemic, never ontological: "this investigation did not establish the
# requested fact". It never means the behaviour, file or control does not exist, and it
# always maps to UNRESOLVED_ENGINEERING_FACT (FINAL_ABSENCE stays disabled).
RULE_CRITERION_STATUSES = {
    "evidenceFound": "EVIDENCE_FOUND",
    "businessContextRequired": "BUSINESS_CONTEXT_REQUIRED",
    "technicalUnresolved": "TECHNICAL_UNRESOLVED",
    "notObserved": "NOT_OBSERVED",
}

# Kind of POSITIVE evidence cited for an EVIDENCE_FOUND criterion. The model reports the
# kind; it never decides compliance.
RULE_EVIDENCE_KINDS = {
    "supportsRequirement": "SUPPORTS_REQUIREMENT",
    "demonstratesViolation": "DEMONSTRATES_VIOLATION",
}

RULE_ANALYSIS_STATUSES = {
    "completed": "COMPLETED",
    "needsContext": "NEEDS_CONTEXT",
    "unresolved": "UNRESOLVED",
    "failed": "FAILED",
}

BUSINESS_CONTEXT_NEED_STATES = {
    "active": "ACTIVE",
    "resolved": "RESOLVED",
    "cancelled": "CANCELLED",
}

RULE_ANALYSIS_ACTIVITIES = {
    "ruleAnalysisStarted": "RULE_ANALYSIS_STARTED",
    "ruleAnalysisCompleted": "RULE_ANALYSIS_COMPLETED",
    "ruleAnalysisNeedsContext": "RULE_ANALYSIS_NEEDS_CONTEXT",
    "ruleAnalysisUnresolved": "RULE_ANALYSIS_UNRESOLVED",
    "ruleAnalysisFailed": "RULE_ANALYSIS_FAILED",
    "businessContextRequested": "BUSINESS_CONTEXT_REQUESTED",
    "businessContextResolved": "BUSINESS_CONTEXT_RESOLVED",
    "ruleAnalysisResumed": "RULE_ANALYSIS_RESUMED",
    "ruleApplicabilityEvaluated": "RULE_APPLICABILITY_EVALUATED",
    "ruleCompletionGated": "RULE_COMPLETION_GATED",
}

# Stable id of the only code allowed to stamp evidence provenance
# (rule_assessment.validation.validate_rule_assessment). Finalize re-checks it.
RULE_ASSESSMENT_VALIDATOR_ID = "lcsp.rule_assessment.v1"
