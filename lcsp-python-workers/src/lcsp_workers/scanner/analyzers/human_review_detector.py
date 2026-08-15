import ast
from dataclasses import dataclass
from typing import List

from lcsp_workers.scanner.analyzers.finding_types import (
    HUMAN_REVIEW_SIGNAL,
    HUMAN_OVERSIGHT_CONTROL_SIGNAL,
    AI_INTERACTION_DISCLOSURE_SIGNAL,
    INCIDENT_HANDLING_SIGNAL
)
from lcsp_workers.scanner.analyzers.decision_patterns import (
    HUMAN_REVIEW_PATTERNS_PY,
    HUMAN_OVERSIGHT_CONTROL_PATTERNS_PY,
    AI_INTERACTION_DISCLOSURE_PATTERNS_PY,
    INCIDENT_HANDLING_PATTERNS_PY
)


@dataclass
class DetectedSignal:
    """Normalized governance-control signal detected in application source."""

    finding_type: str
    matched_rule_id: str
    confidence: float


class HumanReviewDetector:
    """Detect human-oversight, disclosure, and incident-handling controls in Python.

    Text rules provide broad recall for explicit controls, while AST inspection adds
    structural evidence for exception-handling/reporting patterns. Parse failures are
    intentionally non-fatal because this detector supplements the broader scanner.
    """

    def __init__(self):
        """Load the scanner-spec rule groups used by this detector."""
        self.review_patterns = HUMAN_REVIEW_PATTERNS_PY
        self.oversight_patterns = HUMAN_OVERSIGHT_CONTROL_PATTERNS_PY
        self.disclosure_patterns = AI_INTERACTION_DISCLOSURE_PATTERNS_PY
        self.incident_patterns = INCIDENT_HANDLING_PATTERNS_PY

    def detect_signals(self, source_code: str, ai_call_line: int = -1, has_interaction_surface: bool = False) -> List[DetectedSignal]:
        """Detect governance controls without persisting the inspected source body.

        Args:
            source_code: In-memory Python source inspected for control patterns.
            ai_call_line: Reserved AI-call location context for detector composition.
            has_interaction_surface: Whether disclosure rules are relevant to this file.

        Returns:
            At most the first matching signal per supported control category.
        """
        signals = []
        
        # Simple text-based pattern matching as fallback / complement
        for rule in self.review_patterns:
            if any(p in source_code for p in rule.get("patterns", [])):
                signals.append(DetectedSignal(HUMAN_REVIEW_SIGNAL, rule["rule_id"], rule["base_confidence"]))
                break
                
        for rule in self.oversight_patterns:
            if any(p in source_code for p in rule.get("patterns", [])):
                signals.append(DetectedSignal(HUMAN_OVERSIGHT_CONTROL_SIGNAL, rule["rule_id"], rule["base_confidence"]))
                break
                
        if has_interaction_surface:
            for rule in self.disclosure_patterns:
                if any(p in source_code for p in rule.get("patterns", [])):
                    signals.append(DetectedSignal(AI_INTERACTION_DISCLOSURE_SIGNAL, rule["rule_id"], rule["base_confidence"]))
                    break
        
        # AST-based detection for Incident Handling (try/except wrapping)
        try:
            tree = ast.parse(source_code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Try):
                    # Check if except block has reporting
                    has_reporting = False
                    for handler in node.handlers:
                        handler_src = ast.unparse(handler) if hasattr(ast, 'unparse') else ""
                        if not handler_src:
                            # fallback if unparse not available
                            handler_src = source_code
                            
                        # Check against incident patterns
                        for rule in self.incident_patterns:
                            if "ast_pattern" in rule:
                                expected_calls = rule["ast_pattern"].get("except_body_contains", [])
                                if any(call in handler_src for call in expected_calls):
                                    has_reporting = True
                                    signals.append(DetectedSignal(INCIDENT_HANDLING_SIGNAL, rule["rule_id"], rule["base_confidence"]))
                                    break
                    
                    if has_reporting:
                        break # Found one
        except Exception:
            pass # Ignore parse errors
            
        return signals
