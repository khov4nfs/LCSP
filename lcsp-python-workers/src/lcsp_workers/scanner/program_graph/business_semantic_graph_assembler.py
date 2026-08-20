"""Decorator that persists provenance-gated business semantics in scan graph v3."""
from __future__ import annotations

from lcsp_workers.llm.fallback_client import LLMClientProtocol

from .assembler import ProgramGraphAssembler
from .business_semantic_cluster_policy import DiverseBusinessSemanticEnricher
from .business_semantic_enrichment import BusinessSemanticEnricher


class BusinessSemanticProgramGraphAssembler:
    """Build deterministic graph first, then enrich that immutable value semantically."""

    def __init__(
        self,
        llm_client: LLMClientProtocol,
        *,
        base_assembler: ProgramGraphAssembler | None = None,
        enricher: BusinessSemanticEnricher | None = None,
    ) -> None:
        self._base = base_assembler or ProgramGraphAssembler()
        self._enricher = enricher or DiverseBusinessSemanticEnricher(llm_client)

    def assemble(self, **kwargs):
        graph = self._base.assemble(**kwargs)
        scan_job_id = str(kwargs.get("scan_job_id") or "unknown")
        return self._enricher.enrich(
            graph,
            workflow_run_id=f"scan-business-semantics:{scan_job_id}",
        )
