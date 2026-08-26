import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { CompareWizardClaimQuery } from "../../application/queries/compare-wizard-claim/compare-wizard-claim.query.js";
import {
  parseSingleTargetId,
  parseWizardClaimComparisonScope,
  parseWizardClaimExpectedValue,
  parseWizardClaimField,
  parseWizardClaimMaxEvidenceRefs,
} from "./compare-wizard-claim.request.js";

@Controller("assessments")
export class CompareWizardClaimController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(":assessmentId/wizard-claim-comparison")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async compareWizardClaim(
    @Param("assessmentId") assessmentId: string,
    @Query("wizard_profile_id") wizardProfileId: string,
    @Query("evidence_report_id") evidenceReportId: string,
    @Query("target_id") targetId: string,
    @Query("claim_field") claimFieldRaw: string | undefined,
    @Query("expected_value") expectedValueRaw: string | undefined,
    @Query("comparison_scope") comparisonScopeRaw: string | undefined,
    @Query("max_evidence_refs") maxEvidenceRefsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    const claimField = parseWizardClaimField(claimFieldRaw, correlationId);
    const expectedValue = parseWizardClaimExpectedValue(
      expectedValueRaw,
      claimField,
      correlationId,
    );
    const comparisonScope = parseWizardClaimComparisonScope(
      comparisonScopeRaw,
      correlationId,
    );
    const maxEvidenceRefs = parseWizardClaimMaxEvidenceRefs(
      maxEvidenceRefsRaw,
      correlationId,
    );
    const parsedTargetId = parseSingleTargetId(targetId, correlationId);

    return resultEnvelope(
      await this.queryBus.execute(
        new CompareWizardClaimQuery(
          assessmentId,
          wizardProfileId,
          evidenceReportId,
          parsedTargetId,
          claimField,
          expectedValue,
          comparisonScope,
          maxEvidenceRefs,
          correlationId,
        ),
      ),
    );
  }
}
