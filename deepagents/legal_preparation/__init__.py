"""Legal Preparation: the single agent that authors a complete legal portfolio.

One Deep Agent reads one pinned immutable corpus and authors both LegalRule and
EngineeringRule layers. Deterministic code only validates identity, hashes,
citations, provenance, shape and completeness; it never judges legal meaning.
"""

from legal_preparation.agent import create_legal_preparation_agent
from legal_preparation.runner import run_legal_preparation

__all__ = ["create_legal_preparation_agent", "run_legal_preparation"]
