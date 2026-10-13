import type {
  ComplianceRuleSetHistory,
  RuleSetPreparationAvailability,
} from "@lcsp/contracts/compliance-rule-set";

export type ComplianceRuleSetRow = ComplianceRuleSetHistory["ruleSets"][number];
export type RuleSetPreparationRow =
  ComplianceRuleSetHistory["preparations"][number];

export type RuleSetPreparationListProps = {
  preparations: RuleSetPreparationRow[];
};
export type RuleSetPreparationActionProps = {
  availability: RuleSetPreparationAvailability;
};
export type ComplianceRuleSetActiveCardProps = {
  ruleSet: ComplianceRuleSetRow | undefined;
};
export type ComplianceRuleSetHistoryTableProps = {
  ruleSets: ComplianceRuleSetRow[];
};
