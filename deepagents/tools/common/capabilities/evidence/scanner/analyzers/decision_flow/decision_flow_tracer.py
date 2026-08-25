import uuid
from dataclasses import dataclass
from typing import List, Optional

from tools.common.capabilities.evidence.scanner.analyzers.findings.finding_types import (
    AUTOMATED_DECISION_SIGNAL,
    HUMAN_REVIEW_SIGNAL,
    HUMAN_OVERSIGHT_CONTROL_SIGNAL,
    AI_INTERACTION_DISCLOSURE_SIGNAL,
    INCIDENT_HANDLING_SIGNAL,
    UNSUPPORTED_DYNAMIC_FLOW
)
from tools.common.capabilities.evidence.scanner.analyzers.human_review.human_review_detector import HumanReviewDetector

@dataclass
class DecisionFlowTrace:
    finding_id: str
    finding_type: str
    file_path: str
    line_number: int
    matched_rule_id: str
    analysis_level: str
    ai_output_source_finding_id: str
    evidence_patterns: list[str]
    has_human_review_in_scope: bool
    confidence: float

@dataclass
class ControlFlowSignalTrace:
    finding_id: str
    finding_type: str
    file_path: str
    line_number: int
    matched_rule_id: str
    analysis_level: str
    ai_output_source_finding_id: str
    evidence_patterns: list[str]
    path_resolved: bool
    confidence: float

class DecisionFlowTracer:
    def __init__(self):
        self.hr_detector = HumanReviewDetector()

    def trace(
        self, 
        source_code: str, 
        ai_finding_id: str, 
        file_path: str, 
        ai_call_line: int = -1,
        is_dynamic: bool = False,
        has_interaction_surface: bool = False
    ):
        traces = []
        
        # 1. Detect dynamic flow first
        if is_dynamic:
            traces.append(
                DecisionFlowTrace(
                    finding_id=str(uuid.uuid4()),
                    finding_type=UNSUPPORTED_DYNAMIC_FLOW,
                    file_path=file_path,
                    line_number=ai_call_line,
                    matched_rule_id="unsupported-dynamic",
                    analysis_level="L4",
                    ai_output_source_finding_id=ai_finding_id,
                    evidence_patterns=[],
                    has_human_review_in_scope=False,
                    confidence=1.0
                )
            )
            return traces

        # 2. Extract Human Review, Oversight, Disclosure, Incident Handling signals
        detected_signals = self.hr_detector.detect_signals(source_code, ai_call_line, has_interaction_surface)
        
        has_human_review = any(s.finding_type == HUMAN_REVIEW_SIGNAL for s in detected_signals)
        
        for sig in detected_signals:
            if sig.finding_type == HUMAN_REVIEW_SIGNAL:
                traces.append(DecisionFlowTrace(
                    finding_id=str(uuid.uuid4()),
                    finding_type=HUMAN_REVIEW_SIGNAL,
                    file_path=file_path,
                    line_number=ai_call_line,
                    matched_rule_id=sig.matched_rule_id,
                    analysis_level="L2",
                    ai_output_source_finding_id=ai_finding_id,
                    evidence_patterns=[sig.matched_rule_id],
                    has_human_review_in_scope=True,
                    confidence=sig.confidence
                ))
            else:
                traces.append(ControlFlowSignalTrace(
                    finding_id=str(uuid.uuid4()),
                    finding_type=sig.finding_type,
                    file_path=file_path,
                    line_number=ai_call_line,
                    matched_rule_id=sig.matched_rule_id,
                    analysis_level="L2",
                    ai_output_source_finding_id=ai_finding_id,
                    evidence_patterns=[sig.matched_rule_id],
                    path_resolved=True,
                    confidence=sig.confidence
                ))

        # 3. Detect Automated Decision
        is_automated_decision = False
        matched_rule = ""
        base_conf = 0.0
        
        # Detect patterns
        if "tools=" in source_code or "AgentExecutor" in source_code:
            is_automated_decision = True
            matched_rule = "py-auto-decision-agent-tool"
            base_conf = 0.70
        elif "if " in source_code and ("db.update" in source_code or ".save" in source_code):
            is_automated_decision = True
            matched_rule = "py-auto-decision-score-branch"
            base_conf = 0.65
        elif "apply_decision" in source_code:
            is_automated_decision = True
            matched_rule = "py-auto-decision-direct-assign"
            base_conf = 0.60
            
        if is_automated_decision and not has_human_review:
            traces.append(DecisionFlowTrace(
                finding_id=str(uuid.uuid4()),
                finding_type=AUTOMATED_DECISION_SIGNAL,
                file_path=file_path,
                line_number=ai_call_line,
                matched_rule_id=matched_rule,
                analysis_level="L2" if "apply_decision" not in source_code else "L3",
                ai_output_source_finding_id=ai_finding_id,
                evidence_patterns=[matched_rule],
                has_human_review_in_scope=False,
                confidence=base_conf
            ))
            
        return traces
