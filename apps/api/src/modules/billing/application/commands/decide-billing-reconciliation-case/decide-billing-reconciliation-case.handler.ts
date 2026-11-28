/**
 * Rationale ("Why"): G-07 BillingReconciliationCase Audited Decision Handler.
 * Mechanism ("How"): Dispatched by CommandBus from BillingAdminReconciliationController.
 * Enforces admin role and explicit billing:reconciliation:decision action permission.
 * Validates cryptographically signed provider log evidence for CONFIRM_NO_USAGE using ReconciliationArtifactService.
 * Adheres strictly to ADR-028 lock ordering: BillingWallet -> BillableInvocationAdmission -> BillingReconciliationCase.
 * Fingerprints entire business payload (decision + rationale + artifactId) for tamper-proof idempotency replay and conflict detection.
 * Enforces state transition matrix within transaction lock boundary.
 * Persists decision receipt in BillingReconciliationDecisionReceipt with unique constraint on idempotencyKey.
 * Invariants & Constraints: Atomic state updates across Admission, Case, Receipt, and AuditEvent; zero exposure on CONFIRM_NO_USAGE;
 * strict lock ordering prevents database deadlocks.
 */

import { createHash, randomUUID } from "node:crypto";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { HttpStatus, Injectable } from "@nestjs/common";
import { BillingReconciliationState } from "@prisma/client";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  BILLING_ACTIONS,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  RECONCILIATION_CASE_STATES,
  RECONCILIATION_DECISION_ACTIONS,
  reconciliationCaseDecisionResponseSchema,
  type ReconciliationCaseDecisionResponse,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { ReconciliationArtifactService } from "../../shared/reconciliation-artifact.service.js";
import { DecideBillingReconciliationCaseCommand } from "./decide-billing-reconciliation-case.command.js";

/**
 * Business purpose: Calculate canonical SHA-256 fingerprint for business decision payload.
 *
 * Business rules:
 * - Covers decision action, trimmed audit rationale, and providerLogArtifactId reference.
 * - Changing decision, rationale, or artifact ID results in a distinct hash.
 * - Pure determinism: identical payload always yields identical hash.
 *
 * Execution flow:
 * 1. Normalize and trim payload fields.
 * 2. Format canonical JSON representation.
 * 3. Compute SHA-256 hex digest.
 * 4. Return resulting hex string.
 *
 * Failure cases:
 * - Throws if JSON serialization or crypto digest computation fails.
 *
 * Side effects:
 * - Pure computation; no database or external state mutations.
 */
function computeReconciliationDecisionFingerprint(input: {
  decision: string;
  auditRationale: string;
  providerLogArtifactId?: string | null;
}): string {
  const canonical = JSON.stringify({
    decision: input.decision.trim(),
    auditRationale: input.auditRationale.trim(),
    providerLogArtifactId: input.providerLogArtifactId?.trim() ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * State Transition Matrix for BillingReconciliationCase.
 * Defines permitted source states for each administrative decision.
 */
const ALLOWED_STATE_TRANSITIONS: Record<string, readonly string[]> = {
  [RECONCILIATION_DECISION_ACTIONS.confirmNoUsage]: [
    RECONCILIATION_CASE_STATES.OPEN,
    RECONCILIATION_CASE_STATES.EVIDENCE_PENDING,
    RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
    RECONCILIATION_CASE_STATES.ESCALATED,
  ],
  [RECONCILIATION_DECISION_ACTIONS.maintainExposure]: [
    RECONCILIATION_CASE_STATES.OPEN,
    RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
    RECONCILIATION_CASE_STATES.ESCALATED,
  ],
  [RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview]: [
    RECONCILIATION_CASE_STATES.OPEN,
    RECONCILIATION_CASE_STATES.EVIDENCE_PENDING,
    RECONCILIATION_CASE_STATES.ESCALATED,
  ],
  [RECONCILIATION_DECISION_ACTIONS.escalate]: [
    RECONCILIATION_CASE_STATES.OPEN,
    RECONCILIATION_CASE_STATES.EVIDENCE_PENDING,
    RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
  ],
};

const TERMINAL_CASE_STATES: readonly string[] = [
  RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE,
  RECONCILIATION_CASE_STATES.SETTLED_WITH_USAGE,
  RECONCILIATION_CASE_STATES.CLOSED,
];

@Injectable()
@CommandHandler(DecideBillingReconciliationCaseCommand)
export class DecideBillingReconciliationCaseHandler implements ICommandHandler<
  DecideBillingReconciliationCaseCommand,
  ReconciliationCaseDecisionResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifactService: ReconciliationArtifactService,
  ) {}

  /**
   * Business purpose: Execute an audited Admin decision on an open or in-review BillingReconciliationCase.
   *
   * Business rules:
   * - Caller must possess admin role and explicit billing:reconciliation:decision action permission.
   * - Must validate cryptographic provider log evidence when confirming no usage (CONFIRM_NO_USAGE) using ReconciliationArtifactService.
   * - Cannot confirm no-usage if admission is still IN_FLIGHT.
   * - Follows ADR-028 Line 136 lock acquisition sequence: BillingWallet -> BillableInvocationAdmission -> BillingReconciliationCase.
   * - Enforces state transition matrix within transaction lock boundary; terminal states reject further decisions with 409.
   * - Idempotent by idempotencyKey backed by unique BillingReconciliationDecisionReceipt: identical payload fingerprint returns historical snapshot; conflicting payload returns 409.
   * - On CONFIRM_NO_USAGE, resets admission maximumExposureMicrocredits to 0 and marks slot released.
   * - On MAINTAIN_EXPOSURE, retains exposure and transitions case to EVIDENCE_PENDING.
   * - On FLAG_INTEGRITY_REVIEW, retains exposure and transitions case to INTEGRITY_REVIEW.
   * - On ESCALATE, retains exposure and transitions case to ESCALATED.
   *
   * Execution flow:
   * 1. Check caller role and action permission; reject with 403 if unauthorized.
   * 2. Compute canonical payload fingerprint covering decision, rationale, and artifactId.
   * 3. Early check on existing decision receipt; replay snapshot if match, 409 if conflict.
   * 4. Look up case and linked admission; reject with 404 if missing.
   * 5. Check if admission is already settled; reject with 409 if settled.
   * 6. Check if admission is IN_FLIGHT; reject with 409 if confirming no usage.
   * 7. Open transaction and acquire locks in ADR-028 order: Wallet -> Admission -> ReconciliationCase.
   * 8. Check idempotency receipt within lock boundary; return historical response if replay, 409 if conflict.
   * 9. Enforce state transition matrix against locked case state; reject terminal (409) or disallowed transitions (409).
   * 10. If CONFIRM_NO_USAGE, authoritatively verify provider log artifact using ReconciliationArtifactService.
   * 11. Update Admission (if CONFIRM_NO_USAGE) and BillingReconciliationCase state.
   * 12. Persist unique BillingReconciliationDecisionReceipt and immutable AuditEvent.
   * 13. Return validated ReconciliationCaseDecisionResponse.
   *
   * Failure cases:
   * - 403 AUTH_FORBIDDEN_ACTION if caller lacks admin role or action permission.
   * - 404 BILLING_NOT_FOUND if case, wallet, or admission not found.
   * - 409 BILLING_ADMISSION_ALREADY_SETTLED if admission is already settled.
   * - 409 BILLING_ADMISSION_INVALID_STATE if admission is in flight during no-usage confirmation.
   * - 409 BILLING_RECONCILIATION_ALREADY_RESOLVED if case is in a terminal resolved state.
   * - 409 BILLING_RECONCILIATION_CASE_INVALID_STATE if transition is disallowed by state matrix.
   * - 409 BILLING_IDEMPOTENCY_CONFLICT if same idempotency key is replayed with divergent payload or across cases.
   * - 422 BILLING_INVALID_RECONCILIATION_EVIDENCE if provider artifact is missing, unverified, tampered, or contains dispatched logs.
   * - 422 BILLING_INCOMPLETE_RECONCILIATION_WINDOW if coverage window does not completely enfold the potential dispatch window or watermark is missing/unfinalized.
   *
   * Side effects:
   * - Atomically updates BillableInvocationAdmission (exposure/state), BillingReconciliationCase, creates BillingReconciliationDecisionReceipt, and writes AuditEvent.
   * - Locks a customer wallet or the platform sponsorship aggregate before the admission, according to funding principal.
   */
  async execute(
    command: DecideBillingReconciliationCaseCommand,
  ): Promise<ReconciliationCaseDecisionResponse> {
    const { caseId, payload, rbacContext, correlationId } = command;

    // 1. RBAC Authority Verification
    const role = rbacContext?.role ?? "";
    if (role !== AUTH_USER_ROLES.admin) {
      throw problemException(AUTH_ERROR_CODES.rbacDenied, correlationId, {
        status: HttpStatus.FORBIDDEN,
      });
    }

    const permissions = rbacContext?.permissions ?? [];
    if (!permissions.includes(BILLING_ACTIONS.reconciliationDecision)) {
      throw problemException(AUTH_ERROR_CODES.rbacDenied, correlationId, {
        status: HttpStatus.FORBIDDEN,
      });
    }

    // 2. Compute canonical payload fingerprint
    const requestFingerprint = computeReconciliationDecisionFingerprint({
      decision: payload.decision,
      auditRationale: payload.auditRationale,
      providerLogArtifactId: payload.providerLogArtifactId,
    });

    // 3. Early check on existing receipt (if already committed)
    const existingReceipt =
      await this.prisma.billingReconciliationDecisionReceipt.findUnique({
        where: { idempotencyKey: payload.idempotencyKey },
      });
    if (existingReceipt) {
      if (
        existingReceipt.caseId !== caseId ||
        existingReceipt.requestFingerprint !== requestFingerprint
      ) {
        throw problemException(
          BILLING_ERROR_CODES.idempotencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return existingReceipt.responseSnapshot as ReconciliationCaseDecisionResponse;
    }

    // 4. Case Existence Check
    const reconCase = await this.prisma.billingReconciliationCase.findUnique({
      where: { caseId },
      include: { admission: true },
    });

    if (!reconCase) {
      throw problemException(BILLING_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    // 5. Late Settlement Conflict Check (Admission already SETTLED)
    if (reconCase.admission.state === ADMISSION_STATES.SETTLED) {
      throw problemException(
        BILLING_ERROR_CODES.admissionAlreadySettled,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    // 6. Admission IN_FLIGHT Check
    if (
      payload.decision === RECONCILIATION_DECISION_ACTIONS.confirmNoUsage &&
      reconCase.admission.state === ADMISSION_STATES.IN_FLIGHT
    ) {
      throw problemException(
        BILLING_ERROR_CODES.admissionInvalidState,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    // 7. ADR-028 Strict Lock Sequence within Database Transaction
    // Rationale ("Why"): ADR-028 Line 136 defines the global locking hierarchy:
    // Wallet/Platform -> Admission -> ReconciliationCase to prevent deadlocks across concurrent billing ops.
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Why: Platform-sponsored calls have no customer wallet, yet their case decisions need the same lock hierarchy.
        // How: Lock the funding aggregate before the admission, matching settlement's platform advisory lock.
        // Invariant: A null wallet cannot silently prevent Admin review or release a platform case without serialization.
        if (
          reconCase.admission.fundingPrincipal ===
          ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED
        ) {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtext('lcsp:platform-sponsorship'), hashtext(${reconCase.admission.logicalOperationId}));
          `;
        } else if (
          reconCase.admission.fundingPrincipal ===
            ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET &&
          reconCase.admission.walletId
        ) {
          const [lockedWallet] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "BillingWallet" WHERE id = ${reconCase.admission.walletId} FOR UPDATE
          `;
          if (!lockedWallet) {
            throw problemException(
              BILLING_ERROR_CODES.notFound,
              correlationId,
              {
                status: HttpStatus.NOT_FOUND,
              },
            );
          }
        } else {
          // Fail closed if the persisted funding principal and wallet binding disagree.
          throw problemException(
            BILLING_ERROR_CODES.admissionContextMismatch,
            correlationId,
            {
              status: HttpStatus.UNPROCESSABLE_ENTITY,
            },
          );
        }

        // Step 7b: Lock BillableInvocationAdmission FOR UPDATE
        const [lockedAdmission] = await tx.$queryRaw<
          Array<{
            id: string;
            state: string;
            maximumExposureMicrocredits: bigint;
            admittedAt: Date;
            consumedAt: Date | null;
            expiresAt: Date;
          }>
        >`
          SELECT id, state, "maximumExposureMicrocredits", "admittedAt", "consumedAt", "expiresAt"
          FROM "BillableInvocationAdmission"
          WHERE id = ${reconCase.admission.id}
          FOR UPDATE
        `;
        if (!lockedAdmission) {
          throw problemException(
            BILLING_ERROR_CODES.admissionNotFound,
            correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }

        if (lockedAdmission.state === ADMISSION_STATES.SETTLED) {
          throw problemException(
            BILLING_ERROR_CODES.admissionAlreadySettled,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        if (
          payload.decision === RECONCILIATION_DECISION_ACTIONS.confirmNoUsage &&
          lockedAdmission.state === ADMISSION_STATES.IN_FLIGHT
        ) {
          throw problemException(
            BILLING_ERROR_CODES.admissionInvalidState,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Step 7c: Lock BillingReconciliationCase FOR UPDATE
        const [lockedCase] = await tx.$queryRaw<
          Array<{
            caseId: string;
            state: string;
            providerLogArtifactId: string | null;
            auditRationale: string | null;
            version: number;
          }>
        >`
          SELECT "caseId", state, "providerLogArtifactId", "auditRationale", version
          FROM "BillingReconciliationCase"
          WHERE "caseId" = ${caseId}
          FOR UPDATE
        `;
        if (!lockedCase) {
          throw problemException(BILLING_ERROR_CODES.notFound, correlationId, {
            status: HttpStatus.NOT_FOUND,
          });
        }

        // Step 7d: Idempotency Check inside Lock Boundary
        const txExistingReceipt =
          await tx.billingReconciliationDecisionReceipt.findUnique({
            where: { idempotencyKey: payload.idempotencyKey },
          });

        if (txExistingReceipt) {
          if (
            txExistingReceipt.caseId !== caseId ||
            txExistingReceipt.requestFingerprint !== requestFingerprint
          ) {
            throw problemException(
              BILLING_ERROR_CODES.idempotencyConflict,
              correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }

          return txExistingReceipt.responseSnapshot as ReconciliationCaseDecisionResponse;
        }

        // Step 7e: State Transition Matrix Enforcement
        if (TERMINAL_CASE_STATES.includes(lockedCase.state)) {
          throw problemException(
            BILLING_ERROR_CODES.reconciliationAlreadyResolved,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const allowedSources = ALLOWED_STATE_TRANSITIONS[payload.decision];
        if (!allowedSources || !allowedSources.includes(lockedCase.state)) {
          throw problemException(
            BILLING_ERROR_CODES.reconciliationCaseInvalidState,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Step 7f: Evidence Validation for new CONFIRM_NO_USAGE decisions
        if (
          payload.decision === RECONCILIATION_DECISION_ACTIONS.confirmNoUsage
        ) {
          if (!payload.providerLogArtifactId) {
            throw problemException(
              BILLING_ERROR_CODES.invalidReconciliationEvidence,
              correlationId,
              { status: HttpStatus.UNPROCESSABLE_ENTITY },
            );
          }

          const artifact = await tx.providerLogArtifact.findUnique({
            where: { artifactId: payload.providerLogArtifactId },
          });

          if (!artifact || !artifact.verified) {
            throw problemException(
              BILLING_ERROR_CODES.invalidReconciliationEvidence,
              correlationId,
              { status: HttpStatus.UNPROCESSABLE_ENTITY },
            );
          }

          // Unified potential dispatch window formula (identical to ResolveBillableInvocationNoUsageHandler):
          // Start: strictly <= admittedAt
          // End: if consumed, must cover at least 300s timeout after consumedAt or expiresAt, whichever is later.
          const potentialDispatchStart = lockedAdmission.admittedAt;
          const potentialDispatchEnd = lockedAdmission.consumedAt
            ? new Date(
                Math.max(
                  lockedAdmission.expiresAt.getTime(),
                  lockedAdmission.consumedAt.getTime() + 300_000,
                ),
              )
            : lockedAdmission.expiresAt;

          // Use shared ReconciliationArtifactService to authoritatively verify integrity, watermark, cryptographic signature, and window
          const verification = await this.artifactService.verifyArtifact({
            artifactId: artifact.artifactId,
            expectedSha256: artifact.sha256,
            expectedProvider: reconCase.provider,
            correlationId:
              reconCase.providerCorrelationId ||
              reconCase.admission.correlationId,
            potentialDispatchStart,
            potentialDispatchEnd,
            coverageStart: artifact.coverageStart,
            coverageEnd: artifact.coverageEnd,
          });

          if (!verification.verified) {
            if (
              verification.error === "incomplete_coverage" ||
              verification.error === "window_out_of_bounds" ||
              verification.error === "future_watermark"
            ) {
              throw problemException(
                BILLING_ERROR_CODES.incompleteReconciliationWindow,
                correlationId,
                { status: HttpStatus.UNPROCESSABLE_ENTITY },
              );
            }
            throw problemException(
              BILLING_ERROR_CODES.invalidReconciliationEvidence,
              correlationId,
              { status: HttpStatus.UNPROCESSABLE_ENTITY },
            );
          }

          // Also scan log entries for invocationId match to prevent edge-case dispatch
          let entries: Array<{ correlationId?: string; requestId?: string }>;
          try {
            // Why: Provider log JSON is untrusted; validate its shape before deciding no usage.
            const parsedEntries: unknown = JSON.parse(artifact.rawContent);
            if (
              !Array.isArray(parsedEntries) ||
              !parsedEntries.every(
                (entry: unknown) =>
                  typeof entry === "object" &&
                  entry !== null &&
                  ("correlationId" in entry
                    ? typeof entry.correlationId === "string"
                    : true),
              )
            )
              throw new Error("Invalid provider log entries");
            entries = parsedEntries as Array<{
              correlationId?: string;
              requestId?: string;
            }>;
          } catch {
            throw problemException(
              BILLING_ERROR_CODES.invalidReconciliationEvidence,
              correlationId,
              { status: HttpStatus.UNPROCESSABLE_ENTITY },
            );
          }

          const dispatched = entries.some(
            (e) => e.correlationId === reconCase.invocationId,
          );
          if (dispatched) {
            throw problemException(
              BILLING_ERROR_CODES.invalidReconciliationEvidence,
              correlationId,
              { status: HttpStatus.UNPROCESSABLE_ENTITY },
            );
          }
        }

        // Step 7g: State Transitions & Slot Release
        let newState: string;
        let slotReleased: boolean;

        switch (payload.decision) {
          case RECONCILIATION_DECISION_ACTIONS.confirmNoUsage:
            newState = RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE;
            slotReleased = true;
            // Atomically reset admission exposure to 0 and transition admission state
            await tx.billableInvocationAdmission.update({
              where: { id: reconCase.admission.id },
              data: {
                state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
                maximumExposureMicrocredits: 0n,
                version: { increment: 1 },
              },
            });
            break;

          case RECONCILIATION_DECISION_ACTIONS.maintainExposure:
            newState = RECONCILIATION_CASE_STATES.EVIDENCE_PENDING;
            slotReleased = false;
            break;

          case RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview:
            newState = RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW;
            slotReleased = false;
            break;

          case RECONCILIATION_DECISION_ACTIONS.escalate:
            newState = RECONCILIATION_CASE_STATES.ESCALATED;
            slotReleased = false;
            break;

          default:
            throw problemException(
              BILLING_ERROR_CODES.validationFailed,
              correlationId,
              { status: HttpStatus.BAD_REQUEST },
            );
        }

        const decidedAt = new Date().toISOString();

        // Step 7h: Update BillingReconciliationCase
        await tx.billingReconciliationCase.update({
          where: { caseId },
          data: {
            state: newState as BillingReconciliationState,
            resolvedBy: rbacContext.userId,
            resolvedAt: new Date(decidedAt),
            auditRationale: payload.auditRationale,
            providerLogArtifactId: payload.providerLogArtifactId ?? null,
            version: { increment: 1 },
          },
        });

        const responseSnapshot: ReconciliationCaseDecisionResponse = {
          decided: true,
          caseId,
          invocationId: reconCase.invocationId,
          admissionId: reconCase.admission.id,
          previousState: lockedCase.state,
          newState,
          decision: payload.decision,
          slotReleased,
          auditRationale: payload.auditRationale,
          decidedAt,
          decidedBy: rbacContext.userId,
        };

        // Step 7i: Validate response snapshot against canonical contract schema
        const parsed =
          reconciliationCaseDecisionResponseSchema.safeParse(responseSnapshot);
        if (!parsed.success) {
          throw problemException(
            BILLING_ERROR_CODES.validationFailed,
            correlationId,
            { status: HttpStatus.INTERNAL_SERVER_ERROR },
          );
        }

        // Step 7j: Persist unique BillingReconciliationDecisionReceipt for idempotency
        await tx.billingReconciliationDecisionReceipt.create({
          data: {
            id: randomUUID(),
            caseId,
            idempotencyKey: payload.idempotencyKey,
            requestFingerprint,
            decision: payload.decision,
            auditRationale: payload.auditRationale,
            providerLogArtifactId: payload.providerLogArtifactId ?? null,
            decidedBy: rbacContext.userId,
            responseSnapshot: parsed.data,
          },
        });

        // Step 7k: Record immutable AuditEvent
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            eventType: BILLING_AUDIT_EVENT_TYPES.reconciliationDecided,
            actorId: rbacContext.userId,
            resourceId: caseId,
            correlationId,
            payload: {
              idempotencyKey: payload.idempotencyKey,
              requestFingerprint,
              decision: payload.decision,
              previousState: lockedCase.state,
              newState,
              slotReleased,
              auditRationale: payload.auditRationale,
              providerLogArtifactId: payload.providerLogArtifactId ?? null,
              decidedAt,
              responseSnapshot: parsed.data,
            },
          },
        });

        return parsed.data;
      });
    } catch (err: unknown) {
      // Catch concurrent unique constraint race conditions (P2002) on idempotencyKey across different cases
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        const existingReceipt =
          await this.prisma.billingReconciliationDecisionReceipt.findUnique({
            where: { idempotencyKey: payload.idempotencyKey },
          });

        if (existingReceipt) {
          if (
            existingReceipt.caseId !== caseId ||
            existingReceipt.requestFingerprint !== requestFingerprint
          ) {
            throw problemException(
              BILLING_ERROR_CODES.idempotencyConflict,
              correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }

          return existingReceipt.responseSnapshot as ReconciliationCaseDecisionResponse;
        }
      }

      throw err;
    }
  }
}
