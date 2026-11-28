import { randomUUID } from "node:crypto";
import {
  ASSESSMENT_BUDGET_EXTENSION_SOURCES,
  adminBudgetExtensionRequestSchema,
  assessmentBudgetExtensionInputSchema,
  customerRuntimeControlRequestSchema,
} from "../src/evidence/index.ts";

describe("assessment runtime control & admin budget extension contracts", () => {
  it("exports ASSESSMENT_BUDGET_EXTENSION_SOURCES without PAYMENT", () => {
    expect(ASSESSMENT_BUDGET_EXTENSION_SOURCES).toEqual({
      adminOverride: "ADMIN_OVERRIDE",
      systemCompensation: "SYSTEM_COMPENSATION",
    });
    expect(Object.values(ASSESSMENT_BUDGET_EXTENSION_SOURCES)).not.toContain(
      "PAYMENT",
    );
  });

  it("enforces required auditReason, idempotencyKey, and valid optional source/expectedVersion on adminBudgetExtensionRequestSchema", () => {
    const valid = adminBudgetExtensionRequestSchema.safeParse({
      targetRunId: randomUUID(),
      idempotencyKey: "idem-admin-override-1",
      expectedVersion: 1,
      budgetExtension: {
        version: 2,
        auditReason: "Support compensation after provider outage",
        source: ASSESSMENT_BUDGET_EXTENSION_SOURCES.systemCompensation,
        additionalModelCalls: 50,
      },
    });
    expect(valid.success).toBe(true);

    // Optional source and expectedVersion may be omitted
    const minimalValid = adminBudgetExtensionRequestSchema.safeParse({
      targetRunId: randomUUID(),
      idempotencyKey: "idem-admin-override-2",
      budgetExtension: {
        version: 1,
        auditReason: "Manual admin quota adjustment",
        additionalModelCalls: 25,
      },
    });
    expect(minimalValid.success).toBe(true);

    // Rejects missing or whitespace-only auditReason
    expect(
      adminBudgetExtensionRequestSchema.safeParse({
        targetRunId: randomUUID(),
        idempotencyKey: "idem-1",
        budgetExtension: {
          version: 1,
          auditReason: "   ",
          additionalModelCalls: 10,
        },
      }).success,
    ).toBe(false);

    // Rejects missing or whitespace-only idempotencyKey
    expect(
      adminBudgetExtensionRequestSchema.safeParse({
        targetRunId: randomUUID(),
        idempotencyKey: "   ",
        budgetExtension: {
          version: 1,
          auditReason: "Valid reason",
          additionalModelCalls: 10,
        },
      }).success,
    ).toBe(false);

    // Rejects PAYMENT source
    expect(
      adminBudgetExtensionRequestSchema.safeParse({
        targetRunId: randomUUID(),
        idempotencyKey: "idem-payment",
        budgetExtension: {
          version: 1,
          auditReason: "Should reject PAYMENT",
          source: "PAYMENT",
          additionalModelCalls: 10,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects overrideNoProgress in assessmentBudgetExtensionInputSchema and adminBudgetExtensionRequestSchema (R2)", () => {
    expect(
      assessmentBudgetExtensionInputSchema.safeParse({
        version: 1,
        auditReason: "Attempt no-progress override true",
        overrideNoProgress: true,
      }).success,
    ).toBe(false);

    expect(
      assessmentBudgetExtensionInputSchema.safeParse({
        version: 1,
        auditReason: "Attempt no-progress override false",
        overrideNoProgress: false,
      }).success,
    ).toBe(false);

    expect(
      adminBudgetExtensionRequestSchema.safeParse({
        targetRunId: randomUUID(),
        idempotencyKey: "idem-no-progress",
        budgetExtension: {
          version: 1,
          auditReason: "Attempt no-progress unlock via admin request",
          overrideNoProgress: true,
        },
      }).success,
    ).toBe(false);
  });

  it("keeps customerRuntimeControlRequestSchema rejecting budgetExtension", () => {
    expect(
      customerRuntimeControlRequestSchema.safeParse({
        targetRunId: randomUUID(),
        budgetExtension: {
          version: 1,
          auditReason: "Unauthorized customer extension",
          additionalModelCalls: 10,
        },
      }).success,
    ).toBe(false);
  });
});
