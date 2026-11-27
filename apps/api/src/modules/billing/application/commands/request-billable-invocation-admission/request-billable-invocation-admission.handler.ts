import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  DEFAULT_ADMISSION_TTL_SECONDS,
  MODEL_USAGE_DEBIT_MODES,
  PILOT_MAX_IN_FLIGHT_INVOCATIONS_PER_WALLET,
  computeAdmissionRequestFingerprint,
  deriveAdmissionCapabilityDigest,
  deriveAdmissionCapabilitySecret,
  type AdmissionFundingPrincipal,
  type BillableInvocationAdmissionResponse,
  type ModelPricingScope,
} from "@lcsp/contracts/billing";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { BillingRolloutAuthorityService } from "../../shared/billing-rollout-authority.service.js";
import { RequestBillableInvocationAdmissionCommand } from "./request-billable-invocation-admission.command.js";

export type RequestAdmissionExecutionResult = {
  isReplay: boolean;
  data: BillableInvocationAdmissionResponse;
};

@Injectable()
@CommandHandler(RequestBillableInvocationAdmissionCommand)
export class RequestBillableInvocationAdmissionHandler implements ICommandHandler<
  RequestBillableInvocationAdmissionCommand,
  RequestAdmissionExecutionResult
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly modelPricingRepo: ModelPricingRepositoryPort,
    private readonly modelPricingCalculator: ModelPricingCalculatorService,
    private readonly rolloutAuthority: BillingRolloutAuthorityService,
  ) {}

  /**
   * Business purpose: Issue a cryptographically bound, concurrency-controlled invocation admission for deepagents worker calls.
   *
   * Business rules:
   * - Capability HMAC tokens must be derived using a dedicated server-only master secret (BILLING_ADMISSION_MASTER_KEY), never worker keys.
   * - Assessment requests must possess a valid, unexpired execution lease token belonging to the target assessment.
   * - Platform-sponsored requests are strictly restricted to approved system policies (e.g. system preparation runs); arbitrary unlinked calls are rejected.
   * - Both customer-funded and platform-sponsored admissions must calculate real provider cost exposure (> 0n) and pin authoritative policy.
   * - Token bounds (inputTokensUpperBound > 0, outputTokensUpperBound > 0) are strictly mandatory; no synthetic numeric defaults are permitted.
   * - Enforces exactly 1 active invocation slot per wallet during pilot (includes ADMITTED, IN_FLIGHT, OUTCOME_UNKNOWN, DISPATCH_UNKNOWN, BILLING_INTEGRITY_REVIEW).
   * - Row-level locking on BillingWallet ensures concurrent requests serialize deterministically.
   * - Customer wallet must have positive balance and sufficient microcredits to cover maximum exposure.
   * - Idempotent replays matching context return the existing admission (HTTP 200) with reconstructed capability token.
   * - Replaying unconsumed expired admission commits state EXPIRED to PostgreSQL before returning HTTP 422.
   * - Pins server-authoritative rolloutMode and debitMode at issuance time (ADR-028 Line 206-217):
   *   MODEL_USAGE_DEBIT=ON pins DEBIT_ENABLED and ON;
   *   MODEL_USAGE_DEBIT=SHADOW pins SHADOW_SETTLEMENT and SHADOW;
   *   default/OFF pins ADMISSION_REQUIRED and OFF.
   * - Enforces physical invocation retry and zero-redispatch rules under transaction lock (ADR-028 Line 70, 92, 220):
   *   blocks redispatch while prior attempt is unresolved (IN_FLIGHT, DISPATCH_UNKNOWN, OUTCOME_UNKNOWN, BILLING_INTEGRITY_REVIEW);
   *   blocks further attempts for SETTLED operations;
   *   permits incremented attemptOrdinal after terminal non-usage (CONFIRMED_NO_USAGE, EXPIRED);
   *   serializes concurrent retries under logical operation advisory lock and wallet lock, enforcing unique constraint on (logicalOperationId, attemptOrdinal).
   *
   * Execution flow:
   * 1. Validate that dedicated server master secret is configured, throwing immediately if missing or empty.
   * 2. Compute deterministic request fingerprint from input fields.
   * 3. Inspect if an admission with matching admissionRequestId already exists: on unconsumed expired admission, commit state EXPIRED to PostgreSQL before throwing 422.
   * 4. In a transaction, acquire a PostgreSQL transaction-scoped advisory lock on logicalOperationId to serialize all concurrent retries across both customer-wallet and platform-sponsored flows.
   * 5. Verify assessment ownership, execution lease token, and run context against AssessmentRuntime or AssessmentDiscoveryRun.
   * 6. Verify platform sponsorship policy: allow only for approved system preparation runs; reject arbitrary requests.
   * 7. Lock the customer wallet row with FOR UPDATE and sweep unconsumed expired admissions.
   * 8. Verify logical operation attempt history inside transaction lock: reject unresolved attempts (including BILLING_INTEGRITY_REVIEW) and non-monotonic attemptOrdinal.
   * 9. Verify wallet concurrency slot limit against unresolved admission states (including BILLING_INTEGRITY_REVIEW).
   * 10. Enforce mandatory token upper bounds (> 0).
   * 11. For customer wallet, resolve customer tariff and compute maximum exposure; for platform sponsorship, resolve active PlatformSponsorshipPolicySnapshot (fail closed 403 if absent) and compute exposure from snapshot rates.
   * 12. Derive HMAC capability secret and digest.
   * 13. Insert BillableInvocationAdmission record with state ADMITTED, handling unique constraint collisions as concurrency conflict.
   * 14. Return admission response with 201 Created semantics.
   *
   * Failure cases:
   * - Throws Error when BILLING_ADMISSION_MASTER_KEY is missing or empty.
   * - Throws 401 when unauthenticated.
   * - Throws 402 PAYMENT_REQUIRED when customer wallet is empty or insufficient.
   * - Throws 403 FORBIDDEN when execution lease or run context mismatches or unauthorized sponsorship is requested.
   * - Throws 404 NOT_FOUND when assessment or preparation run does not exist.
   * - Throws 409 CONFLICT when replay fingerprint mismatches, wallet concurrency slot limit is reached, active attempts are unresolved (including BILLING_INTEGRITY_REVIEW), attemptOrdinal is non-monotonic, or concurrent race triggers unique constraint violation.
   * - Throws 422 UNPROCESSABLE_ENTITY when unconsumed admission is expired or token bounds are missing/non-positive.
   *
   * Side effects:
   * - Inserts a new BillableInvocationAdmission row.
   * - May transition expired unconsumed admissions to EXPIRED.
   */
  // Rationale ("Why"): Enforces pre-call admission control so unmetered, unauthorized, or insolvent provider dispatch is impossible.
  // Mechanism ("How"): Combines Postgres row lock on BillingWallet, execution lease verification against AssessmentRuntime, and dedicated HMAC capability token generation.
  // Invariants & Constraints: BILLING_ADMISSION_MASTER_KEY is server-private; pins server-authoritative rolloutMode and debitMode; exactly 1 slot per wallet.
  async execute(
    command: RequestBillableInvocationAdmissionCommand,
  ): Promise<RequestAdmissionExecutionResult> {
    const { payload, correlationId = "admission-request" } = command;
    const fingerprint = computeAdmissionRequestFingerprint(payload);

    // Why: Server capability tokens must be signed with a dedicated server-only master secret,
    // never WORKER_API_KEY which workers know and hold, and never an insecure fallback.
    // How: Validate BILLING_ADMISSION_MASTER_KEY from ConfigService / process.env and fail immediately if absent.
    // Invariants: Server-issued capability secret cannot be forged by worker nodes.
    const serverSecret =
      this.configService.get<string>("billing.admissionMasterKey")?.trim() ||
      process.env.BILLING_ADMISSION_MASTER_KEY?.trim();

    if (!serverSecret || serverSecret.length < 16) {
      throw new Error(
        "BILLING_ADMISSION_MASTER_KEY is not configured or empty. Server capability secret derivation requires a dedicated server master secret.",
      );
    }

    const dbUtcNow = await this.modelPricingRepo.getDbUtcNow();

    // 1. Check existing record for idempotent replay outside of creation transaction
    // Why: When an unconsumed admission is expired, transitioning to EXPIRED must be durably committed
    // even though the HTTP response is an unprocessable entity (422) error.
    // How: Execute the state update directly on this.prisma before throwing problemException so rollback cannot revert it.
    // Invariants: Replaying an expired unconsumed admission permanently commits state: EXPIRED to PostgreSQL.
    const existing = await this.prisma.billableInvocationAdmission.findUnique({
      where: { admissionRequestId: payload.admissionRequestId },
    });

    if (existing) {
      // Multi-factor validation for idempotency
      if (existing.requestFingerprint !== fingerprint) {
        throw problemException(
          BILLING_ERROR_CODES.idempotencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      if (
        existing.executionLeaseToken !==
          (payload.executionLeaseToken ?? null) ||
        existing.runId !== payload.runId
      ) {
        throw problemException(
          BILLING_ERROR_CODES.admissionContextMismatch,
          correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }
      if (
        existing.state === ADMISSION_STATES.ADMITTED &&
        existing.expiresAt.getTime() <= dbUtcNow.getTime()
      ) {
        await this.prisma.billableInvocationAdmission.update({
          where: { id: existing.id },
          data: {
            state: ADMISSION_STATES.EXPIRED,
            version: { increment: 1 },
          },
        });
        throw problemException(
          BILLING_ERROR_CODES.admissionExpired,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      // Reconstruct capability token using HMAC
      const capabilityToken = deriveAdmissionCapabilitySecret(
        serverSecret,
        existing.admissionRequestId,
        existing.requestFingerprint,
        existing.invocationId,
      );

      return {
        isReplay: true,
        data: {
          admissionId: existing.id,
          invocationId: existing.invocationId,
          admissionRequestId: existing.admissionRequestId,
          fundingPrincipal: existing.fundingPrincipal,
          state: existing.state,
          rolloutMode: existing.rolloutMode,
          debitMode: existing.debitMode,
          tariffSnapshotId: existing.tariffSnapshotId ?? null,
          tariffAssignmentId: existing.tariffAssignmentId ?? null,
          sponsorshipPolicySnapshotId:
            existing.sponsorshipPolicySnapshotId ?? null,
          appliedMaxOutputTokens: existing.appliedMaxOutputTokens,
          resolvedProvider: existing.resolvedProvider,
          resolvedModel: existing.resolvedModel,
          maximumExposureMicrocredits:
            existing.maximumExposureMicrocredits.toString(),
          capabilityToken,
          admittedAt: existing.admittedAt.toISOString(),
          expiresAt: existing.expiresAt.toISOString(),
        },
      };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Invariant (ADR-028 Line 70, 92, 220): PostgreSQL transaction-scoped advisory lock on logicalOperationId.
        // Serializes all concurrent admission attempts for the same logical operation across BOTH
        // customer-wallet and platform-sponsored flows, regardless of identical or differing attemptOrdinals.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lcsp:billable-logical-operation'), hashtext(${payload.logicalOperationId}));`;

        // 2. Resolve owner and funding principal with strict context and authority verification
        let userId: string | null;
        let fundingPrincipal: AdmissionFundingPrincipal =
          ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET;

        if (payload.assessmentId) {
          const assessment = await tx.assessment.findUnique({
            where: { id: payload.assessmentId },
            select: { ownerId: true },
          });
          if (!assessment) {
            throw problemException(
              BILLING_ERROR_CODES.notFound,
              correlationId,
              {
                status: HttpStatus.NOT_FOUND,
              },
            );
          }

          // Why: An assessment admission must prove possession of an active, unexpired lease token for that assessment.
          // How: Verify leaseToken and runId against AssessmentRuntime or AssessmentDiscoveryRun.
          // Invariants: Untrusted or expired worker requests cannot spend customer wallet credits.
          if (!payload.executionLeaseToken || !payload.runId) {
            throw problemException(
              BILLING_ERROR_CODES.admissionContextMismatch,
              correlationId,
              { status: HttpStatus.FORBIDDEN },
            );
          }

          const runtime = await tx.assessmentRuntime.findUnique({
            where: { assessmentId: payload.assessmentId },
          });

          const isRuntimeValid =
            runtime &&
            runtime.leaseToken === payload.executionLeaseToken &&
            runtime.leaseExpiresAt &&
            runtime.leaseExpiresAt.getTime() > dbUtcNow.getTime() &&
            (runtime.currentExecutionId === payload.runId ||
              runtime.threadId === payload.runId);

          if (!isRuntimeValid) {
            const discoveryRun = await tx.assessmentDiscoveryRun.findUnique({
              where: { runId: payload.runId },
            });

            const isDiscoveryValid =
              discoveryRun &&
              discoveryRun.assessmentId === payload.assessmentId &&
              discoveryRun.leaseToken === payload.executionLeaseToken &&
              discoveryRun.leaseExpiresAt &&
              discoveryRun.leaseExpiresAt.getTime() > dbUtcNow.getTime();

            if (!isDiscoveryValid) {
              throw problemException(
                BILLING_ERROR_CODES.admissionContextMismatch,
                correlationId,
                { status: HttpStatus.FORBIDDEN },
              );
            }
          }

          userId = assessment.ownerId;
        } else if (payload.preparationRunId) {
          const run = await tx.ruleSetPreparationRun.findUnique({
            where: { id: payload.preparationRunId },
            select: { requestedBy: true },
          });
          if (!run) {
            throw problemException(
              BILLING_ERROR_CODES.notFound,
              correlationId,
              {
                status: HttpStatus.NOT_FOUND,
              },
            );
          }
          // Why: Only approved system runs qualify for platform sponsorship.
          // How: Inspect requestedBy; user-requested preparation runs must bind the user's customer wallet.
          // Invariants: Arbitrary unsponsored calls are never granted free platform credits.
          if (run.requestedBy === "SYSTEM") {
            fundingPrincipal = ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED;
            userId = null;
          } else {
            fundingPrincipal = ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET;
            userId = run.requestedBy;
          }
        } else {
          // Arbitrary unlinked requests without assessmentId or approved sponsorship policy are rejected!
          throw problemException(
            BILLING_ERROR_CODES.admissionContextMismatch,
            correlationId,
            { status: HttpStatus.FORBIDDEN },
          );
        }

        let walletId: string | null = null;

        // 3. For customer wallet, row-lock the wallet and check concurrency slot & solvency
        if (
          fundingPrincipal === ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET &&
          userId
        ) {
          const [lockedWallet] = await tx.$queryRaw<
            Array<{
              id: string;
              availableCredits: bigint;
              balanceMicrocredits: bigint;
            }>
          >`SELECT id, "availableCredits", "balanceMicrocredits" FROM "BillingWallet" WHERE "userId" = ${userId} FOR UPDATE;`;

          if (!lockedWallet || lockedWallet.availableCredits <= 0n) {
            throw problemException(
              BILLING_ERROR_CODES.paymentRequired,
              correlationId,
              { status: HttpStatus.PAYMENT_REQUIRED },
            );
          }

          walletId = lockedWallet.id;

          // Transition unconsumed expired admissions to EXPIRED to free slots cleanly
          await tx.billableInvocationAdmission.updateMany({
            where: {
              walletId: lockedWallet.id,
              state: ADMISSION_STATES.ADMITTED,
              expiresAt: { lte: dbUtcNow },
            },
            data: {
              state: ADMISSION_STATES.EXPIRED,
              version: { increment: 1 },
            },
          });

          // Invariant (ADR-028 Line 70, 92, 220): Physical invocation retry & zero-redispatch rules under transaction lock.
          // Evaluated before wallet-level concurrency count so logical operation conflicts (redispatch / retry races)
          // produce canonical operation-level problem codes (concurrencyConflict / idempotencyConflict).
          // 1. Monotonic attempt ordinal check: Each subsequent physical attempt for a logical operation must have a strictly increasing attemptOrdinal.
          //    Attempting to reuse an existing or decremented ordinal is an idempotency conflict.
          // 2. Zero-redispatch concurrency check: While a prior attempt is active or unresolved
          //    (ADMITTED, IN_FLIGHT, DISPATCH_UNKNOWN, OUTCOME_UNKNOWN, or BILLING_INTEGRITY_REVIEW),
          //    requesting a subsequent physical dispatch is forbidden to prevent duplicate in-flight provider calls or competing with unverified integrity review.
          // 3. Concluded operation check: If any prior attempt already concluded in SETTLED, the business operation is finished; further attempts are rejected.
          const existingForOperation =
            await tx.billableInvocationAdmission.findMany({
              where: {
                logicalOperationId: payload.logicalOperationId,
                ...(payload.assessmentId
                  ? { assessmentId: payload.assessmentId }
                  : {}),
              },
              orderBy: { attemptOrdinal: "desc" },
            });

          if (existingForOperation.length > 0) {
            const maxOrdinal = Math.max(
              ...existingForOperation.map((a) => a.attemptOrdinal),
            );
            if (payload.attemptOrdinal <= maxOrdinal) {
              throw problemException(
                BILLING_ERROR_CODES.idempotencyConflict,
                correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }

            const activeUnresolved = existingForOperation.find(
              (a) =>
                a.state === ADMISSION_STATES.ADMITTED ||
                a.state === ADMISSION_STATES.IN_FLIGHT ||
                a.state === ADMISSION_STATES.DISPATCH_UNKNOWN ||
                a.state === ADMISSION_STATES.OUTCOME_UNKNOWN ||
                a.state === ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
            );

            if (activeUnresolved) {
              throw problemException(
                BILLING_ERROR_CODES.concurrencyConflict,
                correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }

            const settledAttempt = existingForOperation.find(
              (a) => a.state === ADMISSION_STATES.SETTLED,
            );
            if (settledAttempt) {
              throw problemException(
                BILLING_ERROR_CODES.admissionAlreadySettled,
                correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
          }

          // Slot limit check: count all active/unresolved states
          const activeCount = await tx.billableInvocationAdmission.count({
            where: {
              walletId: lockedWallet.id,
              state: {
                in: [
                  ADMISSION_STATES.ADMITTED,
                  ADMISSION_STATES.IN_FLIGHT,
                  ADMISSION_STATES.OUTCOME_UNKNOWN,
                  ADMISSION_STATES.DISPATCH_UNKNOWN,
                  ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
                ],
              },
            },
          });

          if (activeCount >= PILOT_MAX_IN_FLIGHT_INVOCATIONS_PER_WALLET) {
            throw problemException(
              BILLING_ERROR_CODES.walletConcurrencyLimitExceeded,
              correlationId,
              { status: HttpStatus.CONFLICT }, // 409 or 429
            );
          }
        } else if (
          fundingPrincipal === ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED
        ) {
          // Enforce logical operation retry & zero-redispatch rules for platform-sponsored calls as well
          const existingForOperation =
            await tx.billableInvocationAdmission.findMany({
              where: {
                logicalOperationId: payload.logicalOperationId,
                ...(payload.preparationRunId
                  ? { preparationRunId: payload.preparationRunId }
                  : {}),
              },
              orderBy: { attemptOrdinal: "desc" },
            });

          if (existingForOperation.length > 0) {
            const maxOrdinal = Math.max(
              ...existingForOperation.map((a) => a.attemptOrdinal),
            );
            if (payload.attemptOrdinal <= maxOrdinal) {
              throw problemException(
                BILLING_ERROR_CODES.idempotencyConflict,
                correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }

            const activeUnresolved = existingForOperation.find(
              (a) =>
                a.state === ADMISSION_STATES.ADMITTED ||
                a.state === ADMISSION_STATES.IN_FLIGHT ||
                a.state === ADMISSION_STATES.DISPATCH_UNKNOWN ||
                a.state === ADMISSION_STATES.OUTCOME_UNKNOWN ||
                a.state === ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
            );

            if (activeUnresolved) {
              throw problemException(
                BILLING_ERROR_CODES.concurrencyConflict,
                correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }

            const settledAttempt = existingForOperation.find(
              (a) => a.state === ADMISSION_STATES.SETTLED,
            );
            if (settledAttempt) {
              throw problemException(
                BILLING_ERROR_CODES.admissionAlreadySettled,
                correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
          }
        }

        // 4. Validate mandatory token bounds and resolve effective tariff & exposure
        // Why: Token bounds define the absolute financial exposure ceiling. Omitting bounds must reject.
        // How: Enforce positive integers for both input and output bounds.
        // Invariants: Never fall back to implicit or synthetic exposure defaults.
        if (
          payload.inputTokensUpperBound == null ||
          payload.outputTokensUpperBound == null ||
          typeof payload.inputTokensUpperBound !== "number" ||
          typeof payload.outputTokensUpperBound !== "number" ||
          payload.inputTokensUpperBound <= 0 ||
          payload.outputTokensUpperBound <= 0
        ) {
          throw problemException(
            BILLING_ERROR_CODES.validationFailed,
            correlationId,
            { status: HttpStatus.UNPROCESSABLE_ENTITY },
          );
        }

        // Why: ADR-028 & Root Cause 2: Separate authority and exposure calculation for customer vs platform work.
        // Customer calls use CustomerModelTariffSnapshot; platform calls MUST use immutable PlatformSponsorshipPolicySnapshot.
        // Mechanism: For PLATFORM_SPONSORED, query active PlatformSponsorshipPolicySnapshot and fail closed (403) if absent.
        // Invariants: Platform calls never resolve customer tariffs or debit customer wallets; customer calls never use platform sponsorship.
        let tariffSnapshotId: string | null = null;
        let tariffAssignmentId: string | null = null;
        let pricingResolution: ModelPricingScope | null = null;
        let sponsorshipPolicySnapshotId: string | null = null;
        let runtimePolicyVersion: string;
        let maximumExposureMicrocredits: bigint;

        if (
          fundingPrincipal === ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED
        ) {
          const policy = await tx.platformSponsorshipPolicySnapshot.findFirst({
            where: {
              policyName: "RULE_SET_PREPARATION_SYSTEM",
              provider: payload.requestedProvider.trim().toLowerCase(),
              resolvedModel: payload.requestedModel.trim(),
              effectiveFrom: { lte: dbUtcNow },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: dbUtcNow } }],
            },
            orderBy: { effectiveFrom: "desc" },
          });

          if (!policy) {
            throw problemException(
              BILLING_ERROR_CODES.admissionContextMismatch,
              correlationId,
              { status: HttpStatus.FORBIDDEN },
            );
          }

          const inputExposure =
            BigInt(payload.inputTokensUpperBound) *
            policy.inputMicrocreditsPerMillion;
          const outputExposure =
            BigInt(payload.outputTokensUpperBound) *
            policy.outputMicrocreditsPerMillion;
          maximumExposureMicrocredits =
            (inputExposure + outputExposure + 999_999n) / 1_000_000n;

          sponsorshipPolicySnapshotId = policy.id;
          runtimePolicyVersion = `${policy.policyName}@${policy.policyVersion}`;
        } else {
          const candidates =
            await this.modelPricingRepo.listActiveAssignmentsAt(dbUtcNow);
          const tariff = this.modelPricingCalculator.resolveEffectiveTariff({
            provider: payload.requestedProvider,
            resolvedModel: payload.requestedModel,
            candidates,
          });

          const charge = this.modelPricingCalculator.calculateCharge({
            ratesMicrocreditsPerMillion: tariff.ratesMicrocreditsPerMillion,
            usage: {
              inputTokens: BigInt(payload.inputTokensUpperBound),
              outputTokens: BigInt(payload.outputTokensUpperBound),
            },
          });

          maximumExposureMicrocredits = charge.chargeMicrocredits;
          tariffSnapshotId = tariff.snapshotId;
          tariffAssignmentId = tariff.assignmentId;
          pricingResolution = tariff.scope;
          runtimePolicyVersion = "WP8_PILOT_V1";
        }

        // 5. Derive capability secret & digest
        const invocationId = `inv-${randomUUID()}`;
        const capabilityToken = deriveAdmissionCapabilitySecret(
          serverSecret,
          payload.admissionRequestId,
          fingerprint,
          invocationId,
        );
        const capabilityDigest =
          deriveAdmissionCapabilityDigest(capabilityToken);
        const expiresAt = new Date(
          dbUtcNow.getTime() + DEFAULT_ADMISSION_TTL_SECONDS * 1000,
        );

        // Rationale ("Why"): ADR-028 Line 206-217 defines server-authoritative monotonic rollout progression:
        // TELEMETRY_ONLY -> SHADOW_PRICING -> ADMISSION_REQUIRED -> SHADOW_SETTLEMENT -> DEBIT_ENABLED.
        // Mechanism ("How"): At admission issuance, the admission pins both its rolloutMode and debitMode
        // based on the server's configured rollout authority from BillingRolloutAuthorityService,
        // ensuring immutable authority for downstream settlement without unvalidated environment bypass.
        // Invariants: Production configuration fails closed; raw process.env is never read directly.
        const authority = this.rolloutAuthority.getActiveRolloutAuthority();
        const rolloutMode = authority.rolloutMode;
        const debitMode = authority.debitMode;

        // 6. Insert BillableInvocationAdmission record
        const admission = await tx.billableInvocationAdmission.create({
          data: {
            invocationId,
            admissionRequestId: payload.admissionRequestId,
            requestFingerprint: fingerprint,
            logicalOperationId: payload.logicalOperationId,
            attemptOrdinal: payload.attemptOrdinal,
            fundingPrincipal,
            userId,
            walletId,
            assessmentId: payload.assessmentId ?? null,
            preparationRunId: payload.preparationRunId ?? null,
            runId: payload.runId,
            executionLeaseToken: payload.executionLeaseToken ?? null,
            agentRole: payload.agentRole,
            operationType: payload.operationType,
            requestedModel: payload.requestedModel,
            resolvedProvider: payload.requestedProvider.trim().toLowerCase(),
            resolvedModel: payload.requestedModel.trim(),
            tariffSnapshotId,
            tariffAssignmentId,
            pricingResolution,
            sponsorshipPolicySnapshotId,
            runtimePolicyVersion,
            rolloutMode,
            debitMode,
            appliedMaxOutputTokens: payload.outputTokensUpperBound,
            maximumExposureMicrocredits,
            capabilityDigest,
            state: ADMISSION_STATES.ADMITTED,
            admittedAt: dbUtcNow,
            expiresAt,
            correlationId,
          },
        });

        return {
          isReplay: false,
          data: {
            admissionId: admission.id,
            invocationId: admission.invocationId,
            admissionRequestId: admission.admissionRequestId,
            fundingPrincipal: admission.fundingPrincipal,
            state: admission.state,
            rolloutMode: admission.rolloutMode,
            debitMode: admission.debitMode,
            tariffSnapshotId: admission.tariffSnapshotId ?? null,
            tariffAssignmentId: admission.tariffAssignmentId ?? null,
            sponsorshipPolicySnapshotId:
              admission.sponsorshipPolicySnapshotId ?? null,
            appliedMaxOutputTokens: admission.appliedMaxOutputTokens,
            resolvedProvider: admission.resolvedProvider,
            resolvedModel: admission.resolvedModel,
            maximumExposureMicrocredits:
              admission.maximumExposureMicrocredits.toString(),
            capabilityToken,
            admittedAt: admission.admittedAt.toISOString(),
            expiresAt: admission.expiresAt.toISOString(),
          },
        };
      });
    } catch (err: unknown) {
      // Why: Catch PostgreSQL unique constraint violations (code P2002) on (logicalOperationId, attemptOrdinal)
      // or admissionRequestId when two concurrent requests race to create an attempt.
      // How: Map P2002 cleanly to 409 BILLING_CONCURRENCY_CONFLICT so clients receive canonical HTTP problem envelope.
      // Invariants: Uniqueness violation never leaks raw Prisma P2002 internal error (500) to API clients.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        throw problemException(
          BILLING_ERROR_CODES.concurrencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      throw err;
    }
  }
}
