"""Managed boundary for persisted Customer Interview answers."""

from __future__ import annotations

from orchestration.agent_stream import invoke_with_stream

import hashlib
import json
import logging
import re
import unicodedata
from typing import Any, Callable

from contracts.handoffs import InterviewResult
from orchestration.result_validation import SpecialistHandoffValidationError
from tools.common.capabilities.managed.boundary import AgentBoundaryBase
from tools.common.capabilities.platform.api_client import (
    InterviewDecisionRepairableCallbackError,
)
from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
    PostGuardContinuationStore,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedStructuredBusinessContext,
    normalize_confirmed_structured_business_context,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
)
from tools.common.capabilities.assessment.planning.engineering_rule.engineering_rule_planner import (
    ENGINEERING_RULE_PLAN_REASON_CODES,
)
from tools.legal.retrieval.legal_basis.rule_applicability_evaluator import (
    RuleApplicabilityEvaluator,
    RULE_APPLICABILITY_STATUSES,
)

_LOGGER = logging.getLogger(__name__)
_INTERVIEW_AGENT_DECISION_REJECTION_REPAIRED = "INTERVIEW_AGENT_DECISION_REJECTION_REPAIRED"
_INTERVIEW_AUTHORITY_PROVENANCE_REPAIRED = "INTERVIEW_AUTHORITY_PROVENANCE_REPAIRED"
_INTERVIEW_CONFIRMATION_QUESTION_SYNTHESIZED = (
    "INTERVIEW_CONFIRMATION_QUESTION_SYNTHESIZED"
)
_INTERVIEW_CONFIRMATION_SYNTHESIS_REJECTED = (
    "INTERVIEW_CONFIRMATION_SYNTHESIS_REJECTED"
)
_CONFIRMATION_PROVENANCE_INSTRUCTION_KEY = (
    "CONFIRMATION_PROVENANCE_REQUIRES_CONFIRM_ADJUST_OR_DIRECT_ASK"
)
_MINIMUM_CONTEXT_INSTRUCTION_KEY = "MINIMUM_PLANNING_CONTEXT_REQUIRES_FOLLOW_UP"
# Keep these term sets and the matcher in sync with apps/api
# assessment-interview-runtime.service.ts::INITIAL_PLANNING_CONTEXT_DIMENSIONS.
# Terms are matched against word tokens: a trailing "*" is a prefix match, spaces form
# a phrase. An explicit "unknown" answer still resolves a dimension as UNKNOWN; it never
# implies a negative such as "no decision effect".
_INITIAL_PLANNING_CONTEXT_DIMENSIONS = {
    "aiUsage": (
        "ai",
        "artificial intelligence",
        "model*",
        "llm*",
        "gpt*",
        "gemini",
        "openai",
        "claude",
        "copilot",
        "chatbot*",
        "machine learning",
        "algorithm*",
        "classifier*",
        "generative",
        "automated decision*",
    ),
    "operationalProcess": (
        "process*",
        "workflow*",
        "operation*",
        "pipeline*",
        "assessment*",
        "onboarding",
        "support",
        "procedure*",
        "use case*",
    ),
    "decisionInfluence": (
        "decision*",
        "decide*",
        "action*",
        "approv*",
        "reject*",
        "gate",
        "gates",
        "block*",
        "deploy*",
        "trigger*",
        "automatically",
        "autonomous*",
        "update*",
        "status",
        "external effect*",
        "recommend*",
        "advis*",
        "draft*",
        "suggest*",
        "influenc*",
    ),
    # Approval verbs alone ("AI never approves") say nothing about who oversees AI output.
    "humanOversight": (
        "human*",
        "person",
        "persons",
        "people",
        "manual*",
        "review*",
        "oversight",
        "supervis*",
        "sign off",
        "approver*",
        "operator*",
        "staff",
        "analyst*",
        "officer*",
        "manager*",
        "recruiter*",
    ),
    "affectedSubjects": (
        "user*",
        "customer*",
        "client*",
        "employee*",
        "applicant*",
        "candidate*",
        "patient*",
        "student*",
        "citizen*",
        "consumer*",
        "subject*",
        "individual*",
        "organization*",
        "organisation*",
        "tenant*",
        "member*",
        "business process*",
        "affected process*",
    ),
    "dataCategories": (
        "data",
        "dataset*",
        "database*",
        "code",
        "codebase*",
        "repositor*",
        "source*",
        "pii",
        "personal",
        "email*",
        "transcript*",
        "ticket*",
        "document*",
        "record*",
        "metadata",
        "log",
        "logs",
        "profile*",
        "file*",
        "message*",
    ),
}
# Only explicit statements that AI is absent short-circuit readiness. Decision-level
# negatives ("no automated decision", "AI never approves") are not an absence of AI.
_NO_AI_USAGE_TERMS = (
    "does not use ai",
    "do not use ai",
    "doesn t use ai",
    "don t use ai",
    "not using ai",
    "no ai usage",
    "no ai use",
    "no ai capabilit*",
    "no ai model*",
    "no ai system*",
    "no model capabilit*",
    "khong dung ai",
    "khong su dung ai",
)
_AUTHORITY_REPAIR_GUIDANCE = {
    "INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_DIRECT_OR_EXPLICIT_CONFIRMATION": {
        "instructionKey": _CONFIRMATION_PROVENANCE_INSTRUCTION_KEY,
        "instruction": (
            "CUSTOMER_CONFIRMED requires either a prior CONFIRM_ADJUST question "
            "where the customer selected CONFIRM, or a direct ASK answer that was "
            "not adjusted and needed no interpretation. A FREE_TEXT answer, a "
            "selected choice that requiresFreeText (e.g. OTHER), or any answer "
            "carrying a non-empty comment always needs interpretation and can "
            "never grant CUSTOMER_CONFIRMED on its own, no matter how explicit "
            "the customer's wording is. CLARIFY BOOLEAN or SINGLE_SELECT answers "
            "never grant CUSTOMER_CONFIRMED. If confirmation is still needed, ask "
            "a CONFIRM_ADJUST question with CONFIRM and ADJUST choices, ADJUST "
            "requiring free text, and proposedInterpretation set to the exact "
            "statement to confirm. Otherwise keep CUSTOMER_STATED."
        ),
    },
    "INTERVIEW_CONFIRMED_REQUIRES_DIRECT_ASK": {
        "instructionKey": _CONFIRMATION_PROVENANCE_INSTRUCTION_KEY,
        "instruction": (
            "CONFIRMED authority requires a direct ASK answer that was not "
            "adjusted and needed no interpretation. A FREE_TEXT answer, a "
            "selected choice that requiresFreeText (e.g. OTHER), or any answer "
            "carrying a non-empty comment always needs interpretation and cannot "
            "earn CONFIRMED directly; ask CONFIRM_ADJUST first. Do not use "
            "CONFIRMED for CLARIFY answers. If the prior answer was not a direct "
            "ASK, keep CUSTOMER_STATED or ask the customer a direct ASK question."
        ),
    },
    "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY": {
        "instructionKey": _CONFIRMATION_PROVENANCE_INSTRUCTION_KEY,
        "instruction": (
            "CONTEXT_READY requires CUSTOMER_CONFIRMED authority. If current "
            "provenance is only CUSTOMER_STATED, ask a bounded CONFIRM_ADJUST "
            "confirmation question or a direct ASK question instead of returning "
            "CONTEXT_READY."
        ),
    },
    "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_AUTHORITY": {
        "instructionKey": _CONFIRMATION_PROVENANCE_INSTRUCTION_KEY,
        "instruction": (
            "CONTEXT_RESOLVED requires authoritative customer-confirmed context "
            "for the targeted need. If the latest answer does not satisfy the "
            "authority provenance rule, ask CONFIRM_ADJUST or direct ASK rather "
            "than resolving."
        ),
    },
    "INTERVIEW_CONFIRMED_CONTEXT_INVALID": {
        "instructionKey": _CONFIRMATION_PROVENANCE_INSTRUCTION_KEY,
        "instruction": (
            "Authoritative context requires structured confirmedContext statements "
            "that reflect the latest valid customer-confirmed/direct answer. Do not "
            "invent statements; if confirmation is missing, ask CONFIRM_ADJUST or "
            "direct ASK and keep CUSTOMER_STATED."
        ),
    },
    "INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE": {
        "instructionKey": _MINIMUM_CONTEXT_INSTRUCTION_KEY,
        "instruction": (
            "CONTEXT_READY requires enough customer-confirmed planning context for "
            "the Planner. Resolve only the missing dimensions listed in "
            "missingDimensions. Do not ask rule-specific governance questions yet; "
            "ask one adaptive follow-up that can cover multiple missing dimensions "
            "when possible. UNKNOWN or UNAVAILABLE is acceptable only when the "
            "customer explicitly says it is unknown or unavailable."
        ),
    },
}
_INTERVIEW_HANDOFF_VALIDATION_REPAIRED = "INTERVIEW_HANDOFF_VALIDATION_REPAIRED"
# _bounded_cause (orchestration.result_validation) renders each pydantic error as
# "<loc>: Value error, <rule message>", joined with "; " for multiple errors. Extracting
# the rule text lets repair telemetry name exactly which of the many conditional
# InterviewResult/InterviewQuestionResult constraints a provider schema cannot express was
# actually violated, instead of only knowing that some validator failed.
_VIOLATED_RULE_PATTERN = re.compile(r"Value error, (.+)")


def _violated_rule_names(error: BaseException) -> str:
    names = [
        match.group(1).strip()
        for segment in str(error).split("; ")
        if (match := _VIOLATED_RULE_PATTERN.search(segment))
    ]
    return "; ".join(names) if names else "unknown"


def _decision_feedback(error_code: str, rejected_decision: dict[str, Any]) -> dict[str, Any]:
    feedback = {
        "code": error_code,
        "rejectedDecision": rejected_decision,
    }
    guidance = _AUTHORITY_REPAIR_GUIDANCE.get(error_code)
    if guidance is not None:
        feedback.update(guidance)
    return feedback


def _revision_requires_answer_interpretation(private_revision: dict[str, Any]) -> bool:
    # Keep this fallback in sync with apps/api assessment-interview-runtime.service.ts
    # ::revisionRequiresAnswerInterpretation. The persisted answerRequiresInterpretation
    # flag (set by the API at answer-recording time, including for choices that
    # requiresFreeText such as OTHER) is authoritative when present; the raw-field
    # fallback below only covers legacy/incomplete revisions that predate the flag.
    if private_revision.get("answerRequiresInterpretation") is True:
        return True
    answer = private_revision.get("answer")
    if not isinstance(answer, dict):
        answer = {}
    question_control = str(private_revision.get("questionControl") or "").upper()
    return (
        question_control == "FREE_TEXT"
        or bool(str(answer.get("freeText") or "").strip())
        or bool(str(answer.get("comment") or "").strip())
        or bool(str(answer.get("otherText") or "").strip())
    )


def _authority_provenance(private_revision: dict[str, Any] | None) -> dict[str, bool]:
    if not isinstance(private_revision, dict):
        return {"customer_confirmed": False, "confirmed": False}
    answer = private_revision.get("answer")
    if not isinstance(answer, dict):
        answer = {}
    question_control = str(private_revision.get("questionControl") or "").upper()
    question_intent = str(private_revision.get("questionIntent") or "").upper()
    confirmed = answer.get("confirmed") is True
    adjusted = answer.get("adjusted") is True

    # Keep this worker preflight in sync with apps/api
    # assessment-interview-runtime.service.ts::assertAuthorityProvenance. The API
    # remains the final guard; this mirror only prevents known impossible candidates
    # from consuming a guarded POST and gives the model one private correction.
    explicitly_confirmed = (
        question_control == "CONFIRM_ADJUST" and confirmed and not adjusted
    )
    direct_lossless_customer_statement = (
        question_intent == "ASK"
        and question_control != "CONFIRM_ADJUST"
        and not adjusted
        and not _revision_requires_answer_interpretation(private_revision)
    )
    return {
        "customer_confirmed": (
            explicitly_confirmed or direct_lossless_customer_statement
        ),
        "confirmed": direct_lossless_customer_statement,
    }


def _authority_error_code(decision: dict[str, Any], context: dict[str, Any]) -> str | None:
    authority = str(decision.get("contextAuthority") or "").upper()
    provenance = _authority_provenance(context.get("privateRevision"))
    if authority == "CUSTOMER_CONFIRMED" and not provenance["customer_confirmed"]:
        return "INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_DIRECT_OR_EXPLICIT_CONFIRMATION"
    if authority == "CONFIRMED" and not provenance["confirmed"]:
        return "INTERVIEW_CONFIRMED_REQUIRES_DIRECT_ASK"
    outcome = str(decision.get("outcome") or "").upper()
    if outcome == "CONTEXT_READY" and authority not in {
        "CUSTOMER_CONFIRMED",
        "CONFIRMED",
    }:
        return "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY"
    if outcome == "CONTEXT_RESOLVED" and authority not in {
        "CUSTOMER_CONFIRMED",
        "CONFIRMED",
    }:
        return "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_AUTHORITY"
    return None


def _missing_initial_planning_context_dimensions(
    decision: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> list[str]:
    # Targeted INVESTIGATOR_RESOLUTION turns resolve one rule-specific need; the
    # initial minimum planning context gate must never be re-applied to them. Mirror
    # the API's mode derivation: a registered targeted need makes the turn targeted.
    if str(decision.get("mode") or "").upper() == "INVESTIGATOR_RESOLUTION" or (
        isinstance(context, dict) and isinstance(context.get("targetedNeed"), dict)
    ):
        return []
    if str(decision.get("outcome") or "").upper() != "CONTEXT_READY":
        return []
    confirmed_context = decision.get("confirmedContext")
    if not isinstance(confirmed_context, dict):
        return list(_INITIAL_PLANNING_CONTEXT_DIMENSIONS)
    raw_statements = confirmed_context.get("statements")
    statements = (
        [item for item in raw_statements if isinstance(item, dict)]
        if isinstance(raw_statements, list)
        else []
    )
    if not statements:
        return list(_INITIAL_PLANNING_CONTEXT_DIMENSIONS)
    token_sets = [_planning_statement_tokens(statement) for statement in statements]
    if any(_matches_any_term(tokens, _NO_AI_USAGE_TERMS) for tokens in token_sets):
        return []
    return [
        dimension
        for dimension, terms in _INITIAL_PLANNING_CONTEXT_DIMENSIONS.items()
        if not any(_matches_any_term(tokens, terms) for tokens in token_sets)
    ]


def _planning_statement_tokens(statement: dict[str, Any]) -> list[str]:
    values = (
        statement.get("topic"),
        statement.get("statement"),
        statement.get("normalizedValue"),
        statement.get("scope"),
    )
    text = " ".join(
        value if isinstance(value, str) else json.dumps(value or {}, sort_keys=True)
        for value in values
    )
    return _planning_tokens(text)


def _planning_tokens(text: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", text.replace("đ", "d").replace("Đ", "D"))
    ascii_text = "".join(char for char in folded if not unicodedata.combining(char))
    return re.findall(r"[a-z0-9]+", ascii_text.lower())


def _matches_any_term(tokens: list[str], terms: tuple[str, ...]) -> bool:
    return any(_matches_term(tokens, term) for term in terms)


def _matches_term(tokens: list[str], term: str) -> bool:
    parts = term.split(" ")
    for start in range(len(tokens) - len(parts) + 1):
        if all(
            tokens[start + offset].startswith(part[:-1])
            if part.endswith("*")
            else tokens[start + offset] == part
            for offset, part in enumerate(parts)
        ):
            return True
    return False


def _apply_authority_preflight(
    decision: dict[str, Any],
    context: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    error_code = _authority_error_code(decision, context)
    if error_code is None:
        missing_dimensions = _missing_initial_planning_context_dimensions(decision, context)
        if missing_dimensions:
            feedback = _decision_feedback("INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE", decision)
            feedback["missingDimensions"] = missing_dimensions
            return decision, feedback
        return decision, None

    outcome = str(decision.get("outcome") or "").upper()
    if outcome in {"CONTEXT_READY", "CONTEXT_RESOLVED"}:
        return decision, _decision_feedback(error_code, decision)

    downgraded = dict(decision)
    downgraded["contextAuthority"] = "CUSTOMER_STATED"
    # This does not discard the customer's answer. The answer is already persisted
    # as API-owned privateRevision; the model-authored confirmedContext is only an
    # authority claim candidate and must not be carried when provenance is invalid.
    downgraded["confirmedContext"] = {}
    return downgraded, None


# A FREE_TEXT answer that volunteers several facts in one turn (e.g. "A recruiter
# approves every rejection. For senior positions, the hiring manager must also
# approve.") is now common after the FREE_TEXT/Other authority tightening, since a
# raw ASK answer can no longer become CUSTOMER_CONFIRMED directly. Bound the merge
# so a rejected multi-statement candidate still converges to one CONFIRM_ADJUST
# turn instead of exhausting the one private correction and failing closed.
_MAX_SYNTHESIZED_STATEMENTS = 5
_MAX_SYNTHESIZED_STATEMENT_LENGTH = 1000


def _confirmation_statement_text(decision: dict[str, Any]) -> str | None:
    confirmed_context = decision.get("confirmedContext")
    if not isinstance(confirmed_context, dict):
        return None
    statements = confirmed_context.get("statements")
    if (
        not isinstance(statements, list)
        or not statements
        or len(statements) > _MAX_SYNTHESIZED_STATEMENTS
    ):
        return None
    texts: list[str] = []
    for statement in statements:
        if not isinstance(statement, dict):
            return None
        text = str(statement.get("statement") or "").strip()
        if not text:
            # Fail closed on any ambiguous/empty statement rather than guess or
            # drop it silently.
            return None
        texts.append(text)
    # Single statement: keep the exact prior behavior (no added formatting).
    # Multiple: concatenate the model's own statement text verbatim, separated by
    # a neutral dash-bullet newline. Never add narration/connecting words — the
    # Customer-visible copy must stay exactly what the model itself asserted.
    merged = texts[0] if len(texts) == 1 else "\n".join(f"- {text}" for text in texts)
    if len(merged) > _MAX_SYNTHESIZED_STATEMENT_LENGTH:
        return None
    return merged


def _confirmation_question_id(statement: str) -> str:
    digest = hashlib.sha256(statement.encode("utf-8")).hexdigest()[:16]
    return f"q-confirm-adjust-{digest}"


def _synthesize_confirmation_question(
    decision: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any] | None:
    statement = _confirmation_statement_text(decision)
    if statement is None:
        return None
    question_id = _confirmation_question_id(statement)
    private_revision = context.get("privateRevision")
    if (
        isinstance(private_revision, dict)
        and str(private_revision.get("questionId") or "") == question_id
        and str(private_revision.get("questionControl") or "").upper() == "CONFIRM_ADJUST"
    ):
        answer = private_revision.get("answer")
        if isinstance(answer, dict) and answer.get("confirmed") is True:
            _LOGGER.error(
                "%s question_id=%s reason=confirmed_synthetic_question_rejected",
                _INTERVIEW_CONFIRMATION_SYNTHESIS_REJECTED,
                question_id,
            )
            raise RuntimeError(
                "synthetic CONFIRM_ADJUST confirmation was rejected after customer confirmation"
            )

    synthesized = {
        **decision,
        "outcome": "WAITING_FOR_CUSTOMER",
        "activeQuestion": {
            "id": question_id,
            "intent": "CLARIFY",
            "control": "CONFIRM_ADJUST",
            # Customer-visible copy must come from the rejected model candidate. Do
            # not prepend static worker text here; web renders the button labels via i18n.
            "prompt": statement,
            "choices": [
                {"id": "CONFIRM", "label": "CONFIRM", "requiresFreeText": False},
                {"id": "ADJUST", "label": "ADJUST", "requiresFreeText": True},
            ],
            "proposedInterpretation": statement,
            "frontier": {
                "owner": "CUSTOMER",
                "materiality": "MATERIAL",
                "description": statement,
                "evidenceRefs": [],
            },
        },
        "contextAuthority": "CUSTOMER_STATED",
        "confirmedContext": {},
    }
    validated = InterviewResult.model_validate(synthesized).model_dump(mode="json")
    statement_count = len(
        (decision.get("confirmedContext") or {}).get("statements") or []
    )
    _LOGGER.warning(
        "%s statement_count=%d question_id=%s",
        _INTERVIEW_CONFIRMATION_QUESTION_SYNTHESIZED,
        statement_count,
        question_id,
    )
    return validated


def _confirmation_or_original(decision: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    prepared, feedback = _apply_authority_preflight(decision, context)
    if feedback is None:
        return prepared
    synthesized = _synthesize_confirmation_question(prepared, context)
    return synthesized if synthesized is not None else prepared


INTERVIEW_RESUME_COMMAND = "command.assessment-interview.resume-agent.v1"
CURRENT_CONTEXT = "CURRENT"
DUPLICATE_CONTEXT = "DUPLICATE"
STALE_CONTEXT = "STALE"
STALE_PROVENANCE_CONTEXT = "STALE_PROVENANCE"
_TERMINAL_GUARDED_OUTCOMES = {"CONTEXT_READY", "CONTEXT_RESOLVED"}
_DOWNSTREAM_IMPACT_FLAG = "DOWNSTREAM_IMPACT"
_LEGAL_RULE_NOT_APPLICABLE_STATUS = RULE_APPLICABILITY_STATUSES["not_applicable"]

# Targeted Interview resolution criteria are authored as customer-facing snake_case
# keys, while LegalRule.requiredFacts fields remain catalog-owned facts. Keep this
# bridge explicit and narrow so administrative customer facts can exclude only the
# parent legal rule fact they were requested to resolve.
_TARGETED_RESOLUTION_FACT_FIELDS = {
    "national_data_source_reuse": (
        "nationalDataSourceReuse",
        "national_data_source_reuse",
    ),
}


class AssessmentInterviewResumeBoundary(AgentBoundaryBase):
    """Run Interview reasoning, persist its guard, then continue durably."""

    boundary_source = "assessment.interview-answer-submitted"
    source_event = INTERVIEW_RESUME_COMMAND
    requires_rbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        rbac_client=None,
        root_agent=None,
        api_client=None,
        dispatcher=None,
        downstream_handler=None,
        investigator_resumer: Callable[..., dict[str, Any]] | None = None,
        investigation_completer: Callable[..., None] | None = None,
        downstream_impact_handler: Callable[..., None] | None = None,
        continuation_store=None,
    ) -> None:
        super().__init__(config, rbac_client)
        self._root_agent = root_agent
        self._api_client = api_client
        self._dispatcher = dispatcher
        self._downstream_handler = downstream_handler
        self._investigator_resumer = investigator_resumer
        self._investigation_completer = investigation_completer
        self._downstream_impact_handler = downstream_impact_handler
        self._continuation_store = continuation_store or PostGuardContinuationStore.from_config(
            config
        )

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        assessment_id = _required_text(message, "assessmentId")
        thread_id = _required_text(message, "threadId")
        question_id = _required_text(message, "questionId")
        source_version = _required_text(message, "sourceVersion")
        pge_version = _required_text(message, "pgeVersion")
        context_revision = _required_int(message, "contextRevision")
        resume_reason = _required_text(message, "resumeReason")
        command_workflow_run_id = _required_text(message, "workflowRunId")
        api_client = self._api_client or self._load_api_client()

        context = api_client.get_interview_private_context(
            assessment_id,
            context_revision,
            source_version=source_version,
            pge_version=pge_version,
        )
        server_thread_id = _required_text(context, "threadId")
        if server_thread_id != thread_id:
            raise ValueError(
                "assessment Interview resume command threadId does not match "
                "the server-owned Interview thread"
            )
        status = str(context.get("status") or "")
        if status == STALE_PROVENANCE_CONTEXT:
            self._reenter_root_for_revalidation(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                correlationId=correlationId,
                root=self._root_agent or self._load_root_agent(),
            )
            return

        coverage_state = str(context.get("technicalCoverageState") or "UNAVAILABLE").upper()
        coverage_limitations = context.get("coverageLimitations")
        if coverage_state == "UNAVAILABLE" or (
            coverage_state == "PARTIAL"
            and (not isinstance(coverage_limitations, list) or not coverage_limitations)
        ):
            self._reenter_root_for_coverage_recovery(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                coverage_state=coverage_state,
                correlationId=correlationId,
                root=self._root_agent or self._load_root_agent(),
            )
            return

        server_workflow_run_id = _required_text(context, "workflowRunId")
        root_workflow_run_id = context.get("rootWorkflowRunId")
        if server_workflow_run_id != command_workflow_run_id and (
            not isinstance(root_workflow_run_id, str)
            or root_workflow_run_id != command_workflow_run_id
        ):
            _LOGGER.warning(
                "INTERVIEW_WORKFLOW_RUN_ID_MISMATCH",
                server_workflow_run_id=server_workflow_run_id,
                root_workflow_run_id=root_workflow_run_id,
                command_workflow_run_id=command_workflow_run_id,
                context_revision=context_revision,
                status=status,
                thread_id=thread_id,
                assessment_id=assessment_id,
            )
            raise ValueError(
                "assessment Interview resume command workflowRunId does not match "
                "the server-owned Interview workflow run"
            )

        # A guard-accepted broker delivery may be retried after the worker crashes.
        # DUPLICATE therefore means no new Interview model turn, not automatically no-op.
        # Terminal guarded state is resumed until the durable post-guard record is COMPLETED.
        if status == DUPLICATE_CONTEXT and _terminal_guarded_state(context):
            guarded_state = self._guarded_state_from_duplicate(
                assessment_id=assessment_id,
                context_revision=context_revision,
                source_version=str(context.get("sourceVersion") or source_version),
                pge_version=str(context.get("pgeVersion") or pge_version),
                context=context,
            )
            self._run_guarded_continuation(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                source_version=str(context.get("sourceVersion") or source_version),
                pge_version=str(context.get("pgeVersion") or pge_version),
                guarded_state=guarded_state,
                correlationId=correlationId,
                root_workflow_run_id=context.get("rootWorkflowRunId"),
            )
            return

        targeted_need = context.get("targetedNeed")
        targeted_mode = isinstance(targeted_need, dict)
        same_revision_resume = resume_reason == "PROVIDE_MORE_CONTEXT" or targeted_mode
        if not same_revision_resume:
            if status in {DUPLICATE_CONTEXT, STALE_CONTEXT}:
                return
            if status != CURRENT_CONTEXT:
                raise ValueError(f"unexpected Interview private context status: {status}")
        else:
            if status == STALE_CONTEXT:
                return
            if status not in {CURRENT_CONTEXT, DUPLICATE_CONTEXT}:
                raise ValueError(f"unexpected Interview private context status: {status}")
            if status == DUPLICATE_CONTEXT and _same_revision_resume_materialized(context):
                # The first same-revision targeted/follow-up delivery may author a question.
                # Once that question or a non-terminal final state is materialized, duplicate
                # delivery is a no-op before model invocation. Terminal guard retry was handled
                # above so it cannot be accidentally swallowed here.
                return

        from orchestration.interview_progress import active_progress, InterviewProgressCallback
        def emit(phase):
            reporter = getattr(api_client, "post_interview_progress", None)
            if reporter is not None:
                reporter(assessment_id, context_revision, phase)
        token = active_progress.set(InterviewProgressCallback(emit))
        emit("RUNNING")
        try:
            self._run_and_persist_decision(api_client, assessment_id, thread_id, question_id,
                context_revision, resume_reason, context, correlationId, source_version, pge_version)
        except Exception:
            emit("FAILED")
            raise
        finally:
            active_progress.reset(token)

    def _run_and_persist_decision(self, api_client, assessment_id, thread_id, question_id,
                                  context_revision, resume_reason, context, correlationId,
                                  source_version, pge_version):
        try:
            decision = self._run_interview(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                resume_reason=resume_reason,
                context=context,
                correlationId=correlationId,
            )
        except SpecialistHandoffValidationError as exc:
            # The specialist's candidate violated one of the conditional InterviewResult /
            # InterviewQuestionResult constraints a provider schema cannot express (e.g. a
            # malformed CONFIRM_ADJUST choice shape, a missing frontier). None of those
            # validators are relaxed; give the specialist one bounded chance to see the
            # exact rule it broke and self-correct instead of crashing the whole turn.
            rule_names = _violated_rule_names(exc)
            _LOGGER.warning(
                "%s assessment_id=%s question_id=%s context_revision=%s rule=%s",
                _INTERVIEW_HANDOFF_VALIDATION_REPAIRED,
                assessment_id,
                question_id,
                context_revision,
                rule_names,
            )
            repair_context = {
                **context,
                "decisionValidationFeedback": {
                    "code": "INTERVIEW_HANDOFF_SCHEMA_VIOLATION",
                    "rejectedReason": str(exc),
                },
            }
            # A second violation propagates to terminal delivery settlement.
            decision = self._run_interview(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                resume_reason=resume_reason,
                context=repair_context,
                correlationId=correlationId,
            )
        decision, authority_feedback = _apply_authority_preflight(decision, context)
        if authority_feedback is not None:
            _LOGGER.warning(
                "%s assessment_id=%s question_id=%s context_revision=%s "
                "instruction_key=%s",
                _INTERVIEW_AUTHORITY_PROVENANCE_REPAIRED,
                assessment_id,
                question_id,
                context_revision,
                authority_feedback.get("instructionKey"),
            )
            repair_context = {
                **context,
                "decisionValidationFeedback": authority_feedback,
            }
            decision = self._run_interview(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                resume_reason=resume_reason,
                context=repair_context,
                correlationId=correlationId,
            )
            decision = _confirmation_or_original(decision, context)

        try:
            guarded_state = api_client.post_interview_agent_decision(
                assessment_id, decision,
            )
        except InterviewDecisionRepairableCallbackError as exc:
            # A rejected candidate has not advanced the persisted revision. The API
            # guard remains authoritative; only codes in the explicit allowlist reach
            # this path, and the specialist gets exactly one private correction. Do
            # not log rejected text/meta here because some codes protect customer
            # surfaces from leaked internal language.
            decision_feedback = _decision_feedback(exc.error_code, decision)
            _LOGGER.warning(
                "%s assessment_id=%s question_id=%s context_revision=%s "
                "error_code=%s instruction_key=%s",
                _INTERVIEW_AGENT_DECISION_REJECTION_REPAIRED,
                assessment_id,
                question_id,
                context_revision,
                exc.error_code,
                decision_feedback.get("instructionKey"),
            )
            missing = getattr(exc, "missing", None)
            if isinstance(missing, str):
                decision_feedback["missingCriteria"] = missing
            missing_dimensions = (getattr(exc, "meta", None) or {}).get("missingDimensions")
            if isinstance(missing_dimensions, str) and missing_dimensions.strip():
                decision_feedback["missingDimensions"] = [
                    item.strip() for item in missing_dimensions.split(",") if item.strip()
                ]
            repair_context = {
                **context,
                "decisionValidationFeedback": decision_feedback,
            }
            corrected = self._run_interview(
                assessment_id=assessment_id,
                thread_id=thread_id,
                question_id=question_id,
                context_revision=context_revision,
                resume_reason=resume_reason,
                context=repair_context,
                correlationId=correlationId,
            )
            corrected = _confirmation_or_original(corrected, context)
            # A second rejection propagates to terminal delivery settlement.
            guarded_state = api_client.post_interview_agent_decision(
                assessment_id, corrected,
            )
        self._run_guarded_continuation(
            assessment_id=assessment_id,
            thread_id=thread_id,
            question_id=question_id,
            context_revision=context_revision,
            source_version=str(context.get("sourceVersion") or source_version),
            pge_version=str(context.get("pgeVersion") or pge_version),
            guarded_state=guarded_state,
            correlationId=correlationId,
            root_workflow_run_id=context.get("rootWorkflowRunId"),
        )

    def _run_interview(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        resume_reason: str,
        context: dict[str, Any],
        correlationId: str,
    ) -> dict[str, Any]:
        from uuid import UUID
        from orchestration.context import LCSPRunContext
        from subagents.interview.customer_safe_projection import (
            TurnEvidenceLedger,
            build_why_are_we_asking_explanation,
            evaluate_question_eligibility,
            extract_governed_evidence_refs,
            reset_active_turn_evidence_ledger,
            sanitize_customer_facing_text,
            set_active_turn_evidence_ledger,
            validate_evidence_refs,
        )

        private_revision = context.get("privateRevision")
        targeted_need = context.get("targetedNeed")
        actor_id = (
            str(context.get("authenticatedActorId") or "").strip()
            or str(context.get("actorId") or "").strip()
            or str(context.get("userId") or "").strip()
            or (str(private_revision.get("authenticatedActorId") or "").strip() if isinstance(private_revision, dict) else "")
            or (str(private_revision.get("actorId") or "").strip() if isinstance(private_revision, dict) else "")
            or (str(private_revision.get("userId") or "").strip() if isinstance(private_revision, dict) else "")
        )
        if not actor_id and isinstance(targeted_need, dict):
            actor_id = str(targeted_need.get("actorId") or "").strip()
        if not actor_id:
            raise ValueError(
                "Assessment Interview resume requires a trusted authenticated principal / actorId"
            )

        workflow_run_id = context.get("workflowRunId") or context.get("workflow_run_id")
        if not workflow_run_id and isinstance(context.get("targetedContinuation"), dict):
            workflow_run_id = context["targetedContinuation"].get("workflowRunId")
        if not workflow_run_id or not str(workflow_run_id).strip():
            raise ValueError(
                "Assessment Interview resume requires a valid workflowRunId from orchestration"
            )
        valid_wf_id = str(workflow_run_id).strip()
        if correlationId and valid_wf_id == correlationId:
            raise ValueError(
                "workflowRunId cannot be identical to correlationId"
            )

        source_version = str(context.get("sourceVersion") or "")
        pge_version = str(context.get("pgeVersion") or "")
        technical_evidence_report_id = (
            pge_version.split(":", 1)[0].strip() if pge_version else ""
        )
        repository_snapshot_id = (
            source_version.split(":", 1)[0].strip() if source_version else ""
        )

        invocation_key = (
            f"assessment-interview:{assessment_id}:{context_revision}:{resume_reason}"
        )
        if context.get("decisionValidationFeedback"):
            invocation_key += ":resolution-correction:1"

        run_context = LCSPRunContext(
            assessment_id=assessment_id,
            user_id=actor_id,
            workflow_run_id=valid_wf_id,
            artifact_versions={
                "technicalEvidenceReportId": technical_evidence_report_id,
                "repositorySnapshotId": repository_snapshot_id,
                "sourceVersion": source_version,
                "pgeVersion": pge_version,
                "guidanceVersion": str(context.get("guidanceVersion") or ""),
            },
            idempotency_key=invocation_key,
        )

        authorized_refs = {
            f"repositorySnapshot:{repository_snapshot_id}",
            f"technicalEvidenceReport:{technical_evidence_report_id}",
            "interviewRuntime:assessment-interview-runtime-v1",
        }
        authorized_refs.update(
            extract_governed_evidence_refs(private_revision, targeted_need, context)
        )

        cov_state = str(context.get("technicalCoverageState") or "READY")
        cov_limitations = list(context.get("coverageLimitations") or [])
        ledger = TurnEvidenceLedger(
            initial_authorized_refs=authorized_refs,
            initial_coverage_state=cov_state,
            initial_coverage_limitations=cov_limitations,
        )
        ledger_token = set_active_turn_evidence_ledger(ledger)
        try:
            dispatcher = self._dispatcher or self._load_dispatcher()
            instruction = _interview_instruction(
                assessment_id=assessment_id,
                question_id=question_id,
                context_revision=context_revision,
                resume_reason=resume_reason,
                context=context,
            )
            result = dispatcher.dispatch(
                subagent_type="interview",
                instruction=instruction,
                idempotency_key=invocation_key,
                trigger=resume_reason,
                metadata={
                    "assessment_id": assessment_id,
                    "question_id": question_id,
                    "context_revision": context_revision,
                    "guidance_version": context.get("guidanceVersion"),
                    "correlationId": correlationId,
                    "artifact_versions": run_context.artifact_versions,
                    "targeted_need": targeted_need if isinstance(targeted_need, dict) else None,
                },
                thread_id=thread_id,
                context=run_context,
                reenter_root=False,
            )
        finally:
            reset_active_turn_evidence_ledger(ledger_token)

        handoff = result.get("handoff") if isinstance(result, dict) else None
        if not isinstance(handoff, dict):
            raise ValueError("Interview specialist did not return a validated handoff")
        handoff["expectedContextRevision"] = context_revision
        targeted_need = context.get("targetedNeed")
        if isinstance(targeted_need, dict):
            if handoff.get("mode") != "INVESTIGATOR_RESOLUTION":
                raise ValueError(
                    "Targeted Interview specialist must return INVESTIGATOR_RESOLUTION mode"
                )
            question = handoff.get("activeQuestion")
            if isinstance(question, dict) and question.get("needId") not in {
                None,
                targeted_need.get("needId"),
            }:
                raise ValueError("Targeted Interview question escaped its registered need")

        # Validate candidate question and evidence refs emitted by the Interview specialist
        question = handoff.get("activeQuestion")
        outcome = handoff.get("outcome")
        if outcome == "WAITING_FOR_CUSTOMER":
            if not isinstance(question, dict):
                raise ValueError("Interview handoff with WAITING_FOR_CUSTOMER requires an activeQuestion")
            frontier = question.get("frontier")
            if not isinstance(frontier, dict):
                raise ValueError("Interview question candidate requires frontier metadata")
            eligible, reason = evaluate_question_eligibility(frontier, ledger)
            if not eligible:
                raise ValueError(f"Interview question candidate is not eligible: {reason}")
            frontier_refs = frontier.get("evidenceRefs") or []
            topic = str(frontier.get("description") or question.get("prompt") or "business clarification")
            obs = str(frontier.get("description") or "")
            question["whyAreWeAsking"] = build_why_are_we_asking_explanation(
                topic=topic,
                evidence_observation=obs,
                coverage_state=str(context.get("technicalCoverageState") or "READY"),
                coverage_limitations=list(context.get("coverageLimitations") or []),
                ledger=ledger,
                evidence_refs=frontier_refs,
            )

        confirmed_context = handoff.get("confirmedContext")
        if isinstance(confirmed_context, dict):
            confirmed_refs: list[str] = []
            statements = confirmed_context.get("statements")
            if isinstance(statements, list):
                for statement in statements:
                    if isinstance(statement, dict):
                        refs = statement.get("evidenceRefs") or statement.get("evidence_refs") or []
                        if isinstance(refs, list):
                            confirmed_refs.extend(str(ref) for ref in refs if str(ref).strip())
            validate_evidence_refs(confirmed_refs, ledger.authorized_refs)

        if isinstance(question, dict):
            if "prompt" in question and question["prompt"]:
                question["prompt"] = sanitize_customer_facing_text(str(question["prompt"]))
            if "whyAreWeAsking" in question and question["whyAreWeAsking"]:
                question["whyAreWeAsking"] = sanitize_customer_facing_text(
                    str(question["whyAreWeAsking"])
                )

            question_refs = (
                question.get("whyEvidenceRefs")
                or question.get("governedEvidenceRefs")
                or []
            )
            frontier = question.get("frontier")
            frontier_refs = frontier.get("evidenceRefs") or [] if isinstance(frontier, dict) else []
            validate_evidence_refs([*question_refs, *frontier_refs], ledger.authorized_refs)

        return handoff

    def _run_guarded_continuation(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        source_version: str,
        pge_version: str,
        guarded_state: dict[str, Any],
        correlationId: str,
        root_workflow_run_id: str | None = None,
    ) -> None:
        outcome = str(guarded_state.get("outcome") or "")
        if outcome not in _TERMINAL_GUARDED_OUTCOMES:
            return
        if root_workflow_run_id and isinstance(guarded_state.get("continuation"), dict):
            guarded_state = {
                **guarded_state,
                "continuation": {
                    **guarded_state["continuation"],
                    "rootWorkflowRunId": root_workflow_run_id,
                },
            }
        payload = _continuation_store_payload(guarded_state)
        record = self._continuation_store.begin(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
            payload=payload,
        )
        if record.completed:
            return
        effective_state = dict(guarded_state)
        if not isinstance(effective_state.get("continuation"), dict):
            stored_continuation = record.payload.get("continuation")
            if isinstance(stored_continuation, dict):
                effective_state["continuation"] = dict(stored_continuation)
        self._continue_after_guard(
            assessment_id=assessment_id,
            thread_id=thread_id,
            question_id=question_id,
            context_revision=context_revision,
            source_version=source_version,
            pge_version=pge_version,
            guarded_state=effective_state,
            correlationId=correlationId,
        )
        self._continuation_store.complete(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
        )

    def _guarded_state_from_duplicate(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        source_version: str,
        pge_version: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        public_state = context.get("publicState")
        if not isinstance(public_state, dict):
            raise RuntimeError("duplicate guarded continuation is missing worker state")
        guarded_state = dict(public_state)
        # Customer projections intentionally omit confirmed context. Recover it
        # from the authenticated worker response, never from the broker payload.
        if isinstance(context.get("confirmedContext"), dict):
            guarded_state["confirmedContext"] = context["confirmedContext"]
        outcome = str(guarded_state.get("outcome") or "")
        record = self._continuation_store.get(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
        )
        if record is not None and record.completed:
            return guarded_state
        if outcome == "CONTEXT_RESOLVED":
            continuation = record.payload.get("continuation") if record is not None else None
            if not isinstance(continuation, dict):
                targeted_need = context.get("targetedNeed")
                if not isinstance(targeted_need, dict):
                    raise RuntimeError(
                        "duplicate resolved continuation is missing targeted need provenance"
                    )
                from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
                    reconstruct_managed_investigator_continuation,
                )

                continuation = reconstruct_managed_investigator_continuation(
                    config=self._config,
                    assessment_id=assessment_id,
                    targeted_need=targeted_need,
                    source_version=source_version,
                    pge_version=pge_version,
                )
            guarded_state["continuation"] = continuation
        return guarded_state

    def _continue_after_guard(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        source_version: str,
        pge_version: str,
        guarded_state: dict[str, Any],
        correlationId: str,
    ) -> None:
        outcome = str(guarded_state.get("outcome") or "")
        if outcome not in _TERMINAL_GUARDED_OUTCOMES:
            return
        if self._downstream_handler is not None:
            self._downstream_handler(
                {
                    "assessmentId": assessment_id,
                    "threadId": thread_id,
                    "questionId": question_id,
                    "contextRevision": context_revision,
                    "sourceVersion": source_version,
                    "pgeVersion": pge_version,
                    "outcome": outcome,
                    "flags": list(guarded_state.get("flags") or []),
                },
                correlationId,
            )
            return
        if outcome == "CONTEXT_READY":
            evidence_report_id = pge_version.split(":", 1)[0].strip()
            if not evidence_report_id:
                raise ValueError(
                    "guarded CONTEXT_READY is missing technical evidence report provenance"
                )
            from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
                InterviewGatedEngineeringAssessmentBoundary,
            )

            InterviewGatedEngineeringAssessmentBoundary(
                self._config,
                api_client=self._api_client,
            ).handle(
                {
                    "assessmentId": assessment_id,
                    "evidenceReportId": evidence_report_id,
                    "workflowRunId": thread_id,
                },
                correlationId,
            )
            return

        continuation = guarded_state.get("continuation")
        if not isinstance(continuation, dict):
            raise ValueError(
                "guarded CONTEXT_RESOLVED is missing server-owned continuation"
            )
        _validate_guarded_continuation_pins(
            continuation,
            source_version=source_version,
            pge_version=pge_version,
        )
        confirmed_context = guarded_state.get("confirmedContext")
        if not isinstance(confirmed_context, dict):
            _LOGGER.warning(
                "GUARDED_STATE_MISSING_CONFIRMED_CONTEXT leniently treated as duplicate",
                extra={
                    "guarded_state_keys": list(guarded_state.keys()),
                    "status": guarded_state.get("status"),
                    "requested_revision": context_revision,
                    "thread_context": guarded_state.get("currentRevision"),
                    "has_confirmed_context": isinstance(
                        guarded_state.get("confirmedContext"), dict
                    ),
                    "public_state_outcome": (
                        guarded_state.get("publicState", {}) or {}
                    ).get("outcome"),
                    "source_version": source_version,
                    "pge_version": pge_version,
                },
            )
            return
        typed_confirmed_context = normalize_confirmed_structured_business_context(
            guarded_state,
            assessment_id=assessment_id,
        )
        if _has_downstream_impact(guarded_state):
            self._route_downstream_impact_to_orchestration(
                assessment_id=assessment_id,
                thread_id=thread_id,
                context_revision=context_revision,
                continuation=continuation,
                confirmed_context=typed_confirmed_context,
                correlationId=correlationId,
            )
            return

        self._resume_exact_investigator(
            assessment_id=assessment_id,
            context_revision=context_revision,
            continuation=continuation,
            confirmed_context=typed_confirmed_context,
            correlationId=correlationId,
        )

    def _route_downstream_impact_to_orchestration(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        context_revision: int,
        continuation: dict[str, Any],
        confirmed_context: ConfirmedStructuredBusinessContext,
        correlationId: str,
    ) -> None:
        if self._downstream_impact_handler is not None:
            self._downstream_impact_handler(
                assessment_id=assessment_id,
                thread_id=thread_id,
                context_revision=context_revision,
                continuation=continuation,
                confirmed_context=confirmed_context,
                correlation_id=correlationId,
            )
            return
        from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
            assert_managed_investigator_artifact_pins,
        )

        api_client = self._api_client or self._load_api_client()
        assert_managed_investigator_artifact_pins(api_client, continuation)
        affected_rule_ids = continuation.get("affectedRuleIds")
        artifact_versions = continuation.get("artifactVersions")
        if not isinstance(affected_rule_ids, list) or not affected_rule_ids:
            raise RuntimeError("downstream impact re-evaluation requires affectedRuleIds")
        if not isinstance(artifact_versions, dict) or not artifact_versions:
            raise RuntimeError("downstream impact re-evaluation requires artifact pins")
        root = self._root_agent or self._load_root_agent()
        invoke_with_stream(root,
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "A guarded Targeted Interview resolved the requested Customer context "
                            "and flagged DOWNSTREAM_IMPACT. Do not exact-resume the old Investigator. "
                            "Root Orchestration must choose the bounded selective rerun/rescope path "
                            "for the affected EngineeringRule scope while preserving the pinned legal, "
                            "technical-evidence, and repository artifacts below. Interview has only "
                            "raised the flag; this orchestration step owns the downstream decision.\n"
                            + json.dumps(
                                {
                                    "assessmentId": assessment_id,
                                    "contextRevision": context_revision,
                                    "affectedRuleIds": affected_rule_ids,
                                    "artifactVersions": artifact_versions,
                                    "confirmedContext": (
                                        confirmed_context.to_prompt_dict()
                                    ),
                                },
                                ensure_ascii=False,
                                sort_keys=True,
                            )
                        ),
                    }
                ]
            },
            config={
                "configurable": {
                    "thread_id": f"{thread_id}:downstream-impact:{context_revision}"
                },
                "metadata": {
                    "lcsp_thread_id": thread_id,
                    "assessment_id": assessment_id,
                    "context_revision": context_revision,
                    "affected_rule_ids": list(affected_rule_ids),
                    "artifact_versions": dict(artifact_versions),
                    "correlationId": correlationId,
                    "trigger": "INTERVIEW_DOWNSTREAM_IMPACT_REEVALUATION",
                },
            },
        )

    def _resume_exact_investigator(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        continuation: dict[str, Any],
        confirmed_context: ConfirmedStructuredBusinessContext,
        correlationId: str,
    ) -> None:
        api_client = self._api_client or self._load_api_client()
        scope_excluded_handoff = _deterministic_not_applicable_handoff(
            api_client=api_client,
            continuation=continuation,
            confirmed_context=confirmed_context,
        )
        if scope_excluded_handoff is not None:
            self._complete_exact_investigator_resume(
                api_client=api_client,
                assessment_id=assessment_id,
                context_revision=context_revision,
                continuation=continuation,
                confirmed_context=confirmed_context,
                handoff=scope_excluded_handoff,
                correlationId=correlationId,
            )
            return

        resumer = self._investigator_resumer
        if resumer is None:
            from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
                resume_managed_investigator,
            )

            resumer = resume_managed_investigator

        result = resumer(
            config=self._config,
            api_client=api_client,
            assessment_id=assessment_id,
            context_revision=context_revision,
            continuation=continuation,
            confirmed_context=confirmed_context,
            correlation_id=correlationId,
        )
        if not isinstance(result, dict):
            raise RuntimeError("exact Investigator resume returned an invalid result")
        if result.get("executionId") != continuation.get("investigatorExecutionId"):
            raise RuntimeError("exact Investigator resume execution identity drifted")
        if result.get("threadId") != continuation.get("workflowRunId"):
            raise RuntimeError("exact Investigator resume thread identity drifted")
        if result.get("fromCheckpointId") != continuation.get("checkpointId"):
            raise RuntimeError("exact Investigator resume checkpoint identity drifted")
        handoff = result.get("handoff")
        if not isinstance(handoff, dict):
            raise RuntimeError("exact Investigator resume did not return a typed handoff")
        if handoff.get("status") != "READY":
            raise RuntimeError(
                "exact Investigator resume must complete the original bounded investigation"
            )

        self._complete_exact_investigator_resume(
            api_client=api_client,
            assessment_id=assessment_id,
            context_revision=context_revision,
            continuation=continuation,
            confirmed_context=confirmed_context,
            handoff=handoff,
            correlationId=correlationId,
        )

    def _complete_exact_investigator_resume(
        self,
        *,
        api_client: Any,
        assessment_id: str,
        context_revision: int,
        continuation: dict[str, Any],
        confirmed_context: ConfirmedStructuredBusinessContext,
        handoff: dict[str, Any],
        correlationId: str,
    ) -> None:
        completer = self._investigation_completer
        if completer is None:
            from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
                complete_resumed_investigation,
            )

            completer = complete_resumed_investigation
        completer(
            config=self._config,
            api_client=api_client,
            assessment_id=assessment_id,
            context_revision=context_revision,
            continuation=continuation,
            confirmed_context=confirmed_context,
            resumed_handoff=handoff,
            correlation_id=correlationId,
        )

    def _reenter_root_for_revalidation(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        correlationId: str,
        root: Any,
    ) -> None:
        invoke_with_stream(root,
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Persisted Customer Interview context was stale against current "
                            "source/PGE provenance. Revalidate via Root Orchestration before "
                            "any Interview Agent sufficiency or downstream resume. "
                            f"Assessment: {assessment_id}. Thread: {thread_id}. "
                            f"Question: {question_id}. Requested revision: {context_revision}."
                        ),
                    }
                ]
            },
            config={
                "configurable": {"thread_id": thread_id},
                "metadata": {
                    "lcsp_thread_id": thread_id,
                    "assessment_id": assessment_id,
                    "question_id": question_id,
                    "context_revision": context_revision,
                    "correlationId": correlationId,
                    "trigger": "ASSESSMENT_INTERVIEW_REVALIDATION_REQUIRED",
                },
            },
        )

    def _reenter_root_for_coverage_recovery(
        self,
        *,
        assessment_id: str,
        thread_id: str,
        question_id: str,
        context_revision: int,
        coverage_state: str,
        correlationId: str,
        root: Any,
    ) -> None:
        invoke_with_stream(root,
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Technical coverage cannot enter Interview reasoning. "
                            "Run Root Orchestration recovery or revalidation before any "
                            "Interview Agent turn or downstream continuation. "
                            f"Assessment: {assessment_id}. Coverage state: {coverage_state}."
                        ),
                    }
                ]
            },
            config={
                "configurable": {"thread_id": thread_id},
                "metadata": {
                    "lcsp_thread_id": thread_id,
                    "assessment_id": assessment_id,
                    "question_id": question_id,
                    "context_revision": context_revision,
                    "correlationId": correlationId,
                    "trigger": "ASSESSMENT_INTERVIEW_COVERAGE_RECOVERY_REQUIRED",
                },
            },
        )

    def _load_api_client(self):
        from tools.common.capabilities.platform.api_client import WorkerApiClient
        from tools.common.capabilities.platform.config import load_config

        config = load_config()
        return WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)

    @staticmethod
    def _load_dispatcher():
        from orchestration.dispatcher import RootSubagentDispatcher

        return RootSubagentDispatcher()

    @staticmethod
    def _load_root_agent():
        from agent import agent

        return agent



def _deterministic_not_applicable_handoff(
    *,
    api_client: Any,
    continuation: dict[str, Any],
    confirmed_context: ConfirmedStructuredBusinessContext,
) -> dict[str, Any] | None:
    rules = _active_legal_rules(api_client)
    if not rules:
        return None
    affected_rule_ids = [
        str(value)
        for value in continuation.get("affectedRuleIds") or []
        if str(value or "").strip()
    ]
    for affected_rule_id in affected_rule_ids:
        legal_rule = _parent_legal_rule_for_engineering_rule(rules, affected_rule_id)
        if legal_rule is None:
            continue
        profile = _profile_with_confirmed_context_facts(
            _base_verified_profile(legal_rule),
            legal_rule=legal_rule,
            confirmed_context=confirmed_context,
        )
        outcome = RuleApplicabilityEvaluator().evaluate_rule(
            rule=legal_rule,
            verified_profile=profile,
        )
        if outcome.status != _LEGAL_RULE_NOT_APPLICABLE_STATUS:
            continue
        statement_refs = tuple(
            ref for refs in profile.get("factEvidenceRefs", {}).values() for ref in refs
        )
        if not statement_refs:
            continue
        return {
            "status": "READY",
            "artifact_versions": dict(continuation.get("artifactVersions") or {}),
            "claims": [
                {
                    "claim_id": f"claim:targeted-scope-excluded:{affected_rule_id}",
                    "engineering_rule_id": affected_rule_id,
                    "claim_type": ENGINEERING_EVIDENCE_CLAIM_TYPES[
                        "rule_scope_not_applicable"
                    ],
                    "value": None,
                    "evidence_refs": [],
                    "graph_path_refs": [],
                    "source_anchor_refs": [],
                    "customer_context_refs": list(dict.fromkeys(statement_refs)),
                    "confidence": outcome.confidence,
                    "limitations": [],
                    "criterion": ENGINEERING_RULE_PLAN_REASON_CODES[
                        "targeted_scope_excluded"
                    ],
                }
            ],
            "limitations": [],
            "missing_input": None,
            "next_step": "GATE",
        }
    return None


def _active_legal_rules(api_client: Any) -> list[dict[str, Any]]:
    try:
        catalog = api_client.get_active_legal_rule_catalog()
    except Exception:
        return []
    if not isinstance(catalog, dict):
        return []
    return [rule for rule in catalog.get("rules") or [] if isinstance(rule, dict)]


def _parent_legal_rule_for_engineering_rule(
    rules: list[dict[str, Any]],
    engineering_rule_id: str,
) -> dict[str, Any] | None:
    for rule in rules:
        legal_rule_id = str(rule.get("legalRuleId") or rule.get("legal_rule_id") or "")
        if engineering_rule_id.startswith(f"{legal_rule_id}::PRECOMPILED::"):
            return rule
        if engineering_rule_id in _legal_rule_engineering_rule_ids(rule):
            return rule
    return None


def _legal_rule_engineering_rule_ids(rule: dict[str, Any]) -> set[str]:
    values: set[str] = set()
    for key in ("engineeringRuleIds", "engineering_rule_ids"):
        raw = rule.get(key)
        if isinstance(raw, list):
            values.update(str(item) for item in raw if str(item or "").strip())
    raw_rules = rule.get("engineeringRules") or rule.get("engineering_rules")
    if isinstance(raw_rules, list):
        for item in raw_rules:
            if isinstance(item, dict):
                value = item.get("engineeringRuleId") or item.get("engineering_rule_id")
                if str(value or "").strip():
                    values.add(str(value))
    return values


def _base_verified_profile(rule: dict[str, Any]) -> dict[str, Any]:
    raw = rule.get("verifiedProfile") or rule.get("verified_profile") or {}
    if not isinstance(raw, dict):
        raw = {}
    merged = raw.get("mergedProfile") or raw.get("merged_profile") or {}
    refs = raw.get("factEvidenceRefs") or raw.get("fact_evidence_refs") or {}
    return {
        "mergedProfile": dict(merged) if isinstance(merged, dict) else {},
        "factEvidenceRefs": dict(refs) if isinstance(refs, dict) else {},
    }


def _profile_with_confirmed_context_facts(
    profile: dict[str, Any],
    *,
    legal_rule: dict[str, Any],
    confirmed_context: ConfirmedStructuredBusinessContext,
) -> dict[str, Any]:
    merged = dict(profile.get("mergedProfile") or {})
    fact_refs = dict(profile.get("factEvidenceRefs") or {})
    required_fields = {
        str(fact.get("field"))
        for fact in legal_rule.get("requiredFacts") or []
        if isinstance(fact, dict) and str(fact.get("field") or "").strip()
    }
    for statement in confirmed_context.statements:
        candidate_fields = _TARGETED_RESOLUTION_FACT_FIELDS.get(statement.topic, ())
        target_field = next(
            (field for field in candidate_fields if field in required_fields),
            None,
        )
        if target_field is None:
            continue
        merged[target_field] = statement.normalized_value
        fact_refs[target_field] = [statement.statement_id]
    return {"mergedProfile": merged, "factEvidenceRefs": fact_refs}

def _terminal_guarded_state(context: dict[str, Any]) -> bool:
    state = context.get("publicState")
    return isinstance(state, dict) and str(state.get("outcome") or "") in _TERMINAL_GUARDED_OUTCOMES


def _same_revision_resume_materialized(context: dict[str, Any]) -> bool:
    state = context.get("publicState")
    if not isinstance(state, dict):
        return False
    if isinstance(state.get("activeQuestion"), dict):
        return True
    outcome = str(state.get("outcome") or "")
    if outcome in {"CONTEXT_READY", "CONTEXT_RESOLVED", "FAILED"}:
        return True
    return state.get("orchestrationRequested") is False


def _has_downstream_impact(state: dict[str, Any]) -> bool:
    flags = state.get("flags")
    return isinstance(flags, list) and _DOWNSTREAM_IMPACT_FLAG in flags


def _validate_guarded_continuation_pins(
    continuation: dict[str, Any],
    *,
    source_version: str,
    pge_version: str,
) -> None:
    if str(continuation.get("sourceVersion") or "") != source_version:
        raise RuntimeError("guarded continuation source version is stale")
    if str(continuation.get("pgeVersion") or "") != pge_version:
        raise RuntimeError("guarded continuation PGE version is stale")
    if not str(continuation.get("originatingInvestigationReference") or "").strip():
        raise RuntimeError("guarded continuation is missing origin")
    affected_rule_ids = continuation.get("affectedRuleIds")
    if not isinstance(affected_rule_ids, list) or not affected_rule_ids:
        raise RuntimeError("guarded continuation is missing affectedRuleIds")
    artifact_versions = continuation.get("artifactVersions")
    if not isinstance(artifact_versions, dict) or not artifact_versions:
        raise RuntimeError("guarded continuation is missing artifactVersions")


def _continuation_store_payload(state: dict[str, Any]) -> dict[str, Any]:
    continuation = state.get("continuation")
    if isinstance(continuation, dict):
        return {"continuation": dict(continuation)}
    return {}


def _interview_instruction(
    *,
    assessment_id: str,
    question_id: str,
    context_revision: int,
    resume_reason: str,
    context: dict[str, Any],
) -> str:
    private_revision = context.get("privateRevision")
    public_state = context.get("publicState")
    targeted_need = context.get("targetedNeed")
    # The complete authorization inventory belongs to the turn ledger, not the
    # model prompt. It can contain millions of characters for a large repository.
    if isinstance(private_revision, dict):
        refs = private_revision.get("governedEvidenceRefs")
        private_revision = {
            key: value for key, value in private_revision.items()
            if key != "governedEvidenceRefs"
        }
        private_revision["governedEvidenceRefCount"] = len(refs) if isinstance(refs, list) else 0
    mode = (
        "INVESTIGATOR_RESOLUTION"
        if isinstance(targeted_need, dict)
        else "INITIAL_INTERVIEW"
    )
    bounded_payload = {
        "hostPlatform": "LCSP",
        "subjectSystemIdentity": f"repositorySnapshot:{str(context.get('sourceVersion') or '').split(':', 1)[0]}",
        "assessmentId": assessment_id,
        "mode": mode,
        "questionId": question_id,
        "contextRevision": context_revision,
        "resumeReason": resume_reason,
        "sourceVersion": context.get("sourceVersion"),
        "pgeVersion": context.get("pgeVersion"),
        "technicalCoverageState": context.get("technicalCoverageState"),
        "coverageLimitations": list(context.get("coverageLimitations") or []),
        "guidanceVersion": context.get("guidanceVersion"),
        "workingStrategy": context.get(
            "workingStrategy",
            {
                "terminologyMap": {},
                "avoidReaskingTopics": [],
                "effectiveQuestionPatterns": [],
                "observedAmbiguities": [],
                "interactionNotes": [],
            },
        ),
        "publicThreadState": public_state,
        "privateCustomerRevision": private_revision,
        # Worker-only, bounded/truncated verbatim history of prior turns' answers
        # (never in publicThreadState, which stays the sanitized customer
        # projection). See assessment-interview-runtime.service.ts
        # ::buildWorkerPriorAnswerHistory for the exact entry-count/text-length
        # limits and truncation marker.
        "priorAnswerHistory": context.get("priorAnswerHistory") or [],
        "priorAnswerHistoryOmittedCount": context.get("priorAnswerHistoryOmittedCount") or 0,
        "targetedNeed": targeted_need,
    }
    if context.get("decisionValidationFeedback"):
        bounded_payload["decisionValidationFeedback"] = context["decisionValidationFeedback"]
    return (
        "Evaluate exactly one governed Assessment Interview turn. The JSON below is a "
        "private worker-only input and must not be copied into Customer-safe evidence or "
        "downstream prompts. Preserve hedging/contradictions, choose ASK vs CLARIFY, and "
        "use the session-local workingStrategy only to adapt terminology and phrasing; "
        "never treat it as authoritative context or change guidanceVersion. "
        "priorAnswerHistory carries the Customer's own verbatim wording from earlier "
        "turns in this thread (bounded to the most recent entries, each comment/free "
        "text truncated at a fixed length with a marker) - use it to recall exactly "
        "what the Customer said before, especially for a FREE_TEXT/Other/commented "
        "answer that publicThreadState.answerHistory only summarizes generically. "
        "priorAnswerHistoryOmittedCount, if non-zero, means older entries beyond that "
        "bound were dropped; do not assume no earlier answer exists just because it is "
        "not listed. "
        "return only the typed InterviewResult candidate. HTTP persistence is not proof "
        "of sufficiency. PROVIDE_MORE_CONTEXT means author the next bounded question from "
        "the existing thread; do not restart a targeted Interview. "
        "Never return outcome=CONTEXT_READY while publicThreadState.contextAuthority is "
        "CUSTOMER_STATED; the platform requires CUSTOMER_CONFIRMED authority for "
        "CONTEXT_READY and rejects an unauthoritative CONTEXT_READY with no automatic "
        "recovery beyond one bounded correction. Provenance rule: CUSTOMER_CONFIRMED "
        "requires either a prior CONFIRM_ADJUST question where the customer selected "
        "CONFIRM, or a direct ASK answer that was not adjusted and needed no "
        "interpretation. A FREE_TEXT answer, a selected choice that requiresFreeText "
        "(e.g. OTHER), or any answer carrying a non-empty comment always needs "
        "interpretation: it stays CUSTOMER_STATED until the customer confirms it "
        "through a CONFIRM_ADJUST turn, no matter how explicit or unambiguous the "
        "wording looks. CLARIFY BOOLEAN or SINGLE_SELECT answers never grant "
        "CUSTOMER_CONFIRMED. If confirmation is "
        "needed, ask WAITING_FOR_CUSTOMER with control=CONFIRM_ADJUST, intent=CLARIFY, "
        "choices exactly CONFIRM and ADJUST, ADJUST.requiresFreeText=true, and "
        "proposedInterpretation set to the exact statement to confirm; otherwise keep "
        "CUSTOMER_STATED. "
        "If decisionValidationFeedback is present, the prior candidate was rejected by the "
        "platform guard; re-evaluate rather than resubmit it unchanged. When its code is "
        "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED, the candidate did not resolve the "
        "targeted need: re-evaluate against the private customer revision and use the exact "
        "resolutionCriteria text as statement.topic. When its code is "
        "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY, the candidate asserted CONTEXT_READY "
        "without CUSTOMER_CONFIRMED authority: return WAITING_FOR_CUSTOMER with a bounded "
        "confirming question instead. When its code is INTERVIEW_HANDOFF_SCHEMA_VIOLATION, "
        "rejectedReason names the exact structural rule the prior candidate broke (for "
        "example a malformed CONFIRM_ADJUST choice shape or an invalid outcome/mode "
        "combination): fix only that violation, changing nothing else about the candidate. "
        "Do not invent confirmation or treat validation feedback as customer evidence. "
        "If evidence is missing, return WAITING_FOR_CUSTOMER with a bounded clarification, "
        "or BLOCKED_OR_UNRESOLVED when the customer cannot supply it. Because provider "
        "schemas cannot enforce conditional fields, every WAITING_FOR_CUSTOMER "
        "activeQuestion MUST include frontier with owner=CUSTOMER, "
        "materiality=MATERIAL, a non-empty description, and evidenceRefs containing "
        "only governed evidence refs supplied in the private input; use [] when no "
        "authorized governed refs support the customer question. confirmedContext "
        "statement evidenceRefs may contain only authorized governed evidence refs; "
        "never use sourceVersion, pgeVersion, raw artifact ids, or version strings as "
        "statement evidenceRefs, and leave evidenceRefs empty when uncertain. Keep validation "
        "feedback private; never copy it into customer-facing text or downstream context.\n\n"
        + json.dumps(bounded_payload, ensure_ascii=False, sort_keys=True)
    )


def _required_text(message: dict[str, Any], field: str) -> str:
    value = str(message.get(field) or "").strip()
    if not value:
        raise ValueError(f"assessment Interview resume command requires {field}")
    return value


def _required_int(message: dict[str, Any], field: str) -> int:
    value = message.get(field)
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"assessment Interview resume command requires numeric {field}")
    return value
