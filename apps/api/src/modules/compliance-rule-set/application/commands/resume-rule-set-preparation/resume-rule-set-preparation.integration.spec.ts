import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, AgentExecutionState as State } from "@prisma/client";
import {
  RULE_SET_PREPARATION_FAILURE_REASONS as R,
  COMPLIANCE_RULE_SET_ERROR_CODES as ERR,
} from "@lcsp/contracts/compliance-rule-set";
import { seedReferenceDependencies } from "../../../../../../test/support/seed-reference-dependencies.js";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import { FailRuleSetPreparationCommand } from "../fail-rule-set-preparation/fail-rule-set-preparation.command.js";
import { FailRuleSetPreparationHandler } from "../fail-rule-set-preparation/fail-rule-set-preparation.handler.js";
import { ClaimRuleSetPreparationCommand } from "../claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { ResumeRuleSetPreparationCommand } from "./resume-rule-set-preparation.command.js";
import { ResumeRuleSetPreparationHandler } from "./resume-rule-set-preparation.handler.js";

const url = process.env.DATABASE_URL ?? "";
const database =
  /^postgresql:\/\/[^@]+@(localhost|127\.0\.0\.1):554\d\d\/lcsp_review_frontier_test(?:\?|$)/u.test(
    url,
  )
    ? describe
    : describe.skip;

database("preparation budget PAUSED / resume PostgreSQL", () => {
  let db: PrismaClient;
  let fail: FailRuleSetPreparationHandler;
  let resume: ResumeRuleSetPreparationHandler;
  let claim: ClaimRuleSetPreparationHandler;
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg(url) });
    await db.$connect();
    const service = db as unknown as PrismaService;
    fail = new FailRuleSetPreparationHandler(service);
    resume = new ResumeRuleSetPreparationHandler(
      service,
      new OutboxRepository(service),
    );
    claim = new ClaimRuleSetPreparationHandler(
      service,
      new LegalDocumentGraphService(service),
    );
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const pause = (id: string) =>
    fail.execute(
      new FailRuleSetPreparationCommand(
        { preparationRunId: id, reason: R.AGENT_BUDGET_REACHED },
        randomUUID(),
      ),
    );
  const requeue = (id: string) =>
    resume.execute(
      new ResumeRuleSetPreparationCommand(id, "admin-test", randomUUID()),
    );

  it("pauses without terminal completion, resumes the same run once, and preserves the pinned frontier", async () => {
    const s = await seedReferenceDependencies(db);
    const operationId = randomUUID();
    await db.ruleSetPreparationRun.update({
      where: { id: s.preparationRunId },
      data: { reviewOperationId: operationId },
    });
    const frontier = await db.ruleSetPreparationReviewFrontier.findFirstOrThrow(
      { where: { preparationRunId: s.preparationRunId } },
    );
    expect(await pause(s.preparationRunId)).toMatchObject({
      executionState: State.PAUSED,
    });
    expect(await pause(s.preparationRunId)).toMatchObject({
      executionState: State.PAUSED,
    });
    expect(
      await db.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: s.preparationRunId },
      }),
    ).toMatchObject({
      executionState: State.PAUSED,
      failureReason: R.AGENT_BUDGET_REACHED,
      completedAt: null,
    });
    const [a, b] = await Promise.all([
      requeue(s.preparationRunId),
      requeue(s.preparationRunId),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      preparationRunId: s.preparationRunId,
      executionState: State.QUEUED,
    });
    const queued = await db.ruleSetPreparationRun.findUniqueOrThrow({
      where: { id: s.preparationRunId },
    });
    expect(queued).toMatchObject({
      reviewOperationId: null,
      failureReason: null,
      completedAt: null,
    });
    expect(
      await db.outboxMessage.count({ where: { id: queued.outboxEventId! } }),
    ).toBe(1);
    expect(
      await db.ruleSetPreparationReviewFrontier.findFirstOrThrow({
        where: { preparationRunId: s.preparationRunId },
      }),
    ).toEqual(frontier);
    expect(
      await claim.execute(
        new ClaimRuleSetPreparationCommand(
          { preparationRunId: s.preparationRunId },
          randomUUID(),
        ),
      ),
    ).toMatchObject({
      preparationRunId: s.preparationRunId,
      executionState: State.RUNNING,
      documentGraph: { materializationId: s.documentGraph.materializationId },
    });
    expect(await requeue(s.preparationRunId)).toMatchObject({
      executionState: State.RUNNING,
    });
    await pause(s.preparationRunId);
    await requeue(s.preparationRunId);
    const next = await db.ruleSetPreparationRun.findUniqueOrThrow({
      where: { id: s.preparationRunId },
    });
    expect(next.outboxEventId).not.toBe(queued.outboxEventId);
  });
  it.each([R.MODEL_ERROR, R.RUNTIME_ERROR])(
    "explicitly resumes %s without changing committed reviews",
    async (reason) => {
      const s = await seedReferenceDependencies(db);
      const frontier =
        await db.ruleSetPreparationReviewFrontier.findFirstOrThrow({
          where: { preparationRunId: s.preparationRunId },
        });
      await fail.execute(
        new FailRuleSetPreparationCommand(
          { preparationRunId: s.preparationRunId, reason },
          randomUUID(),
        ),
      );
      const [first, retried] = await Promise.all([
        requeue(s.preparationRunId),
        requeue(s.preparationRunId),
      ]);
      expect(first).toEqual(retried);
      expect(first).toMatchObject({
        preparationRunId: s.preparationRunId,
        executionState: State.QUEUED,
      });
      expect(
        await db.ruleSetPreparationReviewFrontier.findFirstOrThrow({
          where: { preparationRunId: s.preparationRunId },
        }),
      ).toEqual(frontier);
    },
  );
  it("keeps nonrecoverable source failures FAILED and refuses resume", async () => {
    const s = await seedReferenceDependencies(db);
    expect(
      await fail.execute(
        new FailRuleSetPreparationCommand(
          {
            preparationRunId: s.preparationRunId,
            reason: R.SOURCE_VERSION_UNAVAILABLE,
          },
          randomUUID(),
        ),
      ),
    ).toMatchObject({ executionState: State.FAILED });
    await expect(requeue(s.preparationRunId)).rejects.toMatchObject({
      response: { problem: { code: ERR.preparationRunConflict } },
    });
    await expect(requeue(randomUUID())).rejects.toMatchObject({
      response: { problem: { code: ERR.preparationRunNotFound } },
    });
  });
  it.each([State.CANCELLED, State.SUCCEEDED])(
    "budget failure cannot overwrite %s",
    async (state) => {
      const s = await seedReferenceDependencies(db);
      await db.ruleSetPreparationRun.update({
        where: { id: s.preparationRunId },
        data: { executionState: state },
      });
      if (state === State.CANCELLED)
        expect(await pause(s.preparationRunId)).toMatchObject({
          executionState: state,
        });
      else
        await expect(pause(s.preparationRunId)).rejects.toMatchObject({
          response: { problem: { code: ERR.preparationRunConflict } },
        });
      await expect(requeue(s.preparationRunId)).rejects.toMatchObject({
        response: { problem: { code: ERR.preparationRunConflict } },
      });
    },
  );
});
