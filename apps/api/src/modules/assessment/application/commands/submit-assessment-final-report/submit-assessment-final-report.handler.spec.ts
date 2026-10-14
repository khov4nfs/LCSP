import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_LIFECYCLE_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_DECISION_SCOPE,
  assessmentFinalReportArtifactSchema,
} from "@lcsp/contracts/assessment-domain";
import { describe, expect, it, jest } from "@jest/globals";
import { ArtifactLifecycleState, AssessmentArtifactKind } from "@prisma/client";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";
import type { AssessmentCompletionGate } from "../../services/assessment-completion-gate.service.js";
import type { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import type { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { canonicalJson, sha256Hex } from "../../../domain/domain-ids.js";
import { SubmitAssessmentFinalReportCommand } from "./submit-assessment-final-report.command.js";
import { SubmitAssessmentFinalReportHandler } from "./submit-assessment-final-report.handler.js";

const assessmentId = randomUUID();
const evidenceId = randomUUID();
const ruleSetId = randomUUID();
const snapshotId = randomUUID();
const legalSourceId = randomUUID();
const decision = ruleDecisionSchema.parse({
  assessmentRuleId: "ER-1",
  assessmentRuleVersion: "v1",
  scopeId: ASSESSMENT_DECISION_SCOPE,
  ruleSetVersionId: ruleSetId,
  repositorySnapshotId: snapshotId,
  repositoryCommit: "a".repeat(40),
  caseRevision: 1,
  legalContextRefs: [{ legalContextId: "LR-1" }],
  applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
  rationale: "The accepted evidence supports this outcome.",
  references: [
    {
      type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
      evidenceId,
    },
  ],
  criteria: [
    {
      criterionId: "C-1",
      outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
      rationale: "The cited evidence supports the criterion.",
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

function buildHandler(
  options: {
    existingArtifact?: unknown;
    storedContent?: string;
    storageFailure?: boolean;
  } = {},
) {
  const snapshot = {
    caseRevision: 1,
    pins: {
      ruleSetVersionId: ruleSetId,
      repositorySnapshotId: snapshotId,
      repositoryScanJobId: "scan-1",
      repositoryCommit: "a".repeat(40),
    },
    decisions: [{ decisionId: randomUUID(), decisionRevision: 1, decision }],
    evidence: [
      {
        evidenceId,
        type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
        contentSha256: `sha256:${"b".repeat(64)}`,
        repositoryCommit: "a".repeat(40),
      },
    ],
    facts: [],
    legalProvenance: {},
  };
  const sourceChunk = {
    id: "chunk-1",
    legalSourceVersionId: legalSourceId,
    documentId: "DOC-1",
    locator: "article-1",
    contentSha256: `sha256:${"c".repeat(64)}`,
    legalStatus: "ACTIVE",
  };
  const findExistingArtifact = jest.fn(() =>
    Promise.resolve(options.existingArtifact ?? null),
  );
  const tx = {
    assessmentArtifact: {
      findUnique: findExistingArtifact,
      create: jest.fn((_payload: unknown) => {
        void _payload;
        return Promise.resolve({});
      }),
      update: jest.fn((_payload: unknown) => {
        void _payload;
        return Promise.resolve({});
      }),
    },
    complianceRuleSetVersion: {
      findUnique: () =>
        Promise.resolve({
          id: ruleSetId,
          version: "rules-v1",
          ruleSetDigest: "d".repeat(64),
          legalSourceVersion: {
            id: legalSourceId,
            version: "source-v1",
            integrityManifestRef: null,
          },
        }),
    },
    assessmentRule: {
      findMany: () =>
        Promise.resolve([
          {
            assessmentRuleId: "ER-1",
            assessmentRuleVersion: "v1",
            concept: "Retention",
            legalIntent: "Records are retained.",
            applicabilityGuidance: "Applies to the system.",
            criteria: [{ criterionId: "C-1", statement: "Retention exists." }],
            contract: {
              sourceChunkIds: [sourceChunk.id],
              criteria: [
                { criterionId: "C-1", statement: "Retention exists." },
              ],
            },
            legalRequirementLinks: [{ legalRequirementRowId: "req-1" }],
          },
        ]),
    },
    legalRequirement: {
      findMany: () =>
        Promise.resolve([
          {
            id: "req-1",
            legalRequirementId: "LR-1",
            title: "Retention requirement",
            proposition: "Records are retained.",
            applicabilityConditions: ["The system stores records."],
            qualifiers: [],
            exceptions: [],
            nonRepositoryDuty: false,
            coverageState: "COVERED_BY_ASSESSMENT_RULES",
            provenance: [
              {
                legalSourceVersionId: legalSourceId,
                documentId: sourceChunk.documentId,
                locator: sourceChunk.locator,
                contentSha256: sourceChunk.contentSha256,
              },
            ],
          },
        ]),
    },
    legalDocumentChunk: { findMany: () => Promise.resolve([sourceChunk]) },
    assessmentCaseFact: { findMany: () => Promise.resolve([]) },
    assessmentEvidence: {
      findMany: () =>
        Promise.resolve([
          {
            evidenceId,
            type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
            state: "ACCEPTED",
            repositoryCommit: "a".repeat(40),
            contentSha256: `sha256:${"b".repeat(64)}`,
            payload: { path: "src/retention.ts", startLine: 1, endLine: 2 },
          },
        ]),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  const authority = {
    authorizeInTx: jest.fn(() =>
      Promise.resolve({
        assessmentId,
        threadId: randomUUID(),
        executionId: randomUUID(),
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
        lifecycleRevision: 2,
      }),
    ),
  } as unknown as AssessmentRuntimeAuthority;
  const completionGate = {
    inspectInTx: jest.fn(() =>
      Promise.resolve({
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
        blockers: [],
        snapshot,
      }),
    ),
  } as unknown as AssessmentCompletionGate;
  const coordinator = {
    transitionVerifiedInTx: jest.fn(),
  } as unknown as AssessmentLifecycleCoordinator;
  const events = {
    appendInTx: jest.fn(),
  } as unknown as AssessmentEventAppender;
  const writeImmutableArtifact = jest.fn(
    (artifactId: string, content: string) => {
      if (options.storageFailure) {
        return Promise.reject(new Error("storage unavailable"));
      }
      const hash = sha256Hex(content);
      return {
        manifest: {
          artifact_id: artifactId,
          total_size: Buffer.byteLength(content),
          hash,
          chunks: [`${hash}.chunk`],
        },
        sizeBytes: Buffer.byteLength(content),
      };
    },
  );
  const readAndReconstruct = jest.fn(() =>
    Promise.resolve(options.storedContent ?? ""),
  );
  const storage = {
    writeImmutableArtifact,
    readAndReconstruct,
  } as unknown as ArtifactStorageService;
  return {
    handler: new SubmitAssessmentFinalReportHandler(
      prisma,
      authority,
      completionGate,
      coordinator,
      events,
      storage,
    ),
    findExistingArtifact,
    writeImmutableArtifact,
    readAndReconstruct,
    tx,
  };
}

describe("SubmitAssessmentFinalReportHandler", () => {
  const unresolvedTextCases: Array<{
    label: string;
    summary?: string;
    findingSummary?: string;
    recommendation?: string;
  }> = [
    { label: "UNKNOWN in report summary", summary: "UNKNOWN" },
    { label: "PARTIAL in finding summary", findingSummary: "PARTIAL" },
    {
      label: "NEEDS_CONTEXT in recommendation",
      recommendation: "NEEDS_CONTEXT",
    },
    {
      label: "unresolved question in finding summary",
      findingSummary: "There is an unresolved question.",
    },
    {
      label: "open question in recommendation",
      recommendation: "An open question.",
    },
    { label: "TBD in report summary", summary: "TBD verdict" },
  ];

  const requestFor = (text: {
    summary?: string;
    findingSummary?: string;
    recommendation?: string;
  }) => ({
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    summary: text.summary ?? "The assessment is complete.",
    findings: [
      {
        assessmentRuleId: "ER-1",
        summary:
          text.findingSummary ?? "The accepted rule decision is complete.",
        recommendations: text.recommendation ? [text.recommendation] : [],
      },
    ],
  });

  it.each(unresolvedTextCases)(
    "rejects $label on new submission",
    async (text) => {
      const { handler, writeImmutableArtifact, tx } = buildHandler();
      const command = new SubmitAssessmentFinalReportCommand(
        assessmentId,
        randomUUID(),
        requestFor(text),
        randomUUID(),
      );

      await expect(handler.execute(command)).rejects.toMatchObject({
        response: {
          problem: { code: ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID },
        },
      });
      expect(writeImmutableArtifact).not.toHaveBeenCalled();
      expect(tx.assessmentArtifact.findUnique).toHaveBeenCalledTimes(1);
    },
  );

  it("persists a V2 artifact only after canonical assembly", async () => {
    const { handler, writeImmutableArtifact, tx } = buildHandler();
    const result = await handler.execute(
      new SubmitAssessmentFinalReportCommand(
        assessmentId,
        randomUUID(),
        requestFor({}),
        randomUUID(),
      ),
    );

    expect(result.replayed).toBe(false);
    expect(result.lifecycleState).toBe(ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
    expect(writeImmutableArtifact).toHaveBeenCalledTimes(1);
    expect(tx.assessmentArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schemaVersion: ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
        }),
      }),
    );
  });

  it("does not create or activate an artifact when immutable storage fails", async () => {
    const { handler, tx } = buildHandler({ storageFailure: true });

    await expect(
      handler.execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          requestFor({}),
          randomUUID(),
        ),
      ),
    ).rejects.toThrow("storage unavailable");
    expect(tx.assessmentArtifact.create).not.toHaveBeenCalled();
    expect(tx.assessmentArtifact.update).not.toHaveBeenCalled();
  });

  it("rejects unresolved text while replaying an immutable artifact", async () => {
    const request = requestFor({
      recommendation: "There is an unresolved question.",
    });
    const artifactId = randomUUID();
    const decisionId = randomUUID();
    const report = assessmentFinalReportArtifactSchema.parse({
      schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
      artifactId,
      assessmentId,
      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      pins: {
        ruleSetVersionId: ruleSetId,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: "scan-1",
        repositoryCommit: "a".repeat(40),
      },
      caseRevision: 1,
      decisionFingerprint: `sha256:${sha256Hex(
        canonicalJson([{ decisionId, decisionRevision: 1, decision }]),
      )}`,
      summary: request.summary,
      findings: [
        {
          assessmentRuleId: "ER-1",
          decisionId,
          decisionRevision: 1,
          decision,
          summary: request.findings[0].summary,
          recommendations: request.findings[0].recommendations,
        },
      ],
      provenance: {
        evidenceIds: [evidenceId],
        factIds: [],
        searchCoverageEvidenceIds: [],
      },
    });
    const storedContent = canonicalJson(report);
    const contentHash = sha256Hex(storedContent);
    const manifest = {
      artifact_id: artifactId,
      total_size: Buffer.byteLength(storedContent, "utf8"),
      hash: contentHash,
      chunks: ["artifact.chunk"],
    };
    const existingArtifact = {
      artifactId,
      assessmentId,
      kind: AssessmentArtifactKind.FINAL_REPORT,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
      ruleSetVersionId: ruleSetId,
      repositorySnapshotId: snapshotId,
      repositoryCommit: "a".repeat(40),
      caseRevision: 1,
      schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
      reportRequestDigest: sha256Hex(canonicalJson(request)),
      contentSha256: `sha256:${contentHash}`,
      sizeBytes: Buffer.byteLength(storedContent, "utf8"),
      storageRef: JSON.stringify(manifest),
    };
    const { handler, writeImmutableArtifact } = buildHandler({
      existingArtifact,
      storedContent,
    });

    await expect(
      handler.execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          request,
          randomUUID(),
        ),
      ),
    ).rejects.toMatchObject({
      response: {
        problem: { code: ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID },
      },
    });
    expect(writeImmutableArtifact).not.toHaveBeenCalled();
  });
});
