import type {
  ComplianceRuleSetHistory,
  RuleSetPreparationAvailability,
} from "@lcsp/contracts/compliance-rule-set";

export type ComplianceRuleSetRow = ComplianceRuleSetHistory["ruleSets"][number];
export type RuleSetPreparationRow =
  ComplianceRuleSetHistory["preparations"][number];

export type RuleSetPreparationListProps = {
  preparations: RuleSetPreparationRow[];
  availability: RuleSetPreparationAvailability;
  ruleSets: ComplianceRuleSetRow[];
};
export type RuleSetPreparationActionProps = {
  availability: RuleSetPreparationAvailability;
  replaceActive?: boolean;
};
export type ComplianceRuleSetActiveCardProps = {
  ruleSet: ComplianceRuleSetRow | undefined;
  availability: RuleSetPreparationAvailability;
};
export type ComplianceRuleSetHistoryTableProps = {
  ruleSets: ComplianceRuleSetRow[];
};
