"""Orchestrate deterministic classification, optional LLM assistance, and guardrails."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, TypedDict

from tools.common.capabilities.platform.graph_runtime import (
    GraphNodeContext,
    GraphRunState,
    checkpoint_database_url,
    invoke_graph,
)

from .citation_guardrail import check_citations
from .classification_proposer import ModelAssistedClassificationProposer
from .overclaim_detector import check_overclaim
from .rationale_narrator import RationaleNarrator
from .risk_tier_calculator import calculate_risk_tier


@dataclass(frozen=True)
class ClassificationGraphResult:
    """Final classification payload plus workflow execution metadata."""

    payload: dict[str, Any]
    workflow_run_id: str
    state: GraphRunState


class ClassificationLangGraphState(TypedDict, total=False):
    """State exchanged between classification LangGraph nodes."""

    message: dict[str, Any]
    correlationId: str
    workflow_run_id: str
    graph_state: GraphRunState
    usage_claims: list[dict[str, Any]]
    applicable_rules: list[dict[str, Any]]
    citation_allowlist: list[str]
    citation_refs: list[str]
    classification_version: str
    guardrail_status: str
    guardrail_reason: str
    risk_level: str
    applicability_assessment: str
    citation_coverage: str
    baseline_risk_level: str
    baseline_applicability_assessment: str
    rationale: str | None
    result_payload: dict[str, Any]


ClassificationPersister = Callable[
    [dict[str, Any], ClassificationLangGraphState], None
]


class ClassificationGraph:
    """Run the classification workflow with deterministic authority boundaries.

    Citation validation and the baseline risk decision are deterministic. LLM
    proposal/narration nodes are optional and can only contribute when they
    remain consistent with the deterministic baseline and output guardrails.
    """

    def __init__(
        self,
        *,
        proposer: ModelAssistedClassificationProposer | None = None,
        narrator: RationaleNarrator | None = None,
        persister: ClassificationPersister | None = None,
        checkpoint_url: str | None = None,
        logger=None,
    ) -> None:
        """Create a classification graph and its optional integrations.

        Args:
            proposer: Optional model-assisted proposal node.
            narrator: Optional LLM rationale narrator.
            persister: Optional callback invoked after finalization.
            checkpoint_url: Optional LangGraph checkpoint database URL.
            logger: Optional structured logger for rejected proposals/guardrails.
        """
        self._proposer = proposer
        self._narrator = narrator
        self._persister = persister
        self._checkpoint_url = checkpoint_database_url(checkpoint_url)
        self._logger = logger
        self._app = None

    def run(
        self, *, message: dict[str, Any], correlationId: str
    ) -> ClassificationGraphResult:
        """Execute one classification workflow.

        Args:
            message: Normalized classification evidence and artifact identifiers.
            correlationId: End-to-end correlation identifier.

        Returns:
            Final payload together with workflow ID and recorded graph state.
        """
        classification_version = str(
            message.get("classification_version") or "1.0.0"
        )
        assessment_id = (
            str(message.get("assessment_id"))
            if message.get("assessment_id")
            else None
        )
        workflow_run_id = self.workflow_run_id(message, correlationId)
        state = GraphRunState(
            graph_name="classification",
            workflow_run_id=workflow_run_id,
            assessment_id=assessment_id,
            artifact_id=self._optional_string(message.get("legal_rule_match_id")),
            correlationId=correlationId,
            input_versions={"classification_version": classification_version},
            attempt=self._delivery_attempt(message),
            sanitized_inputs={
                "assessment_id": assessment_id,
                "legal_rule_match_id": self._optional_string(
                    message.get("legal_rule_match_id")
                ),
                "verified_profile_id": self._optional_string(
                    message.get("verified_profile_id")
                ),
            },
        )
        if message.get("legal_rule_match_id"):
            state.record_input_version(
                "legal_rule_match_id", str(message["legal_rule_match_id"])
            )
        if message.get("verified_profile_id"):
            state.record_input_version(
                "verified_profile_id", str(message["verified_profile_id"])
            )

        initial_state = ClassificationLangGraphState(
            message=message,
            correlationId=correlationId,
            workflow_run_id=workflow_run_id,
            graph_state=state,
            usage_claims=message.get("usage_claims", []),
            applicable_rules=message.get("applicable_rules", []),
            citation_allowlist=message.get("citation_allowlist", []),
            classification_version=classification_version,
            rationale=None,
        )
        result_state = invoke_graph(
            build_graph=self._runtime_app,
            initial_state=initial_state,
            workflow_run_id=workflow_run_id,
            checkpoint_url=self._checkpoint_url,
        )
        return ClassificationGraphResult(
            payload=result_state["result_payload"],
            workflow_run_id=workflow_run_id,
            state=result_state["graph_state"],
        )

    def _build_graph(self, checkpointer=None):
        """Compile the classification LangGraph and conditional routes.

        Args:
            checkpointer: Optional LangGraph checkpoint implementation.

        Returns:
            Compiled LangGraph application.

        Raises:
            RuntimeError: If LangGraph is not installed in the Managed Agent runtime.
        """
        try:
            from langgraph.graph import END, START, StateGraph
        except ImportError as exc:
            raise RuntimeError("langgraph is required for ClassificationGraph") from exc

        graph = StateGraph(ClassificationLangGraphState)
        graph.add_node("citation_guardrail", self._node_citation_guardrail)
        graph.add_node("deterministic_baseline", self._node_deterministic_baseline)
        graph.add_node("proposal", self._node_proposal)
        graph.add_node("rationale", self._node_rationale)
        graph.add_node("overclaim_guardrail", self._node_overclaim_guardrail)
        graph.add_node("finalize", self._node_finalize)
        graph.add_node("persist", self._node_persist)

        graph.add_edge(START, "citation_guardrail")
        graph.add_conditional_edges(
            "citation_guardrail",
            self._route_after_citation_guardrail,
            {"blocked": "finalize", "continue": "deterministic_baseline"},
        )
        graph.add_edge("deterministic_baseline", "proposal")
        graph.add_conditional_edges(
            "proposal",
            self._route_after_proposal,
            {"has_rationale": "overclaim_guardrail", "need_rationale": "rationale"},
        )
        graph.add_edge("rationale", "overclaim_guardrail")
        graph.add_edge("overclaim_guardrail", "finalize")
        graph.add_edge("finalize", "persist")
        graph.add_edge("persist", END)
        return graph.compile(checkpointer=checkpointer)

    def _get_app(self):
        """Lazily compile and cache the non-checkpointed graph application."""
        if self._app is None:
            self._app = self._build_graph()
        return self._app

    def _runtime_app(self, checkpointer):
        """Build a checkpoint-aware graph or reuse the cached stateless graph."""
        if checkpointer is None:
            return self._get_app()
        return self._build_graph(checkpointer=checkpointer)

    def _node_citation_guardrail(self, state: ClassificationLangGraphState):
        """Validate citation references before any classification decision runs."""
        citation_refs = self._citation_refs(state["applicable_rules"])
        guardrail_status, guardrail_reason = check_citations(
            citation_refs=citation_refs,
            citation_allowlist=state["citation_allowlist"],
        )
        graph_state = state["graph_state"]
        graph_state.record_guardrail(guardrail_status, guardrail_reason)
        graph_state.record_node(
            node_name="classification.citation_guardrail",
            status=guardrail_status,
            metadata={"citation_ref_count": len(citation_refs)},
        )
        return {
            "citation_refs": citation_refs,
            "guardrail_status": guardrail_status,
            "guardrail_reason": guardrail_reason,
        }

    @staticmethod
    def _route_after_citation_guardrail(state: ClassificationLangGraphState) -> str:
        """Route blocked citation sets directly to finalization."""
        return "blocked" if state["guardrail_status"] == "blocked" else "continue"

    def _node_deterministic_baseline(self, state: ClassificationLangGraphState):
        """Compute the authoritative rule-based classification baseline."""
        risk_level, applicability_assessment, citation_coverage = calculate_risk_tier(
            state["applicable_rules"]
        )
        state["graph_state"].record_node(
            node_name="classification.deterministic_baseline",
            status="completed",
            metadata={"risk_level": risk_level},
        )
        return {
            "risk_level": risk_level,
            "applicability_assessment": applicability_assessment,
            "citation_coverage": citation_coverage,
            "baseline_risk_level": risk_level,
            "baseline_applicability_assessment": applicability_assessment,
        }

    def _node_proposal(self, state: ClassificationLangGraphState):
        """Accept an optional LLM proposal only when it matches the baseline."""
        if not self._proposer:
            state["graph_state"].record_node(
                node_name="classification.proposal",
                status="skipped",
            )
            return {}
        proposer_context = GraphNodeContext(
            workflow_run_id=state["workflow_run_id"],
            node_name="classification.proposal",
            correlationId=state["correlationId"],
        )
        proposal = self._proposer.generate_proposal(
            usage_claims=state["usage_claims"],
            applicable_rules=state["applicable_rules"],
            baseline_risk_level=state["baseline_risk_level"],
            baseline_applicability_assessment=state[
                "baseline_applicability_assessment"
            ],
            workflow_run_id=proposer_context.workflow_run_id,
            node_name=proposer_context.node_name,
            correlationId=proposer_context.correlationId,
        )
        if proposal and self.proposal_matches_baseline(
            proposal=proposal,
            baseline_risk_level=state["baseline_risk_level"],
            baseline_applicability_assessment=state[
                "baseline_applicability_assessment"
            ],
            usage_claims=state["usage_claims"],
        ):
            state["graph_state"].record_node(
                node_name=proposer_context.node_name,
                status="accepted",
                request_id=proposal.get("request_id"),
            )
            return {
                "risk_level": proposal["risk_level"],
                "applicability_assessment": proposal[
                    "applicability_assessment"
                ],
                "rationale": proposal.get("rationale"),
            }
        if proposal:
            state["graph_state"].record_node(
                node_name=proposer_context.node_name,
                status="rejected",
                request_id=proposal.get("request_id"),
            )
            if self._logger:
                self._logger.warning(
                    "CLASSIFICATION_PROPOSAL_REJECTED",
                    baseline_risk_level=state["baseline_risk_level"],
                    baseline_applicability_assessment=state[
                        "baseline_applicability_assessment"
                    ],
                    proposed_risk_level=proposal.get("risk_level"),
                    proposed_applicability_assessment=proposal.get(
                        "applicability_assessment"
                    ),
                )
        else:
            state["graph_state"].record_node(
                node_name=proposer_context.node_name,
                status="skipped",
            )
        return {}

    @staticmethod
    def _route_after_proposal(state: ClassificationLangGraphState) -> str:
        """Skip narration when an accepted proposal already supplied rationale."""
        return "has_rationale" if state.get("rationale") else "need_rationale"

    def _node_rationale(self, state: ClassificationLangGraphState):
        """Optionally narrate the already-authoritative classification decision."""
        if not self._narrator:
            state["graph_state"].record_node(
                node_name="classification.rationale_narrator",
                status="omitted",
            )
            return {}
        narrator_context = GraphNodeContext(
            workflow_run_id=state["workflow_run_id"],
            node_name="classification.rationale_narrator",
            correlationId=state["correlationId"],
        )
        rationale = self._narrator.generate_rationale(
            usage_claims=state["usage_claims"],
            applicable_rules=state["applicable_rules"],
            risk_level=state["risk_level"],
            applicability_assessment=state["applicability_assessment"],
            workflow_run_id=narrator_context.workflow_run_id,
            node_name=narrator_context.node_name,
            correlationId=narrator_context.correlationId,
        )
        state["graph_state"].record_node(
            node_name=narrator_context.node_name,
            status="generated" if rationale else "omitted",
        )
        return {"rationale": rationale}

    def _node_overclaim_guardrail(self, state: ClassificationLangGraphState):
        """Remove rationale text that asserts prohibited certainty/compliance claims."""
        rationale = state.get("rationale")
        if rationale and check_overclaim(rationale):
            if self._logger:
                self._logger.warning(
                    "OVERCLAIM_DETECTED",
                    msg="Rationale rejected due to overclaiming words",
                )
            state["graph_state"].record_node(
                node_name="classification.overclaim_guardrail",
                status="rejected",
            )
            return {"rationale": None}
        state["graph_state"].record_node(
            node_name="classification.overclaim_guardrail",
            status="passed" if rationale else "omitted",
        )
        return {}

    def _node_finalize(self, state: ClassificationLangGraphState):
        """Assemble the contract payload, forcing blocked citation runs to BLOCKED."""
        if state["guardrail_status"] == "blocked":
            payload = {
                "classification_version": state["classification_version"],
                "usage_claims": state["usage_claims"],
                "applicable_rules": state["applicable_rules"],
                "risk_level": "BLOCKED",
                "applicability_assessment": "not_applicable",
                "citation_refs": state["citation_refs"],
                "citation_coverage": "NO_CITATION",
                "rationale": None,
                "guardrail_status": state["guardrail_status"],
                "guardrail_reason": state["guardrail_reason"],
            }
        else:
            payload = {
                "classification_version": state["classification_version"],
                "usage_claims": state["usage_claims"],
                "applicable_rules": state["applicable_rules"],
                "risk_level": state["risk_level"],
                "applicability_assessment": state["applicability_assessment"],
                "citation_refs": state["citation_refs"],
                "citation_coverage": state["citation_coverage"],
                "rationale": state.get("rationale"),
                "guardrail_status": state["guardrail_status"],
                "guardrail_reason": state["guardrail_reason"],
            }
        state["graph_state"].record_node(
            node_name="classification.finalize",
            status="completed",
            metadata={"risk_level": payload["risk_level"]},
        )
        return {"result_payload": payload}

    def _node_persist(self, state: ClassificationLangGraphState):
        """Persist the finalized payload when a persister callback is configured."""
        if not self._persister:
            return {}
        self._persister(state["result_payload"], state)
        state["graph_state"].record_node(
            node_name="classification.persist",
            status="completed",
        )
        return {}

    @staticmethod
    def workflow_run_id(message: dict[str, Any], correlationId: str) -> str:
        """Return an explicit workflow ID or derive a stable traceable identifier."""
        explicit = message.get("workflow_run_id")
        if explicit:
            return str(explicit)
        assessment_id = message.get("assessment_id", "unknown-assessment")
        classification_version = message.get("classification_version", "1.0.0")
        return f"classification:{assessment_id}:{classification_version}:{correlationId}"

    @staticmethod
    def _citation_refs(applicable_rules: list[dict[str, Any]]) -> list[str]:
        """Flatten citation chunk identifiers from applicable legal rules."""
        refs: list[str] = []
        for rule in applicable_rules:
            refs.extend(rule.get("citation_chunk_ids", []))
        return refs

    @staticmethod
    def proposal_matches_baseline(
        proposal: dict[str, Any],
        baseline_risk_level: str,
        baseline_applicability_assessment: str,
        usage_claims: list[dict[str, Any]],
    ) -> bool:
        """Enforce that an LLM proposal cannot override deterministic authority.

        Model-provider-only claims are deliberately excluded from model-assisted
        acceptance, and overclaiming rationale also causes rejection.
        """
        if proposal.get("risk_level") != baseline_risk_level:
            return False
        if (
            proposal.get("applicability_assessment")
            != baseline_applicability_assessment
        ):
            return False
        claim_categories = {
            claim.get("claim_category")
            for claim in usage_claims
            if isinstance(claim, dict)
        }
        if claim_categories and claim_categories.issubset({"MODEL_PROVIDER_USAGE"}):
            return False
        rationale = proposal.get("rationale")
        if rationale and check_overclaim(rationale):
            return False
        return True

    @staticmethod
    def _delivery_attempt(message: dict[str, Any]) -> int:
        """Normalize the delivery-attempt header into a non-negative integer."""
        try:
            return max(0, int(message.get("_delivery_attempt", 0)))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _optional_string(value: Any) -> str | None:
        """Convert a present identifier to string while preserving missing values."""
        if value is None or value == "":
            return None
        return str(value)
