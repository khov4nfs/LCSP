/** Provider-free validation adapter for the native live-model fixture. No production API writes. */
import { readFileSync } from "node:fs";
import { ruleDecisionSchema } from "@lcsp/contracts/assessment";
import { validateRuleDecision } from "../../src/modules/assessment/domain/decision-validator.js";
const input = JSON.parse(readFileSync(0, "utf8"));
const decision = ruleDecisionSchema.parse(input.decision);
const context = {
  ...input.context,
  rule: {
    ...input.context.rule,
    criterionIds: new Set<string>(input.context.rule.criterionIds),
    legalContextIds: new Set<string>(input.context.rule.legalContextIds),
    declaredElements: new Map(input.context.rule.declaredElements),
  },
  facts: new Map(input.context.facts),
  evidence: new Map(input.context.evidence),
};
process.stdout.write(JSON.stringify(validateRuleDecision(decision, context)));
