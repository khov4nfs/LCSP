/** Provider-free validation adapter for the native live-model fixture. No production API writes. */
import { readFileSync } from "node:fs";
import { ruleDecisionSchema } from "@lcsp/contracts/assessment";
import {
  validateRuleDecision,
  type DecisionValidationContext,
} from "../../src/modules/assessment/domain/decision-validator.js";

type Entries<T> =
  T extends ReadonlyMap<infer Key, infer Value> ? [Key, Value][] : never;
type Rule = NonNullable<DecisionValidationContext["rule"]>;
type FixtureInput = {
  decision: unknown;
  context: Omit<DecisionValidationContext, "rule" | "facts" | "evidence"> & {
    rule: Omit<
      Rule,
      "criterionIds" | "legalContextIds" | "declaredElements"
    > & {
      criterionIds: string[];
      legalContextIds: string[];
      declaredElements: Entries<Rule["declaredElements"]>;
    };
    facts: Entries<DecisionValidationContext["facts"]>;
    evidence: Entries<DecisionValidationContext["evidence"]>;
  };
};

const input = JSON.parse(readFileSync(0, "utf8")) as FixtureInput;
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
