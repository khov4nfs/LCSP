import type { ComplianceRuleSetReadModel } from "@lcsp/contracts/compliance-rule-set";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { ArtifactLifecycleState as PrismaArtifactLifecycleState } from "@prisma/client";

import { ComplianceRuleSetReadModelLoader } from "../../../infrastructure/persistence/compliance-rule-set-read-model.service.js";
import { GetActiveComplianceRuleSetQuery } from "./get-active-compliance-rule-set.query.js";

/** The single runtime reader: the explicit ACTIVE rule set, never "latest by date". */
@QueryHandler(GetActiveComplianceRuleSetQuery)
export class GetActiveComplianceRuleSetHandler implements IQueryHandler<GetActiveComplianceRuleSetQuery> {
  constructor(private readonly readModel: ComplianceRuleSetReadModelLoader) {}

  execute(
    input: GetActiveComplianceRuleSetQuery,
  ): Promise<ComplianceRuleSetReadModel> {
    return this.readModel.load(
      { lifecycleState: PrismaArtifactLifecycleState.ACTIVE },
      input.correlationId,
    );
  }
}
