import pytest
from tools.graph.scanner.analyzers.finding_types import (
    AUTOMATED_DECISION_SIGNAL,
    HUMAN_REVIEW_SIGNAL,
    HUMAN_OVERSIGHT_CONTROL_SIGNAL,
    AI_INTERACTION_DISCLOSURE_SIGNAL,
    INCIDENT_HANDLING_SIGNAL,
    UNSUPPORTED_DYNAMIC_FLOW
)
from tools.graph.scanner.analyzers.decision_flow_tracer import DecisionFlowTracer

def get_signal(traces, finding_type):
    for t in traces:
        if t.finding_type == finding_type:
            return t
    return None

def test_t01_automated_decision():
    """T01: score = model.predict(X); if score > 0.8: db.update(status='approved')"""
    tracer = DecisionFlowTracer()
    code = "score = model.predict(X)\nif score > 0.8:\n    db.update(status='approved')"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, AUTOMATED_DECISION_SIGNAL) is not None
    assert get_signal(traces, HUMAN_REVIEW_SIGNAL) is None

def test_t02_human_review_prevents_automated():
    """T02: Same as T01 + require_human_approval()"""
    tracer = DecisionFlowTracer()
    code = "score = model.predict(X)\nrequire_human_approval(score)\nif score > 0.8:\n    db.update(status='approved')"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, HUMAN_REVIEW_SIGNAL) is not None
    assert get_signal(traces, AUTOMATED_DECISION_SIGNAL) is None

def test_t03_no_state_change():
    """T03: AI call with output going into log only"""
    tracer = DecisionFlowTracer()
    code = "score = model.predict(X)\nlogger.info(score)"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, AUTOMATED_DECISION_SIGNAL) is None
    assert get_signal(traces, HUMAN_REVIEW_SIGNAL) is None

def test_t04_agent_executor():
    """T04: AgentExecutor with tools"""
    tracer = DecisionFlowTracer()
    code = "AgentExecutor(agent=agent, tools=[send_email_tool])"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, AUTOMATED_DECISION_SIGNAL) is not None
    assert get_signal(traces, HUMAN_REVIEW_SIGNAL) is None

def test_t05_dynamic_flow():
    """T05: Flow: AI output -> event bus (dynamic)"""
    tracer = DecisionFlowTracer()
    code = "event_bus.publish(model.predict(X))"
    traces = tracer.trace(code, "ai_123", "app.py", is_dynamic=True)
    
    assert get_signal(traces, UNSUPPORTED_DYNAMIC_FLOW) is not None
    assert get_signal(traces, AUTOMATED_DECISION_SIGNAL) is None

def test_t06_human_review_no_ai_call_visible():
    """T06: require_human_approval(result) with no AI call site visible"""
    tracer = DecisionFlowTracer()
    code = "require_human_approval(result)"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, HUMAN_REVIEW_SIGNAL) is not None

def test_t07_no_ai_call():
    """T07: No AI call in module -> No decision signals emitted"""
    # Test implicitly handled as tracer only called when AI finding exists
    # but tracer logic shouldn't falsely trigger
    tracer = DecisionFlowTracer()
    code = "x = 1"
    traces = tracer.trace(code, "ai_123", "app.py")
    assert get_signal(traces, AUTOMATED_DECISION_SIGNAL) is None
    assert get_signal(traces, HUMAN_REVIEW_SIGNAL) is None

def test_t08_evidence_patterns_no_source():
    """T08: evidence_patterns field contains pattern rule IDs only"""
    tracer = DecisionFlowTracer()
    code = "require_human_approval(result)"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    sig = get_signal(traces, HUMAN_REVIEW_SIGNAL)
    assert sig.evidence_patterns == ["py-human-review-function"]
    assert "require_human_approval" not in sig.evidence_patterns

def test_t09_l3_cross_module():
    """T09: L3 cross-module (apply_decision)"""
    tracer = DecisionFlowTracer()
    code = "result = model.predict(X)\napply_decision(result)"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    sig = get_signal(traces, AUTOMATED_DECISION_SIGNAL)
    assert sig is not None
    assert sig.analysis_level == "L3"

def test_t10_approved_by():
    """T10: approved_by = reviewer_id"""
    tracer = DecisionFlowTracer()
    code = "approved_by = reviewer_id"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, HUMAN_REVIEW_SIGNAL) is not None

def test_t11_oversight_control():
    """T11: kill_switch.is_paused() -> HUMAN_OVERSIGHT_CONTROL_SIGNAL"""
    tracer = DecisionFlowTracer()
    code = "if kill_switch.is_paused(): return\nmodel.predict()"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, HUMAN_OVERSIGHT_CONTROL_SIGNAL) is not None

def test_t12_no_oversight_control():
    """T12: No override/kill-switch found -> ABSENT (not emitted)"""
    tracer = DecisionFlowTracer()
    code = "model.predict()"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, HUMAN_OVERSIGHT_CONTROL_SIGNAL) is None

def test_t13_interaction_disclosure():
    """T13: Chat route rendering ai_disclosure"""
    tracer = DecisionFlowTracer()
    code = "render(ai_disclosure)"
    traces = tracer.trace(code, "ai_123", "app.py", has_interaction_surface=True)
    
    assert get_signal(traces, AI_INTERACTION_DISCLOSURE_SIGNAL) is not None

def test_t14_disclosure_not_applicable():
    """T14: Backend-only AI usage -> AI_INTERACTION_DISCLOSURE_SIGNAL not emitted"""
    tracer = DecisionFlowTracer()
    code = "render(ai_disclosure)"
    traces = tracer.trace(code, "ai_123", "app.py", has_interaction_surface=False)
    
    assert get_signal(traces, AI_INTERACTION_DISCLOSURE_SIGNAL) is None

def test_t15_incident_handling():
    """T15: try: ... except Exception as e: sentry.capture_exception(e)"""
    tracer = DecisionFlowTracer()
    code = "try:\n    model.predict()\nexcept Exception as e:\n    sentry.capture_exception(e)"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, INCIDENT_HANDLING_SIGNAL) is not None

def test_t16_incident_handling_pass():
    """T16: try: ... except: pass"""
    tracer = DecisionFlowTracer()
    code = "try:\n    model.predict()\nexcept Exception:\n    pass"
    traces = tracer.trace(code, "ai_123", "app.py")
    
    assert get_signal(traces, INCIDENT_HANDLING_SIGNAL) is None
