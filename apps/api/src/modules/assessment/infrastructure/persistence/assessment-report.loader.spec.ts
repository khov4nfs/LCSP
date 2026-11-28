import { authoredFields } from "../../../../platform/localization/authored-localization.service.js";
import { authoredLocalizationFixture } from "../../../../../test/support/authored-localization.fixture.js";
import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  assessmentFinalReportArtifactSchema,
} from "@lcsp/contracts/assessment-domain";
import { randomUUID } from "node:crypto";
import { HttpStatus } from "@nestjs/common";
import { AssessmentReportLoader } from "./assessment-report.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { ArtifactStorageService } from "../../../../platform/storage/artifact-storage.service.js";
import { canonicalJson, sha256Hex } from "../../domain/domain-ids.js";
import { buildAssessmentFinalReportV4 } from "../../application/commands/submit-assessment-final-report/assessment-final-report-v4.builder.js";
import {
  api as fixtureApi,
  assessmentId as fixtureAssessmentId,
  id as fixtureId,
  twoRepositoryReportEnvironment,
} from "../../fixtures/two-repository-final-report.js";

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
    lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
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
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
        ownerId: userId,
      },
    },
  };

  const mockPrisma = {
    assessmentArtifact: {
      findFirst: () => Promise.resolve(artifactRow),
    },
    repositorySnapshot: {
      findFirst: () => Promise.resolve(null),
      findUnique: () => Promise.resolve(null),
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
    const localized = assessmentFinalReportArtifactSchema.parse(
      JSON.parse(vi.content.toString("utf8")),
    );
    expect(localized.artifactId).toBe(artifactId);
    expect(localized.pins).toEqual(canonicalReport.pins);
    expect(localized.decisionFingerprint).toBe(fingerprint);
    expect(localized.summary).toBe("VI: " + canonicalReport.summary);
    expect(vi.sourceArtifactSha256).toBe(contentSha);
    expect(vi.contentSha256).toBe(sha256Hex(vi.content.toString("utf8")));
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

  it("accepts equivalent Git commit pins when persisted metadata uses uppercase hex", async () => {
    const uppercaseCommit = canonicalReport.pins.repositoryCommit.toUpperCase();
    const loader = new AssessmentReportLoader(
      {
        assessmentArtifact: {
          findFirst: () =>
            Promise.resolve({
              ...artifactRow,
              repositoryCommit: uppercaseCommit,
              assessmentCase: {
                ...artifactRow.assessmentCase,
                repositoryCommit: uppercaseCommit,
              },
            }),
        },
        // Why: The merged loader resolves an optional canonical repository link
        // after integrity checks; this fixture has no connection to expose.
        repositorySnapshot: { findFirst: () => Promise.resolve(null) },
      } as unknown as PrismaService,
      mockStorage,
      localization.projection,
    );

    const loaded = await loader.load({
      assessmentId,
      artifactId,
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "commit-case-normalization",
    });

    expect(loaded.content.toString("utf8")).toBe(rawContent);
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

  it("[RED][ASM-REPORT-02] reports storage dependency outages as 503", async () => {
    const dependencyFailure = Object.assign(
      new Error("artifact storage unavailable at /private/reports"),
      { code: "ETIMEDOUT" },
    );
    const unavailable = new AssessmentReportLoader(
      mockPrisma,
      {
        readAndReconstruct: () => Promise.reject(dependencyFailure),
      } as unknown as ArtifactStorageService,
      localization.projection,
    );

    const error = (await unavailable
      .load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "storage-outage",
      })
      .catch((failure: unknown) => failure)) as {
      getResponse(): unknown;
      getStatus(): number;
    };

    // An unavailable dependency is operationally retryable and must not be
    // misreported as a permanently invalid customer artifact.
    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /private\/reports|ETIMEDOUT/u,
    );
  });

  it.each(["ENOSPC", "EMFILE", "ENFILE", "EROFS"])(
    "[RED][ASM-REPORT-02] reports local storage dependency %s as safe 503",
    async (code) => {
      const dependencyFailure = Object.assign(new Error("private disk path"), {
        code,
      });
      const loader = new AssessmentReportLoader(
        mockPrisma,
        {
          readAndReconstruct: () => Promise.reject(dependencyFailure),
        } as unknown as ArtifactStorageService,
        localization.projection,
      );

      const error = (await loader
        .load({
          assessmentId,
          artifactId,
          sessionUserId: userId,
          subjectRole: AUTH_USER_ROLES.customer,
          correlationId: "local-storage-outage",
        })
        .catch((failure: unknown) => failure)) as {
        getResponse(): unknown;
        getStatus(): number;
      };

      expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(JSON.stringify(error.getResponse())).not.toMatch(
        /private disk path|ENOSPC|EMFILE|ENFILE|EROFS/u,
      );
    },
  );

  it("[RED][BOLA] scopes owner and assessment identity in the database query", async () => {
    const findFirst = jest.fn((query: unknown) => {
      void query;
      return Promise.resolve(artifactRow);
    });
    const loader = new AssessmentReportLoader(
      {
        assessmentArtifact: { findFirst },
        repositorySnapshot: { findFirst: () => Promise.resolve(null) },
      } as unknown as PrismaService,
      mockStorage,
      localization.projection,
    );

    await loader.load({
      assessmentId,
      artifactId,
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: "bola-scope",
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          artifactId,
          assessmentId,
          assessmentCase: { assessment: { ownerId: userId } },
        },
      }),
    );
  });

  it("[RED][BOLA] rejects non-customer roles before querying report metadata", async () => {
    const findFirst = jest.fn((query: unknown) => {
      void query;
      return Promise.resolve(artifactRow);
    });
    const loader = new AssessmentReportLoader(
      {
        assessmentArtifact: { findFirst },
      } as unknown as PrismaService,
      mockStorage,
      localization.projection,
    );

    const failure = (await loader
      .load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.admin,
        correlationId: "role-gate",
      })
      .catch((error: unknown) => error)) as { getStatus(): number };

    expect(failure.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ARTIFACT_LIFECYCLE_STATES.BUILDING,
    ARTIFACT_LIFECYCLE_STATES.INVALID,
    ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
  ])(
    "[ASM-REPORT-01D] refuses %s without reading storage",
    async (lifecycleState) => {
      const readAndReconstruct = jest.fn(() => Promise.resolve(rawContent));
      const loader = new AssessmentReportLoader(
        {
          assessmentArtifact: {
            findFirst: () =>
              Promise.resolve({ ...artifactRow, lifecycleState }),
          },
        } as unknown as PrismaService,
        { readAndReconstruct } as unknown as ArtifactStorageService,
        localization.projection,
      );

      const error = (await loader
        .load({
          assessmentId,
          artifactId,
          sessionUserId: userId,
          subjectRole: AUTH_USER_ROLES.customer,
          correlationId: "inactive-artifact",
        })
        .catch((failure: unknown) => failure)) as {
        getResponse(): { problem: { code: string } };
        getStatus(): number;
      };

      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(error.getResponse().problem.code).toBe(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      );
      expect(readAndReconstruct).not.toHaveBeenCalled();
    },
  );

  it("[RED][ASM-REPORT-02] reports database dependency outages as a masked 503", async () => {
    const databaseFailure = Object.assign(
      new Error("postgres unavailable at postgres.internal:5432/lcsp"),
      { code: "P1001" },
    );
    const loader = new AssessmentReportLoader(
      {
        assessmentArtifact: {
          findFirst: () => Promise.reject(databaseFailure),
        },
      } as unknown as PrismaService,
      mockStorage,
      localization.projection,
    );

    const error = (await loader
      .load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "database-outage",
      })
      .catch((failure: unknown) => failure)) as {
      getResponse(): unknown;
      getStatus(): number;
    };

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /postgres\.internal|5432|P1001/u,
    );
  });

  it("[ASM-REPORT-02] reports malformed report bytes as integrity conflict 409", async () => {
    const loader = new AssessmentReportLoader(
      mockPrisma,
      {
        readAndReconstruct: () => Promise.resolve("not-json"),
      } as unknown as ArtifactStorageService,
      localization.projection,
    );

    const error = (await loader
      .load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "invalid-report",
      })
      .catch((failure: unknown) => failure)) as { getStatus(): number };

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it("[RED][ASM-REPORT-02] masks unexpected internal failures as 500", async () => {
    const loader = new AssessmentReportLoader(
      mockPrisma,
      {
        readAndReconstruct: () =>
          Promise.reject(new Error("secret path /srv/lcsp/reports")),
      } as unknown as ArtifactStorageService,
      localization.projection,
    );

    const error = (await loader
      .load({
        assessmentId,
        artifactId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "unexpected-failure",
      })
      .catch((failure: unknown) => failure)) as {
      getResponse(): unknown;
      getStatus(): number;
    };

    expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /secret path|\/srv\/lcsp/u,
    );
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
          findFirst: () => ({
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
        repositorySnapshot: {
          findFirst: () => Promise.resolve(null),
          findUnique: () => Promise.resolve(null),
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

  describe("multi-repository (V4) report", () => {
    /** A stored V4 artifact, its database row and the loader that reads it. */
    async function stored(
      overrides: {
        artifactSetDigest?: string;
        caseSetDigest?: string;
        apiPrefix?: string | null;
      } = {},
    ) {
      const { tx, snapshot, request } = twoRepositoryReportEnvironment();
      const report = await buildAssessmentFinalReportV4({
        tx,
        assessmentId: fixtureAssessmentId,
        artifactId: fixtureId(),
        request,
        snapshot,
      });
      const raw = canonicalJson(report);
      const hash = sha256Hex(raw);
      const [primary] = report.pins.repositories;
      if (!primary) throw new Error("fixture has no repositories");
      const row = {
        artifactId: report.artifactId,
        assessmentId: fixtureAssessmentId,
        kind: "FINAL_REPORT",
        lifecycleState: "ACTIVE",
        ruleSetVersionId: report.pins.ruleSetVersionId,
        repositorySnapshotId: primary.repositorySnapshotId,
        repositoryCommit: primary.repositoryCommit,
        repositorySetDigest:
          overrides.artifactSetDigest ?? report.pins.repositorySetDigest,
        caseRevision: report.caseRevision,
        schemaVersion: report.schemaVersion,
        contentSha256: `sha256:${hash}`,
        sizeBytes: Buffer.byteLength(raw),
        storageRef: JSON.stringify({
          artifact_id: report.artifactId,
          total_size: Buffer.byteLength(raw),
          hash,
          chunks: ["chunk-0"],
        }),
        assessmentCase: {
          caseRevision: report.caseRevision,
          ruleSetVersionId: report.pins.ruleSetVersionId,
          repositorySnapshotId: primary.repositorySnapshotId,
          repositoryScanJobId: primary.repositoryScanJobId,
          repositoryCommit: primary.repositoryCommit,
          repositorySetDigest:
            overrides.caseSetDigest ?? report.pins.repositorySetDigest,
          assessment: { lifecycleState: "COMPLETE", ownerId: "owner-1" },
        },
      };
      const apiPrefix =
        overrides.apiPrefix === undefined
          ? "services/billing"
          : overrides.apiPrefix;
      const loader = new AssessmentReportLoader(
        {
          assessmentArtifact: { findFirst: () => row },
          complianceRuleSetVersion: {
            findUnique: () => ({
              id: report.pins.ruleSetVersionId,
              version: report.pins.ruleSetVersion,
              ruleSetDigest: report.pins.ruleSetDigest,
              legalSourceVersion: {
                id: report.pins.legalSourceVersionId,
                version: report.pins.legalSourceVersion,
              },
            }),
          },
          repositorySnapshot: {
            findUnique: ({ where }: { where: { id: string } }) => ({
              sourcePathPrefix:
                where.id === fixtureApi.repositorySnapshotId ? apiPrefix : null,
            }),
            // A multi-repository report has no single provider link, so no canonical source is resolved.
            findFirst: () => Promise.resolve(null),
          },
        } as never,
        { readAndReconstruct: () => raw } as never,
        authoredLocalizationFixture().projection,
      );
      const load = () =>
        loader.load({
          assessmentId: fixtureAssessmentId,
          artifactId: report.artifactId,
          sessionUserId: "owner-1",
          subjectRole: AUTH_USER_ROLES.customer,
          correlationId: randomUUID(),
        });
      return { load, raw, hash };
    }

    it("serves the stored bytes when the set digest and every snapshot scope still match", async () => {
      const { load, raw, hash } = await stored();
      const result = await load();
      expect(result.content.toString("utf8")).toBe(raw);
      expect(result.contentSha256).toBe(hash);
    });

    it("refuses a report whose set digest differs from the one recorded on the artifact or the case", async () => {
      const other = `sha256:${"9".repeat(64)}`;
      await expect(
        (await stored({ artifactSetDigest: other })).load(),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        (await stored({ caseSetDigest: other })).load(),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("refuses a report once a pinned snapshot's source scope no longer matches", async () => {
      await expect(
        (await stored({ apiPrefix: "services/other" })).load(),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it("blocks artifact downloads with 403 when user capability artifactsEnabled is false", async () => {
    const blockedAssessmentId = randomUUID();
    const blockedArtifactId = randomUUID();
    const blockedLoader = new AssessmentReportLoader(
      {
        assessmentArtifact: {
          findFirst: () =>
            Promise.resolve({
              artifactId: blockedArtifactId,
              assessmentId: blockedAssessmentId,
              kind: "FINAL_REPORT",
              lifecycleState: "ACTIVE",
              assessmentCase: {
                assessment: { lifecycleState: "COMPLETE", ownerId: "owner-1" },
              },
            }),
        },
        capabilitySetting: {
          findUnique: () => Promise.resolve({ artifactsEnabled: false }),
        },
      } as never,
      { readAndReconstruct: () => Promise.resolve("{}") } as never,
      authoredLocalizationFixture().projection,
    );

    await expect(
      blockedLoader.load({
        assessmentId: blockedAssessmentId,
        artifactId: blockedArtifactId,
        sessionUserId: "owner-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-blocked",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
