"""EngineeringRule investigation capability runtime."""

# Migration bridge for one historical sibling import in pipeline.py. The
# evaluator remains physically owned by assessment/evaluation/engineering_rule.
import sys

from runtime.assessment.evaluation.engineering_rule import rule_evaluator as _rule_evaluator

sys.modules[f"{__name__}.rule_evaluator"] = _rule_evaluator
