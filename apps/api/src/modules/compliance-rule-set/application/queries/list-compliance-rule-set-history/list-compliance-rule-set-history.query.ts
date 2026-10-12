import { Query } from "@nestjs/cqrs";
import type { ComplianceRuleSetHistory } from "@lcsp/contracts/compliance-rule-set";
export class ListComplianceRuleSetHistoryQuery extends Query<ComplianceRuleSetHistory> {}
