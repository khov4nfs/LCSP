import { describe, expect, it, jest } from "@jest/globals";
import { HttpException } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { ListRuleAssessmentsHandler } from "./list-rule-assessments.handler.js";
import { ListRuleAssessmentsQuery } from "./list-rule-assessments.query.js";

function handlerWith(assessment: { id: string } | null, rows: unknown[]) {
  const findMany = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue(rows);
  const prisma = {
    assessment: {
      findUnique: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(assessment),
    },
    engineeringRuleAssessment: { findMany },
  };
  return {
    findMany,
    handler: new ListRuleAssessmentsHandler(prisma as unknown as PrismaService),
  };
}

describe("ListRuleAssessmentsHandler", () => {
  it("maps ledger rows to accepted assessments, scoped to the assessment", async () => {
    const { handler, findMany } = handlerWith({ id: "a1" }, [
      {
        resultId: "r1",
        assessmentId: "a1",
        engineeringRuleId: "rule-1",
        engineeringRuleVersion: "v1",
        repositoryVersion: "abcdef1234567",
        contextRevision: 1,
        status: "NEEDS_CONTEXT",
        criteria: [],
        limitations: [],
        execution: { attempt: 1 },
      },
    ]);
    const result = await handler.execute(
      new ListRuleAssessmentsQuery("a1", "corr"),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessmentId: "a1" } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.engineeringRuleId).toBe("rule-1");
  });

  it("404s for an unknown assessment", async () => {
    const { handler } = handlerWith(null, []);
    const error = await handler
      .execute(new ListRuleAssessmentsQuery("nope", "corr"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
  });
});
