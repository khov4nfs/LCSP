import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import {
  ASSESSMENT_RECORD_STATES,
  ASSESSMENT_FACT_KINDS,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentEvidenceInvalidation } from "../../services/assessment-evidence-invalidation.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { AcceptAssessmentFactCommand } from "./accept-assessment-fact.command.js";
import { AcceptAssessmentFactHandler } from "./accept-assessment-fact.handler.js";

describe("AcceptAssessmentFactHandler", () => {
  const assessmentId = randomUUID();
  const threadId = randomUUID();
  const executionId = randomUUID();
  const correlationId = "corr-fact-1";
  const leaseToken = "lease-token-fact";

  function setupFixture() {
    const tx = {
      assessmentCase: {
        findUniqueOrThrow: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({ caseRevision: 1 }),
        update: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({ caseRevision: 2 }),
      },
      assessmentCaseFact: {
        findUnique: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue(null),
        create: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({ id: "case-fact-1" }),
      },
      assessmentEvidence: {
        findMany: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue([]),
      },
      assessmentCaseFactEvidence: {
        createMany: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    };

    const authority = {
      authorizeInTx: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({
          assessmentId,
          threadId,
          executionId,
          lifecycleState: "ACTIVE",
          lifecycleRevision: 1,
        }),
    };

    const support = {
      loadPins: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({
          ruleSetVersionId: randomUUID(),
          repositorySnapshotId: randomUUID(),
          repositoryCommit: "a".repeat(40),
          caseRevision: 1,
        }),
      lockCase: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(),
    };

    const events = {
      appendInTx: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ eventId: "ev-1" }),
    };

    const invalidation = {
      invalidateCaseRevisionInTx: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(),
    };

    const handler = new AcceptAssessmentFactHandler(
      prisma as never,
      authority as unknown as AssessmentRuntimeAuthority,
      support as unknown as AssessmentCaseSupport,
      events as unknown as AssessmentEventAppender,
      invalidation as unknown as AssessmentEvidenceInvalidation,
    );

    return { handler, tx, authority, support, events, invalidation };
  }

  it("persists a newly accepted fact under authorized agent runtime lease", async () => {
    const fixture = setupFixture();
    const command = new AcceptAssessmentFactCommand(
      assessmentId,
      leaseToken,
      {
        kind: ASSESSMENT_FACT_KINDS.FACT,
        statement: "Repository contains CI/CD pipeline definition.",
        evidenceIds: [],
        expectedCaseRevision: 1,
      },
      correlationId,
    );

    const result = await fixture.handler.execute(command);

    expect(result.caseRevision).toBe(2);
    expect(result.factId).toBeDefined();
    expect(fixture.authority.authorizeInTx).toHaveBeenCalledTimes(1);
    expect(fixture.support.lockCase).toHaveBeenCalledTimes(1);
    expect(fixture.events.appendInTx).toHaveBeenCalledTimes(1);
  });

  it("replays already accepted fact idempotently without incrementing revision", async () => {
    const fixture = setupFixture();
    fixture.tx.assessmentCaseFact.findUnique.mockResolvedValueOnce({
      factId: "existing-fact",
      state: ASSESSMENT_RECORD_STATES.ACCEPTED,
    });

    const command = new AcceptAssessmentFactCommand(
      assessmentId,
      leaseToken,
      {
        kind: ASSESSMENT_FACT_KINDS.FACT,
        statement: "Repository contains CI/CD pipeline definition.",
        evidenceIds: [],
        expectedCaseRevision: 1,
      },
      correlationId,
    );

    const result = await fixture.handler.execute(command);

    expect(result.caseRevision).toBe(1);
    expect(fixture.tx.assessmentCase.update).not.toHaveBeenCalled();
  });
});
