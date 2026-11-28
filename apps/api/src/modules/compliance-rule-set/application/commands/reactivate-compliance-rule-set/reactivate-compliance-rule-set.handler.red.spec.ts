import { describe, expect, it, jest } from "@jest/globals";
import {
  AgentExecutionState,
  ArtifactLifecycleState,
  AuthUserRole,
  UserAccessStatus,
} from "@prisma/client";
import { RULE_SET_REACTIVATION_REASONS } from "@lcsp/contracts/compliance-rule-set";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ReactivateComplianceRuleSetCommand } from "./reactivate-compliance-rule-set.command.js";
import { ReactivateComplianceRuleSetHandler } from "./reactivate-compliance-rule-set.handler.js";

const ACTIVE_ID = "31e042e8-6b91-4bfd-8853-108bb4436efd";
const TARGET_ID = "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598";

describe("Rule Set reactivation while Preparation is unresolved (RED)", () => {
  it.each([
    AgentExecutionState.PAUSED,
    AgentExecutionState.INTERRUPTED,
    AgentExecutionState.CANCEL_REQUESTED,
  ])(
    "rejects reactivation while a %s run remains unresolved",
    async (state) => {
      // Model the same state set that the preparation availability loader treats
      // as in progress; no historical target lookup should be reached.
      const tx = {
        user: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              role: AuthUserRole.ADMIN,
              accessStatus: UserAccessStatus.ACTIVE,
            }),
          ),
        },
        $executeRaw: jest.fn(() => Promise.resolve(0)),
        $queryRaw: jest.fn(() => Promise.resolve([{ acquired: true }])),
        complianceRuleSetReactivationRecord: {
          findUnique: jest.fn(() => Promise.resolve(null)),
        },
        complianceRuleSetVersion: {
          findFirst: jest.fn(() =>
            Promise.resolve({
              id: ACTIVE_ID,
              lifecycleState: ArtifactLifecycleState.ACTIVE,
            }),
          ),
          findUnique: jest.fn(() => {
            throw new Error("TARGET_LOOKUP_REACHED");
          }),
        },
        ruleSetPreparationRun: {
          count: jest.fn(
            (query: {
              where: { executionState: { in: AgentExecutionState[] } };
            }) =>
              Promise.resolve(
                query.where.executionState.in.includes(state) ? 1 : 0,
              ),
          ),
        },
      };
      const prisma = {
        $transaction: (work: (client: typeof tx) => Promise<unknown>) =>
          work(tx),
      };
      const handler = new ReactivateComplianceRuleSetHandler(
        prisma as unknown as PrismaService,
        {} as AuditWriterService,
        {} as OutboxRepository,
      );

      await expect(
        handler.execute(
          new ReactivateComplianceRuleSetCommand(
            TARGET_ID,
            {
              expectedActiveRuleSetVersionId: ACTIVE_ID,
              idempotencyKey: `reactivate-${state}`,
              reason:
                RULE_SET_REACTIVATION_REASONS.SEMANTIC_AUTHORITY_CONTAINMENT,
            },
            "admin-id",
            "correlation-id",
          ),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(tx.complianceRuleSetVersion.findUnique).not.toHaveBeenCalled();
    },
  );
});
