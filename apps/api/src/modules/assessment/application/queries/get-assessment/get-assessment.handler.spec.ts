import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_LOCK_REASONS,
  ASSESSMENT_MISSING_EVIDENCE_CODES,
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import { NotFoundException } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { GetAssessmentHandler } from "./get-assessment.handler.js";
import { GetAssessmentQuery } from "./get-assessment.query.js";

function makeAssessment(
  overrides: Partial<{
    organizationId: string;
    ownerId: string;
    name: string;
  }> = {},
) {
  return Assessment.create({
    organizationId: overrides.organizationId ?? "org-1",
    ownerId: overrides.ownerId ?? "user-1",
    name: overrides.name ?? "Test Assessment",
  });
}

type VerifiedProfileReviewFixture = {
  id: string;
  status: string;
  providerVersion: string;
  profileData: unknown;
  gatesPassedAt: unknown;
  createdAt: Date;
  approvedAt: Date | null;
  approvedById: string | null;
};

function buildHandler(input: {
  assessment: Assessment | null;
  wizardProfile?: { status: string } | null;
  acceptedEvidenceReport?: { id: string } | null;
  classificationResult?: {
    guardrailStatus: string;
    classificationData?: unknown;
  } | null;
  verifiedProfileReview?: VerifiedProfileReviewFixture | null;
  rerunnableLegalRuleMatch?: { id: string } | null;
  legalCorpusVersion?: { id: string } | null;
  legalRetrievalIndex?: { id: string } | null;
  legalRuleCatalogVersion?: { id: string } | null;
}) {
  const findById = jest
    .fn<AssessmentRepository["findById"]>()
    .mockResolvedValue(input.assessment);
  const save = jest
    .fn<AssessmentRepository["save"]>()
    .mockResolvedValue(undefined);
  const saveInTx = jest
    .fn<AssessmentRepository["saveInTx"]>()
    .mockResolvedValue(undefined);
  const findMany = jest
    .fn<AssessmentRepository["findMany"]>()
    .mockResolvedValue({ items: [], total: 0 });
  const repository: AssessmentRepository = {
    save,
    saveInTx,
    findById,
    findMany,
  };

  const findUnique = jest
    .fn<() => Promise<{ status: string } | null>>()
    .mockResolvedValue(input.wizardProfile ?? null);
  const findAcceptedEvidence = jest
    .fn<() => Promise<{ id: string } | null>>()
    .mockResolvedValue(input.acceptedEvidenceReport ?? null);
  const findClassificationResult = jest
    .fn<
      () => Promise<{
        guardrailStatus: string;
        classificationData?: unknown;
      } | null>
    >()
    .mockResolvedValue(input.classificationResult ?? null);
  const findVerifiedProfileReview = jest
    .fn<() => Promise<VerifiedProfileReviewFixture | null>>()
    .mockResolvedValue(input.verifiedProfileReview ?? null);
  const findRerunnableLegalRuleMatch = jest
    .fn<() => Promise<{ id: string } | null>>()
    .mockResolvedValue(input.rerunnableLegalRuleMatch ?? null);
  const findLegalCorpusVersion = jest
    .fn<() => Promise<{ id: string } | null>>()
    .mockResolvedValue(input.legalCorpusVersion ?? null);
  const findLegalRetrievalIndex = jest
    .fn<() => Promise<{ id: string } | null>>()
    .mockResolvedValue(input.legalRetrievalIndex ?? null);
  const findLegalRuleCatalogVersion = jest
    .fn<() => Promise<{ id: string } | null>>()
    .mockResolvedValue(input.legalRuleCatalogVersion ?? null);
  const prisma = {
    wizardProfile: { findUnique },
    technicalEvidenceReport: { findFirst: findAcceptedEvidence },
    classificationResult: { findFirst: findClassificationResult },
    verifiedProfile: { findFirst: findVerifiedProfileReview },
    legalRuleMatch: { findFirst: findRerunnableLegalRuleMatch },
    legalCorpusVersion: { findFirst: findLegalCorpusVersion },
    legalRetrievalIndex: { findFirst: findLegalRetrievalIndex },
    legalRuleCatalogVersion: { findFirst: findLegalRuleCatalogVersion },
  } as unknown as PrismaService;

  const handler = new GetAssessmentHandler(repository, prisma);
  return {
    handler,
    findById,
    findUnique,
    findAcceptedEvidence,
    findClassificationResult,
    findVerifiedProfileReview,
    findRerunnableLegalRuleMatch,
    findLegalCorpusVersion,
    findLegalRetrievalIndex,
    findLegalRuleCatalogVersion,
  };
}

describe("GetAssessmentHandler", () => {
  // T01
  it("returns full assessment state for the owning Manager", async () => {
    const assessment = makeAssessment({
      organizationId: "org-1",
      ownerId: "user-1",
    });
    const { handler } = buildHandler({ assessment, wizardProfile: null });

    const result = await handler.execute(
      new GetAssessmentQuery(
        "assessment-1",
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(result.assessment_id).toBe(assessment.id);
    expect(result.name).toBe("Test Assessment");
    expect(result.status).toBe(ASSESSMENT_STATUS_CODES.wizardInProgress);
    expect(result.owner_id).toBe("user-1");
    expect(result.organization_id).toBe("org-1");
    expect(result.correlationId).toBe("corr-1");
  });

  // T02: no WizardProfile row -> NOT_STARTED
  it("reports wizard_status NOT_STARTED when no WizardProfile exists", async () => {
    const assessment = makeAssessment();
    const { handler } = buildHandler({ assessment, wizardProfile: null });

    const result = await handler.execute(
      new GetAssessmentQuery(
        "assessment-1",
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(result.wizard_status).toBe(WIZARD_STATUS_CODES.notStarted);
  });

  it("reports wizard_status from the WizardProfile row when it exists", async () => {
    const assessment = makeAssessment();
    const { handler } = buildHandler({
      assessment,
      wizardProfile: { status: WIZARD_STATUS_CODES.inProgress },
    });

    const result = await handler.execute(
      new GetAssessmentQuery(
        "assessment-1",
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(result.wizard_status).toBe(WIZARD_STATUS_CODES.inProgress);
  });

  // T03: no accepted TechnicalEvidenceReport keeps classification locked.
  it("reports classification_locked=true with LOCKED_EVIDENCE_REQUIRED when evidence is absent", async () => {
    const assessment = makeAssessment();
    const { handler } = buildHandler({ assessment, wizardProfile: null });

    const result = await handler.execute(
      new GetAssessmentQuery(
        "assessment-1",
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(result.readiness_state.classification_locked).toBe(true);
    expect(result.readiness_state.lock_reason).toBe(
      ASSESSMENT_LOCK_REASONS.evidenceRequired,
    );
    expect(result.readiness_state.missing_evidence.length).toBeGreaterThan(0);
  });

  it("unlocks classification when accepted technical evidence exists", async () => {
    const assessment = makeAssessment();
    const { handler, findAcceptedEvidence } = buildHandler({
      assessment,
      acceptedEvidenceReport: { id: "evidence-1" },
    });

    const result = await handler.execute(
      new GetAssessmentQuery(
        "assessment-1",
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(findAcceptedEvidence).toHaveBeenCalledTimes(1);
    expect(result.readiness_state).toEqual({
      classification_locked: false,
      lock_reason: null,
      missing_evidence: [],
    });
  });

  it("projects the accepted classification result guardrail status and details", async () => {
    const assessment = makeAssessment();
    const { handler, findClassificationResult } = buildHandler({
      assessment,
      acceptedEvidenceReport: { id: "evidence-1" },
      classificationResult: {
        guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
        classificationData: {
          risk_level: "HIGH",
          applicability_assessment: "applicable",
          citation_basis: ["chunk-1"],
          rationale: "Evidence-backed rationale",
        },
      },
    });

    const result = await handler.execute(
      new GetAssessmentQuery(
        "assessment-1",
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(findClassificationResult).toHaveBeenCalledTimes(1);
    expect(result.guardrail_status).toBe(
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    expect(result.classification_result).toEqual({
      risk_level: "HIGH",
      applicability_assessment: "applicable",
      citation_basis: ["chunk-1"],
      rationale: "Evidence-backed rationale",
    });
  });

  it("projects pending VerifiedProfile review only for the owning Manager", async () => {
    const assessment = makeAssessment();
    const profile: VerifiedProfileReviewFixture = {
      id: "vp-1",
      status: VERIFIED_PROFILE_STATUSES.pendingApproval,
      providerVersion: "lcsp.verified-profile-worker.v1",
      profileData: {
        verified_claims: [
          {
            claim_id: "claim-1",
            claim_category: "MODEL_INVOCATION",
            evidence_refs: ["evidence-1"],
          },
        ],
        verification_source: "TECHNICAL_PLUS_WIZARD",
        conflict_resolutions: [
          { conflict_id: "conflict-1", status: "RESOLVED" },
        ],
        evidence_chain_integrity: true,
      },
      gatesPassedAt: { conflicts_resolved: "2026-08-11T00:00:00.000Z" },
      createdAt: new Date("2026-08-11T00:01:00.000Z"),
      approvedAt: null,
      approvedById: null,
    };
    const { handler, findVerifiedProfileReview } = buildHandler({
      assessment,
      verifiedProfileReview: profile,
    });

    const result = await handler.execute(
      new GetAssessmentQuery(
        assessment.id,
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(findVerifiedProfileReview).toHaveBeenCalledTimes(1);
    expect(result.verified_profile_review).toMatchObject({
      verified_profile_id: "vp-1",
      status: VERIFIED_PROFILE_STATUSES.pendingApproval,
      verification_source: "TECHNICAL_PLUS_WIZARD",
      evidence_chain_integrity: true,
      approved_at: null,
      approved_by_id: null,
    });
  });

  it("only exposes classification retry after a passed legal rule match exists", async () => {
    const assessment = makeAssessment();
    const { handler, findRerunnableLegalRuleMatch } = buildHandler({
      assessment,
      acceptedEvidenceReport: { id: "evidence-1" },
      rerunnableLegalRuleMatch: { id: "match-1" },
    });

    const result = await handler.execute(
      new GetAssessmentQuery(
        assessment.id,
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(findRerunnableLegalRuleMatch).toHaveBeenCalledTimes(1);
    expect(result.can_rerun_classification).toBe(true);
  });

  it("locks classification when an approved profile is waiting for legal readiness", async () => {
    const assessment = makeAssessment();
    const profile: VerifiedProfileReviewFixture = {
      id: "vp-approved",
      status: VERIFIED_PROFILE_STATUSES.approved,
      providerVersion: "lcsp.verified-profile-worker.v1",
      profileData: {},
      gatesPassedAt: {},
      createdAt: new Date("2026-08-11T00:01:00.000Z"),
      approvedAt: new Date("2026-08-11T00:02:00.000Z"),
      approvedById: "user-1",
    };
    const { handler, findLegalCorpusVersion } = buildHandler({
      assessment,
      acceptedEvidenceReport: { id: "evidence-1" },
      verifiedProfileReview: profile,
      legalCorpusVersion: null,
    });

    const result = await handler.execute(
      new GetAssessmentQuery(
        assessment.id,
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    expect(findLegalCorpusVersion).toHaveBeenCalledTimes(1);
    expect(result.readiness_state).toEqual({
      classification_locked: true,
      lock_reason: ASSESSMENT_LOCK_REASONS.legalReadinessRequired,
      missing_evidence: [ASSESSMENT_MISSING_EVIDENCE_CODES.legalCorpusVersion],
    });
  });

  // T04
  it("throws ASSESSMENT_NOT_FOUND when the assessment does not exist", async () => {
    const { handler } = buildHandler({ assessment: null });

    await expect(
      handler.execute(
        new GetAssessmentQuery(
          "missing",
          "org-1",
          "user-1",
          SUBJECT_ROLES.manager,
          "corr-1",
        ),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws ASSESSMENT_NOT_FOUND when the assessment belongs to a different organization", async () => {
    const assessment = makeAssessment({ organizationId: "org-2" });
    const { handler } = buildHandler({ assessment });

    await expect(
      handler.execute(
        new GetAssessmentQuery(
          assessment.id,
          "org-1",
          "user-1",
          SUBJECT_ROLES.manager,
          "corr-1",
        ),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws ASSESSMENT_NOT_FOUND when a Manager requests an assessment owned by someone else in the same org", async () => {
    const assessment = makeAssessment({
      organizationId: "org-1",
      ownerId: "user-2",
    });
    const { handler } = buildHandler({ assessment });

    await expect(
      handler.execute(
        new GetAssessmentQuery(
          assessment.id,
          "org-1",
          "user-1",
          SUBJECT_ROLES.manager,
          "corr-1",
        ),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // T07: Developer scope is not restricted by ownerId (PBAC action grant already gates access)
  it("allows a Developer to read an assessment but never exposes Manager profile review", async () => {
    const assessment = makeAssessment({
      organizationId: "org-1",
      ownerId: "user-2",
    });
    const { handler, findVerifiedProfileReview } = buildHandler({
      assessment,
      verifiedProfileReview: {
        id: "vp-sensitive",
        status: VERIFIED_PROFILE_STATUSES.pendingApproval,
        providerVersion: "worker-v1",
        profileData: { verified_claims: [{ claim_id: "sensitive" }] },
        gatesPassedAt: {},
        createdAt: new Date(),
        approvedAt: null,
        approvedById: null,
      },
    });

    const result = await handler.execute(
      new GetAssessmentQuery(
        assessment.id,
        "org-1",
        "user-3",
        SUBJECT_ROLES.developer,
        "corr-1",
      ),
    );

    expect(result.assessment_id).toBe(assessment.id);
    expect(result.verified_profile_review).toBeNull();
    expect(findVerifiedProfileReview).not.toHaveBeenCalled();
  });

  // T06 / T08
  it("never includes risk/severity/non-compliant wording before classification, and next_action is business language", async () => {
    const assessment = makeAssessment();
    const { handler } = buildHandler({ assessment, wizardProfile: null });

    const result = await handler.execute(
      new GetAssessmentQuery(
        assessment.id,
        "org-1",
        "user-1",
        SUBJECT_ROLES.manager,
        "corr-1",
      ),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/\bHIGH\b|\bMEDIUM\b|\bLOW\b/);
    expect(serialized.toLowerCase()).not.toMatch(
      /\brisk\b|\bseverity\b|\bviolation\b|non-compliant/,
    );
    expect(result.next_action.length).toBeGreaterThan(0);
  });

  it("varies next_action by wizard_status", async () => {
    const assessment = makeAssessment();
    const { handler: notStarted } = buildHandler({
      assessment,
      wizardProfile: null,
    });
    const { handler: inProgress } = buildHandler({
      assessment,
      wizardProfile: { status: WIZARD_STATUS_CODES.inProgress },
    });
    const { handler: submitted } = buildHandler({
      assessment,
      wizardProfile: { status: WIZARD_STATUS_CODES.submitted },
    });

    const query = new GetAssessmentQuery(
      assessment.id,
      "org-1",
      "user-1",
      SUBJECT_ROLES.manager,
      "corr-1",
    );
    const a = await notStarted.execute(query);
    const b = await inProgress.execute(query);
    const c = await submitted.execute(query);

    expect(new Set([a.next_action, b.next_action, c.next_action]).size).toBe(3);
  });
});
