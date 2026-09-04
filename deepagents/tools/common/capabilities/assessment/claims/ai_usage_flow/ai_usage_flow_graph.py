"""Orchestrate canonical input loading, deterministic claim rules, optional summary assistance, and persistence."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, TypedDict

from tools.common.capabilities.platform.callback_schemas import AIUsageFlowCallbackPayload
from tools.common.capabilities.platform.graph_runtime import (
    GraphNodeContext,
    GraphRunState,
    checkpoint_database_url,
    invoke_graph,
)

from .ai_usage_flow_proposer import AIUsageFlowModelAssistedProposer
from .ai_usage_flow_rule_engine import (
    AIUsageFlow,
    AIUsageFlowClaim,
    AIUsageFlowRuleEngine,
)


@dataclass(frozen=True)
class AIUsageFlowGraphResult:
    """Persisted AIUsageFlow result plus callback/workflow execution metadata."""

    flow: AIUsageFlow
    callback_payload: AIUsageFlowCallbackPayload
    workflow_run_id: str
    state: GraphRunState


class AIUsageFlowLangGraphState(TypedDict, total=False):
    """State exchanged between AIUsageFlow LangGraph nodes."""

    message: dict[str, Any]
    correlationId: str
    workflow_run_id: str
    graph_state: GraphRunState
    technical_profile_id: str
    assessment_id: str
    technical_profile: dict[str, Any]
    evidence_report_id: str
    evidence_report: dict[str, Any]
    confirmed_customer_context: dict[str, Any] | None
    flow: AIUsageFlow
    callback_payload: AIUsageFlowCallbackPayload


class AIUsageFlowGraph:
    """Build AI usage claims with deterministic rules and bounded summary assistance.

    The rule engine owns claim creation and lifecycle decisions. Optional LLM
    assistance may update only customer-authoritative summary fields and is rejected
    when it disagrees with the canonical customer_context.
    """

    def __init__(
        self,
        *,
        api_client,
        rule_engine: AIUsageFlowRuleEngine,
        proposer: AIUsageFlowModelAssistedProposer | None = None,
        checkpoint_url: str | None = None,
        logger=None,
    ) -> None:
        """Create the graph with API, deterministic rules, and optional proposer."""
        self._api_client = api_client
        self._rule_engine = rule_engine
        self._proposer = proposer
        self._checkpoint_url = checkpoint_database_url(checkpoint_url)
        self._logger = logger
        self._app = None

    def run(
        self, *, message: dict[str, Any], correlationId: str
    ) -> AIUsageFlowGraphResult:
        """Execute one AIUsageFlow workflow from a technical-profile event.

        Args:
            message: Technical-profile-ready event payload.
            correlationId: End-to-end trace identifier.

        Returns:
            Flow, callback payload, workflow ID, and graph execution state.
        """
        technical_profile_id = self.required_message_id(message, "technicalProfileId")
        assessment_id = self.required_message_id(message, "assessmentId")
        workflow_run_id = self.workflow_run_id(
            message, correlationId, technical_profile_id
        )
        state = GraphRunState(
            graph_name="ai_usage_flow",
            workflow_run_id=workflow_run_id,
            assessment_id=assessment_id,
            artifact_id=technical_profile_id,
            correlationId=correlationId,
            attempt=self._delivery_attempt(message),
            sanitized_inputs={
                "technical_profile_id": technical_profile_id,
                "assessment_id": assessment_id,
            },
        )
        initial_state = AIUsageFlowLangGraphState(
            message=message,
            correlationId=correlationId,
            workflow_run_id=workflow_run_id,
            graph_state=state,
            technical_profile_id=technical_profile_id,
            assessment_id=assessment_id,
        )
        result_state = invoke_graph(
            build_graph=self._runtime_app,
            initial_state=initial_state,
            workflow_run_id=workflow_run_id,
            checkpoint_url=self._checkpoint_url,
        )
        return AIUsageFlowGraphResult(
            flow=result_state["flow"],
            callback_payload=result_state["callback_payload"],
            workflow_run_id=workflow_run_id,
            state=result_state["graph_state"],
        )

    def _build_graph(self, checkpointer=None):
        """Compile the load → rule → optional proposal → finalize → persist graph.

        Raises:
            RuntimeError: If LangGraph is unavailable in the Managed Agent runtime.
        """
        try:
            from langgraph.graph import END, START, StateGraph
        except ImportError as exc:
            raise RuntimeError("langgraph is required for AIUsageFlowGraph") from exc

        graph = StateGraph(AIUsageFlowLangGraphState)
        graph.add_node("load_inputs", self._node_load_inputs)
        graph.add_node("rule_engine", self._node_rule_engine)
        graph.add_node("summary_proposal", self._node_summary_proposal)
        graph.add_node("finalize", self._node_finalize)
        graph.add_node("persist", self._node_persist)
        graph.add_edge(START, "load_inputs")
        graph.add_edge("load_inputs", "rule_engine")
        graph.add_edge("rule_engine", "summary_proposal")
        graph.add_edge("summary_proposal", "finalize")
        graph.add_edge("finalize", "persist")
        graph.add_edge("persist", END)
        return graph.compile(checkpointer=checkpointer)

    def _get_app(self):
        """Lazily build and cache the non-checkpointed graph application."""
        if self._app is None:
            self._app = self._build_graph()
        return self._app

    def _runtime_app(self, checkpointer):
        """Return a checkpoint-aware graph or reuse the cached stateless graph."""
        if checkpointer is None:
            return self._get_app()
        return self._build_graph(checkpointer=checkpointer)

    def _node_load_inputs(self, state: AIUsageFlowLangGraphState):
        """Load canonical technical evidence without customer-context hydration."""
        technical_profile = self._api_client.get_accepted_technical_profile(
            state["technical_profile_id"]
        )
        evidence_report_id = (
            state["message"].get("evidenceReportId")
            or state["message"].get("evidence_report_id")
            or technical_profile.get("evidence_report_id")
            or technical_profile.get("evidenceReportId")
        )
        if not evidence_report_id:
            raise ValueError("missing evidenceReportId")

        graph_state = state["graph_state"]
        graph_state.record_input_version(
            "technical_profile_id", state["technical_profile_id"]
        )
        graph_state.record_input_version(
            "evidence_report_id", str(evidence_report_id)
        )

        evidence_report = self._api_client.get_accepted_technical_evidence_report(
            str(evidence_report_id)
        )
        return {
            "technical_profile": technical_profile,
            "evidence_report_id": str(evidence_report_id),
            "evidence_report": evidence_report,
            "confirmed_customer_context": None,
        }

    def _node_rule_engine(self, state: AIUsageFlowLangGraphState):
        """Generate authoritative claims/status using deterministic rule logic."""
        flow = self._rule_engine.generate(
            technical_profile=state["technical_profile"],
            evidence_report=state["evidence_report"],
            confirmed_customer_context=state["confirmed_customer_context"],
        )
        graph_state = state["graph_state"]
        graph_state.record_node(
            node_name="ai_usage_flow.rule_engine",
            status=flow.status.lower(),
            metadata={"claim_count": len(flow.claims)},
        )
        reason = flow.uncertainty_reasons[0] if flow.uncertainty_reasons else None
        if flow.status == "BLOCKED":
            graph_state.record_guardrail("blocked", reason)
        elif flow.status in {"UNCLEAR", "CONFLICTED"}:
            graph_state.record_guardrail("degraded", reason or flow.status)
        else:
            graph_state.record_guardrail("passed")
        return {"flow": flow}

    @staticmethod
    def workflow_run_id(
        message: dict[str, Any], correlationId: str, technical_profile_id: str
    ) -> str:
        """Use an explicit workflow ID or derive one from artifact and trace IDs."""
        explicit = message.get("workflow_run_id")
        if explicit:
            return str(explicit)
        return f"ai-usage-flow:{technical_profile_id}:{correlationId}"

    @staticmethod
    def required_message_id(message: dict[str, Any], key: str) -> str:
        """Resolve a required camelCase event field from camel/snake-case aliases."""
        snake_key = key[0].lower() + "".join(
            f"_{char.lower()}" if char.isupper() else char for char in key[1:]
        )
        value = message.get(key) or message.get(snake_key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)

    @staticmethod
    def _delivery_attempt(message: dict[str, Any]) -> int:
        """Normalize the delivery-attempt marker into a non-negative integer."""
        try:
            return max(0, int(message.get("_delivery_attempt", 0)))
        except (TypeError, ValueError):
            return 0

    def _apply_summary_proposal(
        self,
        *,
        state: AIUsageFlowLangGraphState,
    ):
        """Apply optional LLM summary updates only when customer authority agrees."""
        flow = state["flow"]
        confirmed_customer_context = state.get("confirmed_customer_context")
        if not self._proposer or not confirmed_customer_context or flow.status == "BLOCKED":
            state["graph_state"].record_node(
                node_name="ai_usage_flow.summary_proposal",
                status="skipped",
            )
            return {}
        validated_claims = [
            claim.to_dict()
            for claim in flow.claims
            if claim.lifecycle_state == "VALIDATED"
        ]
        proposer_context = GraphNodeContext(
            workflow_run_id=state["workflow_run_id"],
            node_name="ai_usage_flow.summary_proposal",
            correlationId=state["correlationId"],
        )
        proposal = self._proposer.generate_summary_proposal(
            baseline_summary=flow.summary,
            confirmed_customer_context=confirmed_customer_context,
            validated_claims=validated_claims,
            assessment_id=flow.assessment_id,
            evidence_report_id=state["evidence_report_id"],
            workflow_run_id=proposer_context.workflow_run_id,
            node_name=proposer_context.node_name,
            correlationId=proposer_context.correlationId,
        )
        if not proposal:
            state["graph_state"].record_node(
                node_name=proposer_context.node_name,
                status="omitted",
            )
            return {}
        summary_updates = proposal.get("summary_updates", {})
        if not self.summary_updates_match_authority(summary_updates, confirmed_customer_context):
            state["graph_state"].record_node(
                node_name=proposer_context.node_name,
                status="rejected",
                request_id=proposal.get("request_id"),
                metadata={"proposed_keys": sorted(summary_updates.keys())},
            )
            if self._logger:
                self._logger.warning(
                    "AI_USAGE_FLOW_SUMMARY_PROPOSAL_REJECTED",
                    workflow_run_id=state["workflow_run_id"],
                    proposed_keys=sorted(summary_updates.keys()),
                )
            return {}
        updated_summary = dict(flow.summary)
        updated_summary.update(summary_updates)
        state["graph_state"].record_node(
            node_name=proposer_context.node_name,
            status="accepted",
            request_id=proposal.get("request_id"),
            metadata={"proposed_keys": sorted(summary_updates.keys())},
        )
        return {"flow": replace(flow, summary=updated_summary)}

    def _node_summary_proposal(self, state: AIUsageFlowLangGraphState):
        """Execute the bounded summary-proposal node."""
        return self._apply_summary_proposal(state=state)

    def _node_finalize(self, state: AIUsageFlowLangGraphState):
        """Translate the governed flow into the API callback contract."""
        flow = state["flow"]
        callback_payload = AIUsageFlowCallbackPayload(
            technical_profile_id=flow.technical_profile_id,
            assessment_id=flow.assessment_id,
            schema_version=flow.schema_version,
            provider_version=flow.provider_version,
            claims=[self._to_callback_claim(claim) for claim in flow.claims],
            unknown_usages=[{"reason": reason} for reason in flow.uncertainty_reasons],
            privacy_flags=flow.privacy_flags,
            flow_data=flow.to_dict(),
        )
        graph_state = state["graph_state"]
        graph_state.metadata["callback_contract"] = "AIUsageFlowCallbackRequest"
        graph_state.record_node(
            node_name="ai_usage_flow.finalize",
            status="completed",
            metadata={"status": flow.status},
        )
        return {"callback_payload": callback_payload}

    def _node_persist(self, state: AIUsageFlowLangGraphState):
        """Enforce callback privacy and persist the finalized AIUsageFlow artifact."""
        payload = state["callback_payload"]
        if payload.privacy_flags.get("containsSourceCode") is not False:
            raise ValueError("AIUsageFlow callback privacy flag is unsafe")
        response = self._api_client.post_ai_usage_flow_callback(payload)
        artifact_id = getattr(response, "ai_usage_flow_id", None)
        state["graph_state"].record_node(
            node_name="ai_usage_flow.persist",
            status="completed",
            metadata={
                "accepted": bool(getattr(response, "accepted", True)),
                "artifact_id": artifact_id,
            },
        )
        return {}

    @staticmethod
    def _to_callback_claim(claim: AIUsageFlowClaim) -> dict[str, Any]:
        """Project internal numeric/lifecycle claim data to the callback contract."""
        if claim.confidence >= 0.75:
            confidence = "high"
        elif claim.confidence >= 0.40:
            confidence = "medium"
        else:
            confidence = "low"

        uncertainty_reason = (
            "; ".join(claim.uncertainty_reasons)
            if claim.uncertainty_reasons
            else None
        )
        is_material = (
            claim.lifecycle_state == "VALIDATED"
            and bool(claim.evidence_refs)
            and claim.confidence >= 0.65
        )
        return {
            "claim_id": claim.claim_id,
            "claim_type": claim.claim_category,
            "confidence": confidence,
            "evidence_refs": list(claim.evidence_refs),
            "uncertainty_reason": uncertainty_reason,
            "description": f"{claim.claim_category}: {claim.claim_field}",
            "is_material": is_material,
        }

    @staticmethod
    def summary_updates_match_authority(
        summary_updates: dict[str, Any],
        confirmed_customer_context: dict[str, Any],
    ) -> bool:
        """Accept proposed summary values only when identical to customer authority."""
        answers = confirmed_customer_context.get("answers")
        if not isinstance(answers, dict):
            return False
        authoritative_map = {
            "businessProcess": answers.get("businessProcess"),
            "aiPurpose": answers.get("aiPurpose"),
            "affectedSubjects": answers.get("affectedSubjects"),
            "humanReview": answers.get("humanReview"),
        }
        for key, value in summary_updates.items():
            if authoritative_map.get(key) != value:
                return False
        return True
