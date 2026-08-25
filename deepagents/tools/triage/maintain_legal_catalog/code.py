"""Triage-facing bounded tool for proactive legal catalog maintenance."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from langchain.tools import tool

from .service import MaintainLegalCatalogService


class MaintainLegalCatalogInput(BaseModel):
    """Only operational bounds are model supplied; legal source URLs are never accepted."""

    model_config = ConfigDict(extra="forbid")

    max_runs: int = Field(default=500, ge=0, le=500)
    correlation_id: str | None = Field(default=None, max_length=160)


@tool(args_schema=MaintainLegalCatalogInput)
def maintain_legal_catalog(max_runs: int = 500, correlation_id: str | None = None) -> dict:
    """Refresh only approved legal sources and run governed recovery when they changed."""
    return MaintainLegalCatalogService().run(
        max_runs=max_runs,
        correlation_id=correlation_id,
    )
