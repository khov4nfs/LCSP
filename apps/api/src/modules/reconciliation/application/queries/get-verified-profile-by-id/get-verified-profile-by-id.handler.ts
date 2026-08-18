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

type FactProjection = {
  mergedProfile: Record<string, unknown>;
  factEvidenceRefs: Record<string, string[]>;
  evidenceRefs: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter(
          (item): item is string =>
            typeof item === "string" && Boolean(item.trim()),
        )
        .map((item) => item.trim()),
    ),
  ].sort();
}

function explicitMergedProfile(profileData: unknown): Record<string, unknown> {
  const data = asRecord(profileData);
  if (!data) return {};
  return asRecord(data.merged_profile) ?? asRecord(data.mergedProfile) ?? {};
}

function explicitFactEvidenceRefs(
  profileData: unknown,
): Record<string, string[]> {
  const data = asRecord(profileData);
  if (!data) return {};
  const raw =
    asRecord(data.fact_evidence_refs) ?? asRecord(data.factEvidenceRefs);
  if (!raw) return {};

  const mapped: Record<string, string[]> = {};
  for (const [field, refs] of Object.entries(raw)) {
    const normalized = stringRefs(refs);
    if (normalized.length) mapped[field] = normalized;
  }
  return mapped;
}

function verifiedClaims(profileData: unknown): Record<string, unknown>[] {
  const data = asRecord(profileData);
  if (!data || !Array.isArray(data.verified_claims)) return [];
  return data.verified_claims.filter(
    (claim): claim is Record<string, unknown> => asRecord(claim) !== null,
  );
}

function wizardFactEntries(wizardAnswers: unknown): [string, unknown][] {
  if (Array.isArray(wizardAnswers)) {
    return wizardAnswers.flatMap((item) => {
      const answer = asRecord(item);
      const questionId = cleanString(answer?.questionId);
      if (!answer || !questionId || !("value" in answer)) return [];
      return [[questionId, answer.value] as [string, unknown]];
    });
  }

  const legacyAnswers = asRecord(wizardAnswers);
  return legacyAnswers ? Object.entries(legacyAnswers) : [];
}

function mergeRefs(
  target: Record<string, string[]>,
  field: string,
  refs: string[],
): void {
  if (!refs.length) return;
  target[field] = [...new Set([...(target[field] ?? []), ...refs])].sort();
}

function buildFactProjection(
  profileData: unknown,
  wizardAnswers: unknown,
  wizardProfileId: string | null,
): FactProjection {
  const mergedProfile: Record<string, unknown> = {};
  const factEvidenceRefs: Record<string, string[]> = {};

  for (const [field, value] of wizardFactEntries(wizardAnswers)) {
    mergedProfile[field] = value;
    if (wizardProfileId) {
      mergeRefs(factEvidenceRefs, field, [
        `wizard:${wizardProfileId}:${field}`,
      ]);
    }
  }

  for (const claim of verifiedClaims(profileData)) {
    const field = cleanString(claim.claim_field);
    if (!field || !("claim_value" in claim)) continue;

    const value = claim.claim_value;
    const refs = stringRefs(claim.evidence_refs);
    mergedProfile[field] = value;
    mergeRefs(factEvidenceRefs, field, refs);

    const nested = asRecord(value);
    if (!nested) continue;
    for (const [nestedField, nestedValue] of Object.entries(nested)) {
      mergedProfile[nestedField] = nestedValue;
      mergeRefs(factEvidenceRefs, nestedField, refs);
    }
  }

  Object.assign(mergedProfile, explicitMergedProfile(profileData));
  for (const [field, refs] of Object.entries(
    explicitFactEvidenceRefs(profileData),
  )) {
    mergeRefs(factEvidenceRefs, field, refs);
  }

  const data = asRecord(profileData);
  const explicitEvidenceRefs = stringRefs(
    data?.evidence_refs ?? data?.evidenceRefs,
  );
  const evidenceRefs = [
    ...new Set([
      ...explicitEvidenceRefs,
      ...Object.values(factEvidenceRefs).flat(),
    ]),
  ].sort();

  return { mergedProfile, factEvidenceRefs, evidenceRefs };
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

    const wizard = profile.wizardProfileId
      ? await this.prisma.wizardProfile.findUnique({
          where: { id: profile.wizardProfileId },
          select: { answers: true },
        })
      : null;
    const projection = buildFactProjection(
      profile.profileData,
      wizard?.answers,
      profile.wizardProfileId,
    );

    return {
      id: profile.id,
      aiUsageFlowId: profile.aiUsageFlowId,
      assessmentId: profile.assessmentId,
      organizationId: profile.organizationId,
      schemaVersion: profile.schemaVersion,
      providerVersion: profile.providerVersion,
      mergedProfile: projection.mergedProfile,
      factEvidenceRefs: projection.factEvidenceRefs,
      evidenceRefs: projection.evidenceRefs,
      status: profile.status,
      gatesPassedAt: toGatesPassedAt(profile.gatesPassedAt),
    };
  }
}
