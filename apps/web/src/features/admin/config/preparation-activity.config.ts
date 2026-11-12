/** Bound browser rendering while complete events remain in the durable journal. */
export const PREPARATION_ACTIVITY_VISIBLE_LIMIT = 100;

export { PREPARATION_STAGE_OBSERVATIONS } from "@lcsp/contracts/compliance-rule-set";
export const PREPARATION_OBSERVABILITY_STAGES = [
  "SOURCE_LOADING",
  "SOURCE_DISCOVERY",
  "CLAIM_INVENTORY",
  "SOURCE_REVIEW",
  "RULE_AUTHORING",
  "RULE_VALIDATION",
  "SUBMISSION",
  "ACTIVATION",
] as const;
