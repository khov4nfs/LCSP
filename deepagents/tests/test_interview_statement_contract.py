import pytest
from pydantic import ValidationError
from contracts.handoffs import InterviewResult


@pytest.mark.parametrize("context", [ {}, {"purpose": "internal assistant"},
    {"statements": [{"topic": "purpose", "statement": "internal assistant"}]},
    {"statements": [{"statementId": " ", "topic": "purpose", "statement": "internal assistant"}]},
])
def test_confirmed_output_rejects_api_invalid_statement_shapes(context):
    with pytest.raises(ValidationError):
        InterviewResult(expectedContextRevision=1, outcome="CONTEXT_READY",
                        contextAuthority="CUSTOMER_CONFIRMED", confirmedContext=context)


def test_confirmed_candidate_has_required_semantic_fields_without_runtime_provenance():
    candidate = InterviewResult(expectedContextRevision=1, outcome="CONTEXT_READY",
        contextAuthority="CUSTOMER_CONFIRMED", confirmedContext={"statements": [
            {"statementId": "purpose-1", "topic": "purpose", "statement": "Internal assistant"}
        ]})
    statement = candidate.model_dump()["confirmedContext"]["statements"][0]
    assert statement["statementId"] == "purpose-1"
    assert "respondentRef" not in statement
    assert "resolutionState" not in statement
