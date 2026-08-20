import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetVerifiedProfileByIdHandler } from "./get-verified-profile-by-id.handler.js";
import { GetVerifiedProfileByIdQuery } from "./get-verified-profile-by-id.query.js";

function resolvedMock<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}

describe("GetVerifiedProfileByIdHandler", () => {
  it("rebuilds merged legal facts and field evidence refs from persisted wizard answers and legacy verified claims", async () => {
    const prisma = {
      verifiedProfile: {
        findUnique: resolvedMock({
          id: "verified-1",
          aiUsageFlowId: "flow-1",
          assessmentId: "assessment-1",
          organizationId: "org-1",
          wizardProfileId: "wizard-1",
          schemaVersion: "1.0.0",
          providerVersion: "provider-1",
          status: "APPROVED",
          gatesPassedAt: null,
          profileData: {
            verified_claims: [
              {
                claim_field: "model_invocation",
                claim_value: { invocationDetected: true },
                evidence_refs: ["evidence:model-call"],
              },
              {
                claim_field: "provider_usage",
                claim_value: {
                  providers: ["openai"],
                  frameworks: ["langchain"],
                },
                evidence_refs: ["evidence:provider"],
              },
            ],
            fact_evidence_refs: ["legacy:flat-ref"],
          },
        }),
      },
      wizardProfile: {
        findUnique: resolvedMock({
          answers: [
            {
              questionId: "businessProcess",
              value: "customer support",
              answerState: "ANSWERED",
              updatedAt: "2026-08-18T00:00:00.000Z",
            },
            {
              questionId: "humanReview",
              value: "PRESENT",
              answerState: "ANSWERED",
              updatedAt: "2026-08-18T00:00:00.000Z",
            },
          ],
        }),
      },
    } as unknown as PrismaService;

    const result = await new GetVerifiedProfileByIdHandler(prisma).execute(
      new GetVerifiedProfileByIdQuery("verified-1"),
    );

    expect(result.mergedProfile).toMatchObject({
      businessProcess: "customer support",
      humanReview: "PRESENT",
      model_invocation: { invocationDetected: true },
      invocationDetected: true,
      provider_usage: {
        providers: ["openai"],
        frameworks: ["langchain"],
      },
      providers: ["openai"],
      frameworks: ["langchain"],
    });
    expect(result.factEvidenceRefs).toMatchObject({
      businessProcess: ["wizard:wizard-1:businessProcess"],
      humanReview: ["wizard:wizard-1:humanReview"],
      model_invocation: ["evidence:model-call"],
      invocationDetected: ["evidence:model-call"],
      provider_usage: ["evidence:provider"],
      providers: ["evidence:provider"],
      frameworks: ["evidence:provider"],
    });
    expect(result.evidenceRefs).toContain("evidence:model-call");
    expect(result.evidenceRefs).toContain("wizard:wizard-1:businessProcess");
  });

  it("keeps compatibility with legacy object-shaped wizard answers", async () => {
    const prisma = {
      verifiedProfile: {
        findUnique: resolvedMock({
          id: "verified-legacy-wizard",
          aiUsageFlowId: "flow-legacy",
          assessmentId: "assessment-legacy",
          organizationId: "org-1",
          wizardProfileId: "wizard-legacy",
          schemaVersion: "1.0.0",
          providerVersion: "provider-1",
          status: "APPROVED",
          gatesPassedAt: null,
          profileData: { verified_claims: [] },
        }),
      },
      wizardProfile: {
        findUnique: resolvedMock({
          answers: {
            aiRole: "PROVIDER",
            jurisdiction: "EU",
          },
        }),
      },
    } as unknown as PrismaService;

    const result = await new GetVerifiedProfileByIdHandler(prisma).execute(
      new GetVerifiedProfileByIdQuery("verified-legacy-wizard"),
    );

    expect(result.mergedProfile).toMatchObject({
      aiRole: "PROVIDER",
      jurisdiction: "EU",
    });
    expect(result.factEvidenceRefs.aiRole).toEqual([
      "wizard:wizard-legacy:aiRole",
    ]);
  });

  it("lets explicit canonical legal facts override reconstructed legacy values", async () => {
    const prisma = {
      verifiedProfile: {
        findUnique: resolvedMock({
          id: "verified-2",
          aiUsageFlowId: "flow-2",
          assessmentId: "assessment-2",
          organizationId: "org-1",
          wizardProfileId: "wizard-2",
          schemaVersion: "1.0.0",
          providerVersion: "provider-1",
          status: "APPROVED",
          gatesPassedAt: null,
          profileData: {
            verified_claims: [
              {
                claim_field: "jurisdiction",
                claim_value: "US",
                evidence_refs: ["evidence:legacy"],
              },
            ],
            merged_profile: { jurisdiction: "EU" },
            fact_evidence_refs: {
              jurisdiction: ["evidence:canonical"],
            },
          },
        }),
      },
      wizardProfile: {
        findUnique: resolvedMock({ answers: [] }),
      },
    } as unknown as PrismaService;

    const result = await new GetVerifiedProfileByIdHandler(prisma).execute(
      new GetVerifiedProfileByIdQuery("verified-2"),
    );

    expect(result.mergedProfile.jurisdiction).toBe("EU");
    expect(result.factEvidenceRefs.jurisdiction).toEqual([
      "evidence:canonical",
      "evidence:legacy",
    ]);
  });
});
