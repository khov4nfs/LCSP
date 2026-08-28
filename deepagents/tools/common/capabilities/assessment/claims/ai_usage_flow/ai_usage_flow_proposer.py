"""Generate bounded LLM proposals for AIUsageFlow summary fields only."""

from __future__ import annotations

from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from langchain.agents import create_agent
from langchain.agents.middleware import ToolCallLimitMiddleware

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from model_policy import RESOLVER_MODEL_SPEC
from tools.common.capabilities.agentic_evidence import AgenticInvocationContext, AgenticToolResolver


ALLOWED_SUMMARY_FIELDS = {
    "businessProcess",
    "aiPurpose",
    "affectedSubjects",
    "humanReview",
}


class AIUsageFlowModelAssistedProposer:
    """Suggest bounded summary updates without creating claims or evidence facts."""

    def __init__(
        self,
        agentic_tool_resolver: AgenticToolResolver | None = None,
        model: str = RESOLVER_MODEL_SPEC,
    ):
        """Create the proposer with optional read-only agentic evidence tools."""
        self.agentic_tool_resolver = agentic_tool_resolver
        self._model = model

    def generate_summary_proposal(
        self,
        *,
        baseline_summary: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
        validated_claims: list[dict[str, Any]],
        assessment_id: str,
        evidence_report_id: str,
        workflow_run_id: str,
        node_name: str,
        correlationId: str | None = None,
    ) -> dict[str, Any] | None:
        """Generate and parse a proposal restricted to approved summary fields.

        Args:
            baseline_summary: Deterministically constructed summary to preserve by default.
            wizard_profile: Optional manager-authoritative business context.
            validated_claims: Evidence-backed claims available as context only.
            assessment_id: Assessment identifier used for tool scoping.
            evidence_report_id: Pinned technical evidence artifact reference.
            workflow_run_id: Workflow identifier used for LLM/tool telemetry.
            node_name: Graph node issuing the model request.
            correlationId: Optional end-to-end trace identifier.

        Returns:
            Validated ``summary_updates`` plus request ID, or ``None`` when the
            model/tool path fails or produces an invalid proposal.
        """
        prompt = self._build_initial_prompt(
            baseline_summary=baseline_summary,
            wizard_profile=wizard_profile,
            validated_claims=validated_claims,
        )
        response = self._complete(
            prompt=prompt,
            baseline_summary=baseline_summary,
            wizard_profile=wizard_profile,
            validated_claims=validated_claims,
            assessment_id=assessment_id,
            evidence_report_id=evidence_report_id,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            correlationId=correlationId,
        )
        if response is None:
            return None
        return self._parse_summary_proposal(response)

    def _build_initial_prompt(
        self,
        *,
        baseline_summary: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
        validated_claims: list[dict[str, Any]],
    ) -> str:
        """Build the first prompt from bounded structured context only."""
        return f"""
        You are an AIUsageFlow summary proposal assistant.
        Use the configured structured response format only.

        BASELINE_SUMMARY:
        {baseline_summary}

        WIZARD_PROFILE:
        {wizard_profile or {}}

        VALIDATED_CLAIMS:
        {validated_claims}

        OUTPUT_SCHEMA:
        {{
          "summary_updates": {{
            "businessProcess": "optional string",
            "aiPurpose": "optional string",
            "affectedSubjects": "optional list or string",
            "humanReview": "optional string"
          }}
        }}

        RULES:
        - Only include keys that should change.
        - Do not propose values outside the wizard-authoritative business context.
        - Do not invent claims, evidence refs, confidence, or privacy flags.
        - If you need more evidence, call only the provided read-only tools.
        """

    def _build_final_prompt(
        self,
        *,
        baseline_summary: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
        validated_claims: list[dict[str, Any]],
        tool_results: list[dict[str, Any]],
    ) -> str:
        """Build the second prompt after authorized bounded tool results return."""
        return f"""
        You are an AIUsageFlow summary proposal assistant.
        Use the configured structured response format only.

        BASELINE_SUMMARY:
        {baseline_summary}

        WIZARD_PROFILE:
        {wizard_profile or {}}

        VALIDATED_CLAIMS:
        {validated_claims}

        TOOL_RESULTS:
        {tool_results}

        OUTPUT_SCHEMA:
        {{
          "summary_updates": {{
            "businessProcess": "optional string",
            "aiPurpose": "optional string",
            "affectedSubjects": "optional list or string",
            "humanReview": "optional string"
          }}
        }}

        RULES:
        - Only include keys that should change.
        - Use TOOL_RESULTS only as bounded supporting evidence.
        - Do not propose values outside the wizard-authoritative business context.
        - Do not invent claims, evidence refs, confidence, or privacy flags.
        """

    def _complete(
        self,
        *,
        prompt: str,
        baseline_summary: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
        validated_claims: list[dict[str, Any]],
        assessment_id: str,
        evidence_report_id: str,
        workflow_run_id: str,
        node_name: str,
        correlationId: str | None,
    ):
        """Complete directly or through one bounded read-only tool round trip.

        Any LLM/tool failure is converted to ``None`` so deterministic baseline
        processing can continue without model assistance.
        """
        try:
            tools = []
            middleware = list(MODEL_GOVERNANCE_MIDDLEWARE)
            if self.agentic_tool_resolver:
                tools = self.agentic_tool_resolver.as_langchain_tools(context=self._tool_context(
                    assessment_id=assessment_id,
                    evidence_report_id=evidence_report_id,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlationId,
                ))
                middleware.append(ToolCallLimitMiddleware(run_limit=self.agentic_tool_resolver.max_tool_calls, exit_behavior="error"))
            agent = create_agent(
                model=self._model, tools=tools,
                system_prompt="Propose bounded AIUsageFlow summary fields only. Use governed read tools only when necessary.",
                response_format=_summary_proposal_response_schema(), middleware=middleware,
                name="lcsp-ai-usage-flow-proposer",
            )
            return agent.invoke(
                {"messages": [{"role": "user", "content": prompt}]},
                config={"metadata": {"workflow_run_id": workflow_run_id, "node_name": node_name, "correlationId": correlationId}, "configurable": {"thread_id": workflow_run_id}},
            )
        except Exception:
            return None

    @staticmethod
    def _parse_summary_proposal(response: Any) -> dict[str, Any] | None:
        """Validate structured output and reject updates outside the allowlist."""
        proposal = response.get("structured_response") if isinstance(response, dict) else None
        if not isinstance(proposal, dict):
            return None

        summary_updates = proposal.get("summary_updates")
        if not isinstance(summary_updates, dict):
            return None

        if any(key not in ALLOWED_SUMMARY_FIELDS for key in summary_updates):
            return None

        return {
            "summary_updates": summary_updates,
            "request_id": None,
        }

    @staticmethod
    def _tool_context(
        *,
        assessment_id: str,
        evidence_report_id: str,
        workflow_run_id: str,
        correlationId: str | None,
    ) -> AgenticInvocationContext:
        """Build a stable UUID-based context with pinned evidence for tool calls."""
        return AgenticInvocationContext(
            assessment_id=_stable_uuid(f"assessment:{assessment_id}"),
            workflow_run_id=_stable_uuid(f"workflow:{workflow_run_id}"),
            correlationId=_stable_uuid(f"correlation:{correlationId or workflow_run_id}"),
            user_id="worker-runtime",
            artifact_versions={"technicalEvidenceReportId": evidence_report_id},
            scope={},
        )


def _stable_uuid(value: str) -> UUID:
    """Derive a deterministic UUID for string identifiers used by agentic tools."""
    return uuid5(NAMESPACE_URL, value)


def _summary_proposal_response_schema() -> dict[str, Any]:
    return {
        "title": "AIUsageFlowSummaryProposalResponse",
        "description": "Bounded proposal for AIUsageFlow summary fields only.",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary_updates": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "businessProcess": {"type": "string"},
                    "aiPurpose": {"type": "string"},
                    "affectedSubjects": {
                        "type": ["array", "string"],
                        "items": {"type": "string"},
                    },
                    "humanReview": {"type": "string"},
                },
            }
        },
        "required": ["summary_updates"],
    }
