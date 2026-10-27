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
const ruleSetId = randomUUID();
const snapshotId = randomUUID();
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
        source: { path: "src/retention.py", startLine: 3, endLine: 9 },
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
      create: jest.fn(),
      update: jest.fn(),
    },
    assessmentRule: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            assessmentRuleId: "ER-1",
            concept: "Retention",
            legalIntent: "Records are kept.",
            applicabilityGuidance: "Applies to the keeper of a register.",
            legalRequirementLinks: [
              {
                legalRequirement: {
                  legalRequirementId: "LR-1",
                  title: "Retention duty",
                  applicabilityConditions: ["The system keeps a register."],
                  qualifiers: [],
                  exceptions: ["Unless the register is private."],
                  ordinal: 0,
                  provenance: [
                    {
                      documentId: "DOC-1",
                      locator: "art-4::cl-1",
                      contentSha256: `sha256:${"c".repeat(64)}`,
                    },
                  ],
                },
              },
            ],
          },
        ]),
      ),
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

  it("permits descriptive natural language such as partial elements in findings or decision rationales", async () => {
    const { handler, writeImmutableArtifact } = buildHandler();
    writeImmutableArtifact.mockImplementation((id: string, content: string) =>
      Promise.resolve({
        manifest: {
          artifact_id: id,
          total_size: Buffer.byteLength(content, "utf8"),
          hash: sha256Hex(content),
          chunks: ["artifact.chunk"],
        },
        sizeBytes: Buffer.byteLength(content, "utf8"),
      }),
    );
    const command = new SubmitAssessmentFinalReportCommand(
      assessmentId,
      randomUUID(),
      requestFor({
        summary: "The assessment is complete.",
        findingSummary:
          "Existing dossiers are partial elements but satisfy baseline requirements.",
      }),
      randomUUID(),
    );

    const result = await handler.execute(command);
    expect(result.lifecycleState).toBe(ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
    expect(writeImmutableArtifact).toHaveBeenCalledTimes(1);
  });

  it("binds the rule's source-derived basis and the cited evidence into every finding", async () => {
    const { handler, writeImmutableArtifact } = buildHandler();
    writeImmutableArtifact.mockImplementation((id: string, content: string) =>
      Promise.resolve({
        manifest: {
          artifact_id: id,
          total_size: Buffer.byteLength(content, "utf8"),
          hash: sha256Hex(content),
          chunks: ["artifact.chunk"],
        },
        sizeBytes: Buffer.byteLength(content, "utf8"),
      }),
    );

    await handler.execute(
      new SubmitAssessmentFinalReportCommand(
        assessmentId,
        randomUUID(),
        requestFor({}),
        randomUUID(),
      ),
    );

    const stored = assessmentFinalReportArtifactSchema.parse(
      JSON.parse(writeImmutableArtifact.mock.calls[0]?.[1] as string),
    );
    expect(stored.findings[0].legalBasis).toEqual({
      concept: "Retention",
      legalIntent: "Records are kept.",
      applicabilityGuidance: "Applies to the keeper of a register.",
      legalRequirements: [
        {
          legalRequirementId: "LR-1",
          title: "Retention duty",
          applicabilityConditions: ["The system keeps a register."],
          qualifiers: [],
          exceptions: ["Unless the register is private."],
          sources: [
            {
              documentId: "DOC-1",
              locator: "art-4::cl-1",
              contentSha256: `sha256:${"c".repeat(64)}`,
            },
          ],
        },
      ],
    });
    expect(stored.findings[0].evidence).toEqual([
      {
        evidenceId,
        type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
        repositoryCommit: "a".repeat(40),
        path: "src/retention.py",
        startLine: 3,
        endLine: 9,
      },
    ]);
    // The decision fingerprint still covers decisions only, so older reports keep verifying.
    expect(stored.decisionFingerprint).toBe(
      `sha256:${sha256Hex(canonicalJson([{ decisionId: stored.findings[0].decisionId, decisionRevision: 1, decision }]))}`,
    );
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
