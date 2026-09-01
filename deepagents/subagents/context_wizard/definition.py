"""Context-wizard subagent: hydrate governed pipeline input before planning."""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.runtime_context import inject_lcsp_runtime_context
from model_policy import CONTEXT_WIZARD_MODEL_SPEC
from tools.common.get_assessment_context.code import get_assessment_context
from tools.common.get_legal_corpus_readiness.code import get_legal_corpus_readiness
from tools.common.retrieve_legal_basis.code import retrieve_legal_basis


TOOLS = [
    get_assessment_context,
    get_legal_corpus_readiness,
    retrieve_legal_basis,
]


ContextWizardStatus = Literal["READY", "NEEDS_INPUT"]
ContextWizardNextStep = Literal["PLAN", "WIZARD_NEEDS_INPUT"]
ContextWizardReasonCode = Literal[
    "MISSING_BUSINESS_CONTEXT",
    "DOUBTFUL_ANSWER",
    "RULE_SCOPE_AMBIGUOUS",
    "GRAPH_CONTEXT_MISSING",
    "BUSINESS_SEMANTICS_UNCLEAR",
]


class ContextWizardClarificationQuestion(BaseModel):
    """One bounded, user-answerable question required before Planner may run."""

    model_config = ConfigDict(extra="forbid")

    question_id: str = Field(min_length=1, max_length=160)
    question_text: str = Field(min_length=1, max_length=2_000)
    target_field_name: str | None = Field(default=None, max_length=160)
    reason_code: ContextWizardReasonCode
    evidence_refs: list[str] = Field(default_factory=list, max_length=20)
    required: bool = True


class ContextWizardQuestionRound(BaseModel):
    """Typed handoff from Context Wizard to the root assessment supervisor."""

    model_config = ConfigDict(extra="forbid")

    status: ContextWizardStatus
    assessment_context: dict[str, Any] = Field(default_factory=dict)
    engineering_rules: list[dict[str, Any]] = Field(default_factory=list)
    artifact_versions: dict[str, Any] = Field(default_factory=dict)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)
    unresolved_facts: list[str] = Field(default_factory=list)
    questions: list[ContextWizardClarificationQuestion] = Field(
        default_factory=list,
        max_length=8,
    )
    next_step: ContextWizardNextStep

    @model_validator(mode="after")
    def validate_status_transition(self) -> Self:
        """Keep READY and pre-Planner NEEDS_INPUT transitions unambiguous."""
        if self.status == "READY":
            if self.next_step != "PLAN":
                raise ValueError("READY Context Wizard output must transition to PLAN")
            if self.questions:
                raise ValueError("READY Context Wizard output cannot contain pending questions")
            return self

        if self.next_step != "WIZARD_NEEDS_INPUT":
            raise ValueError(
                "NEEDS_INPUT Context Wizard output must transition to WIZARD_NEEDS_INPUT"
            )
        if not self.unresolved_facts:
            raise ValueError("NEEDS_INPUT Context Wizard output must name unresolved facts")
        if not self.questions:
            raise ValueError("NEEDS_INPUT Context Wizard output must contain a question round")
        return self


OUTPUT_MODEL = ContextWizardQuestionRound


SYSTEM_PROMPT = """You are the LCSP Context Wizard.

You are the first model stage in the assessment pipeline. Build one compact, pinned
ContextWizardQuestionRound for Planner from the current assessment/Wizard context and the active
EngineeringRule identifiers supplied by the root runtime context.

Tool guidance:
1. Use `get_assessment_context` to hydrate the pinned assessment, Wizard answers, artifact
   versions and known conflicts for this workflow run.
2. Use `get_legal_corpus_readiness` only to verify that the already-pinned approved legal catalog
   and corpus are READY for this assessment. Assessment must never trigger legal maintenance.
3. Use `retrieve_legal_basis` only for EngineeringRule identifiers already supplied by the root.
   Do not discover, select, invent or broaden the set of EngineeringRules.

Question-round rules:
- Return `READY` only when Planner has enough bounded business context to interpret the supplied
  EngineeringRule technical criteria without guessing.
- Return `NEEDS_INPUT` before Planner when one or more material, user-answerable business facts
  are missing or doubtful. Generate only the minimum questions needed for those facts.
- Every generated question must identify one reason code, optional target Wizard field, and only
  safe evidence references already present in the hydrated context. Never embed raw source code or
  raw legal text in a question.
- Do not use the investigation-time Resolver loop for these pre-Planner questions. The root must
  persist the question round, wait for the user's Wizard answer, then resume Context Wizard from
  checkpoint.
- The legal catalog is an upstream READY prerequisite. If the pinned catalog/corpus is not READY,
  do not invent a legal replacement or ask the user to repair it; report the prerequisite as an
  unresolved fact so the root can stop the assessment safely.

Boundary rules:
- Repository evidence, approved legal evidence and Wizard answers remain separate sources.
- Never resolve a Wizard/repository conflict here; preserve it for investigation-time Resolver if
  it later blocks an evidence claim.
- Never search the Program Evidence Graph and never perform technical investigation.
- Never decide legal applicability, risk tier or compliance.
- Never change the supplied EngineeringRule identifiers.

Output contract:
Return exactly one JSON object matching `ContextWizardQuestionRound`:
- `status`: READY or NEEDS_INPUT
- `assessment_context`: concise pinned assessment/Wizard facts needed by Planner
- `engineering_rules`: only the supplied active EngineeringRules with their technical criteria
- `artifact_versions`: pinned artifact versions used to build this context
- `conflicts`: unresolved Wizard/repository conflicts, if any
- `unresolved_facts`: exact missing context; required when NEEDS_INPUT
- `questions`: [] when READY; a bounded user-answerable question round when NEEDS_INPUT
- `next_step`: PLAN when READY; WIZARD_NEEDS_INPUT when NEEDS_INPUT

Do not include raw legal text, raw source code, tool dumps or a compliance verdict.
"""

SUBAGENT = {
    "name": "context_wizard",
    "description": (
        "Use first for every assessment planning cycle to hydrate pinned Wizard/assessment "
        "context and already-selected EngineeringRules, returning either READY for Planner or a "
        "typed NEEDS_INPUT question round that must be answered before planning begins."
    ),
    "system_prompt": SYSTEM_PROMPT,
    "tools": TOOLS,
    "model": CONTEXT_WIZARD_MODEL_SPEC,
    "middleware": [inject_lcsp_runtime_context, *MODEL_GOVERNANCE_MIDDLEWARE],
    "response_format": OUTPUT_MODEL,
}


__all__ = [
    "ContextWizardClarificationQuestion",
    "ContextWizardQuestionRound",
    "ContextWizardStatus",
    "ContextWizardNextStep",
    "OUTPUT_MODEL",
    "SUBAGENT",
    "SYSTEM_PROMPT",
    "TOOLS",
]
