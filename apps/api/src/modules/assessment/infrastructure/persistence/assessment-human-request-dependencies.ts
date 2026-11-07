import { canonicalJson } from "../../domain/domain-ids.js";

export interface HumanRequestDependency {
  assessmentRuleId: string;
  criterionIds: string[];
}

/**
 * Business purpose: Preserve every rule that relies on one factual customer question.
 * Business rules:
 * - The primary dependency always participates; criteria are unioned only within the same rule.
 * Execution flow:
 * 1. Combine primary and explicitly declared dependencies by rule.
 * 2. Deduplicate and sort rule and criterion identities for deterministic persistence and presentation.
 * Failure cases:
 * - Invalid criterion payloads are rejected by the caller's contract validation.
 * Side effects:
 * - Pure transformation; no persistence or rule decision is changed.
 */
export function canonicalHumanRequestDependencies(
  primary: HumanRequestDependency,
  additional: readonly HumanRequestDependency[] = [],
): HumanRequestDependency[] {
  const rules = new Map<string, Set<string>>();
  for (const dependency of [primary, ...additional]) {
    const criteria =
      rules.get(dependency.assessmentRuleId) ?? new Set<string>();
    for (const id of dependency.criterionIds) criteria.add(id);
    rules.set(dependency.assessmentRuleId, criteria);
  }
  return [...rules]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assessmentRuleId, ids]) => ({
      assessmentRuleId,
      criterionIds: [...ids].sort(),
    }));
}

/**
 * Business purpose: Expose canonical dependencies while retaining legacy request fixtures.
 * Business rules:
 * - Persisted relation rows take precedence; the primary dependency is retained when no relation was loaded.
 * Execution flow:
 * 1. Read the request's explicit relation when present.
 * 2. Normalize it together with the original primary rule and criterion identities.
 * Failure cases:
 * - Non-array legacy criterion payloads yield no primary criteria; authoritative writes validate criteria separately.
 * Side effects:
 * - Read-only projection with no mutation of the source row.
 */
export function humanRequestDependenciesOf(row: {
  assessmentRuleId: string;
  criterionIds: unknown;
  dependencies?: readonly { assessmentRuleId: string; criterionIds: unknown }[];
}): HumanRequestDependency[] {
  const criteriaOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  return canonicalHumanRequestDependencies(
    {
      assessmentRuleId: row.assessmentRuleId,
      criterionIds: criteriaOf(row.criterionIds),
    },
    (row.dependencies ?? []).map((entry) => ({
      assessmentRuleId: entry.assessmentRuleId,
      criterionIds: criteriaOf(entry.criterionIds),
    })),
  );
}

/**
 * Business purpose: Limit explicit question reuse to the identical factual subject and answer control.
 * Business rules:
 * - Question, unresolved fact, control type and ordered choice values/labels must match exactly; legal impact and rule criteria may differ.
 * Execution flow:
 * 1. Compare factual wording and input control.
 * 2. Compare canonical serialized choice content.
 * Failure cases:
 * - Any difference denies reuse; topic or linguistic similarity never grants authority.
 * Side effects:
 * - Pure identity comparison; no facts are inferred or accepted.
 */
export function hasSameHumanFactScope(
  source: {
    question: string;
    unresolvedFact: string;
    controlType: string;
    choices: unknown;
  },
  requested: {
    question: string;
    unresolvedFact: string;
    controlType: string;
    choices: unknown;
  },
): boolean {
  return (
    source.question === requested.question &&
    source.unresolvedFact === requested.unresolvedFact &&
    source.controlType === requested.controlType &&
    canonicalJson(source.choices) === canonicalJson(requested.choices)
  );
}
