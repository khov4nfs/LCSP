import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetVerifiedProfileByIdQuery } from "./get-verified-profile-by-id.query.js";

type VerifiedProfileResponse = {
  id: string;
  aiUsageFlowId: string | null;
  assessmentId: string | null;
  organizationId: string | null;
  schemaVersion: string | null;
  providerVersion: string | null;
  mergedProfile: Record<string, unknown>;
  factEvidenceRefs: Record<string, string[]>;
  evidenceRefs: string[];
  status: string | null;
  gatesPassedAt: Date | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toMergedProfile(profileData: unknown): Record<string, unknown> {
  const data = asRecord(profileData);
  if (!data) return {};
  return asRecord(data.merged_profile) ?? asRecord(data.mergedProfile) ?? {};
}

function toFactEvidenceRefs(profileData: unknown): Record<string, string[]> {
  const data = asRecord(profileData);
  if (!data) return {};
  const raw =
    asRecord(data.fact_evidence_refs) ?? asRecord(data.factEvidenceRefs);
  if (!raw) return {};

  const mapped: Record<string, string[]> = {};
  for (const [field, refs] of Object.entries(raw)) {
    if (!Array.isArray(refs)) continue;
    mapped[field] = [
      ...new Set(
        refs
          .filter(
            (ref): ref is string =>
              typeof ref === "string" && Boolean(ref.trim()),
          )
          .map((ref) => ref.trim()),
      ),
    ].sort();
  }
  return mapped;
}

function toEvidenceRefs(profileData: unknown): string[] {
  const data = asRecord(profileData);
  if (!data) return [];
  const raw = data.evidence_refs ?? data.evidenceRefs;
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter(
          (ref): ref is string =>
            typeof ref === "string" && Boolean(ref.trim()),
        )
        .map((ref) => ref.trim()),
    ),
  ].sort();
}

function toGatesPassedAt(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

@QueryHandler(GetVerifiedProfileByIdQuery)
export class GetVerifiedProfileByIdHandler implements IQueryHandler<GetVerifiedProfileByIdQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetVerifiedProfileByIdQuery,
  ): Promise<VerifiedProfileResponse> {
    const profile = await this.prisma.verifiedProfile.findUnique({
      where: { id: query.verifiedProfileId },
    });

    if (!profile) {
      throw new Error("Verified profile not found");
    }

    return {
      id: profile.id,
      aiUsageFlowId: profile.aiUsageFlowId,
      assessmentId: profile.assessmentId,
      organizationId: profile.organizationId,
      schemaVersion: profile.schemaVersion,
      providerVersion: profile.providerVersion,
      mergedProfile: toMergedProfile(profile.profileData),
      factEvidenceRefs: toFactEvidenceRefs(profile.profileData),
      evidenceRefs: toEvidenceRefs(profile.profileData),
      status: profile.status,
      gatesPassedAt: toGatesPassedAt(profile.gatesPassedAt),
    };
  }
}
