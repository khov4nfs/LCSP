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
const portfolioId = randomUUID();
const snapshotId = randomUUID();
const decision = ruleDecisionSchema.parse({
  engineeringRuleId: "ER-1",
  engineeringRuleVersion: "v1",
  scopeId: ASSESSMENT_DECISION_SCOPE,
  legalPortfolioVersionId: portfolioId,
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
  } = {},
) {
  const snapshot = {
    caseRevision: 1,
    pins: {
      legalPortfolioVersionId: portfolioId,
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
  };
  const findExistingArtifact = jest.fn(() =>
    Promise.resolve(options.existingArtifact ?? null),
  );
  const tx = {
    assessmentArtifact: {
      findUnique: findExistingArtifact,
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
  const writeImmutableArtifact = jest.fn();
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
        engineeringRuleId: "ER-1",
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
        legalPortfolioVersionId: portfolioId,
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
          engineeringRuleId: "ER-1",
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
      legalPortfolioVersionId: portfolioId,
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
