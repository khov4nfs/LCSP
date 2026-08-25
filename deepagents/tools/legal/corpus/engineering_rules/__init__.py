"""EngineeringRule corpus lifecycle capabilities."""
from __future__ import annotations

from .registry.cache import EngineeringRuleCache
from .compilation.compiler import COMPILER_VERSION, PROMPT_VERSION, EngineeringRuleCompiler
from .compilation.fingerprint import engineering_rule_fingerprint
from .contract.legal_reasoning_contract import (
    LEGAL_REASONING_CONTRACT_SCHEMA_VERSION,
    LEGAL_REASONING_PLANNER_AUTHORITY,
    LegalReasoningContract,
    LegalReasoningContractValidationError,
    build_legal_reasoning_contract,
    validate_legal_reasoning_contract,
)
from .contract.models import ENGINEERING_RULE_SCHEMA_VERSION, EngineeringRule, GraphQueryTemplate
from .orchestration.service import EngineeringRuleService
from .contract.validator import EngineeringRuleValidationError, validate_engineering_rule

__all__ = [
    "EngineeringRuleCache",
    "EngineeringRuleService",
    "COMPILER_VERSION",
    "PROMPT_VERSION",
    "EngineeringRuleCompiler",
    "engineering_rule_fingerprint",
    "ENGINEERING_RULE_SCHEMA_VERSION",
    "LEGAL_REASONING_CONTRACT_SCHEMA_VERSION",
    "LEGAL_REASONING_PLANNER_AUTHORITY",
    "EngineeringRule",
    "GraphQueryTemplate",
    "LegalReasoningContract",
    "LegalReasoningContractValidationError",
    "build_legal_reasoning_contract",
    "validate_legal_reasoning_contract",
    "EngineeringRuleValidationError",
    "validate_engineering_rule",
]
