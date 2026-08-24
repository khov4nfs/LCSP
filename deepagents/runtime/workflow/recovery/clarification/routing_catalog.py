"""Canonical routing targets: the only locations a free-form question may land on.

Field names mirror the Wizard clarification fields declared in
``packages/contracts/src/wizard/clarification.ts`` and the wizard answer shape.
Descriptors/keywords feed both the embedding router and the deterministic
keyword fallback, in Vietnamese and English because assessments run in either.
"""
from __future__ import annotations

from tools.clarification.investigation.clarification.models import (
    CLARIFICATION_TARGET_KINDS,
    ClarificationRoutingTarget,
)

ROUTING_TARGETS: tuple[ClarificationRoutingTarget, ...] = (
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="businessProcess",
        display_name="Business process",
        descriptor=(
            "What business process or workflow the assessed system supports, "
            "described in plain business language."
        ),
        keywords=(
            "business process",
            "quy trinh",
            "quy trình",
            "nghiệp vụ",
            "nghiep vu",
            "workflow",
            "process",
            "hoạt động",
            "hoat dong",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="useCase",
        display_name="Use case",
        descriptor=(
            "The concrete use case or scenario the AI system is used for."
        ),
        keywords=(
            "use case",
            "use-case",
            "usecase",
            "trường hợp sử dụng",
            "truong hop su dung",
            "kịch bản",
            "kich ban",
            "scenario",
            "tình huống",
            "tinh huong",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="primaryActors",
        display_name="Primary actors",
        descriptor=(
            "Who or what primarily interacts with and operates the system, "
            "including human roles and other systems."
        ),
        keywords=(
            "actor",
            "người dùng",
            "nguoi dung",
            "user",
            "role",
            "vai trò",
            "vai tro",
            "ai uses",
            "ai interacts",
            "operator",
            "người vận hành",
            "nguoi van hanh",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="businessTrigger",
        display_name="Business trigger",
        descriptor=(
            "What event or action starts the process or AI feature in the "
            "business workflow."
        ),
        keywords=(
            "trigger",
            "kích hoạt",
            "kich hoat",
            "when does",
            "khi nào",
            "khi nao",
            "what starts",
            "what initiates",
            "business event",
            "sự kiện",
            "su kien",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="expectedOutcome",
        display_name="Expected outcome",
        descriptor=(
            "The business outcome or decision the system is expected to produce."
        ),
        keywords=(
            "outcome",
            "result",
            "kết quả",
            "ket qua",
            "output",
            "decision",
            "quyết định",
            "quyet dinh",
            "deliverable",
            "mục tiêu",
            "muc tieu",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="autonomyLevel",
        display_name="Autonomy level",
        descriptor=(
            "How autonomous the AI system is: human-in-the-loop, advisory only, "
            "or fully autonomous decisions."
        ),
        keywords=(
            "autonomy",
            "autonomous",
            "tự chủ",
            "tu chu",
            "human in the loop",
            "human-in-the-loop",
            "human review",
            "supervision",
            "giám sát",
            "giam sat",
            "người phê duyệt",
            "nguoi phe duyet",
            "approval",
            "tự động",
            "tu dong",
        ),
        answer_control="select",
        option_set="autonomyLevel",
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="aiPurpose",
        display_name="AI purpose",
        descriptor=(
            "Why AI is used at all: what capability the model provides in this "
            "product."
        ),
        keywords=(
            "ai purpose",
            "why ai",
            "mục đích ai",
            "muc dich ai",
            "ai capability",
            "model purpose",
            "why use ai",
            "tại sao dùng ai",
            "tai sao dung ai",
            "genai",
            "llm",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["wizard_field"],
        field_name="sector",
        display_name="Sector",
        descriptor=(
            "The industry or public sector the deploying organization operates in."
        ),
        keywords=(
            "sector",
            "industry",
            "lĩnh vực",
            "linh vuc",
            "ngành",
            "nganh",
            "banking",
            "healthcare",
            "education",
            "public sector",
            "finance",
        ),
        answer_control="select",
        option_set="sector",
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["post_graph_context"],
        field_name="postGraphContext",
        display_name="Missing graph context",
        descriptor=(
            "Business context that the program evidence graph could not derive "
            "from source code and needs the product owner to explain."
        ),
        keywords=(
            "graph",
            "program graph",
            "missing context",
            "thiếu thông tin",
            "thieu thong tin",
            "not found in code",
            "không thấy trong mã",
            "khong thay trong ma",
            "undetected",
            "not derived",
            "evidence gap",
            "khoảng trống",
            "khoang trong",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["post_graph_context"],
        field_name="postGraphRuleScope",
        display_name="Missing rule scope",
        descriptor=(
            "Which legal or engineering rule scope applies to the system when "
            "declarations and source signals disagree."
        ),
        keywords=(
            "rule scope",
            "legal scope",
            "phạm vi áp dụng",
            "pham vi ap dung",
            "which rules",
            "rule applicability",
            "điều khoản",
            "dieu khoan",
            "regulation scope",
            "pháp lý",
            "phap ly",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["post_graph_context"],
        field_name="postGraphHumanReviewBoundary",
        display_name="Missing human review boundary",
        descriptor=(
            "Where human review or override is required in the workflow, which "
            "source evidence cannot determine alone."
        ),
        keywords=(
            "human review boundary",
            "human oversight",
            "override",
            "người kiểm soát",
            "nguoi kiem soat",
            "can thiệp",
            "can thiep",
            "escalation",
            "veto",
            "kiểm duyệt",
            "kiem duyet",
        ),
    ),
    ClarificationRoutingTarget(
        target_kind=CLARIFICATION_TARGET_KINDS["planner_scope"],
        field_name="plannerScope",
        display_name="Planner scope",
        descriptor=(
            "Investigation planning itself: which parts of the system the "
            "engineering-rule investigation should cover or exclude."
        ),
        keywords=(
            "planner",
            "investigation scope",
            "phạm vi điều tra",
            "pham vi dieu tra",
            "investigate",
            "điều tra",
            "dieu tra",
            "scope in",
            "scope out",
            "exclude from assessment",
            "loại khỏi",
            "loai khoi",
        ),
    ),
)

GENERAL_CONTEXT_TARGET = ClarificationRoutingTarget(
    target_kind=CLARIFICATION_TARGET_KINDS["general_context"],
    field_name="generalContext",
    display_name="General context",
    descriptor=(
        "General business context that does not map to a single wizard field."
    ),
    keywords=(),
)

_ROUTING_TARGET_INDEX = {target.field_name: target for target in ROUTING_TARGETS}


def routing_target_by_field_name(field_name: str) -> ClarificationRoutingTarget | None:
    """Return the canonical routing target for a wizard field name, if any."""
    if not isinstance(field_name, str):
        return None
    return _ROUTING_TARGET_INDEX.get(field_name.strip())
