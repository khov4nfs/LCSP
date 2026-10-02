import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  RULE_ANALYSIS_STATUSES,
  RULE_CRITERION_STATUSES,
  RULE_EVIDENCE_KINDS,
  type AcceptedRuleAssessment,
} from "@lcsp/contracts/evidence";
import { HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { PutRuleAssessmentCommand } from "./put-rule-assessment.command.js";
import { PutRuleAssessmentHandler } from "./put-rule-assessment.handler.js";

const SHA = "abcdef1234567";
const REF = `source:${SHA}:src/a.ts#L1-L5`;

function body(
  overrides: Partial<AcceptedRuleAssessment> = {},
): AcceptedRuleAssessment {
  return {
    resultId: "result-1",
    assessmentId: "assessment-1",
    engineeringRuleId: "rule-1",
    engineeringRuleVersion: "v1",
    repositoryVersion: SHA,
    contextRevision: 3,
    status: RULE_ANALYSIS_STATUSES.completed,
    criteria: [
      {
        criterionId: "c1",
        status: RULE_CRITERION_STATUSES.evidenceFound,
        evidenceKind: RULE_EVIDENCE_KINDS.supportsRequirement,
        evidenceRefs: [REF],
        evidence: [
          {
            ref: REF,
            path: "src/a.ts",
            startLine: 1,
            endLine: 5,
            provenance: {
              assessmentId: "assessment-1",
              repositoryVersion: SHA,
              engineeringRuleId: "rule-1",
              criterionId: "c1",
              validator: "cite_repository_source",
            },
          },
        ],
        technicalFacts: [],
        limitations: [],
      },
    ],
    limitations: [],
    execution: { attempt: 1 },
    ...overrides,
  };
}

function harness(existing: { id: string; contextRevision: number } | null) {
  const ledger = {
    findUnique: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(existing),
    updateMany: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(savedRow()),
    create: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(savedRow()),
  };
  const prisma = {
    assessment: {
      findUnique: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({
          id: "assessment-1",
        }),
    },
    engineeringRuleAssessment: ledger,
  };
  return {
    ledger,
    handler: new PutRuleAssessmentHandler(prisma as unknown as PrismaService),
  };
}

function savedRow() {
  const b = body();
  return {
    id: "row-1",
    ...b,
    status: "COMPLETED",
    attempt: 1,
  };
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

const run = (h: PutRuleAssessmentHandler, b: unknown, rule = "rule-1") =>
  h.execute(new PutRuleAssessmentCommand("assessment-1", rule, b, "corr-1"));

describe("PutRuleAssessmentHandler", () => {
  it("creates the first ledger row atomically", async () => {
    const { handler, ledger } = harness(null);
    const result = await run(handler, body());
    expect(ledger.create).toHaveBeenCalledTimes(1);
    expect(ledger.updateMany).not.toHaveBeenCalled();
    expect(result.engineeringRuleId).toBe("rule-1");
  });

  it("falls back to the guarded CAS when a concurrent first write wins (P2002)", async () => {
    const { handler, ledger } = harness(null);
    ledger.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await run(handler, body());
    expect(ledger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: "assessment-1",
          engineeringRuleId: "rule-1",
          contextRevision: { lte: 3 },
        },
      }),
    );
  });

  it("rejects with 409 when the first-write race was won by a newer revision", async () => {
    const { handler, ledger } = harness(null);
    ledger.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    ledger.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await rejection(run(handler, body()))).getStatus()).toBe(409);
  });

  it("does not swallow non-unique create errors", async () => {
    const { handler, ledger } = harness(null);
    ledger.create.mockRejectedValueOnce(new Error("db down"));
    await expect(run(handler, body())).rejects.toThrow("db down");
    expect(ledger.updateMany).not.toHaveBeenCalled();
  });

  it("updates an existing row with a newer or equal contextRevision", async () => {
    const { handler, ledger } = harness({ id: "row-1", contextRevision: 3 });
    await run(handler, body());
    expect(ledger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: "assessment-1",
          engineeringRuleId: "rule-1",
          contextRevision: { lte: 3 },
        },
      }),
    );
    expect(ledger.create).not.toHaveBeenCalled();
  });

  it("rejects a stale contextRevision with 409", async () => {
    const { handler, ledger } = harness({ id: "row-1", contextRevision: 4 });
    const error = await rejection(run(handler, body()));
    expect(error.getStatus()).toBe(409);
    expect(
      (error.getResponse() as { problem: { code: string } }).problem.code,
    ).toBe(ASSESSMENT_ERROR_CODES.ruleAssessmentStale);
    expect(ledger.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a 409 when the guarded write loses a race", async () => {
    const { handler, ledger } = harness({ id: "row-1", contextRevision: 3 });
    ledger.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await rejection(run(handler, body()))).getStatus()).toBe(409);
  });

  it("rejects identity mismatch between path and body", async () => {
    const { handler, ledger } = harness(null);
    const error = await rejection(run(handler, body(), "rule-other"));
    expect(error.getStatus()).toBe(422);
    expect(ledger.create).not.toHaveBeenCalled();
  });

  it("rejects evidence provenance that does not match the assessment/rule/criterion", async () => {
    const { handler, ledger } = harness(null);
    const b = body();
    b.criteria[0].evidence[0].provenance.engineeringRuleId = "rule-other";
    expect((await rejection(run(handler, b))).getStatus()).toBe(422);
    expect(ledger.create).not.toHaveBeenCalled();
  });

  it("rejects refs carrying a runtime mac suffix", async () => {
    const { handler, ledger } = harness(null);
    const b = body();
    const macRef = `${REF}~0123456789abcdef01234567`;
    b.criteria[0].evidenceRefs = [macRef];
    b.criteria[0].evidence[0].ref = macRef;
    expect((await rejection(run(handler, b))).getStatus()).toBe(422);
    expect(ledger.create).not.toHaveBeenCalled();
  });

  it("rejects a status that does not match the criteria derivation", async () => {
    const { handler } = harness(null);
    const error = await rejection(
      run(handler, body({ status: RULE_ANALYSIS_STATUSES.unresolved })),
    );
    expect(error.getStatus()).toBe(422);
  });
});
