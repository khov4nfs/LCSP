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
  SEARCH_COVERAGE_SCOPE_KINDS,
  type AssessmentCompletionBlockerCode,
} from "@lcsp/contracts/assessment-domain";
import {
  ArtifactLifecycleState,
  ComplianceRuleSetValidationOutcome,
  RepositoryScanJobStatus,
  RepositorySnapshotStatus,
  type Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";

import { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentCompletionGate } from "./assessment-completion-gate.service.js";

const assessmentId = randomUUID();
const ruleSetVersionId = randomUUID();
const snapshotId = randomUUID();
const scanJobId = randomUUID();
const evidenceId = randomUUID();
const factId = randomUUID();
const repositoryCommit = "a".repeat(40);
const assessmentRuleId = "ER-1";
const assessmentRuleVersion = "v1";
const legalRequirementId = "LR-1";
const criterionId = "C-1";
const legalSourceVersionId = randomUUID();
const legalDocumentId = "DOC-1";
const legalLocator = "article-1";
const legalContentSha256 = `sha256:${"c".repeat(64)}`;

type Fixture = {
  controlState: string;
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
    ruleSetVersionId: string | null;
    repositorySnapshotId: string | null;
    repositoryScanJobId: string | null;
    repositoryCommit: string | null;
    pinnedAt: Date | null;
  };
  ruleSet: {
    id: string;
    lifecycleState: string;
    validationOutcome: string;
    legalSourceVersionId: string;
    legalSourceVersion: { id: string; version: string; status: string };
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
  rules: Array<{
    assessmentRuleId: string;
    assessmentRuleVersion: string;
    contract: unknown;
    legalRequirementLinks: Array<{ legalRequirementRowId: string }>;
  }>;
  legalRequirements: Array<{
    id: string;
    ruleSetVersionId: string;
    legalRequirementId: string;
    coverageState: string;
    provenance: Array<{
      legalSourceVersionId: string;
      chunkId: string;
      documentId: string;
      locator: string;
      contentSha256: string;
      sourceEffectStatus: string | null;
      chunk: {
        legalSourceVersionId: string;
        documentId: string;
        locator: string;
        contentSha256: string;
        legalStatus: string;
        sourceDocument: { legalSourceVersionId: string; documentId: string };
      };
    }>;
  }>;
  legalDocumentChunks: Array<{
    id: string;
    legalSourceVersionId: string;
    documentId: string;
    locator: string;
    contentSha256: string;
    legalStatus: string;
  }>;
  coverage: Array<{
    assessmentRuleId: string;
    ruleSetVersionId: string;
    assessmentRuleVersion: string;
    resolutionState: string;
    currentDecisionId: string | null;
    decisionRevision: number;
  }>;
  decisions: Array<{
    decisionId: string;
    assessmentRuleId: string;
    assessmentRuleVersion: string;
    scopeId: string;
    ruleSetVersionId: string;
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
    payload: unknown;
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
    assessmentRuleId,
    assessmentRuleVersion,
    scopeId: ASSESSMENT_DECISION_SCOPE,
    ruleSetVersionId: ruleSetVersionId,
    repositorySnapshotId: snapshotId,
    repositoryCommit,
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: legalRequirementId }],
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
    controlState: Controls.running,
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
      ruleSetVersionId: ruleSetVersionId,
      repositorySnapshotId: snapshotId,
      repositoryScanJobId: scanJobId,
      repositoryCommit,
      pinnedAt: new Date(),
    },
    ruleSet: {
      id: ruleSetVersionId,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
      validationOutcome: ComplianceRuleSetValidationOutcome.PASSED,
      legalSourceVersionId,
      legalSourceVersion: {
        id: legalSourceVersionId,
        version: "v1",
        status: "ACTIVE",
      },
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
    rules: [
      {
        assessmentRuleId,
        assessmentRuleVersion,
        contract: {
          sourceChunkIds: ["chunk-1"],
        },
        legalRequirementLinks: [{ legalRequirementRowId: "lr-row-1" }],
      },
    ],
    legalRequirements: [
      {
        id: "lr-row-1",
        ruleSetVersionId,
        legalRequirementId,
        coverageState: "COVERED_BY_ASSESSMENT_RULES",
        provenance: [
          {
            legalSourceVersionId,
            chunkId: "chunk-1",
            documentId: legalDocumentId,
            locator: legalLocator,
            contentSha256: legalContentSha256,
            sourceEffectStatus: "ACTIVE",
            chunk: {
              legalSourceVersionId,
              documentId: legalDocumentId,
              locator: legalLocator,
              contentSha256: legalContentSha256,
              legalStatus: "ACTIVE",
              sourceDocument: {
                legalSourceVersionId,
                documentId: legalDocumentId,
              },
            },
          },
        ],
      },
    ],
    legalDocumentChunks: [
      {
        id: "chunk-1",
        legalSourceVersionId,
        documentId: legalDocumentId,
        locator: legalLocator,
        contentSha256: legalContentSha256,
        legalStatus: "ACTIVE",
      },
    ],
    coverage: [
      {
        assessmentRuleId,
        ruleSetVersionId,
        assessmentRuleVersion,
        resolutionState: DECISION_RESOLUTION_STATES.RESOLVED,
        currentDecisionId: "decision-1",
        decisionRevision: 1,
      },
    ],
    decisions: [
      {
        decisionId: "decision-1",
        assessmentRuleId,
        assessmentRuleVersion,
        scopeId: ASSESSMENT_DECISION_SCOPE,
        ruleSetVersionId,
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
        payload: {},
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
    assessmentRuntimeTurn: {
      findFirst: () => Promise.resolve({ state: fixture.controlState }),
    },
    assessmentCase: {
      findUnique: () => Promise.resolve(fixture.assessmentCase),
    },
    complianceRuleSetVersion: {
      findUnique: () => Promise.resolve(fixture.ruleSet),
    },
    repositorySnapshot: {
      findUnique: () => Promise.resolve(fixture.snapshot),
    },
    repositoryScanJob: {
      findUnique: () => Promise.resolve(fixture.scanJob),
    },
    assessmentRule: { findMany: () => Promise.resolve(fixture.rules) },
    legalRequirement: {
      findMany: () => Promise.resolve(fixture.legalRequirements),
    },
    legalDocumentChunk: {
      findMany: () => Promise.resolve(fixture.legalDocumentChunks),
    },
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
          ruleSetVersionId: fixture.assessmentCase.ruleSetVersionId!,
          repositorySnapshotId: fixture.assessmentCase.repositorySnapshotId!,
          repositoryCommit: fixture.assessmentCase.repositoryCommit!,
        },
        rule: {
          assessmentRuleId,
          assessmentRuleVersion,
          criterionIds: new Set([criterionId]),
          legalContextIds: new Set([legalRequirementId]),
        },
        evidence: new Map(
          fixture.evidence.map((item) => [
            item.evidenceId,
            {
              state: item.state,
              repositoryCommit: item.repositoryCommit,
              type: item.type,
              payload: item.payload,
            },
          ]),
        ),
        facts: new Map(
          fixture.facts.map((item) => [
            item.factId,
            {
              state: item.state,
              caseRevision: item.caseRevision,
              authority: item.authority,
              evidenceIds: item.evidenceLinks.map((link) => link.evidenceId),
            },
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
  it("refuses finalization while the current Root has a pending Stop", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.controlState = Controls.stopRequested;
    const result = await gate.inspectInTx(transaction, assessmentId);
    expect(result.blockers).toContainEqual({
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.RUNTIME_STOP_REQUESTED,
      reference: fixture.assessment.runtime!.currentExecutionId,
    });
    expect(result.snapshot).toBeNull();
  });

  it("returns the frozen snapshot when every mechanical prerequisite is current", async () => {
    const { gate, transaction } = createFixture();

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.blockers).toEqual([]);
    expect(result.snapshot).toMatchObject({
      caseRevision: 1,
      pins: { ruleSetVersionId: ruleSetVersionId, repositoryCommit },
      decisions: [{ decisionId: "decision-1" }],
      evidence: [{ evidenceId }],
      facts: [{ factId }],
    });
  });

  it("blocks a pinned source whose provenance hash no longer matches", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.legalRequirements[0].provenance[0].chunk.contentSha256 = `sha256:${"d".repeat(64)}`;

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.snapshot).toBeNull();
    expect(result.blockers).toContainEqual({
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.LEGAL_SOURCE_HASH_MISMATCH,
      reference: `${legalRequirementId}:${legalDocumentId}:${legalLocator}`,
    });
  });

  it("blocks an invalid or revoked pinned source without requiring ACTIVE status", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.ruleSet!.legalSourceVersion.status = "INVALID";

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.snapshot).toBeNull();
    expect(result.blockers).toContainEqual({
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.LEGAL_SOURCE_REFERENCE_INVALID,
      reference: legalSourceVersionId,
    });
  });

  it("blocks a rule set whose source pin does not match its source record", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.ruleSet!.legalSourceVersionId = randomUUID();

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.snapshot).toBeNull();
    expect(result.blockers).toContainEqual({
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.LEGAL_SOURCE_PIN_MISMATCH,
      reference: ruleSetVersionId,
    });
  });

  it("permits a superseded source when its pinned identity and hashes remain valid", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.ruleSet!.legalSourceVersion.status = "SUPERSEDED";

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.blockers).toEqual([]);
    expect(result.snapshot?.legalProvenance.source.status).toBe("SUPERSEDED");
  });

  it("blocks an assessment rule with an orphaned legal requirement link", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.rules[0].legalRequirementLinks = [
      { legalRequirementRowId: "missing-row" },
    ];

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.snapshot).toBeNull();
    expect(result.blockers).toContainEqual({
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.RULE_REQUIREMENT_LINK_INVALID,
      reference: `${assessmentRuleId}:missing-row`,
    });
  });

  it("blocks missing mandatory legal provenance for a covered requirement", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.legalRequirements[0].provenance = [];

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.snapshot).toBeNull();
    expect(result.blockers).toContainEqual({
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.REPORT_PROVENANCE_INCOMPLETE,
      reference: legalRequirementId,
    });
  });

  it("blocks a rule source chunk that cannot be resolved in the pinned corpus", async () => {
    const { fixture, gate, transaction } = createFixture();
    fixture.rules[0].contract = { sourceChunkIds: ["missing-chunk"] };

    const result = await gate.inspectInTx(transaction, assessmentId);

    expect(result.snapshot).toBeNull();
    expect(result.blockers).toContainEqual({
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.LEGAL_SOURCE_REFERENCE_INVALID,
      reference: `${assessmentRuleId}:missing-chunk`,
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
      name: "incomplete search coverage cannot be final provenance",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_EVIDENCE,
      mutate: (fixture) => {
        fixture.evidence[0].type = ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE;
        fixture.evidence[0].payload = {
          scopes: [
            { kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY, path: "." },
          ],
          queries: [
            {
              tool: "search_code",
              query: "retention",
              resultCount: 0,
              truncated: true,
            },
          ],
          inspectedEntryPoints: [],
          knownGaps: ["Index coverage is incomplete."],
          directSourceFallbacks: [],
        };
      },
    },
    {
      name: "an evidence-cited fact without linked provenance",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_EVIDENCE,
      mutate: (fixture) => {
        fixture.facts[0].authority = ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED;
        fixture.facts[0].evidenceLinks = [];
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
      name: "decision coverage from a different ruleSet version",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.coverage[0].ruleSetVersionId = randomUUID();
      },
    },
    {
      name: "decision coverage with a stale rule version",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.coverage[0].assessmentRuleVersion = "v0";
      },
    },
    {
      name: "decision payload for a different rule",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
      mutate: (fixture) => {
        fixture.decisions[0].decision = ruleDecisionSchema.parse({
          ...fixture.decisions[0].decision,
          assessmentRuleId: "ER-OTHER",
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
      name: "invalid pinned ruleSet",
      code: ASSESSMENT_COMPLETION_BLOCKER_CODES.RULE_SET_INVALID,
      mutate: (fixture) => {
        fixture.ruleSet!.lifecycleState = ArtifactLifecycleState.BUILDING;
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
