import { describe, expect, it, jest } from "@jest/globals";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import { LEGAL_MATCHING_REQUEST_COMMAND } from "@lcsp/contracts/legal-rule-catalog";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ResumeWaitingRunsCommand } from "./resume-waiting-runs.command.js";
import { ResumeWaitingRunsHandler } from "./resume-waiting-runs.handler.js";

function buildHandler(input?: {
  corpus?: object | null;
  index?: object | null;
  approvedProfiles?: Array<{
    id: string;
    assessmentId: string;
    organizationId: string;
    approvedAt: Date | null;
  }>;
  legalRuleMatches?: Array<{ verifiedProfileId: string }>;
  existingCommands?: Array<{ aggregateId: string }>;
}) {
  const hasCorpus = input ? "corpus" in input : false;
  const hasIndex = input ? "index" in input : false;
  const prisma = {
    legalCorpusVersion: {
      findFirst: jest.fn().mockResolvedValue(
        hasCorpus
          ? input?.corpus
          : {
              id: "corpus-1",
              approvedAt: new Date("2026-08-12T00:00:00.000Z"),
            },
      ),
    },
    legalRetrievalIndex: {
      findFirst: jest
        .fn()
        .mockResolvedValue(hasIndex ? input?.index : { id: "index-1" }),
    },
    verifiedProfile: {
      findMany: jest.fn().mockResolvedValue(
        input?.approvedProfiles ?? [
          {
            id: "vp-1",
            assessmentId: "assessment-1",
            organizationId: "org-1",
            approvedAt: new Date("2026-08-11T00:00:00.000Z"),
          },
          {
            id: "vp-2",
            assessmentId: "assessment-2",
            organizationId: "org-1",
            approvedAt: new Date("2026-08-11T00:05:00.000Z"),
          },
        ],
      ),
    },
    legalRuleMatch: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          input?.legalRuleMatches ?? [{ verifiedProfileId: "vp-2" }],
        ),
    },
    outboxMessage: {
      findMany: jest.fn().mockResolvedValue(input?.existingCommands ?? []),
    },
    $transaction: jest.fn(async (callback: (tx: object) => Promise<void>) =>
      callback({}),
    ),
  } as unknown as PrismaService;

  const enqueue = jest
    .fn<OutboxRepository["enqueue"]>()
    .mockResolvedValue(undefined);
  const outbox = { enqueue } as unknown as OutboxRepository;
  const audit = {
    write: jest.fn<AuditWriterService["write"]>().mockResolvedValue(undefined),
  } as unknown as AuditWriterService;

  return {
    handler: new ResumeWaitingRunsHandler(prisma, outbox, audit),
    prisma,
    enqueue,
    audit,
  };
}

describe("ResumeWaitingRunsHandler", () => {
  it("blocks when the corpus version is not approved", async () => {
    const { handler } = buildHandler({ corpus: null });

    const result = await handler.execute(
      new ResumeWaitingRunsCommand("corpus-1", 10, "resume-key", "corr-1"),
    );

    expect(result.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(result.result.resumedRunCount).toBe(0);
  });

  it("queues legal matching only for eligible approved profiles without a match", async () => {
    const { handler, enqueue } = buildHandler();

    const result = await handler.execute(
      new ResumeWaitingRunsCommand("corpus-1", 10, "resume-key", "corr-1"),
    );

    expect(result.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(result.result.eligibleRunCount).toBe(1);
    expect(result.result.resumedRunCount).toBe(1);
    expect(result.result.skippedRunCount).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      eventType: LEGAL_MATCHING_REQUEST_COMMAND,
      aggregateId: "vp-1",
    });
  });

  it("skips profiles that already have a pending or published legal-matching command", async () => {
    const { handler, enqueue } = buildHandler({
      existingCommands: [{ aggregateId: "vp-1" }],
      legalRuleMatches: [],
    });

    const result = await handler.execute(
      new ResumeWaitingRunsCommand("corpus-1", 10, "resume-key", "corr-1"),
    );

    expect(result.result.resumedRunCount).toBe(1);
    expect(result.result.skips).toEqual([
      {
        runRef: "verified-profile:vp-1",
        reason: "LEGAL_MATCH_ALREADY_QUEUED",
      },
    ]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      aggregateId: "vp-2",
    });
  });
});
