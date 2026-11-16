import {
  DISCOVERY_EVIDENCE_STRENGTHS,
  DISCOVERY_EXPANSION_STATES,
  DISCOVERY_OBSERVATION_STATUSES,
  DISCOVERY_REACHABILITY_STATES,
  DISCOVERY_RULE_CANDIDATE_STATES,
  DISCOVERY_SIGNAL_TYPES,
  DISCOVERY_SOURCE_CLASSIFICATIONS,
  DISCOVERY_TECHNOLOGY_RELEVANCE,
  REPOSITORY_DISCOVERY_VERSIONS,
  computeRepositoryDiscoveryDigest,
  repositoryDiscoverySchema,
  repositoryDiscoverySummarySchema,
  submitRepositoryDiscoverySchema,
  type RepositoryDiscovery,
} from "../src/assessment-domain/repository-discovery.ts";
import { REPOSITORY_SCANNER_VERSIONS } from "../src/assessment-domain/repository-profile.ts";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

function fixture(): RepositoryDiscovery {
  const withoutDigest: Omit<
    RepositoryDiscovery,
    "contentDigest" | "discoveryId" | "generatedAt"
  > = {
    repositoryId: "repo-1",
    commitSha: "a".repeat(40),
    sourcePathPrefix: "apps/api",
    scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
    discoveryVersion: REPOSITORY_DISCOVERY_VERSIONS.v1,
    scannerSignature: sha("1"),
    graphIndexVersion: sha("2"),
    cacheIdentity: sha("3"),
    sourceRanges: [
      {
        rangeId: sha("4"),
        path: "apps/api/model.ts",
        startLine: 12,
        endLine: 12,
        sourceDigest: sha("5"),
        symbol: "summarize",
        signalType: DISCOVERY_SIGNAL_TYPES.aiSdkCall,
        sourceClassification:
          DISCOVERY_SOURCE_CLASSIFICATIONS.productionCandidate,
        reachability: DISCOVERY_REACHABILITY_STATES.notEstablished,
        observationStatus: DISCOVERY_OBSERVATION_STATUSES.observedSourceFact,
        technologyRelevance: [DISCOVERY_TECHNOLOGY_RELEVANCE.aiInvocation],
        useCaseIds: [sha("6")],
        ruleRelevance: [],
        evidenceStrength: DISCOVERY_EVIDENCE_STRENGTHS.directSource,
        explanation:
          "A direct SDK call is present; deployment reachability is unresolved.",
        callers: [],
        callees: [],
        unresolvedEdges: ["Dependency injection was not resolved."],
        coverageGaps: [],
        expansionState: DISCOVERY_EXPANSION_STATES.permitted,
      },
    ],
    aiUseCases: [
      {
        useCaseId: sha("6"),
        name: "Candidate OpenAI use",
        observationStatus: DISCOVERY_OBSERVATION_STATUSES.candidateFinding,
        providerOrFramework: "OpenAI",
        invocationRangeIds: [sha("4")],
        inputRangeIds: [],
        outputRangeIds: [],
        controlRangeIds: [],
        unresolvedQuestions: ["Is this deployed in production?"],
      },
    ],
    ruleCandidates: [
      {
        assessmentRuleId: "RULE-1",
        assessmentRuleVersion: "1",
        state: DISCOVERY_RULE_CANDIDATE_STATES.needsContext,
        supportingUseCaseIds: [sha("6")],
        supportingRangeIds: [sha("4")],
        supportingFactIds: [],
        matchedTerms: ["model"],
        applicabilityElements: ["Production use is in scope."],
        unresolvedConditions: ["Production use is unconfirmed."],
        rationale: "Source observations make this rule a candidate only.",
        limitations: ["Static reachability is incomplete."],
        authorizesAssessment: false,
      },
    ],
    knownGaps: [],
    unsupportedLanguages: [],
    skippedPaths: [],
    unresolvedCalls: ["Runtime caller is unresolved."],
    resourceLedger: {
      budget: { maxFiles: 10_000, maxBytes: 10_485_760_000, maxRanges: 10_000 },
      usage: { filesScanned: 1, bytesInspected: 200, rangesProduced: 1 },
      remaining: { files: 9_999, bytes: 10_485_759_800, ranges: 9_999 },
      coverageImpact: {
        knownGapCount: 0,
        unresolvedCallCount: 1,
        unsupportedLanguageCount: 0,
        truncated: false,
      },
      expansionHistory: [],
    },
    scannedFileCount: 1,
  };
  const digest = computeRepositoryDiscoveryDigest(withoutDigest);
  return {
    ...withoutDigest,
    discoveryId: digest,
    contentDigest: digest,
    generatedAt: "2026-11-16T10:00:00.000Z",
  };
}

describe("repository discovery contract", () => {
  it("accepts a provenance-bound non-authoritative candidate artifact", () => {
    const parsed = repositoryDiscoverySchema.parse(fixture());

    expect(parsed.ruleCandidates[0]?.authorizesAssessment).toBe(false);
    expect(parsed.sourceRanges[0]?.sourceClassification).toBe(
      DISCOVERY_SOURCE_CLASSIFICATIONS.productionCandidate,
    );
    expect(parsed.sourceRanges[0]?.reachability).toBe(
      DISCOVERY_REACHABILITY_STATES.notEstablished,
    );
  });

  it("rejects a candidate that claims audit authorization", () => {
    const discovery = fixture();
    const invalid = {
      ...discovery,
      ruleCandidates: [
        { ...discovery.ruleCandidates[0], authorizesAssessment: true },
      ],
    };

    expect(repositoryDiscoverySchema.safeParse(invalid).success).toBe(false);
  });

  it("prevents workers from submitting API-owned rule recommendations", () => {
    const discovery = fixture();

    expect(submitRepositoryDiscoverySchema.safeParse(discovery).success).toBe(
      false,
    );
    expect(
      submitRepositoryDiscoverySchema.safeParse({
        ...discovery,
        ruleCandidates: [],
        sourceRanges: discovery.sourceRanges.map((range) => ({
          ...range,
          ruleRelevance: [],
        })),
      }).success,
    ).toBe(true);
    expect(
      submitRepositoryDiscoverySchema.safeParse({
        ...discovery,
        ruleCandidates: [],
        sourceRanges: discovery.sourceRanges.map((range) => ({
          ...range,
          ruleRelevance: [
            {
              assessmentRuleId: "RULE-1",
              evidenceNeed: null,
              rationale: "API-owned recommendation",
            },
          ],
        })),
      }).success,
    ).toBe(false);
  });

  it("binds graph version and audited expansion history into the digest", () => {
    const discovery = fixture();
    const {
      contentDigest: _content,
      discoveryId: _id,
      generatedAt: _time,
      ...base
    } = discovery;
    const changedGraph = {
      ...base,
      graphIndexVersion: "graph-v2",
    };
    const expanded = {
      ...base,
      resourceLedger: {
        ...base.resourceLedger,
        expansionHistory: [
          {
            expansionId: sha("7"),
            requestedAt: "2026-11-16T10:01:00.000Z",
            reason: "Resolve an indirect wrapper edge.",
            addedRangeIds: [sha("8")],
            resourceUsage: {
              filesScanned: 2,
              bytesInspected: 400,
              rangesProduced: 2,
            },
            remainingBudget: {
              files: 9_998,
              bytes: 10_485_759_600,
              ranges: 9_998,
            },
            coverageImpact: "One unresolved wrapper edge was inspected.",
          },
        ],
      },
    };

    expect(computeRepositoryDiscoveryDigest(changedGraph)).not.toBe(
      discovery.contentDigest,
    );
    expect(computeRepositoryDiscoveryDigest(expanded)).not.toBe(
      discovery.contentDigest,
    );
  });

  it("keeps summary availability structurally consistent", () => {
    expect(
      repositoryDiscoverySummarySchema.safeParse({
        available: true,
        discovery: null,
      }).success,
    ).toBe(false);
    expect(
      repositoryDiscoverySummarySchema.safeParse({
        available: false,
        discovery: {
          recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      }).success,
    ).toBe(false);
    expect(
      repositoryDiscoverySummarySchema.safeParse({
        available: false,
        discovery: null,
      }).success,
    ).toBe(true);
  });
});
