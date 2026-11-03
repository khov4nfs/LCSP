import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { AssessmentRuntimeAuthority } from "./assessment-runtime-authority.service.js";
import type { AuthorizedRootRun } from "./assessment-runtime-authority.service.js";

describe("AssessmentRuntimeAuthority selected rule membership", () => {
  const authority = new AssessmentRuntimeAuthority(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const assessmentRuleId = "RULE-3";
  const correlationId = randomUUID();

  it.each(["RESOLVED", "INVESTIGATING", "INVALIDATED"])(
    "rejects a previously covered %s rule absent from the current request",
    async (historicalState) => {
      expect(historicalState).toMatch(/^(RESOLVED|INVESTIGATING|INVALIDATED)$/);
      const tx = {
        assessmentRuleAuditItem: {
          findUnique: jest
            .fn<() => Promise<{ assessmentRuleId: string } | null>>()
            .mockResolvedValue(null),
        },
        assessmentDecisionCoverage: { findUnique: jest.fn() },
      };
      const run: AuthorizedRootRun = {
        assessmentId: randomUUID(),
        threadId: randomUUID(),
        executionId: randomUUID(),
        auditRequestId: randomUUID(),
        lifecycleState: "ACTIVE",
        lifecycleRevision: 1,
        blockerReason: null,
        blockerReference: null,
      };

      let failure: unknown;
      try {
        await authority.requireSelectedRuleMembershipInTx(
          tx as never,
          run,
          assessmentRuleId,
          correlationId,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(HttpException);
      expect((failure as HttpException).getStatus()).toBe(403);
      expect(tx.assessmentRuleAuditItem.findUnique).toHaveBeenCalledWith({
        where: {
          requestId_assessmentRuleId: {
            requestId: run.auditRequestId,
            assessmentRuleId,
          },
        },
        select: { assessmentRuleId: true },
      });
      expect(tx.assessmentDecisionCoverage.findUnique).not.toHaveBeenCalled();
    },
  );

  it("does not let membership in an earlier request authorize a replay", async () => {
    const firstRequestId = randomUUID();
    const secondRequestId = randomUUID();
    const findUnique = jest
      .fn<() => Promise<{ assessmentRuleId: string } | null>>()
      .mockResolvedValueOnce({ assessmentRuleId })
      .mockResolvedValueOnce(null);
    const tx = { assessmentRuleAuditItem: { findUnique } };
    const run: AuthorizedRootRun = {
      assessmentId: randomUUID(),
      threadId: randomUUID(),
      executionId: randomUUID(),
      auditRequestId: firstRequestId,
      lifecycleState: "ACTIVE",
      lifecycleRevision: 1,
      blockerReason: null,
      blockerReference: null,
    };

    await authority.requireSelectedRuleMembershipInTx(
      tx as never,
      run,
      assessmentRuleId,
      correlationId,
    );
    await expect(
      authority.requireSelectedRuleMembershipInTx(
        tx as never,
        { ...run, auditRequestId: secondRequestId },
        assessmentRuleId,
        correlationId,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("preserves the explicit legacy full-audit path", async () => {
    const findUnique =
      jest.fn<() => Promise<{ assessmentRuleId: string } | null>>();
    await authority.requireSelectedRuleMembershipInTx(
      { assessmentRuleAuditItem: { findUnique } } as never,
      {
        assessmentId: randomUUID(),
        threadId: randomUUID(),
        executionId: randomUUID(),
        auditRequestId: null,
        lifecycleState: "ACTIVE",
        lifecycleRevision: 1,
        blockerReason: null,
        blockerReference: null,
      },
      assessmentRuleId,
      correlationId,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
