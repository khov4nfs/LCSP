import { describe, expect, it, jest } from "@jest/globals";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  RULE_SET_PREPARATION_MAX_ATTEMPTS,
  ruleSetPreparationIdempotencyKey,
} from "@lcsp/contracts/compliance-rule-set";
import type { CommandBus } from "@nestjs/cqrs";
import { LegalSourceLifecycleStatus } from "@prisma/client";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { StartRuleSetPreparationCommand } from "../start-rule-set-preparation/start-rule-set-preparation.command.js";
import { PrepareCurrentRuleSetCommand } from "./prepare-current-rule-set.command.js";
import { PrepareCurrentRuleSetHandler } from "./prepare-current-rule-set.handler.js";

const SOURCE = "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598";
const RUN = "31e042e8-6b91-4bfd-8853-108bb4436efd";
const command = () =>
  new PrepareCurrentRuleSetCommand("owner-admin", "correlation-1");

function build() {
  const source = {
    id: SOURCE,
    version: "2026.10",
    integrityManifestRef: "integrity:real-source",
    documents: [{ _count: { chunks: 544 } }],
    activations: [
      {
        integrityManifestRef: "integrity:real-source",
        retrievalValidationRef: "retrieval:real-source",
      },
    ],
    retrievalIndexes: [{ validationManifestRef: "retrieval:real-source" }],
  };
  const tx = {
    legalSourceVersion: {
      findMany: jest
        .fn<(args: unknown) => Promise<(typeof source)[]>>()
        .mockResolvedValue([source]),
    },
    complianceRuleSetVersion: {
      findFirst: jest
        .fn<() => Promise<{ id: string } | null>>()
        .mockResolvedValue(null),
    },
    ruleSetPreparationRun: {
      findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
    },
  };
  const prisma = {
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  const execute = jest.fn<CommandBus["execute"]>().mockResolvedValue({
    preparationRunId: RUN,
    legalSourceVersionId: SOURCE,
    executionState: AGENT_EXECUTION_STATES.QUEUED,
    ruleSetVersionId: null,
  });
  const handler = new PrepareCurrentRuleSetHandler(
    prisma as unknown as PrismaService,
    { execute } as unknown as CommandBus,
  );
  return { handler, tx, source, execute };
}

describe("Admin current-source preparation", () => {
  it("resolves the eligible ACTIVE source and delegates only to the canonical command", async () => {
    const { handler, tx, execute } = build();
    const result = await handler.execute(command());
    expect(result.legalSourceVersionId).toBe(SOURCE);
    expect(tx.legalSourceVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: LegalSourceLifecycleStatus.ACTIVE },
        take: 2,
      }),
    );
    const dispatched = execute.mock
      .calls[0][0] as StartRuleSetPreparationCommand;
    expect(dispatched).toBeInstanceOf(StartRuleSetPreparationCommand);
    expect(dispatched.request).toEqual({
      legalSourceVersionId: SOURCE,
      idempotencyKey: ruleSetPreparationIdempotencyKey(SOURCE),
    });
    expect(dispatched.requestedBy).toBe("owner-admin");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    AGENT_EXECUTION_STATES.QUEUED,
    AGENT_EXECUTION_STATES.RUNNING,
    AGENT_EXECUTION_STATES.INTERRUPTED,
    AGENT_EXECUTION_STATES.PAUSED,
  ])(
    "returns the existing %s run without a second start",
    async (executionState) => {
      const { handler, tx, execute } = build();
      tx.ruleSetPreparationRun.findFirst.mockResolvedValue({
        id: RUN,
        legalSourceVersionId: SOURCE,
        executionState,
        ruleSet: null,
      });
      expect(await handler.execute(command())).toMatchObject({
        preparationRunId: RUN,
        executionState,
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("refuses a compatible ACTIVE rule set", async () => {
    const { handler, tx, execute } = build();
    tx.complianceRuleSetVersion.findFirst.mockResolvedValue({ id: RUN });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: {
        problem: {
          code: COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
          meta: {
            reason: RULE_SET_PREPARATION_REFUSAL_REASONS.ACTIVE_RULE_SET_EXISTS,
          },
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires the canonical Retry path after a failed attempt", async () => {
    const { handler, tx, execute } = build();
    tx.ruleSetPreparationRun.findFirst.mockResolvedValue({
      id: RUN,
      legalSourceVersionId: SOURCE,
      executionState: AGENT_EXECUTION_STATES.FAILED,
      ruleSet: null,
    });
    await expect(handler.execute(command())).rejects.toMatchObject({
      response: {
        problem: {
          meta: {
            reason:
              RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_ALREADY_STARTED,
          },
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("starts a fresh canonical attempt after cancellation without treating it as FAILED", async () => {
    const { handler, tx, execute } = build();
    tx.ruleSetPreparationRun.findFirst.mockResolvedValue({
      id: RUN,
      legalSourceVersionId: SOURCE,
      executionState: AGENT_EXECUTION_STATES.CANCELLED,
      ruleSet: null,
    });
    tx.ruleSetPreparationRun.count.mockResolvedValue(1);

    await handler.execute(command());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (execute.mock.calls[0]?.[0] as StartRuleSetPreparationCommand).request,
    ).toEqual({
      legalSourceVersionId: SOURCE,
      idempotencyKey: ruleSetPreparationIdempotencyKey(SOURCE, 2),
    });
  });

  it("does not exceed the canonical per-source attempt maximum after cancellation", async () => {
    const { handler, tx, execute } = build();
    tx.ruleSetPreparationRun.findFirst.mockResolvedValue({
      id: RUN,
      legalSourceVersionId: SOURCE,
      executionState: AGENT_EXECUTION_STATES.CANCELLED,
      ruleSet: null,
    });
    tx.ruleSetPreparationRun.count.mockResolvedValue(
      RULE_SET_PREPARATION_MAX_ATTEMPTS,
    );

    await expect(handler.execute(command())).rejects.toMatchObject({
      response: {
        problem: {
          meta: {
            reason: RULE_SET_PREPARATION_REFUSAL_REASONS.ATTEMPTS_EXHAUSTED,
          },
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["missing", "ambiguous", "fixture", "emptyDocument", "invalidIndex"])(
    "does not select a %s source generation",
    async (condition) => {
      const { handler, tx, source, execute } = build();
      if (condition === "missing")
        tx.legalSourceVersion.findMany.mockResolvedValue([]);
      if (condition === "ambiguous")
        tx.legalSourceVersion.findMany.mockResolvedValue([
          source,
          { ...source, id: RUN },
        ]);
      if (condition === "fixture") {
        source.id = "00000000-0000-0000-0000-000000000000";
        source.activations = [];
      }
      if (condition === "emptyDocument") source.documents[0]._count.chunks = 0;
      if (condition === "invalidIndex") source.retrievalIndexes = [];
      await expect(handler.execute(command())).rejects.toMatchObject({
        response: {
          problem: {
            meta: {
              reason:
                RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ELIGIBLE,
            },
          },
        },
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
