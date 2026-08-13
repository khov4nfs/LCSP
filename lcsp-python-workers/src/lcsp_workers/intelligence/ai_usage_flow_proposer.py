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
    def __init__(
        self,
        llm_client: LLMGatewayClient,
        agentic_tool_resolver: AgenticToolResolver | None = None,
    ):
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
        correlation_id: str | None = None,
    ) -> dict[str, Any] | None:
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
            correlation_id=correlation_id,
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
        correlation_id: str | None,
    ):
        if self.agentic_tool_resolver is None:
            try:
                return self.llm_client.complete(
                    prompt=prompt,
                    workflow_run_id=workflow_run_id,
                    node_name=node_name,
                    max_tokens=256,
                    correlation_id=correlation_id,
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
                correlation_id=correlation_id,
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
                    correlation_id=correlation_id,
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
                correlation_id=correlation_id,
            )
        except Exception:
            return None

    @staticmethod
    def _parse_summary_proposal(response: Any) -> dict[str, Any] | None:
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
        correlation_id: str | None,
    ) -> AgenticInvocationContext:
        return AgenticInvocationContext(
            assessment_id=_stable_uuid(f"assessment:{assessment_id}"),
            workflow_run_id=_stable_uuid(f"workflow:{workflow_run_id}"),
            correlation_id=_stable_uuid(f"correlation:{correlation_id or workflow_run_id}"),
            user_id="worker-runtime",
            organization_id=organization_id or "worker-runtime",
            artifact_versions={"technicalEvidenceReportId": evidence_report_id},
            scope={},
        )


def _stable_uuid(value: str) -> UUID:
    return uuid5(NAMESPACE_URL, value)
