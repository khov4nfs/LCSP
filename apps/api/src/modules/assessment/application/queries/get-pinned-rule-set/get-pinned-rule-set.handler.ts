import type { ComplianceRuleSetReadModel } from "@lcsp/contracts/compliance-rule-set";
import { type IQueryHandler, QueryBus, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetComplianceRuleSetVersionQuery } from "../../../../compliance-rule-set/application/queries/get-compliance-rule-set-version/get-compliance-rule-set-version.query.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetPinnedRuleSetQuery } from "./get-pinned-rule-set.query.js";

/** The immutable rule set version this assessment is pinned to (never "whatever is ACTIVE"). */
@QueryHandler(GetPinnedRuleSetQuery)
export class GetPinnedRuleSetHandler implements IQueryHandler<GetPinnedRuleSetQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly queryBus: QueryBus,
  ) {}

  async execute(
    input: GetPinnedRuleSetQuery,
  ): Promise<ComplianceRuleSetReadModel> {
    const pins = await this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      return this.support.loadPins(tx, input.assessmentId, input.correlationId);
    });
    return this.queryBus.execute(
      new GetComplianceRuleSetVersionQuery(
        pins.ruleSetVersionId,
        input.correlationId,
      ),
    );
  }
}
