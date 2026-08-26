import * as crypto from "node:crypto";

import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  buildAuditEventInput,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  AI_USAGE_FLOW_SCHEMA_VERSIONS,
  AI_USAGE_FLOW_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import {
  ConflictException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaOutboxAggregateType,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import type {
  AIUsageFlowCallbackDto,
  AIUsageFlowClaimRequest,
} from "../../contracts/ai-usage-flow/ai-usage-flow-callback.contract.js";
import { AcceptAIUsageFlowCommand } from "./accept-ai-usage-flow.command.js";

const AI_USAGE_FLOW_WORKER_ACTOR_ID = AUDIT_ACTOR_IDS.aiUsageFlowWorker;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "codesnippet",
  "filecontent",
  "fullastbody",
  "fullprompt",
  "rawoutput",
  "rawsource",
  "rawsourcecode",
  "snippet",
  "sourcecode",
  "sourcecontent",
]);
const SECRET_PATTERNS = [
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
];

/**
 * Validates and atomically accepts worker-produced AI usage-flow artifacts, then emits the corresponding outbox and audit records.
 */
@CommandHandler(AcceptAIUsageFlowCommand)
export class AcceptAIUsageFlowHandler implements ICommandHandler<AcceptAIUsageFlowCommand> {
  /**
   * Creates the command handler with access to AI usage-flow, outbox, and audit persistence.
   *
   * @param prisma - Prisma service used for validation lookups and the acceptance transaction.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Accepts one AI usage-flow callback after schema, privacy, ownership, and uniqueness validation.
   *
   * @param command - Callback payload and correlation context to validate and persist.
   * @returns Acceptance metadata containing the persisted AI usage-flow identifier and correlation ID.
   * @throws When the callback is invalid, unsafe, references a missing technical profile, or duplicates an existing flow.
   */
  async execute(
    command: AcceptAIUsageFlowCommand,
  ): Promise<AIUsageFlowCallbackDto> {
    this.validate(command);

    const payload = command.payload;
    const technicalProfile = await this.prisma.technicalProfile.findFirst({
      where: {
        id: payload.technical_profile_id,
        assessmentId: payload.assessment_id,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_PROFILE_STATUSES.accepted,
        ),
      },
      select: {
        id: true,
        assessmentId: true,
      },
    });
    if (!technicalProfile) {
      throw new NotFoundException(
        this.errorBody(command, SCAN_ERROR_CODES.technicalProfileNotFound),
      );
    }

    const existing = await this.prisma.aIUsageFlow.findUnique({
      where: { technicalProfileId: technicalProfile.id },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        this.errorBody(command, SCAN_ERROR_CODES.aiUsageFlowAlreadyExists),
      );
    }

    const aiUsageFlowId = crypto.randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.aIUsageFlow.create({
          data: {
            id: aiUsageFlowId,
            technicalProfileId: technicalProfile.id,
            assessmentId: technicalProfile.assessmentId,
            schemaVersion: payload.schema_version,
            providerVersion: payload.provider_version,
            // The public callback claim contract is intentionally compact, but the
            // Managed Agent callback also sends sanitized `flow_data.claims` containing the
            // deterministic claim field/value/lifecycle/numeric confidence. Join
            // those details by claim_id before persistence so reconciliation/legal
            // matching does not have to guess values from descriptions later.
            claims: enrichStoredClaims(
              payload,
            ) as unknown as Prisma.InputJsonValue,
            unknownUsages:
              payload.unknown_usages as unknown as Prisma.InputJsonValue,
            privacyFlags: payload.privacy_flags as Prisma.InputJsonValue,
            status: toPrismaEvidenceAcceptanceStatus(
              AI_USAGE_FLOW_STATUSES.accepted,
            ),
          },
        });

        const outboxEvent = buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.aiUsageFlow,
          aggregateId: aiUsageFlowId,
          eventType: SCAN_EVENT_TYPES.aiUsageFlowReady,
          assessmentId: technicalProfile.assessmentId,
          correlationId: command.correlationId,
          causationId: technicalProfile.id,
          actor: {
            id: AI_USAGE_FLOW_WORKER_ACTOR_ID,
            type: AUDIT_ACTOR_TYPES.service,
          },
          result: SCAN_EVENT_TYPES.aiUsageFlowAcceptedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${aiUsageFlowId}:${SCAN_EVENT_TYPES.aiUsageFlowReady}`,
          payload: {
            aiUsageFlowId,
            assessmentId: technicalProfile.assessmentId,
            technicalProfileId: technicalProfile.id,
            correlationId: command.correlationId,
          },
        });
        await tx.outboxMessage.create({
          data: {
            id: crypto.randomUUID(),
            aggregateType: toPrismaOutboxAggregateType(
              outboxEvent.aggregateType,
            ),
            aggregateId: outboxEvent.aggregateId,
            eventType: outboxEvent.eventType,
            payload: outboxEvent.payload as Prisma.InputJsonValue,
          },
        });

        const auditEvent = buildAuditEventInput({
          eventType: SCAN_EVENT_TYPES.aiUsageFlowAcceptedAudit,
          actorId: AI_USAGE_FLOW_WORKER_ACTOR_ID,
          assessmentId: technicalProfile.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.aiUsageFlow,
          resourceId: aiUsageFlowId,
          correlationId: command.correlationId,
          causationId: technicalProfile.id,
          decision: AUDIT_DECISIONS.allow,
          result: SCAN_EVENT_TYPES.aiUsageFlowAcceptedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: {
            id: AI_USAGE_FLOW_WORKER_ACTOR_ID,
            type: AUDIT_ACTOR_TYPES.service,
          },
          payload: {
            aiUsageFlowId,
            assessmentId: technicalProfile.assessmentId,
            technicalProfileId: technicalProfile.id,
            correlationId: command.correlationId,
          },
        });
        await tx.authAuditEvent.create({
          data: {
            id: crypto.randomUUID(),
            eventType: auditEvent.eventType,
            actorId: auditEvent.actorId,
            resourceType: auditEvent.resourceType
              ? toPrismaAuditResourceType(auditEvent.resourceType)
              : null,
            resourceId: auditEvent.resourceId ?? null,
            correlationId: auditEvent.correlationId,
            reasonCode: auditEvent.reasonCode ?? null,
            decision: auditEvent.decision
              ? toPrismaAuthDecision(auditEvent.decision)
              : null,
            payload: auditEvent.payload as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          this.errorBody(command, SCAN_ERROR_CODES.aiUsageFlowAlreadyExists),
        );
      }
      throw error;
    }

    return {
      accepted: true,
      ai_usage_flow_id: aiUsageFlowId,
      correlationId: command.correlationId,
    };
  }

  /**
   * Enforces callback schema, evidence-reference consistency, rich-claim parity, and privacy/sanitization requirements.
   *
   * @param command - AI usage-flow command whose payload should be validated.
   * @returns Nothing when the callback satisfies every acceptance invariant.
   * @throws When schema, material evidence, rich-claim consistency, or privacy checks fail.
   */
  private validate(command: AcceptAIUsageFlowCommand): void {
    const payload = command.payload;
    if (
      !isRecord(payload) ||
      !clean(payload.technical_profile_id) ||
      !clean(payload.assessment_id) ||
      !AI_USAGE_FLOW_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof AI_USAGE_FLOW_SCHEMA_VERSIONS)[number],
      ) ||
      !clean(payload.provider_version) ||
      !Array.isArray(payload.claims) ||
      !payload.claims.every(isClaim) ||
      !Array.isArray(payload.unknown_usages) ||
      !payload.unknown_usages.every(isRecord) ||
      !isRecord(payload.privacy_flags)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.aiUsageFlowSchemaInvalid),
      );
    }

    if (payload.claims.some(isMaterialClaimMissingEvidence)) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.claimMissingEvidenceRef),
      );
    }

    if (!hasConsistentRichClaims(payload)) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.aiUsageFlowSchemaInvalid),
      );
    }

    if (
      payload.privacy_flags.containsSourceCode !== false ||
      payload.privacy_flags.secretsRedacted !== true ||
      containsUnsafePayload(payload.claims) ||
      containsUnsafePayload(payload.unknown_usages) ||
      containsUnsafePayload(flowDataOf(payload))
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.privacyFlagsInvalid),
      );
    }
  }

  /**
   * Builds the standardized problem response used by callback validation and conflict errors.
   *
   * @param command - Command providing the request correlation identifier.
   * @param errorCode - Stable scan-domain error code to expose.
   * @returns Standard problem result for the callback failure.
   */
  private errorBody(command: AcceptAIUsageFlowCommand, errorCode: string) {
    return problemResult(errorCode, command.correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
}

/**
 * Verifies that optional rich claims correspond one-to-one with compact public claims and carry valid deterministic fields.
 *
 * @param payload - Callback payload whose `flow_data.claims` should be checked against compact claims.
 * @returns True when rich claims are absent or fully consistent with the compact claim set.
 */
function hasConsistentRichClaims(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (payload.flow_data === undefined) return true;
  if (
    !isRecord(payload.flow_data) ||
    !Array.isArray(payload.flow_data.claims)
  ) {
    return false;
  }
  if (!Array.isArray(payload.claims)) return false;

  const compactClaims = payload.claims.filter(isRecord);
  const richClaims = payload.flow_data.claims;
  if (compactClaims.length !== payload.claims.length) return false;
  if (richClaims.length !== compactClaims.length) return false;

  const compactById = new Map<string, Record<string, unknown>>();
  for (const compactClaim of compactClaims) {
    const claimId = clean(compactClaim.claim_id);
    if (!claimId || compactById.has(claimId)) return false;
    compactById.set(claimId, compactClaim);
  }

  const seen = new Set<string>();
  for (const value of richClaims) {
    if (!isRecord(value)) return false;
    const claimId = clean(value.claim_id);
    if (!claimId || seen.has(claimId)) return false;
    seen.add(claimId);

    const compactClaim = compactById.get(claimId);
    if (!compactClaim) return false;
    const numericConfidence = value.confidence;
    if (
      !clean(value.claim_field) ||
      !Object.prototype.hasOwnProperty.call(value, "claim_value") ||
      !clean(value.lifecycle_state) ||
      typeof numericConfidence !== "number" ||
      !Number.isFinite(numericConfidence) ||
      numericConfidence < 0 ||
      numericConfidence > 1 ||
      !sameEvidenceRefs(compactClaim.evidence_refs, value.evidence_refs)
    ) {
      return false;
    }
  }

  return seen.size === compactById.size;
}

/**
 * Compares two evidence-reference collections as normalized sets, independent of order and duplicates.
 *
 * @param left - First evidence-reference collection.
 * @param right - Second evidence-reference collection.
 * @returns True when both collections contain the same non-empty normalized references.
 */
function sameEvidenceRefs(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.some((ref) => !clean(ref)) || right.some((ref) => !clean(ref))) {
    return false;
  }
  const leftRefs = [...new Set(left.map((ref) => clean(ref) as string))].sort();
  const rightRefs = [
    ...new Set(right.map((ref) => clean(ref) as string)),
  ].sort();
  return (
    leftRefs.length === rightRefs.length &&
    leftRefs.every((ref, index) => ref === rightRefs[index])
  );
}

/**
 * Enriches compact callback claims with sanitized deterministic fields from matching rich worker claims before persistence.
 *
 * @param payload - Callback payload containing compact claims and optional `flow_data.claims` details.
 * @returns Persistable claim records enriched by matching `claim_id` when rich details are available.
 */
function enrichStoredClaims(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.claims)) return [];

  const flowData = flowDataOf(payload);
  const richClaims =
    flowData && Array.isArray(flowData.claims)
      ? flowData.claims.filter(isRecord)
      : [];
  const byClaimId = new Map<string, Record<string, unknown>>();
  for (const claim of richClaims) {
    const claimId = clean(claim.claim_id);
    if (claimId) byClaimId.set(claimId, claim);
  }

  return payload.claims.filter(isRecord).map((compactClaim) => {
    const claimId = clean(compactClaim.claim_id);
    const richClaim = claimId ? byClaimId.get(claimId) : undefined;
    if (!richClaim) return { ...compactClaim };

    return {
      ...compactClaim,
      claim_field: richClaim.claim_field,
      claim_value: richClaim.claim_value,
      lifecycle_state: richClaim.lifecycle_state,
      claim_confidence: richClaim.confidence,
      conflict_refs: richClaim.conflict_refs ?? null,
    };
  });
}

/**
 * Reads the structured `flow_data` object from a callback payload when present.
 *
 * @param value - Unknown callback value to inspect.
 * @returns The flow-data record, or null when absent or malformed.
 */
function flowDataOf(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value.flow_data) ? value.flow_data : null;
}

/**
 * Validates the compact public representation of one AI usage-flow claim.
 *
 * @param value - Unknown claim value to validate.
 * @returns True when the value satisfies the callback claim contract.
 */
function isClaim(value: unknown): value is AIUsageFlowClaimRequest {
  if (!isRecord(value)) return false;
  return (
    Boolean(clean(value.claim_id)) &&
    Boolean(clean(value.claim_type)) &&
    Boolean(clean(value.confidence)) &&
    Array.isArray(value.evidence_refs) &&
    value.evidence_refs.every((entry) => Boolean(clean(entry))) &&
    (typeof value.uncertainty_reason === "string" ||
      value.uncertainty_reason === null) &&
    Boolean(clean(value.description)) &&
    typeof value.is_material === "boolean"
  );
}

/**
 * Determines whether a material claim violates the requirement to reference at least one evidence item.
 *
 * @param claim - Validated compact AI usage-flow claim.
 * @returns True when the claim is material but has no evidence references.
 */
function isMaterialClaimMissingEvidence(
  claim: AIUsageFlowClaimRequest,
): boolean {
  return claim.is_material && claim.evidence_refs.length === 0;
}

/**
 * Checks whether an unknown runtime value is a non-array object record.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is a record-like object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalizes a non-empty string value without coercing other runtime types.
 *
 * @param value - Unknown value to normalize.
 * @returns Trimmed string value, or null when the input is not a non-empty string.
 */
function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Recursively detects forbidden source-code/raw-content keys or recognizable secret patterns in a callback payload.
 *
 * @param value - Arbitrary callback subtree to inspect.
 * @returns True when the subtree contains unsafe content that must not be persisted.
 */
function containsUnsafePayload(value: unknown): boolean {
  if (typeof value === "string") {
    return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafePayload);
  }
  if (!isRecord(value)) return false;

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    return (
      FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey) || containsUnsafePayload(entry)
    );
  });
}
