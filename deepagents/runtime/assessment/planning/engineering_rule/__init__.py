"""EngineeringRule planning capability runtime."""

# Migration bridge for one historical sibling import in engineering_rule_planner.py.
# InvestigationPacket remains physically owned by assessment/claims/evidence_claim.
import sys

from runtime.assessment.claims.evidence_claim import models as _claim_models

sys.modules[f"{__name__}.models"] = _claim_models
