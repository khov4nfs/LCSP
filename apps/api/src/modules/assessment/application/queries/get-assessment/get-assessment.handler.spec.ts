import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_LOCK_REASONS,
  ASSESSMENT_MISSING_EVIDENCE_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { CLASSIFICATION_GUARDRAIL_STATUSES } from "@lcsp/contracts/scan";
import { NotFoundException } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { GetAssessmentHandler } from "./get-assessment.handler.js";
import { GetAssessmentQuery } from "./get-assessment.query.js";

function resolvedMock<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}

function makeAssessment(
  overrides: Partial<{
    ownerId: string;
    name: string;
  }> = {},
) {
  return Assessment.create({
    ownerId: overrides.ownerId ?? "user-1",
    name: overrides.name ?? "Test Assessment",
  });
}

type LegalChunkFixture = {
  id: string;
  documentId: string;
  locator: string;
  content: string;
  hierarchy: Record<string, unknown>;
};

function buildHandler(input: {
  assessment: Assessment | null;
  wizardProfile?: { status: string } | null;
  acceptedEvidenceReport?: { id: string; evidencePayload?: unknown } | null;
  classificationResult?: {
    guardrailStatus: string;
    classificationData: unknown;
  } | null;
  legalChunks?: LegalChunkFixture[];
}) {
  const repository: AssessmentRepository = {
    findById: jest
      .fn<AssessmentRepository["findById"]>()
      .mockResolvedValue(input.assessment),
    save: jest.fn<AssessmentRepository["save"]>().mockResolvedValue(undefined),
    saveInTx: jest
      .fn<AssessmentRepository["saveInTx"]>()
      .mockResolvedValue(undefined),
    findMany: jest
      .fn<AssessmentRepository["findMany"]>()
      .mockResolvedValue({ items: [], total: 0 }),
  };
  const prisma = {
    wizardProfile: {
      findUnique: resolvedMock(input.wizardProfile ?? null),
    },
    technicalEvidenceReport: {
      findFirst: resolvedMock(input.acceptedEvidenceReport ?? null),
    },
    classificationResult: {
      findFirst: resolvedMock(input.classificationResult ?? null),
    },
    legalDocumentChunk: {
      findMany: resolvedMock(input.legalChunks ?? []),
    },
  } as unknown as PrismaService;
  return new GetAssessmentHandler(repository, prisma);
}

function query(
  assessmentId: string,
  role: GetAssessmentQuery["subjectRole"] = AUTH_USER_ROLES.customer,
  userId = "user-1",
) {
  return new GetAssessmentQuery(assessmentId, userId, role, "corr-1");
}

describe("GetAssessmentHandler direct EngineeringRule runtime", () => {
  it("locks assessment only while accepted repository evidence is absent", async () => {
    const assessment = makeAssessment();
    const handler = buildHandler({ assessment });

    const result = await handler.execute(query(assessment.id));

    expect(result.wizard_status).toBe(WIZARD_STATUS_CODES.notStarted);
    expect(result.readiness_state).toEqual({
      classification_locked: true,
      lock_reason: ASSESSMENT_LOCK_REASONS.evidenceRequired,
      missing_evidence: [
        ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
      ],
    });
    expect(result.verified_profile_review).toBeNull();
    expect(result.legal_rule_match_guardrail_status).toBeNull();
    expect(result.legal_rule_match_diagnostics).toBeNull();
    expect(result.can_rerun_classification).toBe(false);
  });

  it("unlocks immediately after accepted TechnicalEvidenceReport and waits for direct worker", async () => {
    const assessment = makeAssessment();
    const handler = buildHandler({
      assessment,
      wizardProfile: { status: WIZARD_STATUS_CODES.submitted },
      acceptedEvidenceReport: { id: "ter-1" },
    });

    const result = await handler.execute(query(assessment.id));

    expect(result.readiness_state).toEqual({
      classification_locked: false,
      lock_reason: null,
      missing_evidence: [],
    });
    expect(result.classification_result).toBeNull();
    expect(result.guardrail_status).toBeNull();
  });

  it("projects EngineeringRule evaluations with readable graph and legal evidence", async () => {
    const assessment = makeAssessment();
    const handler = buildHandler({
      assessment,
      acceptedEvidenceReport: {
        id: "ter-1",
        evidencePayload: {
          evidence_graph: {
            nodes: [
              {
                node_id: "node:review",
                node_type: "HUMAN_REVIEW",
                label: "Manual approval",
                source: {
                  file_path: "owner-repo-abcdef1/src/review.ts",
                  symbol_ref: "approveRequest",
                  start_line: 42,
                  end_line: 48,
                },
                evidence_refs: ["evidence:review"],
              },
            ],
            edges: [],
            source_anchors: [
              {
                anchor_id: "source-anchor:review",
                graph_node_id: "node:review",
                file_path: "owner-repo-abcdef1/src/review.ts",
                symbol_ref: "approveRequest",
                start_line: 42,
                end_line: 48,
              },
            ],
          },
        },
      },
      legalChunks: [
        {
          id: "LAW-134-2025-QH15:art-10",
          documentId: "LAW-134-2025-QH15",
          locator: "art-10",
          content:
            "Điều 10. Hồ sơ phân loại\n1. Nội dung khoản một.\n3. Nội dung khoản ba.",
          hierarchy: { articleNumber: "10" },
        },
        {
          id: "LAW-134-2025-QH15:art-10::cl-1",
          documentId: "LAW-134-2025-QH15",
          locator: "art-10::cl-1",
          content: "1. Nội dung khoản một.",
          hierarchy: { articleNumber: "10", clauseNumber: "1" },
        },
        {
          id: "LAW-134-2025-QH15:art-10::cl-3",
          documentId: "LAW-134-2025-QH15",
          locator: "art-10::cl-3",
          content: "3. Nội dung khoản ba.",
          hierarchy: { articleNumber: "10", clauseNumber: "3" },
        },
      ],
      classificationResult: {
        guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
        classificationData: {
          mode: "ENGINEERING_RULE_EVALUATION",
          status: "COMPLETE",
          summary: { compliant: 1, non_compliant: 1, unknown: 0, total: 2 },
          legal_rule_catalog_version_id: "catalog-1",
          legal_corpus_version_id: "corpus-1",
          technical_evidence_report_id: "ter-1",
          snapshot_id: "snapshot-1",
          limitations: [],
          observability: {
            openwiki: {
              available: false,
              error: "OPENWIKI_RUNTIME_COMMAND_UNAVAILABLE",
              fallback: "OPENWIKI_REQUIRED_FALLBACK_ALL",
            },
            engineering_rule_preparation: {
              legal_rules_seen: 176,
              candidate_count: 265,
              compile_failed_count: 2,
              compile_failed_legal_rule_ids: ["legal-a", "legal-b"],
            },
            candidate_source_hit_distribution: {
              candidate_count: 265,
              source_hit_count_buckets: { "0": 11, "2_5": 200 },
            },
            provenance: {
              claim_count: 265,
              claims_with_evidence: 252,
            },
          },
          evaluations: [
            {
              engineering_rule_id: "eng-1",
              legal_rule_id: "legal-1",
              concept: "HUMAN_REVIEW",
              status: "NON_COMPLIANT",
              reason: "Requirement not met from repository evidence.",
              evidence_refs: [
                "evidence:review",
                "node:review",
                "source-anchor:review",
              ],
              source_chunk_ids: [
                "LAW-134-2025-QH15:art-10",
                "LAW-134-2025-QH15:art-10::cl-1",
                "LAW-134-2025-QH15:art-10::cl-3",
              ],
              source_locators: ["art-10", "art-10::cl-1", "art-10::cl-3"],
              confidence: 0.95,
              limitations: [],
            },
          ],
        },
      },
    });

    const result = await handler.execute(query(assessment.id));

    expect(result.guardrail_status).toBe(
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    expect(result.classification_result).toMatchObject({
      mode: "ENGINEERING_RULE_EVALUATION",
      status: "COMPLETE",
      engineering_summary: {
        compliant: 1,
        non_compliant: 1,
        unknown: 0,
        total: 2,
      },
      technical_evidence_report_id: "ter-1",
      snapshot_id: "snapshot-1",
      observability: {
        openwiki: {
          available: false,
          error: "OPENWIKI_RUNTIME_COMMAND_UNAVAILABLE",
          fallback: "OPENWIKI_REQUIRED_FALLBACK_ALL",
        },
        engineering_rule_preparation: {
          legal_rules_seen: 176,
          candidate_count: 265,
          compile_failed_count: 2,
          compile_failed_legal_rule_ids: ["legal-a", "legal-b"],
        },
        candidate_source_hit_distribution: {
          candidate_count: 265,
          source_hit_count_buckets: { "0": 11, "2_5": 200 },
        },
        provenance: {
          claim_count: 265,
          claims_with_evidence: 252,
        },
      },
    });
    expect(result.classification_result?.evaluations[0]).toMatchObject({
      engineering_rule_id: "eng-1",
      legal_rule_id: "legal-1",
      status: "NON_COMPLIANT",
      technical_evidence: [
        {
          kind: "HUMAN_REVIEW",
          label: "Manual approval",
          file_path: "src/review.ts",
          symbol_ref: "approveRequest",
          start_line: 42,
          end_line: 48,
        },
      ],
      legal_provisions: [
        {
          document_id: "LAW-134-2025-QH15",
          locator: "art-10::cl-1",
          article_number: "10",
          clause_number: "1",
          point_code: null,
          content: "1. Nội dung khoản một.",
        },
        {
          document_id: "LAW-134-2025-QH15",
          locator: "art-10::cl-3",
          article_number: "10",
          clause_number: "3",
          point_code: null,
          content: "3. Nội dung khoản ba.",
        },
      ],
    });
  });

  it("does not require legal readiness/profile artifacts", async () => {
    const assessment = makeAssessment();
    const handler = buildHandler({
      assessment,
      acceptedEvidenceReport: { id: "ter-1" },
    });

    const result = await handler.execute(query(assessment.id));
    expect(result.readiness_state.classification_locked).toBe(false);
    expect(result.readiness_state.missing_evidence).toEqual([]);
  });

  it("hides non-owned customer assessments", async () => {
    const nonOwned = makeAssessment({ ownerId: "user-2" });
    await expect(
      buildHandler({ assessment: nonOwned }).execute(query(nonOwned.id)),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects non-customer assessment reads after RBAC", async () => {
    const assessment = makeAssessment({ ownerId: "user-2" });
    const handler = buildHandler({ assessment });

    await expect(
      handler.execute(
        query(assessment.id, AUTH_USER_ROLES.admin, "system-admin-1"),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
