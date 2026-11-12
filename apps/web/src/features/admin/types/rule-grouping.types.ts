import type { RuleGroupingProposal } from "@lcsp/contracts/assessment-domain";
export type RuleGroupingReviewProps = { ruleSetVersionId: string };
export type RuleGroupingAssignmentProps = {
  entry: RuleGroupingProposal["entries"][number];
  index: number;
  readOnly?: boolean;
};
