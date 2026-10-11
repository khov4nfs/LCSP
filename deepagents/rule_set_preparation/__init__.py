"""Rule Set Preparation: the single agent that authors a complete compliance rule set.

One Deep Agent reads one pinned immutable corpus and authors both LegalRequirement and
AssessmentRule layers. Deterministic code only validates identity, hashes,
citations, provenance, shape and completeness; it never judges legal meaning.
"""

from rule_set_preparation.agent import create_rule_set_preparation_agent
from rule_set_preparation.runner import run_rule_set_preparation

__all__ = ["create_rule_set_preparation_agent", "run_rule_set_preparation"]
