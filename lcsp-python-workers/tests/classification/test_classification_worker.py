import pytest
from unittest.mock import MagicMock
from lcsp_workers.classification.risk_tier_calculator import calculate_risk_tier
from lcsp_workers.classification.citation_guardrail import check_citations
from lcsp_workers.classification.classification_graph import ClassificationGraph
from lcsp_workers.classification.overclaim_detector import check_overclaim
from lcsp_workers.classification.rationale_narrator import RationaleNarrator

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
    mock_llm = MagicMock()
    mock_response = MagicMock()
    mock_response.content = "The risk is definitely LOW."
    mock_llm.complete.return_value = mock_response
    
    narrator = RationaleNarrator(mock_llm)
    rationale = narrator.generate_rationale(
        [], [], "HIGH", "applicable", "wf-123", "classification.rationale_narrator"
    )
    # Because it mentions LOW but risk_level is HIGH
    assert rationale is None

def test_t09_no_llm_for_risk_tier():
    """T09: risk_level computed without LLM"""
    # Simply calling calculate_risk_tier doesn't require any LLM client instance
    risk, _, _ = calculate_risk_tier([{"confidence": 0.6, "coverage_status": "COMPLETE_CITATION"}])
    assert risk == "MEDIUM"

from unittest.mock import patch
from lcsp_workers.classification.classification_consumer import ClassificationConsumer

def test_t05_classification_not_started_when_blocked():
    """T05: LegalRuleMatch.guardrailStatus = blocked -> Classification not started"""
    consumer = ClassificationConsumer(config=MagicMock(), llm_client=None)
    
    with patch.object(consumer, '_submit_callback') as mock_submit:
        # Provide refs not in allowlist to trigger "blocked"
        message = {
            "applicable_rules": [{"citation_chunk_ids": ["ref1"]}],
            "citation_allowlist": ["ref2"] 
        }
        consumer.handle(message, "test-corr-id")
        
        mock_submit.assert_called_once()
        payload = mock_submit.call_args[0][0]
        assert payload["guardrail_status"] == "blocked"
        assert payload["risk_level"] == "BLOCKED"

def test_t06_raw_source_in_llm_prompt():
    """T06: Raw source in LLM prompt -> PromptSafetyViolation raised"""
    class PromptSafetyViolation(Exception):
        pass
        
    mock_llm = MagicMock()
    mock_llm.complete.side_effect = PromptSafetyViolation("Raw source detected")
    
    narrator = RationaleNarrator(mock_llm)
    rationale = narrator.generate_rationale(
        [], [], "HIGH", "applicable", "wf-123", "classification.rationale_narrator"
    )
    
    # Narrator should catch exception and return None
    assert rationale is None

def test_t07_budget_exceeded():
    """T07: Budget exceeded -> BudgetExceeded raised; risk_level valid, rationale omitted"""
    class BudgetExceeded(Exception):
        pass
        
    mock_llm = MagicMock()
    mock_llm.complete.side_effect = BudgetExceeded("Monthly cap reached")
    
    consumer = ClassificationConsumer(config=MagicMock(), llm_client=mock_llm)
    
    with patch.object(consumer, '_submit_callback') as mock_submit:
        message = {
            "applicable_rules": [{"confidence": 0.9, "coverage_status": "COMPLETE_CITATION"}]
        }
        
        # Mock check_citations so it passes and allows the flow to reach the LLM part
        with patch('lcsp_workers.classification.classification_graph.check_citations', return_value=("passed", "")):
            consumer.handle(message, "test-corr-id")
            
            mock_submit.assert_called_once()
            payload = mock_submit.call_args[0][0]
            
            # Risk level must still be calculated
            assert payload["risk_level"] == "HIGH"
            # Rationale must be gracefully omitted
            assert payload["rationale"] is None

def test_t10_consumer_derives_workflow_context_for_rationale_node():
    mock_llm = MagicMock()
    mock_response = MagicMock()
    mock_response.content = '{"risk_level":"HIGH","applicability_assessment":"applicable","rationale":"The risk is HIGH based on the verified evidence."}'
    mock_llm.complete.return_value = mock_response

    consumer = ClassificationConsumer(config=MagicMock(), llm_client=mock_llm)

    with patch.object(consumer, "_submit_callback") as mock_submit:
        with patch("lcsp_workers.classification.classification_graph.check_citations", return_value=("passed", "")):
            consumer.handle(
                {
                    "assessment_id": "asmt-1",
                    "classification_version": "2.0",
                    "applicable_rules": [{"confidence": 0.9, "coverage_status": "COMPLETE_CITATION"}],
                },
                "corr-123",
            )

    mock_llm.complete.assert_called_once()
    kwargs = mock_llm.complete.call_args.kwargs
    assert kwargs["workflow_run_id"] == "classification:asmt-1:2.0:corr-123"
    assert kwargs["node_name"] == "classification.proposal"
    assert kwargs["correlationId"] == "corr-123"
    assert mock_submit.called

def test_t11_consumer_rejects_mismatched_model_assisted_proposal():
    mock_llm = MagicMock()
    proposal_response = MagicMock()
    proposal_response.content = '{"risk_level":"LOW","applicability_assessment":"not_applicable","rationale":"The risk is LOW."}'
    fallback_response = MagicMock()
    fallback_response.content = "This assessment remains high risk based on the verified evidence."
    mock_llm.complete.side_effect = [proposal_response, fallback_response]

    consumer = ClassificationConsumer(config=MagicMock(), llm_client=mock_llm)

    with patch.object(consumer, "_submit_callback") as mock_submit:
        with patch("lcsp_workers.classification.classification_graph.check_citations", return_value=("passed", "")):
            consumer.handle(
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
    mock_llm = MagicMock()
    proposal_response = MagicMock()
    proposal_response.content = '{"risk_level":"HIGH","applicability_assessment":"applicable","rationale":"This assessment is high risk based on the cited evidence."}'
    mock_llm.complete.return_value = proposal_response

    consumer = ClassificationConsumer(config=MagicMock(), llm_client=mock_llm)

    with patch.object(consumer, "_submit_callback") as mock_submit:
        with patch("lcsp_workers.classification.classification_graph.check_citations", return_value=("passed", "")):
            consumer.handle(
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
