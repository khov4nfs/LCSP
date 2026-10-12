"""Validate model inputs separately from LangGraph-injected runtime objects."""
from __future__ import annotations
from typing import Any
from langchain.tools import ToolRuntime
from pydantic import BaseModel, model_validator

class RuntimeInjectedInput(BaseModel):
    """Validate model data separately from LangGraph's injected runtime.

    LangChain validates explicit args_schema before reattaching injected arguments.
    Only an actual ToolRuntime is removed here; model-authored dictionaries remain
    forbidden extra fields. The original runtime is forwarded by StructuredTool.
    """

    @model_validator(mode="before")
    @classmethod
    def separate_injected_runtime(cls, value: Any) -> Any:
        if isinstance(value, dict) and isinstance(value.get("runtime"), ToolRuntime):
            return {key: item for key, item in value.items() if key != "runtime"}
        return value
