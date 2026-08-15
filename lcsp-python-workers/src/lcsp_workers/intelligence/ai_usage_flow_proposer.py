"""Generate bounded LLM proposals for AIUsageFlow summary fields only."""

from __future__ import annotations

import json
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from lcsp_workers.agentic_evidence import AgenticInvocationContext, AgenticToolResolver
from lcsp_workers.llm.gateway_client import LLMGatewayClient


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
        llm_client: LLMGatewayClient,
        agentic_tool_resolver: AgenticToolResolver | None = None,
    ):
        """Create the proposer with optional read-only agentic evidence tools."""
        self.llm_client = llm_client
        self.agentic_tool_resolver = agentic_tool_resolver

    def generate_summary_proposal(
        self,
        *,
        baseline_summary: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
        validated_claims: list[dict[str, Any]],
        assessment_id: str,
        evidence_report_id: str,
        organization_id: str | None,
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
            organization_id: Optional tenant identifier for tool authorization.
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
            organization_id=organization_id,
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
        Return JSON only.

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
        - Do not output markdown fences.
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
        Return JSON only.

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
        - Do not output markdown fences.
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
        organization_id: str | None,
        workflow_run_id: str,
        node_name: str,
        correlationId: str | None,
    ):
        """Complete directly or through one bounded read-only tool round trip.

        Any LLM/tool failure is converted to ``None`` so deterministic baseline
        processing can continue without model assistance.
        """
        if self.agentic_tool_resolver is None:
            try:
                return self.llm_client.complete(
                    prompt=prompt,
                    workflow_run_id=workflow_run_id,
                    node_name=node_name,
                    max_tokens=256,
                    correlationId=correlationId,
                )
            except Exception:
                return None

        try:
            tool_response = self.llm_client.complete_with_tools(
                prompt=prompt,
                tools=self.agentic_tool_resolver.tool_definitions(),
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=256,
                correlationId=correlationId,
            )
        except Exception:
            return None

        if not tool_response.tool_calls:
            return tool_response

        try:
            tool_results = self.agentic_tool_resolver.invoke_tool_calls(
                tool_response.tool_calls,
                context=self._tool_context(
                    assessment_id=assessment_id,
                    evidence_report_id=evidence_report_id,
                    organization_id=organization_id,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlationId,
                ),
            )
            return self.llm_client.complete(
                prompt=self._build_final_prompt(
                    baseline_summary=baseline_summary,
                    wizard_profile=wizard_profile,
                    validated_claims=validated_claims,
                    tool_results=[
                        {
                            "tool_name": result.tool_name,
                            "authorized_action": result.authorized_action,
                            "response": result.response,
                        }
                        for result in tool_results
                    ],
                ),
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=256,
                correlationId=correlationId,
            )
        except Exception:
            return None

    @staticmethod
    def _parse_summary_proposal(response: Any) -> dict[str, Any] | None:
        """Parse JSON and reject updates outside the summary-field allowlist."""
        try:
            proposal = json.loads(response.content)
        except json.JSONDecodeError:
            return None

        summary_updates = proposal.get("summary_updates")
        if not isinstance(summary_updates, dict):
            return None

        if any(key not in ALLOWED_SUMMARY_FIELDS for key in summary_updates):
            return None

        return {
            "summary_updates": summary_updates,
            "request_id": response.request_id,
        }

    @staticmethod
    def _tool_context(
        *,
        assessment_id: str,
        evidence_report_id: str,
        organization_id: str | None,
        workflow_run_id: str,
        correlationId: str | None,
    ) -> AgenticInvocationContext:
        """Build a stable UUID-based context with pinned evidence for tool calls."""
        return AgenticInvocationContext(
            assessment_id=_stable_uuid(f"assessment:{assessment_id}"),
            workflow_run_id=_stable_uuid(f"workflow:{workflow_run_id}"),
            correlationId=_stable_uuid(f"correlation:{correlationId or workflow_run_id}"),
            user_id="worker-runtime",
            organization_id=organization_id or "worker-runtime",
            artifact_versions={"technicalEvidenceReportId": evidence_report_id},
            scope={},
        )


def _stable_uuid(value: str) -> UUID:
    """Derive a deterministic UUID for string identifiers used by agentic tools."""
    return uuid5(NAMESPACE_URL, value)
