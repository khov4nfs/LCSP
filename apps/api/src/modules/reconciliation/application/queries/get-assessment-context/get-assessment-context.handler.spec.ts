import { jest } from "@jest/globals";
import { WizardProfileStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_STATUSES,
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
} from "@lcsp/contracts/evidence";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetAssessmentContextHandler } from "./get-assessment-context.handler.js";
import { GetAssessmentContextQuery } from "./get-assessment-context.query.js";

describe("GetAssessmentContextHandler", () => {
  it("returns allow-listed submitted answers and pinned artifacts", async () => {
    const prisma = {
      wizardProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "wizard-1",
          assessmentId: "assessment-1",
          version: 7,
          status: WizardProfileStatus.SUBMITTED,
          submittedAt: new Date("2026-08-12T01:00:00.000Z"),
          answers: [
            {
              questionId: "businessProcess",
              value: "LOAN_APPROVAL",
              answerState: "ANSWERED",
              updatedAt: "2026-08-12T01:00:00.000Z",
            },
            {
              questionId: "humanReview",
              value: "PRESENT",
              answerState: "ANSWERED",
              updatedAt: "2026-08-12T01:00:00.000Z",
            },
            {
              questionId: "freeText",
              value: "secret text",
              answerState: "ANSWERED",
              updatedAt: "2026-08-12T01:00:00.000Z",
            },
          ],
        }),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
        }),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    const handler = new GetAssessmentContextHandler(prisma, audit);
    const response = await handler.execute(
      new GetAssessmentContextQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        [
          ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers,
          ASSESSMENT_CONTEXT_INCLUDES.pinnedArtifacts,
        ],
        [
          ASSESSMENT_CONTEXT_ANSWER_FIELDS.systemPurpose,
          ASSESSMENT_CONTEXT_ANSWER_FIELDS.humanReviewDeclaration,
        ],
        "corr-1",
      ),
    );

    expect(response.coverage_state).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    );
    expect(response.result.wizard.answers).toEqual({
      SYSTEM_PURPOSE: "LOAN_APPROVAL",
      HUMAN_REVIEW_DECLARATION: "PRESENT",
    });
    expect(JSON.stringify(response)).not.toContain("secret text");
    expect(response.result.artifact_versions).toEqual({
      technical_evidence_report_id: "report-1",
    });
  });

  it("returns OUT_OF_COVERAGE when target ids are requested but unavailable", async () => {
    const prisma = {
      wizardProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "wizard-1",
          assessmentId: "assessment-1",
          version: 7,
          status: WizardProfileStatus.SUBMITTED,
          submittedAt: null,
          answers: [],
        }),
      },
      technicalEvidenceReport: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    const handler = new GetAssessmentContextHandler(prisma, audit);
    const response = await handler.execute(
      new GetAssessmentContextQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        [ASSESSMENT_CONTEXT_INCLUDES.targetIds],
        [],
        "corr-1",
      ),
    );

    expect(response.coverage_state).toBe(AGENTIC_TOOL_COVERAGE_STATES.partial);
    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.limitations).toContain("TARGET_IDS_UNAVAILABLE");
    expect(response.result.wizard.target_ids).toBeUndefined();
  });

  it("returns NEEDS_INPUT when the wizard profile is not submitted", async () => {
    const prisma = {
      wizardProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "wizard-1",
          assessmentId: "assessment-1",
          version: 7,
          status: WizardProfileStatus.IN_PROGRESS,
          submittedAt: null,
          answers: [],
        }),
      },
      technicalEvidenceReport: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    const handler = new GetAssessmentContextHandler(prisma, audit);
    const response = await handler.execute(
      new GetAssessmentContextQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        [ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers],
        [ASSESSMENT_CONTEXT_ANSWER_FIELDS.systemPurpose],
        "corr-1",
      ),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.coverage_state).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.unavailable,
    );
    expect(response.limitations).toContain("PROFILE_NOT_SUBMITTED");
  });
});
