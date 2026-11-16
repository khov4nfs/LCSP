import {
  DISCOVERY_GAP_REASONS,
  DISCOVERY_REACHABILITY_STATES,
  DISCOVERY_RULE_CANDIDATE_STATES,
  computeRepositoryDiscoveryDigest,
  repositoryDiscoverySchema,
  type RepositoryDiscovery,
  type SubmitRepositoryDiscovery,
} from "@lcsp/contracts/assessment-domain";

const MAX_CANDIDATES = 10_000;
const MAX_STRING_LEAVES = 500;
const MAX_MATCHED_TERMS = 100;
const MAX_RULE_RELEVANCE_PER_RANGE = 1_000;

const MATCH_STOP_WORDS = new Set([
  "about",
  "against",
  "application",
  "assessment",
  "based",
  "business",
  "candidate",
  "code",
  "compliance",
  "condition",
  "data",
  "evidence",
  "from",
  "have",
  "into",
  "legal",
  "model",
  "must",
  "need",
  "provide",
  "required",
  "requirement",
  "rule",
  "service",
  "should",
  "source",
  "supporting",
  "system",
  "that",
  "their",
  "this",
  "using",
  "with",
]);

export type DiscoveryRuleMatchRule = {
  assessmentRuleId: string;
  assessmentRuleVersion: string;
  concept: string;
  applicabilityGuidance: string;
  criteria: unknown;
  contract: unknown;
  ordinal: number;
};

export type DiscoveryRuleMatchFact = {
  factId: string;
  statement: string;
};

type JsonRecord = Record<string, unknown>;

/**
 * Business purpose: Safely expose named engineering fields from persisted rule JSON without trusting its runtime shape.
 *
 * Business rules:
 * - Only plain non-array objects may supply named rule fields.
 * - Malformed or scalar JSON contributes no match input and never broadens candidate scope.
 *
 * Execution flow:
 * 1. Check that the value is a non-null object.
 * 2. Exclude arrays from the record shape.
 * 3. Return the record or an empty object.
 *
 * Failure cases:
 * - Unexpected JSON shapes resolve to an empty record rather than throwing or inventing semantics.
 *
 * Side effects:
 * - Pure runtime narrowing with no persistence or assessment-state changes.
 */
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/**
 * Business purpose: Bound extraction of human-authored strings from nested rule metadata before lexical prioritization.
 *
 * Business rules:
 * - Traversal is capped so malformed or unusually large rule JSON cannot create unbounded work.
 * - Empty strings are discarded and each retained value is capped to the contract-safe length.
 * - Object keys are not treated as evidence because only authored values describe rule intent.
 *
 * Execution flow:
 * 1. Traverse arrays and object values using an explicit stack.
 * 2. Normalize and retain non-empty string leaves.
 * 3. Stop at the configured leaf cap and preserve deterministic traversal order.
 *
 * Failure cases:
 * - Unsupported scalar values are ignored; oversized inputs are conservatively truncated.
 *
 * Side effects:
 * - Pure bounded extraction without database access or legal conclusions.
 */
function collectStringLeaves(value: unknown): string[] {
  const leaves: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0 && leaves.length < MAX_STRING_LEAVES) {
    const current = stack.pop();
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed) leaves.push(trimmed.slice(0, 1_000));
      continue;
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (current && typeof current === "object") {
      const values = Object.values(current as JsonRecord);
      for (let index = values.length - 1; index >= 0; index -= 1) {
        stack.push(values[index]);
      }
    }
  }
  return leaves;
}

/**
 * Business purpose: Normalize authored technical language into stable terms for deterministic discovery-to-rule comparison.
 *
 * Business rules:
 * - Unicode letters and numbers are retained after accent normalization and case folding.
 * - Generic assessment vocabulary and tokens shorter than three characters are excluded.
 * - Terms are unique and sorted so identical inputs always produce identical candidate artifacts.
 *
 * Execution flow:
 * 1. Normalize each text value to lowercase decomposed Unicode.
 * 2. Split on non-alphanumeric boundaries and remove generic stop words.
 * 3. Return a sorted unique list.
 *
 * Failure cases:
 * - Empty or punctuation-only text produces no terms and therefore cannot create a candidate.
 *
 * Side effects:
 * - Pure lexical normalization without model calls, persistence, or applicability decisions.
 */
function normalizedTerms(values: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    for (const token of value
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/gu)) {
      if (
        token.length >= 3 &&
        token.length <= 200 &&
        !MATCH_STOP_WORDS.has(token)
      ) {
        terms.add(token);
      }
    }
  }
  return [...terms].sort((left, right) => left.localeCompare(right));
}

/**
 * Business purpose: Find stable shared technical terms between a rule and one discovery or accepted-fact text surface.
 *
 * Business rules:
 * - Only terms already normalized from the pinned rule may match.
 * - Output is bounded to the candidate contract maximum and retains deterministic rule-term order.
 *
 * Execution flow:
 * 1. Normalize the comparison text.
 * 2. Build a membership set for the observed terms.
 * 3. Return the bounded intersection in rule-term order.
 *
 * Failure cases:
 * - Text with no shared technical terms returns an empty match.
 *
 * Side effects:
 * - Pure comparison without persistence or assessment authorization.
 */
function intersectTerms(
  ruleTerms: readonly string[],
  observedText: readonly string[],
): string[] {
  const observed = new Set(normalizedTerms(observedText));
  return ruleTerms
    .filter((term) => observed.has(term))
    .slice(0, MAX_MATCHED_TERMS);
}

/**
 * Business purpose: Enrich a verified repository discovery artifact with explainable, non-authoritative rule investigation candidates.
 *
 * Business rules:
 * - Candidate matching uses only the pinned rules supplied by the API, verified discovery metadata, and ACCEPTED case facts supplied by the caller.
 * - A rule requires a technical source/use-case match; accepted facts may support but never create a candidate alone.
 * - Missing matches never produce NOT_SELECTED, and this matcher never emits SELECTED, RECOMMENDED, applicability, or compliance outcomes.
 * - Coverage gaps, unresolved reachability, and rule conditions force NEEDS_CONTEXT; every candidate has authorizesAssessment=false.
 * - Rule relevance is an investigation priority only and is bounded per source range.
 *
 * Execution flow:
 * 1. Extract explicit engineering fields from each pinned rule and normalize their technical terms.
 * 2. Match those terms against discovered use cases, source ranges, and accepted facts.
 * 3. Build bounded candidate explanations and attach rule-specific priorities to supporting ranges.
 * 4. Record truncation as an explicit coverage gap, then recompute the immutable content digest and discovery identity.
 * 5. Validate the complete enriched artifact before returning it.
 *
 * Failure cases:
 * - Rules without a technical source/use-case match are omitted without a negative legal inference.
 * - Oversized candidate sets are truncated with an INCOMPLETE_COVERAGE gap instead of silently excluding rules.
 * - A schema-invalid enriched artifact throws and is not persisted.
 *
 * Side effects:
 * - Pure in-memory enrichment; it does not authorize audit scope, accept facts/evidence, mutate rules, or write persistence.
 */
export function buildRepositoryDiscoveryRuleCandidates(input: {
  discovery: SubmitRepositoryDiscovery;
  rules: readonly DiscoveryRuleMatchRule[];
  acceptedFacts: readonly DiscoveryRuleMatchFact[];
}): RepositoryDiscovery {
  const rangeById = new Map(
    input.discovery.sourceRanges.map((range) => [range.rangeId, range]),
  );
  const rangeRelevance = new Map<
    string,
    RepositoryDiscovery["sourceRanges"][number]["ruleRelevance"]
  >();
  const candidates: RepositoryDiscovery["ruleCandidates"] = [];
  let candidateTruncated = false;
  let rangeRelevanceTruncated = false;

  const orderedRules = [...input.rules].sort(
    (left, right) =>
      left.ordinal - right.ordinal ||
      left.assessmentRuleId.localeCompare(right.assessmentRuleId),
  );

  for (const rule of orderedRules) {
    if (candidates.length >= MAX_CANDIDATES) {
      candidateTruncated = true;
      break;
    }
    const contract = asRecord(rule.contract);
    const engineeringValues = collectStringLeaves([
      contract.keywords,
      contract.commonApis,
      contract.commonLibraries,
      contract.patterns,
      contract.graphQueries,
      contract.investigationGoals,
      contract.requiredEvidence,
      contract.supportingEvidence,
      contract.negativeEvidence,
      contract.criteria,
      rule.criteria,
      rule.concept,
    ]);
    const ruleTerms = normalizedTerms(engineeringValues);
    if (ruleTerms.length === 0) continue;

    const matchedTermSet = new Set<string>();
    const directRangeIds = new Set<string>();
    const supportingUseCaseIds = new Set<string>();

    for (const range of input.discovery.sourceRanges) {
      const terms = intersectTerms(ruleTerms, [
        range.path,
        range.symbol ?? "",
        range.signalType,
        range.explanation,
        ...range.technologyRelevance,
      ]);
      if (terms.length === 0) continue;
      directRangeIds.add(range.rangeId);
      for (const term of terms) matchedTermSet.add(term);
      for (const useCaseId of range.useCaseIds) {
        supportingUseCaseIds.add(useCaseId);
      }
    }

    for (const useCase of input.discovery.aiUseCases) {
      const terms = intersectTerms(ruleTerms, [
        useCase.name,
        useCase.providerOrFramework ?? "",
      ]);
      if (terms.length === 0) continue;
      supportingUseCaseIds.add(useCase.useCaseId);
      for (const term of terms) matchedTermSet.add(term);
    }

    if (matchedTermSet.size === 0) continue;

    const supportingRangeIds = new Set(directRangeIds);
    for (const useCase of input.discovery.aiUseCases) {
      if (!supportingUseCaseIds.has(useCase.useCaseId)) continue;
      for (const rangeId of [
        ...useCase.invocationRangeIds,
        ...useCase.inputRangeIds,
        ...useCase.outputRangeIds,
        ...useCase.controlRangeIds,
      ]) {
        if (rangeById.has(rangeId)) supportingRangeIds.add(rangeId);
      }
    }

    const supportingFacts = input.acceptedFacts.filter(
      (fact) => intersectTerms(ruleTerms, [fact.statement]).length > 0,
    );
    const unresolvedConditions = collectStringLeaves(
      contract.unresolvedConditions,
    ).slice(0, 100);
    const applicabilityElements = collectStringLeaves([
      rule.applicabilityGuidance,
      contract.applicabilityGuidance,
    ]).slice(0, 100);
    const relevantRanges = [...supportingRangeIds]
      .map((rangeId) => rangeById.get(rangeId))
      .filter((range) => range !== undefined);
    const unresolvedUseCase = input.discovery.aiUseCases.some(
      (useCase) =>
        supportingUseCaseIds.has(useCase.useCaseId) &&
        useCase.unresolvedQuestions.length > 0,
    );
    const incompleteCoverage =
      input.discovery.knownGaps.length > 0 ||
      input.discovery.unresolvedCalls.length > 0 ||
      input.discovery.unsupportedLanguages.length > 0 ||
      input.discovery.resourceLedger.coverageImpact.truncated ||
      relevantRanges.some(
        (range) =>
          range.reachability !== DISCOVERY_REACHABILITY_STATES.confirmed ||
          range.unresolvedEdges.length > 0 ||
          range.coverageGaps.length > 0,
      );
    const state =
      unresolvedConditions.length > 0 || unresolvedUseCase || incompleteCoverage
        ? DISCOVERY_RULE_CANDIDATE_STATES.needsContext
        : DISCOVERY_RULE_CANDIDATE_STATES.candidate;
    const matchedTerms = [...matchedTermSet]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_MATCHED_TERMS);
    const evidenceNeed = collectStringLeaves(contract.requiredEvidence)[0];
    const limitations = [
      "Deterministic engineering relevance prioritizes investigation; it is not a legal applicability or compliance conclusion.",
      "Legal actor, operational scope, conditions, and exceptions still require governed assessment evidence.",
      ...(incompleteCoverage
        ? [
            "Repository coverage, reachability, or call resolution is incomplete; missing source matches cannot establish absence.",
          ]
        : []),
    ];
    const rationale =
      `Pinned rule engineering terms (${matchedTerms.join(", ")}) matched ${supportingRangeIds.size} discovery range(s), ${supportingUseCaseIds.size} AI use case(s), and ${supportingFacts.length} accepted fact(s). This candidate only prioritizes governed investigation.`.slice(
        0,
        4_000,
      );

    candidates.push({
      assessmentRuleId: rule.assessmentRuleId,
      assessmentRuleVersion: rule.assessmentRuleVersion,
      state,
      supportingUseCaseIds: [...supportingUseCaseIds].slice(0, 500),
      supportingRangeIds: [...supportingRangeIds].slice(0, 1_000),
      supportingFactIds: supportingFacts
        .map((fact) => fact.factId)
        .slice(0, 500),
      matchedTerms,
      applicabilityElements,
      unresolvedConditions,
      rationale,
      limitations,
      authorizesAssessment: false,
    });

    for (const rangeId of supportingRangeIds) {
      const current = rangeRelevance.get(rangeId) ?? [];
      if (current.length >= MAX_RULE_RELEVANCE_PER_RANGE) {
        rangeRelevanceTruncated = true;
        continue;
      }
      current.push({
        assessmentRuleId: rule.assessmentRuleId,
        evidenceNeed: evidenceNeed ?? null,
        rationale:
          `Matched rule engineering terms: ${matchedTerms.join(", ")}. This is an investigation priority, not a legal conclusion.`.slice(
            0,
            2_000,
          ),
      });
      rangeRelevance.set(rangeId, current);
    }
  }

  const matchingTruncated = candidateTruncated || rangeRelevanceTruncated;
  const truncationGap = matchingTruncated
    ? [
        {
          path: "",
          reason: DISCOVERY_GAP_REASONS.incompleteCoverage,
          detail:
            "Rule-candidate or per-range relevance matching reached a contract limit; remaining pinned rules require explicit investigation.",
        },
      ]
    : [];
  const knownGaps = matchingTruncated
    ? [...input.discovery.knownGaps.slice(0, 1_999), ...truncationGap]
    : input.discovery.knownGaps;
  const enrichedWithoutIdentity = {
    ...input.discovery,
    sourceRanges: input.discovery.sourceRanges.map((range) => ({
      ...range,
      ruleRelevance: rangeRelevance.get(range.rangeId) ?? [],
    })),
    ruleCandidates: candidates,
    knownGaps,
    resourceLedger: {
      ...input.discovery.resourceLedger,
      coverageImpact: {
        ...input.discovery.resourceLedger.coverageImpact,
        knownGapCount: Math.min(2_000, knownGaps.length),
        truncated:
          input.discovery.resourceLedger.coverageImpact.truncated ||
          matchingTruncated,
      },
    },
  } satisfies Omit<RepositoryDiscovery, "contentDigest" | "discoveryId">;
  const contentDigest = computeRepositoryDiscoveryDigest(
    enrichedWithoutIdentity,
  );
  return repositoryDiscoverySchema.parse({
    ...enrichedWithoutIdentity,
    contentDigest,
    discoveryId: contentDigest,
  });
}
