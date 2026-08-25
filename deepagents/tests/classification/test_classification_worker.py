from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langchain.messages import AIMessage
from tools.common.capabilities.assessment.evaluation.classification.risk_tier_calculator import calculate_risk_tier
from tools.common.capabilities.assessment.evaluation.classification.citation_guardrail import check_citations
from tools.common.capabilities.assessment.evaluation.classification.classification_graph import ClassificationGraph
from tools.common.capabilities.assessment.evaluation.classification.overclaim_detector import check_overclaim
from tools.common.capabilities.assessment.evaluation.classification.rationale_narrator import RationaleNarrator


def _agent_result(*, structured_response=None, content: str = ""):
    result = {"messages": [AIMessage(content=content)]}
    if structured_response is not None:
        result["structured_response"] = structured_response
    return SimpleNamespace(invoke=MagicMock(return_value=result))

def test_t01_valid_match_and_citations():
    """T01: Valid match + valid citations"""
    status, reason = check_citations(["ref1"], ["ref1"])
    assert status == "passed"
    
    risk, app, cov = calculate_risk_tier([{"confidence": 0.9, "coverage_status": "COMPLETE_CITATION"}])
    assert risk == "HIGH"
    assert cov == "COMPLETE_CITATION"

def test_t02_missing_some_citations():
    """T02: Missing some citations -> degraded"""
    status, reason = check_citations(["ref1", "ref2"], ["ref1"])
    assert status == "degraded"

def test_t03_no_valid_citations():
    """T03: No valid citations -> blocked"""
    status, reason = check_citations(["ref3"], ["ref1"])
    assert status == "blocked"
    
    # Or empty refs
    status2, reason2 = check_citations([], ["ref1"])
    assert status2 == "blocked"

def test_t04_rationale_overclaim():
    """T04: Rationale contains overclaiming word -> blocked"""
    assert check_overclaim("This product is fully certified and legally approved.") == True
    assert check_overclaim("This assessment shows a high risk level.") == False

def test_t08_rationale_contradicts():
    """T08: Rationale draft contradicts decision -> rejected"""
    with patch(
        "tools.common.capabilities.assessment.evaluation.classification.rationale_narrator.create_agent",
        return_value=_agent_result(content="The risk is definitely LOW."),
    ):
        rationale = RationaleNarrator().generate_rationale(
            [], [], "HIGH", "applicable", "wf-123", "classification.rationale_narrator"
        )
    # Because it mentions LOW but risk_level is HIGH
    assert rationale is None

def test_t09_no_llm_for_risk_tier():
    """T09: risk_level computed without LLM"""
    # Simply calling calculate_risk_tier doesn't require any LLM client instance
    risk, _, _ = calculate_risk_tier([{"confidence": 0.6, "coverage_status": "COMPLETE_CITATION"}])
    assert risk == "MEDIUM"

from tools.common.capabilities.assessment.evaluation.classification.classification_boundary import ClassificationBoundary

def test_t05_classification_not_started_when_blocked():
    """T05: LegalRuleMatch.guardrailStatus = blocked -> Classification not started"""
    boundary = ClassificationBoundary(config=MagicMock())
    
    with patch.object(boundary, '_submit_callback') as mock_submit:
        # Provide refs not in allowlist to trigger "blocked"
        message = {
            "applicable_rules": [{"citation_chunk_ids": ["ref1"]}],
            "citation_allowlist": ["ref2"] 
        }
        boundary.handle(message, "test-corr-id")
        
        mock_submit.assert_called_once()
        payload = mock_submit.call_args[0][0]
        assert payload["guardrail_status"] == "blocked"
        assert payload["risk_level"] == "BLOCKED"

def test_t06_agent_failure_omits_optional_rationale():
    """T06: Native agent failure does not block deterministic classification."""
    class AgentFailure(Exception):
        pass
        
    with patch(
        "tools.common.capabilities.assessment.evaluation.classification.rationale_narrator.create_agent",
        side_effect=AgentFailure("model call failed"),
    ):
        rationale = RationaleNarrator().generate_rationale(
            [], [], "HIGH", "applicable", "wf-123", "classification.rationale_narrator"
        )
    
    # Narrator should catch exception and return None
    assert rationale is None

def test_t07_budget_exceeded():
    """T07: Budget exceeded -> BudgetExceeded raised; risk_level valid, rationale omitted"""
    class BudgetExceeded(Exception):
        pass
        
    boundary = ClassificationBoundary(config=MagicMock())
    
    with patch.object(boundary, '_submit_callback') as mock_submit:
        message = {
            "applicable_rules": [{"confidence": 0.9, "coverage_status": "COMPLETE_CITATION"}]
        }
        
        # Mock check_citations so it passes and allows the flow to reach the LLM part
        with (
            patch('tools.common.capabilities.assessment.evaluation.classification.classification_graph.check_citations', return_value=("passed", "")),
            patch(
                "tools.common.capabilities.assessment.evaluation.classification.classification_proposer.create_agent",
                side_effect=BudgetExceeded("Monthly cap reached"),
            ),
            patch(
                "tools.common.capabilities.assessment.evaluation.classification.rationale_narrator.create_agent",
                side_effect=BudgetExceeded("Monthly cap reached"),
            ),
        ):
            boundary.handle(message, "test-corr-id")
            
            mock_submit.assert_called_once()
            payload = mock_submit.call_args[0][0]
            
            # Risk level must still be calculated
            assert payload["risk_level"] == "HIGH"
            # Rationale must be gracefully omitted
            assert payload["rationale"] is None

def test_t10_consumer_derives_workflow_context_for_proposal_node():
    agent = _agent_result(structured_response={
        "risk_level": "HIGH",
        "applicability_assessment": "applicable",
        "rationale": "The risk is HIGH based on the verified evidence.",
    })

    boundary = ClassificationBoundary(config=MagicMock())

    with (
        patch.object(boundary, "_submit_callback") as mock_submit,
        patch("tools.common.capabilities.assessment.evaluation.classification.classification_graph.check_citations", return_value=("passed", "")),
        patch(
            "tools.common.capabilities.assessment.evaluation.classification.classification_proposer.create_agent",
            return_value=agent,
        ),
    ):
            boundary.handle(
                {
                    "assessment_id": "asmt-1",
                    "classification_version": "2.0",
                    "applicable_rules": [{"confidence": 0.9, "coverage_status": "COMPLETE_CITATION"}],
                },
                "corr-123",
            )

    kwargs = agent.invoke.call_args.kwargs["config"]
    assert kwargs["metadata"]["workflow_run_id"] == "classification:asmt-1:2.0:corr-123"
    assert kwargs["metadata"]["node_name"] == "classification.proposal"
    assert kwargs["metadata"]["correlationId"] == "corr-123"
    assert mock_submit.called

def test_t11_consumer_rejects_mismatched_model_assisted_proposal():
    proposal_agent = _agent_result(structured_response={
        "risk_level": "LOW",
        "applicability_assessment": "not_applicable",
        "rationale": "The risk is LOW.",
    })
    narrator_agent = _agent_result(
        content="This assessment remains high risk based on the verified evidence."
    )

    boundary = ClassificationBoundary(config=MagicMock())

    with (
        patch.object(boundary, "_submit_callback") as mock_submit,
        patch("tools.common.capabilities.assessment.evaluation.classification.classification_graph.check_citations", return_value=("passed", "")),
        patch("tools.common.capabilities.assessment.evaluation.classification.classification_proposer.create_agent", return_value=proposal_agent),
        patch("tools.common.capabilities.assessment.evaluation.classification.rationale_narrator.create_agent", return_value=narrator_agent),
    ):
            boundary.handle(
                {
                    "assessment_id": "asmt-2",
                    "classification_version": "2.0",
                    "applicable_rules": [{"confidence": 0.9, "coverage_status": "COMPLETE_CITATION"}],
                },
                "corr-456",
            )

    payload = mock_submit.call_args[0][0]
    assert payload["risk_level"] == "HIGH"
    assert payload["applicability_assessment"] == "applicable"
    assert payload["rationale"] == "This assessment remains high risk based on the verified evidence."

def test_t12_consumer_accepts_matching_model_assisted_proposal():
    proposal_agent = _agent_result(structured_response={
        "risk_level": "HIGH",
        "applicability_assessment": "applicable",
        "rationale": "This assessment is high risk based on the cited evidence.",
    })

    boundary = ClassificationBoundary(config=MagicMock())

    with (
        patch.object(boundary, "_submit_callback") as mock_submit,
        patch("tools.common.capabilities.assessment.evaluation.classification.classification_graph.check_citations", return_value=("passed", "")),
        patch("tools.common.capabilities.assessment.evaluation.classification.classification_proposer.create_agent", return_value=proposal_agent),
    ):
            boundary.handle(
                {
                    "assessment_id": "asmt-3",
                    "classification_version": "2.0",
                    "applicable_rules": [{"confidence": 0.9, "coverage_status": "COMPLETE_CITATION"}],
                    "usage_claims": [{"claim_category": "MODEL_INVOCATION"}],
                },
                "corr-789",
            )

    payload = mock_submit.call_args[0][0]
    assert payload["risk_level"] == "HIGH"
    assert payload["applicability_assessment"] == "applicable"
    assert payload["rationale"] == "This assessment is high risk based on the cited evidence."

def test_t13_classification_graph_blocks_without_valid_citations():
    graph = ClassificationGraph()
    result = graph.run(
        message={
            "classification_version": "1.0",
            "usage_claims": [],
            "applicable_rules": [{"citation_chunk_ids": ["ref1"]}],
            "citation_allowlist": ["ref2"],
        },
        correlationId="corr-999",
    )

    assert result.payload["risk_level"] == "BLOCKED"
    assert result.payload["guardrail_status"] == "blocked"
    assert result.workflow_run_id == "classification:unknown-assessment:1.0:corr-999"
    assert result.state.graph_name == "classification"
    assert result.state.node_results[0].node_name == "classification.citation_guardrail"
