"""Invocation tool input schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LcspInvocationRequest(BaseModel):
    """Input for invoking one managed invocation boundary as an agent boundary."""

    model_config = ConfigDict(extra="forbid")

    boundary_name: str = Field(description="Managed invocation boundary name.")
    message: dict[str, Any] = Field(description="Boundary-compatible message body.")
    correlation_id: str = Field(description="Correlation ID for the invocation.")
