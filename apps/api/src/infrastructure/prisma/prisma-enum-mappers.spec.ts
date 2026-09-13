import {
  EngineeringEvidenceClaimType as PrismaEngineeringEvidenceClaimType,
  EngineeringRuleEvaluationStatus as PrismaEngineeringRuleEvaluationStatus,
} from "@prisma/client";
import {
  ENGINEERING_EVIDENCE_CLAIM_TYPES,
  ENGINEERING_RULE_EVALUATION_STATUSES,
} from "@lcsp/contracts/scan";

import {
  fromPrismaEngineeringEvidenceClaimType,
  fromPrismaEngineeringRuleEvaluationStatus,
  toPrismaEngineeringEvidenceClaimType,
  toPrismaEngineeringRuleEvaluationStatus,
} from "./prisma-enum-mappers.js";

describe("engineering Prisma enum mappers", () => {
  it("maps NOT_APPLICABLE EngineeringRule evaluations", () => {
    expect(
      toPrismaEngineeringRuleEvaluationStatus(
        ENGINEERING_RULE_EVALUATION_STATUSES.notApplicable,
      ),
    ).toBe(PrismaEngineeringRuleEvaluationStatus.NOT_APPLICABLE);
    expect(
      fromPrismaEngineeringRuleEvaluationStatus(
        PrismaEngineeringRuleEvaluationStatus.NOT_APPLICABLE,
      ),
    ).toBe(ENGINEERING_RULE_EVALUATION_STATUSES.notApplicable);
  });

  it("maps RULE_SCOPE_NOT_APPLICABLE evidence claims", () => {
    expect(
      toPrismaEngineeringEvidenceClaimType(
        ENGINEERING_EVIDENCE_CLAIM_TYPES.ruleScopeNotApplicable,
      ),
    ).toBe(PrismaEngineeringEvidenceClaimType.RULE_SCOPE_NOT_APPLICABLE);
    expect(
      fromPrismaEngineeringEvidenceClaimType(
        PrismaEngineeringEvidenceClaimType.RULE_SCOPE_NOT_APPLICABLE,
      ),
    ).toBe(ENGINEERING_EVIDENCE_CLAIM_TYPES.ruleScopeNotApplicable);
  });
});
