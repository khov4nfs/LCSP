"""EngineeringRule contract models (the portfolio is authored by the Legal Preparation agent)."""
from __future__ import annotations

from .contract.legal_reasoning_contract import (
    LEGAL_REASONING_CONTRACT_SCHEMA_VERSION,
    LEGAL_REASONING_PLANNER_AUTHORITY,
    LegalReasoningContract,
    LegalReasoningContractValidationError,
    build_legal_reasoning_contract,
    validate_legal_reasoning_contract,
)
from .contract.models import ENGINEERING_RULE_SCHEMA_VERSION, EngineeringRule, GraphQueryTemplate
from .contract.validator import EngineeringRuleValidationError, validate_engineering_rule

__all__ = [
    "ENGINEERING_RULE_SCHEMA_VERSION",
    "LEGAL_REASONING_CONTRACT_SCHEMA_VERSION",
    "LEGAL_REASONING_PLANNER_AUTHORITY",
    "EngineeringRule",
    "GraphQueryTemplate",
    "LegalReasoningContract",
    "LegalReasoningContractValidationError",
    "EngineeringRuleValidationError",
    "build_legal_reasoning_contract",
    "validate_engineering_rule",
    "validate_legal_reasoning_contract",
]
