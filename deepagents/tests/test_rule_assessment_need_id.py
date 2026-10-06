"""Targeted-need ids must satisfy the API contract /^need:[A-Za-z0-9_.:-]{1,300}$/.

Regression: rule criterion ids are authored free text (they contain spaces), so
need ids built from them were rejected by the API (INTERVIEW_TARGETED_NEED_INVALID).
The worker swallowed each rejection, no question was ever registered, and the rule
stage "completed" with every business-context rule still waiting.
"""

import re
from types import SimpleNamespace
from unittest.mock import Mock

from tools.common.capabilities.assessment.rule_assessment.need_id import canonical_need_id
from tools.common.capabilities.assessment.rule_assessment.run import register_business_needs
from tools.common.capabilities.assessment.rule_assessment.validation import _accept_need

API_NEED_ID = re.compile(r"^need:[A-Za-z0-9_.:-]{1,300}$")

RULE_ID = "AUTO-VN-LEGAL-2026-08-134-2025-QH15::art-10::cl-1::ENG::2"
# Verbatim shape stored in EngineeringRuleAssessment for a real stuck assessment.
LEGACY_ID = (
    f"need:{RULE_ID}:Persisted classification dossier associated with a medium "
    "or high risk AI system:6656590a1b2c"
)


def test_valid_need_id_is_left_untouched():
    valid = "need:r1:c1:abc123"
    assert canonical_need_id(valid) == valid


def test_spaced_need_id_becomes_api_valid_deterministic_and_unique():
    result = canonical_need_id(LEGACY_ID)

    assert API_NEED_ID.fullmatch(result)
    assert result == canonical_need_id(LEGACY_ID)  # stable across runs (idempotent registration)
    assert result.startswith("need:AUTO-VN-LEGAL-2026-08-134-2025-QH15::art-10")
    assert canonical_need_id(LEGACY_ID + " x") != result


def test_overlong_need_id_stays_within_api_limit():
    result = canonical_need_id("need:" + "a b " * 200)

    assert API_NEED_ID.fullmatch(result)


def test_accepted_need_with_free_text_criterion_id_is_api_valid():
    criterion = "Persisted classification dossier associated with a medium or high risk AI system"
    body, errors = _accept_need(
        {"question": "Is a classification dossier kept for this system?", "observation": "No dossier was observed."},
        "criterion[0]",
        criterion,
        (criterion,),
        RULE_ID,
    )

    assert errors == []
    assert API_NEED_ID.fullmatch(body["needId"])


def test_registration_posts_api_valid_id_for_legacy_stored_need():
    api = Mock()
    api.post_interview_targeted_need.return_value = {"registered": True}
    criterion_id = "Persisted classification dossier associated with a medium or high risk AI system"
    assessment = {
        "contextRevision": 6,
        "criteria": [
            {
                "criterionId": criterion_id,
                "status": "BUSINESS_CONTEXT_REQUIRED",
                "evidenceRefs": [],
                "businessContextNeed": {
                    "needId": LEGACY_ID,  # stored before the fix
                    "question": "Is a classification dossier kept for this system?",
                    "observation": "No dossier was observed.",
                    "resolutionCriterionIds": [criterion_id],
                },
            }
        ],
    }
    context = SimpleNamespace(
        assessment_id="assessment-1",
        workflow_run_id="run-1",
        artifact_versions={},
        scan_job_id="scan-1",
    )

    registered = register_business_needs(
        rule=SimpleNamespace(engineering_rule_id=RULE_ID),
        assessment=assessment,
        context=context,
        api=api,
        user_id="user-1",
    )

    payload = api.post_interview_targeted_need.call_args.args[1]
    assert API_NEED_ID.fullmatch(payload["needId"])
    assert registered == [payload["needId"]]


def _need_criterion(criterion_id, question, resolves):
    return {
        "criterionId": criterion_id,
        "status": "BUSINESS_CONTEXT_REQUIRED",
        "evidenceRefs": [],
        "businessContextNeed": {
            "needId": f"need:{RULE_ID}:{criterion_id}:abc",
            "question": question,
            "observation": "The repository does not show how incidents are reported.",
            "resolutionCriterionIds": resolves,
        },
    }


def _register(criteria, api):
    return register_business_needs(
        rule=SimpleNamespace(engineering_rule_id=RULE_ID),
        assessment={"contextRevision": 6, "criteria": criteria},
        context=SimpleNamespace(
            assessment_id="assessment-1", workflow_run_id="run-1", artifact_versions={}, scan_job_id="scan-1"
        ),
        api=api,
        user_id="user-1",
    )


def test_identical_needs_across_criteria_are_asked_once():
    # Two criteria of one rule hinge on the same Customer-owned distinction, so the
    # analyst attaches the same question to both and lists both as resolved by it.
    api = Mock()
    api.post_interview_targeted_need.return_value = {"registered": True}
    question = "How are serious incidents involving your chat assistant reported to authorities?"
    criteria = [
        _need_criterion("crit-suspend", question, ["crit-suspend", "crit-notify"]),
        _need_criterion("crit-notify", question, ["crit-suspend", "crit-notify"]),
    ]

    registered = _register(criteria, api)

    assert api.post_interview_targeted_need.call_count == 1
    payload = api.post_interview_targeted_need.call_args.args[1]
    assert payload["resolutionCriterionIds"] == ["crit-suspend", "crit-notify"]
    assert len(registered) == 1


def test_distinct_needs_are_still_registered_separately():
    api = Mock()
    api.post_interview_targeted_need.return_value = {"registered": True}
    criteria = [
        _need_criterion("crit-a", "Who approves a suspension of the assistant?", ["crit-a"]),
        _need_criterion("crit-b", "Where are incident reports sent?", ["crit-b"]),
    ]

    registered = _register(criteria, api)

    assert api.post_interview_targeted_need.call_count == 2
    assert len(registered) == 2


def test_analyst_prompt_requires_grounded_questions_and_merging():
    from subagents.repository_analyst.definition import SYSTEM_PROMPT

    prompt = " ".join(SYSTEM_PROMPT.split())  # the prompt wraps lines mid-sentence
    # Scope boundary: the repository is the analyst's job, the Interview only gets
    # Customer-owned business context the code cannot settle.
    assert "Ask only about facts outside the repository" in prompt
    assert "Never ask how the software behaves" in prompt
    assert "TECHNICAL_UNRESOLVED or NOT_OBSERVED" in prompt
    assert "confirmedCustomerContext" in prompt
    assert "does not apply to our deployment" in prompt
    assert "identical question and observation" in prompt
