"""Production middleware must support both native execution modes (sync and async)."""

import pytest
from langchain.agents.middleware import AgentMiddleware

from middleware.runtime_context import inject_lcsp_runtime_context


@pytest.mark.parametrize("middleware,slot", [(inject_lcsp_runtime_context, "model")])
def test_production_middleware_supports_both_execution_modes(middleware, slot):
    assert getattr(type(middleware), f"wrap_{slot}_call") is not getattr(AgentMiddleware, f"wrap_{slot}_call")
    assert getattr(type(middleware), f"awrap_{slot}_call") is not getattr(AgentMiddleware, f"awrap_{slot}_call")
