import type { MessageKey } from "@lcsp/i18n";
import type { ComplianceRuleSetResult } from "@lcsp/contracts/compliance-rule-set";

export type ComplianceRuleSetResultRequirement =
  ComplianceRuleSetResult["ruleSet"]["legalRequirements"][number];
export type ComplianceRuleSetResultAssessmentRule =
  ComplianceRuleSetResult["ruleSet"]["assessmentRules"][number];
export type ComplianceRuleSetResultSource =
  ComplianceRuleSetResultRequirement["sources"][number];

export type ComplianceRuleSetResultPageProps = {
  ruleSetVersionId: string;
};
export type ComplianceRuleSetResultValueListProps = {
  labelKey: MessageKey;
  values: string[];
};
export type ComplianceRuleSetResultSourcesProps = {
  sources: ComplianceRuleSetResultSource[];
};
export type ComplianceRuleSetResultRequirementProps = {
  requirement: ComplianceRuleSetResultRequirement;
};
export type ComplianceRuleSetResultAssessmentRuleProps = {
  rule: ComplianceRuleSetResultAssessmentRule;
};
