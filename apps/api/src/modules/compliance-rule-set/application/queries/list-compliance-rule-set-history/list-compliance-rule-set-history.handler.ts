import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { ComplianceRuleSetHistoryLoader } from "../../../infrastructure/persistence/compliance-rule-set-history.loader.js";
import { ListComplianceRuleSetHistoryQuery } from "./list-compliance-rule-set-history.query.js";
@QueryHandler(ListComplianceRuleSetHistoryQuery)
export class ListComplianceRuleSetHistoryHandler implements IQueryHandler<ListComplianceRuleSetHistoryQuery> {
  constructor(private readonly history: ComplianceRuleSetHistoryLoader) {}
  execute() {
    return this.history.load();
  }
}
