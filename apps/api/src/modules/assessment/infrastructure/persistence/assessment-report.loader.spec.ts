import { authoredFields } from "../../../../platform/localization/authored-localization.service.js";
import { authoredLocalizationFixture } from "../../../../../test/support/authored-localization.fixture.js";
import { describe, expect, it } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  assessmentFinalReportArtifactSchema,
} from "@lcsp/contracts/assessment-domain";
import { randomUUID } from "node:crypto";
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

  const localization = authoredLocalizationFixture();
  const loader = new AssessmentReportLoader(
    mockPrisma,
    mockStorage,
    localization.projection,
  );

  it("reads durable locale overlays while preserving original report bytes and source digest", async () => {
    for (const field of authoredFields(canonicalReport))
      localization.seed(field.text, "VI: " + field.text);
    const vi = await loader.load({
      assessmentId,
      artifactId,
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "corr-test",
      locale: "vi",
    });
    const overlay = JSON.parse(vi.content.toString("utf8")) as {
      sourceArtifactId: string;
      sourceSha256: string;
      locale: string;
      localizedFields: Record<string, string>;
    };
    expect(overlay.sourceArtifactId).toBe(artifactId);
    expect(overlay.sourceSha256).toBe(sha256Hex(rawContent));
    expect(overlay.locale).toBe("vi");
    expect(overlay.localizedFields["/summary"]).toBe(
      "VI: " + canonicalReport.summary,
    );
    const repeated = await loader.load({
      assessmentId,
      artifactId,
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "corr-test",
      locale: "vi",
    });
    expect(repeated.content).toEqual(vi.content);
    const canonical = await loader.load({
      assessmentId,
      artifactId,
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "corr-test",
    });
    expect(canonical.content.toString("utf8")).toBe(rawContent);
    expect(JSON.parse(canonical.content.toString("utf8"))).toMatchObject({
      artifactId,
      decisionFingerprint: fingerprint,
    });
  });
  it("rejects an unavailable locale revision without substituting canonical text", async () => {
    const reader = new AssessmentReportLoader(
      mockPrisma,
      mockStorage,
      authoredLocalizationFixture().projection,
    );
    await expect(
      reader.load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-test",
        locale: "vi",
      }),
    ).rejects.toThrow();
  });
});

describe("AssessmentReportLoader historical compatibility", () => {
  it("loads a valid V1 artifact without rewriting its bytes", async () => {
    const assessmentId = randomUUID();
    const artifactId = randomUUID();
    const ruleSetVersionId = randomUUID();
    const snapshotId = randomUUID();
    const content = JSON.stringify({
      schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
      artifactId,
      assessmentId,
      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      pins: {
        ruleSetVersionId,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: "scan-1",
        repositoryCommit: "a".repeat(40),
      },
      caseRevision: 1,
      decisionFingerprint: `sha256:${sha256Hex(canonicalJson([]))}`,
      summary: "Historical V1 report.",
      findings: [],
      provenance: {
        evidenceIds: [],
        factIds: [],
        searchCoverageEvidenceIds: [],
      },
    });
    const parsed = assessmentFinalReportArtifactSchema.parse(
      JSON.parse(content),
    );
    const raw = JSON.stringify(parsed);
    const hash = sha256Hex(raw);
    const loader = new AssessmentReportLoader(
      {
        assessmentArtifact: {
          findUnique: () => ({
            artifactId,
            assessmentId,
            kind: "FINAL_REPORT",
            lifecycleState: "ACTIVE",
            ruleSetVersionId,
            repositorySnapshotId: snapshotId,
            repositoryCommit: "a".repeat(40),
            caseRevision: 1,
            schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
            contentSha256: `sha256:${hash}`,
            sizeBytes: Buffer.byteLength(raw),
            storageRef: JSON.stringify({
              artifact_id: artifactId,
              total_size: Buffer.byteLength(raw),
              hash,
              chunks: ["chunk-0"],
            }),
            assessmentCase: {
              caseRevision: 1,
              ruleSetVersionId,
              repositorySnapshotId: snapshotId,
              repositoryScanJobId: "scan-1",
              repositoryCommit: "a".repeat(40),
              assessment: { lifecycleState: "COMPLETE", ownerId: "owner-1" },
            },
          }),
        },
      } as never,
      { readAndReconstruct: () => raw } as never,
      authoredLocalizationFixture().projection,
    );
    const result = await loader.load({
      assessmentId,
      artifactId,
      sessionUserId: "owner-1",
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: randomUUID(),
    });
    expect(result.content.toString("utf8")).toBe(raw);
    expect(result.contentSha256).toBe(hash);
  });
});
