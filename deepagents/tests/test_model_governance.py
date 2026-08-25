from langchain.agents.middleware import PIIMiddleware

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE


def test_model_governance_redacts_standard_and_lcsp_credentials() -> None:
    pii_middleware = {
        middleware.pii_type: middleware
        for middleware in MODEL_GOVERNANCE_MIDDLEWARE
        if isinstance(middleware, PIIMiddleware)
    }

    assert set(pii_middleware) == {
        "email",
        "credit_card",
        "github_token",
        "bearer_token",
        "aws_access_key",
        "anthropic_key",
        "credential_assignment",
    }
    assert all(
        middleware.apply_to_output and middleware.apply_to_tool_results
        for middleware in pii_middleware.values()
    )
