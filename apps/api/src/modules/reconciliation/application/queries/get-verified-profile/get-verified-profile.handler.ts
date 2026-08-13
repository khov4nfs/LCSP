import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  GET_VERIFIED_PROFILE_TOOL,
  VERIFIED_PROFILE_REVIEW_STATES,
  type GetVerifiedProfileResponse,
  type VerifiedProfileLegalSafeFacts,
} from "@lcsp/contracts/evidence";
import {
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaVerifiedProfileStatus,
  toPrismaConflictRecordStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetVerifiedProfileQuery } from "./get-verified-profile.query.js";

const MAX_FACT_EVIDENCE_REFS = 100;
const SAFE_CATEGORY = /^[A-Z][A-Z0-9_.-]{0,63}$/;

@QueryHandler(GetVerifiedProfileQuery)
export class GetVerifiedProfileHandler implements IQueryHandler<
  GetVerifiedProfileQuery,
  GetVerifiedProfileResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetVerifiedProfileQuery,
  ): Promise<GetVerifiedProfileResponse> {
    const profile = await this.prisma.verifiedProfile.findFirst({
      where: {
        id: query.verifiedProfileId,
        assessmentId: query.assessmentId,
        organizationId: query.organizationId,
      },
      select: {
        id: true,
        version: true,
        aiUsageFlowId: true,
        status: true,
        profileData: true,
        approvedAt: true,
      },
    });
    if (!profile) this.notFound(query);

    if (String(profile.version) !== query.expectedVersion) {
      this.blocked(query, SCAN_ERROR_CODES.verifiedProfileWrongState);
    }
    if (
      fromPrismaVerifiedProfileStatus(profile.status) !==
      VERIFIED_PROFILE_STATUSES.approved
    ) {
      this.blocked(query, SCAN_ERROR_CODES.verifiedProfileWrongState);
    }

    const pendingConflicts = await this.prisma.conflictRecord.count({
      where: {
        aiUsageFlowId: profile.aiUsageFlowId,
        assessmentId: query.assessmentId,
        organizationId: query.organizationId,
        status: toPrismaConflictRecordStatus(CONFLICT_RECORD_STATUSES.pending),
      },
    });
    if (pendingConflicts > 0) {
      this.blocked(query, SCAN_ERROR_CODES.pendingConflictsExist);
    }

    const facts = toLegalSafeFacts(profile.profileData);
    const factEvidenceRefs = toFactEvidenceRefs(profile.profileData);
    const response: GetVerifiedProfileResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.getVerifiedProfile,
      tool_version: GET_VERIFIED_PROFILE_TOOL.version,
      config_hash: GET_VERIFIED_PROFILE_TOOL.configHash,
      correlationId: query.correlationId,
      artifact_versions: {
        verified_profile_id: profile.id,
        version: String(profile.version),
      },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: factEvidenceRefs,
      limitations: [],
      result: {
        profile_ref: `verified:${profile.id}`,
        version: String(profile.version),
        status: VERIFIED_PROFILE_STATUSES.approved,
        legal_safe_facts: facts,
        fact_evidence_refs: factEvidenceRefs,
        gates_passed_at: profile.approvedAt?.toISOString() ?? null,
        blocking_reason: null,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.verifiedProfileRead,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
      resourceId: profile.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        verifiedProfileRef: response.result.profile_ref,
        expectedVersion: query.expectedVersion,
        requiredFor: query.requiredFor,
      },
    });
    return response;
  }

  private notFound(query: GetVerifiedProfileQuery): never {
    throw problemException(
      SCAN_ERROR_CODES.verifiedProfileNotFound,
      query.correlationId,
      { status: HttpStatus.NOT_FOUND },
    );
  }

  private blocked(query: GetVerifiedProfileQuery, code: string): never {
    throw problemException(code, query.correlationId, {
      status: HttpStatus.CONFLICT,
    });
  }
}

function toLegalSafeFacts(value: unknown): VerifiedProfileLegalSafeFacts {
  const claims = verifiedClaims(value);
  const aiUsageTypes = categories(claims);
  const providers = valuesForKeys(claims, ["providers", "provider"]);
  const deploymentCategories = valuesForKeys(claims, [
    "deploymentCategories",
    "deployment_categories",
  ]);
  const reviewState = aiUsageTypes.some((type) => type.includes("HUMAN"))
    ? VERIFIED_PROFILE_REVIEW_STATES.present
    : VERIFIED_PROFILE_REVIEW_STATES.unknown;
  return { aiUsageTypes, providers, reviewState, deploymentCategories };
}

function verifiedClaims(value: unknown): Record<string, unknown>[] {
  const root = record(value);
  const claims = root?.verified_claims ?? root?.verifiedClaims;
  return Array.isArray(claims)
    ? claims.flatMap((claim) => {
        const parsed = record(claim);
        return parsed ? [parsed] : [];
      })
    : [];
}

function categories(claims: Record<string, unknown>[]): string[] {
  return uniqueSafe(
    claims.flatMap((claim) => {
      const raw =
        claim.claim_category ?? claim.claim_type ?? claim.claimCategory;
      return typeof raw === "string" ? [raw] : [];
    }),
  );
}

function valuesForKeys(
  claims: Record<string, unknown>[],
  keys: string[],
): string[] {
  return uniqueSafe(
    claims.flatMap((claim) => {
      const claimValue = record(claim.claim_value ?? claim.claimValue);
      if (!claimValue) return [];
      return keys.flatMap((key) => strings(claimValue[key]));
    }),
  );
}

function toFactEvidenceRefs(value: unknown): string[] {
  const root = record(value);
  const direct = root?.fact_evidence_refs ?? root?.factEvidenceRefs;
  const groupedRefs = record(direct);
  const refs = Array.isArray(direct)
    ? strings(direct)
    : groupedRefs
      ? Object.values(groupedRefs).flatMap(strings)
      : [];
  return uniqueSafeRefs(refs).slice(0, MAX_FACT_EVIDENCE_REFS);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
}

function uniqueSafe(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim().toUpperCase()))]
    .filter((item) => SAFE_CATEGORY.test(item))
    .sort();
}

function uniqueSafeRefs(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()))]
    .filter((item) => item.length > 0 && item.length <= 200)
    .sort();
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
