/**
 * Rationale ("Why"): Validates BillingReconciliationCase query, detail, and audited decision contracts (ADR-028 Line 155 & Line 173).
 * Mechanism ("How"): Asserts error codes, action permissions, decision actions, and request/response Zod schema parsing.
 * Invariants & Constraints: Strict validation rejecting unknown fields; enforces canonical decision actions and ISO datetime formats.
 */

import { describe, expect, it } from "@jest/globals";
import {
  BILLING_ACTIONS,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  RECONCILIATION_CASE_STATES,
  RECONCILIATION_DECISION_ACTIONS,
  billingAdminReconciliationCaseListQuerySchema,
  billingReconciliationCaseDetailResponseSchema,
  reconciliationCaseDecisionRequestSchema,
  reconciliationCaseDecisionResponseSchema,
} from "../src/billing/index.ts";

describe("WP8 BillingReconciliationCase Contracts", () => {
  it("defines canonical error codes, audit event types, and distinct action permissions for reconciliation decisions", () => {
    expect(BILLING_ERROR_CODES.reconciliationCaseNotFound).toBe("BILLING_RECONCILIATION_CASE_NOT_FOUND");
    expect(BILLING_ERROR_CODES.reconciliationCaseInvalidState).toBe("BILLING_RECONCILIATION_CASE_INVALID_STATE");
    expect(BILLING_ERROR_CODES.workerSelfReleaseDisallowed).toBe("BILLING_WORKER_SELF_RELEASE_DISALLOWED");
    expect(BILLING_ACTIONS.reconciliationDecision).toBe("billing:reconciliation:decision");
    expect(BILLING_AUDIT_EVENT_TYPES.reconciliationDecided).toBe("billing.reconciliation.decided");
    expect(RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE).toBe("CONFIRMED_NO_USAGE");
    expect(RECONCILIATION_DECISION_ACTIONS.confirmNoUsage).toBe("CONFIRM_NO_USAGE");
    expect(RECONCILIATION_DECISION_ACTIONS.maintainExposure).toBe("MAINTAIN_EXPOSURE");
    expect(RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview).toBe("FLAG_INTEGRITY_REVIEW");
    expect(RECONCILIATION_DECISION_ACTIONS.escalate).toBe("ESCALATE");
  });

  it("validates list query schema with defaults and valid states", () => {
    const valid = {
      state: RECONCILIATION_CASE_STATES.OPEN,
      provider: "anthropic",
      page: "2",
      pageSize: "50",
    };
    const parsed = billingAdminReconciliationCaseListQuerySchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(2);
      expect(parsed.data.pageSize).toBe(50);
    }
  });

  it("validates valid reconciliation decision request", () => {
    const valid = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: "recon-decision-idem-001",
      auditRationale: "Verified zero dispatch against provider log artifact",
      providerLogArtifactId: "art-anthropic-recon-001",
    };
    const parsed = reconciliationCaseDecisionRequestSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("strictly rejects client-injected unknown fields in decision request", () => {
    const malicious = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: "recon-decision-idem-002",
      auditRationale: "Verified zero dispatch against provider log artifact",
      walletId: "malicious-wallet-id",
      userId: "malicious-user-id",
      slotReleased: true,
    };
    const parsed = reconciliationCaseDecisionRequestSchema.safeParse(malicious);
    expect(parsed.success).toBe(false);
  });

  it("validates decision response schema", () => {
    const validResponse = {
      decided: true,
      caseId: "case-001",
      invocationId: "inv-001",
      admissionId: "adm-001",
      previousState: "OPEN",
      newState: "CONFIRMED_NO_USAGE",
      decision: "CONFIRM_NO_USAGE",
      slotReleased: true,
      auditRationale: "Provider logs prove request never reached provider socket",
      decidedAt: new Date().toISOString(),
      decidedBy: "admin-user-01",
    };
    const parsed = reconciliationCaseDecisionResponseSchema.safeParse(validResponse);
    expect(parsed.success).toBe(true);
  });

  it("validates detail response schema with evidence linkage", () => {
    const validDetail = {
      caseId: "case-001",
      invocationId: "inv-001",
      admissionId: "adm-001",
      state: "OPEN",
      provider: "anthropic",
      providerCorrelationId: "corr-inv-001",
      providerLogArtifactId: "art-001",
      coverageStart: "2026-11-27T08:00:00.000Z",
      coverageEnd: "2026-11-27T08:15:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      auditRationale: null,
      conflictDetectedAt: null,
      conflictingPayload: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      admission: {
        id: "adm-001",
        invocationId: "inv-001",
        walletId: "wallet-001",
        userId: "user-001",
        maximumExposureMicrocredits: "5000000",
        state: "DISPATCH_UNKNOWN",
        rolloutMode: "TELEMETRY_ONLY",
        debitMode: "OFF",
        requestedModel: "claude-3-5-sonnet",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-3-5-sonnet",
        admittedAt: "2026-11-27T08:00:00.000Z",
        consumedAt: "2026-11-27T08:00:05.000Z",
        expiresAt: "2026-11-27T08:05:00.000Z",
      },
      evidenceArtifact: {
        artifactId: "art-001",
        provider: "anthropic",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        coverageStart: "2026-11-27T08:00:00.000Z",
        coverageEnd: "2026-11-27T08:15:00.000Z",
        verified: true,
        ingestedAt: "2026-11-27T08:20:00.000Z",
      },
      // Why: An open case without an eligible debit has no compensation ceiling.
      // How: Match the required nullable detail contract rather than omitting the field.
      // Invariant: The UI cannot infer a compensable amount from absent evidence.
      compensationPreview: null,
    };
    const parsed = billingReconciliationCaseDetailResponseSchema.safeParse(validDetail);
    expect(parsed.success).toBe(true);
  });
});
