import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AssessmentFinalReportArtifact } from "@lcsp/contracts/assessment-domain";
import { AssessmentReportLoader } from "./assessment-report.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { ArtifactStorageService } from "../../../../platform/storage/artifact-storage.service.js";
import { canonicalJson, sha256Hex } from "../../domain/domain-ids.js";

describe("AssessmentReportLoader locale read projection", () => {
  const assessmentId = "11111111-1111-4111-8111-111111111111";
  const artifactId = "22222222-2222-4222-8222-222222222222";
  const userId = "user-test-owner";

  const decisionPart = {
    decisionId: "33333333-3333-4333-8333-333333333333",
    decisionRevision: 1,
    decision: {
      assessmentRuleId: "RULE-1",
      assessmentRuleVersion: "v1",
      scopeId: "SCOPE-1",
      ruleSetVersionId: "44444444-4444-4444-8444-444444444444",
      repositorySnapshotId: "55555555-5555-4555-8555-555555555555",
      repositoryCommit: "a".repeat(40),
      caseRevision: 1,
      legalContextRefs: [{ legalContextId: "LC-1" }],
      applicability: "APPLICABLE",
      rationale: "Rationale",
      compliance: "COMPLIANT",
      references: [
        {
          type: "CONFIRMED_FACT",
          factId: "66666666-6666-4666-8666-666666666666",
          caseRevision: 1,
        },
      ],
      criteria: [
        {
          criterionId: "CRIT-1",
          outcome: "MET",
          rationale: "Crit rationale",
          references: [
            {
              type: "CONFIRMED_FACT",
              factId: "66666666-6666-4666-8666-666666666666",
              caseRevision: 1,
            },
          ],
        },
      ],
    },
  };

  const fingerprint = `sha256:${sha256Hex(
    canonicalJson([
      {
        decisionId: decisionPart.decisionId,
        decisionRevision: decisionPart.decisionRevision,
        decision: decisionPart.decision,
      },
    ]),
  )}`;

  const canonicalReport = {
    artifactId,
    assessmentId,
    kind: "FINAL_REPORT",
    schemaVersion: "ASSESSMENT_FINAL_REPORT_V1",
    pins: {
      ruleSetVersionId: "44444444-4444-4444-8444-444444444444",
      repositorySnapshotId: "55555555-5555-4555-8555-555555555555",
      repositoryScanJobId: "77777777-7777-4777-8777-777777777777",
      repositoryCommit: "a".repeat(40),
    },
    caseRevision: 1,
    decisionFingerprint: fingerprint,
    summary: "The assessment completed with high compliance.",
    findings: [
      {
        assessmentRuleId: "RULE-1",
        summary: "Security headers are configured.",
        recommendations: ["Ensure TLS 1.3 is enforced."],
        ...decisionPart,
      },
    ],
    provenance: {
      evidenceIds: [],
      factIds: [],
      searchCoverageEvidenceIds: [],
    },
  };

  const rawContent = JSON.stringify(canonicalReport);
  const contentSha = sha256Hex(rawContent);

  const artifactRow = {
    artifactId,
    assessmentId,
    kind: "FINAL_REPORT",
    lifecycleState: "ACTIVE",
    ruleSetVersionId: canonicalReport.pins.ruleSetVersionId,
    repositorySnapshotId: canonicalReport.pins.repositorySnapshotId,
    repositoryCommit: canonicalReport.pins.repositoryCommit,
    caseRevision: canonicalReport.caseRevision,
    schemaVersion: canonicalReport.schemaVersion,
    storageRef: JSON.stringify({
      artifact_id: artifactId,
      total_size: Buffer.byteLength(rawContent),
      hash: contentSha,
      chunks: ["chunk-0"],
    }),
    contentSha256: `sha256:${contentSha}`,
    sizeBytes: Buffer.byteLength(rawContent),
    assessmentCase: {
      caseRevision: 1,
      ruleSetVersionId: canonicalReport.pins.ruleSetVersionId,
      repositorySnapshotId: canonicalReport.pins.repositorySnapshotId,
      repositoryScanJobId: canonicalReport.pins.repositoryScanJobId,
      repositoryCommit: canonicalReport.pins.repositoryCommit,
      assessment: {
        lifecycleState: "COMPLETE",
        ownerId: userId,
      },
    },
  };

  const mockPrisma = {
    assessmentArtifact: {
      findUnique: () => Promise.resolve(artifactRow),
    },
  } as unknown as PrismaService;

  const mockStorage = {
    readAndReconstruct: () => Promise.resolve(rawContent),
  } as unknown as ArtifactStorageService;

  const loader = new AssessmentReportLoader(mockPrisma, mockStorage);

  it("projects report summary, finding summaries, and recommendations to VI while preserving technical integrity", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            projected: {
              "The assessment completed with high compliance.":
                "Đánh giá đã hoàn tất với mức độ tuân thủ cao.",
              "Security headers are configured.":
                "Các tiêu đề bảo mật đã được định cấu hình.",
              "Ensure TLS 1.3 is enforced.":
                "Đảm bảo giao thức TLS 1.3 được thực thi bắt buộc.",
            },
          }),
      } as Response),
    ) as typeof fetch;

    process.env.LCSP_AGENT_SERVER_URL = "http://127.0.0.1:2024";
    process.env.WORKER_API_KEY = "test-worker-key";

    try {
      // 1. Read with VI locale
      const resultVi = await loader.load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-test",
        locale: "vi",
      });

      const parsedVi = JSON.parse(
        resultVi.content.toString("utf8"),
      ) as AssessmentFinalReportArtifact;
      expect(parsedVi.summary).toBe(
        "Đánh giá đã hoàn tất với mức độ tuân thủ cao.",
      );
      expect(parsedVi.findings[0]?.summary).toBe(
        "Các tiêu đề bảo mật đã được định cấu hình.",
      );
      expect(parsedVi.findings[0]?.recommendations[0]).toBe(
        "Đảm bảo giao thức TLS 1.3 được thực thi bắt buộc.",
      );
      // Technical invariants preserved
      expect(parsedVi.artifactId).toBe(artifactId);
      expect(parsedVi.decisionFingerprint).toBe(fingerprint);
      expect(parsedVi.findings[0]?.assessmentRuleId).toBe("RULE-1");

      // 2. Read with EN locale - preserves canonical English
      const resultEn = await loader.load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-test",
        locale: "en",
      });

      const parsedEn = JSON.parse(
        resultEn.content.toString("utf8"),
      ) as AssessmentFinalReportArtifact;
      expect(parsedEn.summary).toBe(
        "The assessment completed with high compliance.",
      );
      expect(parsedEn.findings[0]?.summary).toBe(
        "Security headers are configured.",
      );
      expect(parsedEn.findings[0]?.recommendations[0]).toBe(
        "Ensure TLS 1.3 is enforced.",
      );
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.LCSP_AGENT_SERVER_URL;
      delete process.env.WORKER_API_KEY;
    }
  });
});
