import type { RuleAuditCatalog } from "@lcsp/contracts/assessment-domain";
export type RuleAuditGroupProps = {
  group: RuleAuditCatalog["groups"][number];
  rules: RuleAuditCatalog["rules"];
  visibleRuleIds: Set<string>;
  canStart: boolean;
  onView: (decisionId: string) => void;
};
