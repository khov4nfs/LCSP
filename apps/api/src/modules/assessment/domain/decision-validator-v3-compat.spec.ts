import { describe, expect, it } from "@jest/globals";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_BASIS_FINDINGS,
  RULE_DECISION_BASIS_KINDS,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  ASSESSMENT_RECORD_STATES,
  DECISION_VALIDATION_FAILURE_CODES,
  SEARCH_COVERAGE_SCOPE_KINDS,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_LIMITS,
  ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS,
  assessmentFinalReportV3Schema,
} from "@lcsp/contracts/assessment-report";
import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
} from "@lcsp/contracts/compliance-rule-set";
import {
  validateRuleDecision,
  type DecisionValidationContext,
} from "./decision-validator.js";

const COMMIT = "a".repeat(40);
const sha = (ch: string) => `sha256:${ch.repeat(64).slice(0, 64)}`;
const LEGAL_SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const RULE_SET_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SCAN_JOB_ID = "44444444-4444-4444-8444-444444444444";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";
const ASSESSMENT_ID = "66666666-6666-4666-8666-666666666666";
const DECISION_ID = "77777777-7777-4777-8777-777777777771";
const FACT_HUMAN_ID = "88888888-8888-4888-8888-888888888881";
const EVIDENCE_HUMAN_ID = "99999999-9999-4999-8999-999999999991";
const EVIDENCE_REPO_ID = "99999999-9999-4999-8999-999999999992";
const EVIDENCE_COVERAGE_ID = "99999999-9999-4999-8999-999999999993";

const sourceRef = (documentId: string) => ({
  legalSourceVersionId: LEGAL_SOURCE_ID,
  legalSourceVersion: "LAW-2026",
  documentId,
  documentTitle: "Data Protection Decree",
  locator: "art-1",
  contentSha256: sha("a"),
});

describe("DecisionValidator and V3 Report contract parity (P1-04)", () => {
  it("accepts the same direct + related legalContextRefs across DecisionValidator and assessmentFinalReportV3Schema while rejecting unauthorized contexts", () => {
    const directRequirementId = "req-direct";
    const relatedRequirementId = "req-related-def";
    const unrelatedRequirementId = "req-unrelated";

    const basisRef = {
      type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
      factId: FACT_HUMAN_ID,
      caseRevision: 1,
    } as const;
    const criterionRef = {
      type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
      evidenceId: EVIDENCE_REPO_ID,
    } as const;

    const decision = {
      assessmentRuleId: "rule-1",
      assessmentRuleVersion: "1",
      scopeId: ASSESSMENT_DECISION_SCOPE,
      ruleSetVersionId: RULE_SET_ID,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
      caseRevision: 1,
      legalContextRefs: [
        { legalContextId: directRequirementId },
        { legalContextId: relatedRequirementId },
      ],
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      rationale: "Rule applies with both direct duty and related definition.",
      references: [criterionRef],
      applicabilityBasis: [
        {
          legalRequirementId: directRequirementId,
          kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
          index: 0,
          finding: RULE_DECISION_BASIS_FINDINGS.ESTABLISHED,
          rationale: "Customer confirmed system scope.",
          references: [basisRef],
        },
      ],
      criteria: [
        {
          criterionId: "crit-1",
          outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
          rationale: "Control verified in repository.",
          references: [criterionRef],
        },
      ],
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
    };

    // Context equivalent to AssessmentCaseSupport.buildValidationContext() output:
    // union of direct AssessmentRuleLegalRequirement + LegalRequirementContextRelation (toRuleId != null).
    const validationContext: DecisionValidationContext = {
      caseRevision: 1,
      pins: {
        ruleSetVersionId: RULE_SET_ID,
        repositorySnapshotId: SNAPSHOT_ID,
        repositoryCommit: COMMIT,
      },
      rule: {
        assessmentRuleId: "rule-1",
        assessmentRuleVersion: "1",
        criterionIds: new Set(["crit-1"]),
        legalContextIds: new Set([directRequirementId, relatedRequirementId]),
        declaredElements: new Map([
          [
            directRequirementId,
            {
              applicabilityConditions: 1,
              qualifiers: 0,
              exceptions: 0,
            },
          ],
        ]),
      },
      evidence: new Map([
        [
          EVIDENCE_HUMAN_ID,
          {
            state: ASSESSMENT_RECORD_STATES.ACCEPTED,
            repositoryCommit: COMMIT,
            type: ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER,
            payload: {},
          },
        ],
        [
          EVIDENCE_REPO_ID,
          {
            state: ASSESSMENT_RECORD_STATES.ACCEPTED,
            repositoryCommit: COMMIT,
            type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
            payload: {},
          },
        ],
      ]),
      facts: new Map([
        [
          FACT_HUMAN_ID,
          {
            state: ASSESSMENT_RECORD_STATES.ACCEPTED,
            caseRevision: 1,
            authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
            evidenceIds: [EVIDENCE_HUMAN_ID],
          },
        ],
      ]),
    };

    // 1. Accepted by DecisionValidator
    expect(validateRuleDecision(decision, validationContext)).toEqual([]);

    // 2. Accepted by V3 report contract with explicit source-pinned relatedLegalContexts
    const v3Candidate = {
      schemaVersion: ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
      artifactId: ARTIFACT_ID,
      assessmentId: ASSESSMENT_ID,
      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      identity: { repositorySnapshotId: SNAPSHOT_ID, repositoryCommit: COMMIT },
      pins: {
        legalSourceVersionId: LEGAL_SOURCE_ID,
        legalSourceVersion: "LAW-2026",
        ruleSetVersionId: RULE_SET_ID,
        ruleSetVersion: "RULES-2026",
        ruleSetDigest: "b".repeat(64),
        repositorySnapshotId: SNAPSHOT_ID,
        repositoryScanJobId: SCAN_JOB_ID,
        repositoryCommit: COMMIT,
        sourcePathPrefix: "apps/api",
      },
      caseRevision: 1,
      decisionFingerprint: sha("c"),
      sourceScope: {
        mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
        visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
        sourcePathPrefix: "apps/api",
        excludedPaths: [],
        limitationReasons: [],
        searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
      },
      legalRequirements: [
        {
          legalRequirementId: directRequirementId,
          title: "Primary retention duty",
          proposition: "Enforce bounded retention.",
          applicabilityConditions: ["System stores customer records."],
          qualifiers: [],
          exceptions: [],
          nonRepositoryDuty: false,
          coverageState:
            LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
          sourceRefs: [sourceRef("law-1")],
        },
        {
          legalRequirementId: relatedRequirementId,
          title: "Personal data term definition",
          proposition: "Defines regulated customer record.",
          applicabilityConditions: [],
          qualifiers: [],
          exceptions: [],
          nonRepositoryDuty: false,
          coverageState: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
          sourceRefs: [sourceRef("law-def")],
        },
        {
          legalRequirementId: unrelatedRequirementId,
          title: "Unrelated duty",
          proposition: "Separate rule scope.",
          applicabilityConditions: [],
          qualifiers: [],
          exceptions: [],
          nonRepositoryDuty: false,
          coverageState:
            LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
          sourceRefs: [sourceRef("law-other")],
        },
      ],
      ruleDetails: [
        {
          assessmentRuleId: "rule-1",
          assessmentRuleVersion: "1",
          legalRequirementIds: [directRequirementId],
          relatedLegalContexts: [
            {
              relationId: "rel-def-1",
              kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
              fromLegalRequirementId: directRequirementId,
              toLegalRequirementId: relatedRequirementId,
              sourceRefs: [sourceRef("law-def")],
            },
          ],
          concept: "Retention control",
          legalIntent: "Bound personal record storage duration.",
          applicabilityGuidance: "Evaluate when customer records exist.",
          criteria: [{ criterionId: "crit-1", statement: "Purge configured." }],
          decisionId: DECISION_ID,
          decisionRevision: 1,
          decision,
          decisionReferences: [
            {
              origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.decision,
              reference: criterionRef,
            },
          ],
          applicabilityBasisReferences: [
            {
              origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.applicabilityBasis,
              legalRequirementId: directRequirementId,
              kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
              index: 0,
              reference: basisRef,
            },
          ],
          factEvidenceReferences: [
            {
              origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.factEvidence,
              factId: FACT_HUMAN_ID,
              reference: {
                type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                evidenceId: EVIDENCE_HUMAN_ID,
              },
            },
          ],
          criteriaDecisions: [
            {
              criterionId: "crit-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
              rationale: "Control verified in repository.",
              references: [
                {
                  origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.criterion,
                  reference: criterionRef,
                },
              ],
            },
          ],
          narrative: {
            summary: "Rule summary.",
            recommendations: ["Monitor retention metrics."],
          },
          factIds: [FACT_HUMAN_ID],
          evidenceIds: [EVIDENCE_HUMAN_ID, EVIDENCE_REPO_ID],
          sourceRefs: [sourceRef("law-1")],
        },
      ],
      factIndex: [
        {
          factId: FACT_HUMAN_ID,
          caseRevision: 1,
          kind: ASSESSMENT_FACT_KINDS.FACT,
          authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
          statement: "Customer confirmed records are stored.",
          evidenceIds: [EVIDENCE_HUMAN_ID],
        },
      ],
      evidenceIndex: [
        {
          evidenceId: EVIDENCE_HUMAN_ID,
          type: ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER,
          contentSha256: sha("d"),
          repositoryCommit: COMMIT,
          safeLocator: null,
        },
        {
          evidenceId: EVIDENCE_REPO_ID,
          type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
          contentSha256: sha("e"),
          repositoryCommit: COMMIT,
          safeLocator: "apps/api/src/retention/purge.ts:10-42",
        },
        {
          evidenceId: EVIDENCE_COVERAGE_ID,
          type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
          contentSha256: sha("f"),
          repositoryCommit: COMMIT,
          safeLocator: null,
          searchCoverage: {
            scopes: [
              {
                kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
                path: "apps/api",
              },
            ],
            truncatedQueriesCount: 0,
            knownGapsCount: 0,
            directFallbackCount: 0,
          },
        },
      ],
      outcomeSummary: {
        totalRules: 1,
        applicableCompliant: 1,
        applicableNonCompliant: 0,
        notApplicable: 0,
      },
      boundedNarrative: {
        summary: "Overall summary.",
        scopeLimitations: [],
      },
      boundedActionPlan: {
        maxHighlightItems:
          ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS,
        totalRecommendations: 1,
        omittedCount: 0,
        truncated: false,
        items: [
          {
            actionId: "rule-1#0",
            assessmentRuleId: "rule-1",
            ruleDetailRef: "/ruleDetails/0",
            recommendationIndex: 0,
            priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
          },
        ],
      },
      publicationProvenance: {
        sourceManifestDigest: null,
        publishedAt: null,
      },
    };

    expect(assessmentFinalReportV3Schema.safeParse(v3Candidate).success).toBe(
      true,
    );

    // 3. Unrelated requirement is rejected identically by both DecisionValidator and V3 schema
    const unauthorizedDecision = {
      ...decision,
      legalContextRefs: [
        { legalContextId: directRequirementId },
        { legalContextId: unrelatedRequirementId },
      ],
    };
    const validatorFailures = validateRuleDecision(
      unauthorizedDecision,
      validationContext,
    );
    expect(validatorFailures.map((f) => f.code)).toContain(
      DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_LEGAL_CONTEXT,
    );
    expect(
      assessmentFinalReportV3Schema.safeParse({
        ...v3Candidate,
        ruleDetails: [
          {
            ...v3Candidate.ruleDetails[0],
            decision: unauthorizedDecision,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
