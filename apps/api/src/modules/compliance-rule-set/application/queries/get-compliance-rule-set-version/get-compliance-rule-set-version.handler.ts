import type { ComplianceRuleSetReadModel } from "@lcsp/contracts/compliance-rule-set";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { ArtifactLifecycleState as PrismaArtifactLifecycleState } from "@prisma/client";

import { ComplianceRuleSetReadModelLoader } from "../../../infrastructure/persistence/compliance-rule-set-read-model.service.js";
import { GetComplianceRuleSetVersionQuery } from "./get-compliance-rule-set-version.query.js";

/**
 * One immutable rule set version by identity, for an assessment's pin. SUPERSEDED versions
 * stay readable because existing assessments remain pinned to their as-of legal basis.
 */
@QueryHandler(GetComplianceRuleSetVersionQuery)
export class GetComplianceRuleSetVersionHandler implements IQueryHandler<GetComplianceRuleSetVersionQuery> {
  constructor(private readonly readModel: ComplianceRuleSetReadModelLoader) {}

  execute(
    input: GetComplianceRuleSetVersionQuery,
  ): Promise<ComplianceRuleSetReadModel> {
    return this.readModel.load(
      {
        id: input.ruleSetVersionId,
        lifecycleState: {
          in: [
            PrismaArtifactLifecycleState.ACTIVE,
            PrismaArtifactLifecycleState.SUPERSEDED,
          ],
        },
      },
      input.correlationId,
    );
  }
}
