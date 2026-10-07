import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  BLOCKER_REASONS,
  DECISION_RESOLUTION_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_COMPLETION_BLOCKER_CODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  ASSESSMENT_RECORD_STATES,
  type AssessmentCompletionBlockerCode,
} from "@lcsp/contracts/assessment-domain";
import {
  ArtifactLifecycleState,
  LegalPortfolioValidationOutcome,
  RepositoryScanJobStatus,
  RepositorySnapshotStatus,
  type Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentCompletionGate } from "./assessment-completion-gate.service.js";

const assessmentId = randomUUID();
const portfolioVersionId = randomUUID();
const snapshotId = randomUUID();
const scanJobId = randomUUID();
const evidenceId = randomUUID();
const factId = randomUUID();
const repositoryCommit = "a".repeat(40);
const engineeringRuleId = "ER-1";
const engineeringRuleVersion = "v1";
const legalRuleId = "LR-1";
const criterionId = "C-1";

type Fixture = {
  assessment: {
    lifecycleState: string;
    lifecycleRevision: number;
    blockerReason: string | null;
    blockerReference: string | null;
    runtime: {
      executionState: string;
      currentExecutionId: string | null;
    } | null;
  };
  assessmentCase: {
    caseRevision: number;
    legalPortfolioVersionId: string | null;
    repositorySnapshotId: string | null;
    repositoryScanJobId: string | null;
    repositoryCommit: string | null;
    pinnedAt: Date | null;
  };
  portfolio: {
    id: string;
    lifecycleState: string;
    validationOutcome: string;
  } | null;
  snapshot: {
    id: string;
    assessmentId: string;
    commitSha: string;
    status: string;
  } | null;
  scanJob: {
    id: string;
    assessmentId: string;
    snapshotId: string;
    status: string;
  } | null;
  rules: Array<{ engineeringRuleId: string; engineeringRuleVersion: string }>;
  coverage: Array<{
    engineeringRuleId: string;
    portfolioVersionId: string;
    engineeringRuleVersion: string;
    resolutionState: string;
    currentDecisionId: string | null;
    decisionRevision: number;
  }>;
  decisions: Array<{
    decisionId: string;
    engineeringRuleId: string;
    engineeringRuleVersion: string;
    scopeId: string;
    portfolioVersionId: string;
    decisionRevision: number;
    state: string;
    repositoryCommit: string;
    caseRevision: number;
    decision: ReturnType<typeof ruleDecisionSchema.parse>;
  }>;
  evidence: Array<{
    evidenceId: string;
    type: string;
    state: string;
    contentSha256: string;
    repositoryCommit: string;
  }>;
  facts: Array<{
    factId: string;
    caseRevision: number;
    kind: string;
    authority: string;
    state: string;
    statement: string;
    evidenceLinks: Array<{ evidenceId: string }>;
  }>;
  openRequests: Array<{ requestId: string }>;
  artifacts: Array<{ artifactId: string }>;
};

function createFixture() {
  const decision = ruleDecisionSchema.parse({
    engineeringRuleId,
    engineeringRuleVersion,
    scopeId: ASSESSMENT_DECISION_SCOPE,
    legalPortfolioVersionId: portfolioVersionId,
    repositorySnapshotId: snapshotId,
    repositoryCommit,
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: legalRuleId }],
    applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
    rationale: "The Root recorded its conclusion against accepted state.",
    references: [
      {
        type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
        evidenceId,
      },
      {
        type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
        factId,
        caseRevision: 1,
      },
    ],
    criteria: [
      {
        criterionId,
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "The accepted evidence supports this criterion.",
        references: [
          {
            type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
            evidenceId,
          },
        ],
      },
    ],
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  });
  const fixture: Fixture = {
    assessment: {
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      lifecycleRevision: 3,
      blockerReason: null,
      blockerReference: null,
      runtime: {
        executionState: AGENT_EXECUTION_STATES.RUNNING,
        currentExecutionId: randomUUID(),
      },
    },
    assessmentCase: {
      caseRevision: 1,
      legalPortfolioVersionId: portfolioVersionId,
      repositorySnapshotId: snapshotId,
      repositoryScanJobId: scanJobId,
      repositoryCommit,
      pinnedAt: new Date(),
    },
    portfolio: {
      id: portfolioVersionId,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
      validationOutcome: LegalPortfolioValidationOutcome.PASSED,
    },
    snapshot: {
      id: snapshotId,
      assessmentId,
      commitSha: repositoryCommit,
      status: RepositorySnapshotStatus.READY,
    },
    scanJob: {
      id: scanJobId,
      assessmentId,
      snapshotId,
      status: RepositoryScanJobStatus.COMPLETED,
    },
    rules: [{ engineeringRuleId, engineeringRuleVersion }],
    coverage: [
      {
        engineeringRuleId,
        portfolioVersionId,
        engineeringRuleVersion,
        resolutionState: DECISION_RESOLUTION_STATES.RESOLVED,
        currentDecisionId: "decision-1",
        decisionRevision: 1,
      },
    ],
    decisions: [
      {
        decisionId: "decision-1",
        engineeringRuleId,
        engineeringRuleVersion,
        scopeId: ASSESSMENT_DECISION_SCOPE,
        portfolioVersionId,
        decisionRevision: 1,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        repositoryCommit,
        caseRevision: 1,
        decision,
      },
    ],
    evidence: [
      {
        evidenceId,
        type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
        state: ASSESSMENT_RECORD_STATES.ACCEPTED,
        contentSha256: `sha256:${"b".repeat(64)}`,
        repositoryCommit,
      },
    ],
    facts: [
      {
        factId,
        caseRevision: 1,
        kind: ASSESSMENT_FACT_KINDS.FACT,
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        state: ASSESSMENT_RECORD_STATES.ACCEPTED,
        statement: "The named owner is recorded as a confirmed fact.",
        evidenceLinks: [{ evidenceId }],
      },
    ],
    openRequests: [],
    artifacts: [],
  };

  const transaction = {
    assessment: {
      findUnique: () => Promise.resolve(fixture.assessment),
    },
    assessmentCase: {
      findUnique: () => Promise.resolve(fixture.assessmentCase),
    },
    legalPortfolioVersion: {
      findUnique: () => Promise.resolve(fixture.portfolio),
    },
    repositorySnapshot: {
      findUnique: () => Promise.resolve(fixture.snapshot),
    },
    repositoryScanJob: {
      findUnique: () => Promise.resolve(fixture.scanJob),
    },
    engineeringRule: { findMany: () => Promise.resolve(fixture.rules) },
    assessmentDecisionCoverage: {
      findMany: () => Promise.resolve(fixture.coverage),
    },
    assessmentRuleDecision: {
      findMany: () => Promise.resolve(fixture.decisions),
    },
    assessmentEvidence: {
      findMany: () => Promise.resolve(fixture.evidence),
    },
    assessmentCaseFact: {
      findMany: () => Promise.resolve(fixture.facts),
    },
    assessmentHumanRequest: {
      findMany: () => Promise.resolve(fixture.openRequests),
    },
    assessmentArtifact: {
      findMany: () => Promise.resolve(fixture.artifacts),
    },
  } as unknown as Prisma.TransactionClient;

  const support = {
    buildValidationContext: () =>
      Promise.resolve({
        caseRevision: fixture.assessmentCase.caseRevision,
        pins: {
          legalPortfolioVersionId:
            fixture.assessmentCase.legalPortfolioVersionId!,
          repositorySnapshotId: fixture.assessmentCase.repositorySnapshotId!,
          repositoryCommit: fixture.assessmentCase.repositoryCommit!,
        },
        rule: {
          engineeringRuleId,
          engineeringRuleVersion,
          criterionIds: new Set([criterionId]),
          legalContextIds: new Set([legalRuleId]),
        },
        evidence: new Map(
          fixture.evidence.map((item) => [
            item.evidenceId,
            { state: item.state, repositoryCommit: item.repositoryCommit },
          ]),
        ),
        facts: new Map(
          fixture.facts.map((item) => [
            item.factId,
            { state: item.state, caseRevision: item.caseRevision },
          ]),
        ),
      }),
  } as unknown as AssessmentCaseSupport;

  return {
    fixture,
    gate: new AssessmentCompletionGate(support),
    transaction,
  };
}

describe("AssessmentCompletionGate", () => {
  it("returns the frozen snapshot when every mechanical prerequisite is current", async () => {
    const { gate, transaction } = createFixture();

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.blockers).toEqual([]);
    expect(result.snapshot).toMatchObject({
      caseRevision: 1,
      pins: { legalPortfolioVersionId: portfolioVersionId, repositoryCommit },
      decisions: [{ decisionId: "decision-1" }],
      evidence: [{ evidenceId }],
      facts: [{ factId }],
    });
  });

  const blockerCases: Array<{
    name: string;
    code: AssessmentCompletionBlockerCode;
    mutate: (fixture: Fixture) => void;
  }> = [
    {
      name: "open Human Resolution request",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.OPEN_HUMAN_REQUEST,
      mutate: (fixture) =>
        fixture.openRequests.push({ requestId: randomUUID() }),
    },
    {
      name: "required input",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.REQUIRED_INPUT_UNRESOLVED,
      mutate: (fixture) => {
        fixture.assessment.lifecycleState =
          ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT;
      },
    },
    {
      name: "required-input blocker reason",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.REQUIRED_INPUT_UNRESOLVED,
      mutate: (fixture) => {
        fixture.assessment.blockerReason =
          BLOCKER_REASONS.REQUIRED_RUNTIME_INPUT_UNAVAILABLE;
      },
    },
    ...[
      DECISION_RESOLUTION_STATES.PENDING,
      DECISION_RESOLUTION_STATES.INVESTIGATING,
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    ].map((state) => ({
      name: `${state} decision coverage`,
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.DECISION_UNRESOLVED,
      mutate: (fixture: Fixture) => {
        fixture.coverage[0].resolutionState = state;
      },
    })),
    {
      name: "invalidated decision coverage",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.coverage[0].resolutionState =
          DECISION_RESOLUTION_STATES.INVALIDATED;
      },
    },
    {
      name: "stale evidence reference",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_EVIDENCE,
      mutate: (fixture) => {
        fixture.evidence[0].state = ASSESSMENT_RECORD_STATES.INVALIDATED;
      },
    },
    {
      name: "search coverage from an older repository commit",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_EVIDENCE,
      mutate: (fixture) => {
        fixture.evidence[0].type = ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE;
        fixture.evidence[0].repositoryCommit = "b".repeat(40);
      },
    },
    {
      name: "stale fact reference",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_FACT,
      mutate: (fixture) => {
        fixture.facts[0].state = ASSESSMENT_RECORD_STATES.INVALIDATED;
      },
    },
    {
      name: "decision revision no longer current",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.decisions[0].caseRevision = 0;
      },
    },
    {
      name: "decision coverage from a different portfolio version",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.coverage[0].portfolioVersionId = randomUUID();
      },
    },
    {
      name: "decision coverage with a stale rule version",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.coverage[0].engineeringRuleVersion = "v0";
      },
    },
    {
      name: "decision payload for a different rule",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.decisions[0].decision = ruleDecisionSchema.parse({
          ...fixture.decisions[0].decision,
          engineeringRuleId: "ER-OTHER",
        });
      },
    },
    {
      name: "decision record from another scope",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.decisions[0].scopeId = "OUTSIDE_ASSESSMENT_SCOPE";
      },
    },
    {
      name: "more than one accepted decision for a rule",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.decisions.push({
          ...fixture.decisions[0],
          decisionId: "decision-duplicate",
          decisionRevision: 2,
        });
      },
    },
    {
      name: "missing rule coverage",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.MISSING_RULE_COVERAGE,
      mutate: (fixture) => {
        fixture.coverage.length = 0;
      },
    },
    {
      name: "unresolved fatal execution",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.EXECUTION_FAILURE,
      mutate: (fixture) => {
        fixture.assessment.runtime!.currentExecutionId = null;
      },
    },
    {
      name: "invalid pinned portfolio",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.PORTFOLIO_INVALID,
      mutate: (fixture) => {
        fixture.portfolio!.lifecycleState = ArtifactLifecycleState.BUILDING;
      },
    },
    {
      name: "repository snapshot pin mismatch",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.REPOSITORY_SNAPSHOT_INVALID,
      mutate: (fixture) => {
        fixture.snapshot!.commitSha = "c".repeat(40);
      },
    },
    {
      name: "failed repository hydration ticket",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.REPOSITORY_SNAPSHOT_INVALID,
      mutate: (fixture) => {
        fixture.scanJob!.status = RepositoryScanJobStatus.FAILED;
      },
    },
    {
      name: "missing pins",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.PINS_MISSING,
      mutate: (fixture) => {
        fixture.assessmentCase.repositorySnapshotId = null;
      },
    },
    {
      name: "existing final artifact prerequisite",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.INVALID_ARTIFACT_PREREQUISITE,
      mutate: (fixture) => fixture.artifacts.push({ artifactId: randomUUID() }),
    },
  ];

  it.each(blockerCases)(
    "blocks when there is $name",
    async ({ code, mutate }) => {
      const { fixture, gate, transaction } = createFixture();
      mutate(fixture);

      const result = await gate.inspectInTx(transaction, assessmentId);

      expect(result.blockers.map((blocker) => blocker.code)).toContain(code);
      expect(result.snapshot).toBeNull();
    },
  );

  it.each([RepositoryScanJobStatus.QUEUED, RepositoryScanJobStatus.RUNNING])(
    "allows the pinned snapshot hydration ticket while it is %s",
    async (status) => {
      const { fixture, gate, transaction } = createFixture();
      fixture.scanJob!.status = status;

      const result = await gate.inspectInTx(transaction, assessmentId);

      expect(result.blockers).toEqual([]);
      expect(result.snapshot).not.toBeNull();
    },
  );
});
