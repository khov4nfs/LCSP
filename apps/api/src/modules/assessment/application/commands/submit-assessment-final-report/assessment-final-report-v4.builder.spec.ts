import { describe, expect, it } from "@jest/globals";
import {
  ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
  computeRepositorySetDigest,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  assessmentFinalReportArtifactVersionedSchema,
  assessmentFinalReportV4Schema,
  buildAssessmentReportPresentation,
  type AssessmentFinalReportV4,
} from "@lcsp/contracts/assessment-report";

import {
  api,
  apiCoverageId,
  apiEvidenceId,
  assessmentId,
  id,
  twoRepositoryReportEnvironment as environment,
  web,
  webCoverageId,
  webEvidenceId,
  type Options,
} from "../../../fixtures/two-repository-final-report.js";
import { assessmentReportV4Html } from "../../../infrastructure/report/assessment-report-v4-pdf-html.js";
import { buildAssessmentFinalReportV3 } from "./assessment-final-report-v3.builder.js";
import {
  buildAssessmentFinalReportV4,
  finalReportNeedsRepositorySet,
} from "./assessment-final-report-v4.builder.js";

async function build(options: Options = {}) {
  const { tx, snapshot, request } = environment(options);
  return buildAssessmentFinalReportV4({
    tx,
    assessmentId,
    artifactId: id(),
    request,
    snapshot,
  });
}

describe("buildAssessmentFinalReportV4", () => {
  it("records the pinned set, one scope per repository and a repository on every evidence entry", async () => {
    const report = await build();

    expect(report.schemaVersion).toBe(
      ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
    );
    expect(report.pins.repositories.map((pin) => pin.repositoryKey)).toEqual([
      "web",
      "api",
    ]);
    expect(report.pins.repositorySetDigest).toBe(
      computeRepositorySetDigest([web, api]),
    );
    expect(report.identity.repositorySetDigest).toBe(
      report.pins.repositorySetDigest,
    );
    expect(report.sourceScopes.map((scope) => scope.repositoryKey)).toEqual([
      "web",
      "api",
    ]);
    expect(report.sourceScopes[1]).toMatchObject({
      mode: "SUBTREE",
      sourcePathPrefix: "services/billing",
      visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
      searchCoverageEvidenceIds: [apiCoverageId],
    });
    expect(report.sourceScopes[0]).toMatchObject({
      mode: "WHOLE_REPOSITORY",
      visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
      searchCoverageEvidenceIds: [webCoverageId],
    });
    const keyOf = (id: string) =>
      report.evidenceIndex.find((item) => item.evidenceId === id)
        ?.repositoryKey;
    expect(keyOf(webEvidenceId)).toBe("web");
    expect(keyOf(apiEvidenceId)).toBe("api");
    expect(keyOf(apiCoverageId)).toBe("api");
    expect(assessmentFinalReportV4Schema.parse(report)).toEqual(report);
    expect(
      assessmentFinalReportArtifactVersionedSchema.parse(report).schemaVersion,
    ).toBe(ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION);
  });

  it("judges each repository's visibility from its own coverage and its own scan", async () => {
    const report = await build({ webCoverage: false, apiScanCompleted: false });

    const [webScope, apiScope] = report.sourceScopes;
    expect(webScope?.visibility).toBe(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    );
    expect(webScope?.searchCoverageEvidenceIds).toEqual([]);
    // The incomplete scan of the second repository cannot be hidden by the first one's coverage.
    expect(apiScope?.visibility).toBe(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    );
    expect(report.boundedNarrative.scopeLimitations).toEqual([
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
    ]);
  });

  it("keeps one limited repository from being reported as fully visible", async () => {
    const report = await build({ apiCoverage: false });

    expect(report.sourceScopes.map((scope) => scope.visibility)).toEqual([
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    ]);
    expect(report.boundedNarrative.scopeLimitations).toContain(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
    );
  });

  it("refuses repository evidence that is not bound to a pinned repository", async () => {
    await expect(build({ unboundEvidence: true })).rejects.toThrow(
      /not bound to a pinned repository/u,
    );
  });

  it("uses the V4 format only when several repositories are pinned", () => {
    const { snapshot } = environment();
    expect(finalReportNeedsRepositorySet({ snapshot })).toBe(true);
    expect(
      finalReportNeedsRepositorySet({
        snapshot: {
          ...snapshot,
          pins: { ...snapshot.pins, repositories: [web] },
        },
      }),
    ).toBe(false);
    expect(
      finalReportNeedsRepositorySet({
        snapshot: {
          ...snapshot,
          pins: { ...snapshot.pins, repositories: undefined },
        },
      }),
    ).toBe(false);
  });

  it("does not let the single-repository builder describe a set", async () => {
    const { tx, snapshot, request } = environment();
    await expect(
      buildAssessmentFinalReportV3({
        tx,
        assessmentId,
        artifactId: id(),
        request,
        snapshot,
      }),
    ).rejects.toThrow(/exactly one repository/u);
  });
});

describe("assessmentFinalReportV4Schema invariants", () => {
  const mutate = async (
    change: (report: AssessmentFinalReportV4) => void,
  ): Promise<boolean> => {
    const report = structuredClone(await build());
    change(report);
    return assessmentFinalReportV4Schema.safeParse(report).success;
  };
  const evidenceOf = (report: AssessmentFinalReportV4, evidenceId: string) => {
    const item = report.evidenceIndex.find(
      (entry) => entry.evidenceId === evidenceId,
    );
    if (!item) throw new Error("fixture evidence missing");
    return item;
  };

  it("rejects a set digest that does not recompute from the listed repositories", async () => {
    expect(
      await mutate((report) => {
        report.pins.repositorySetDigest = `sha256:${"0".repeat(64)}`;
      }),
    ).toBe(false);
    expect(
      await mutate((report) => {
        const second = report.pins.repositories[1];
        if (second) second.repositoryCommit = "d".repeat(40);
      }),
    ).toBe(false);
  });

  it("rejects evidence checked against another repository's commit or source prefix", async () => {
    // API evidence carrying the web commit.
    expect(
      await mutate((report) => {
        evidenceOf(report, apiEvidenceId).repositoryCommit =
          web.repositoryCommit;
      }),
    ).toBe(false);
    // API evidence pointing outside services/billing.
    expect(
      await mutate((report) => {
        evidenceOf(report, apiEvidenceId).safeLocator = "src/charge.py:3-8";
      }),
    ).toBe(false);
    // Evidence naming a repository that is not pinned.
    expect(
      await mutate((report) => {
        evidenceOf(report, webEvidenceId).repositoryKey = "mobile";
      }),
    ).toBe(false);
  });

  it("rejects missing, reordered or misattributed source scopes", async () => {
    expect(
      await mutate((report) => {
        report.sourceScopes.pop();
      }),
    ).toBe(false);
    expect(
      await mutate((report) => {
        report.sourceScopes.reverse();
      }),
    ).toBe(false);
    // Coverage evidence of the other repository cannot establish this repository's visibility.
    expect(
      await mutate((report) => {
        const second = report.sourceScopes[1];
        if (second) second.searchCoverageEvidenceIds = [webCoverageId];
      }),
    ).toBe(false);
  });

  it("rejects duplicate keys and non-contiguous ordinals", async () => {
    expect(
      await mutate((report) => {
        const pin = report.pins.repositories[1];
        const identity = report.identity.repositories[1];
        const scope = report.sourceScopes[1];
        if (pin) pin.repositoryKey = "web";
        if (identity) identity.repositoryKey = "web";
        if (scope) scope.repositoryKey = "web";
      }),
    ).toBe(false);
    expect(
      await mutate((report) => {
        const pin = report.pins.repositories[1];
        if (pin) pin.ordinal = 3;
      }),
    ).toBe(false);
  });
});

describe("multi-repository report presentation", () => {
  it("lists the pinned repositories and labels evidence with its repository", async () => {
    const report = await build();
    const model = buildAssessmentReportPresentation(report);
    expect(model.version).toBe(ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION);
    if (!("repositories" in model.header)) throw new Error("not a V4 model");
    expect(model.header.repositories.map((item) => item.repositoryKey)).toEqual(
      ["web", "api"],
    );
    expect(model.header.repositories[1]?.evidenceIds).toEqual(
      expect.arrayContaining([apiEvidenceId, apiCoverageId]),
    );
    // The primary repository still fills the original single-repository fields.
    expect(model.header.repositoryCommit).toBe(web.repositoryCommit);
    const labelled = model.obligationDetails[0]?.evidence.map(
      (item) => (item as { repositoryKey?: string | null }).repositoryKey,
    );
    expect(labelled).toEqual(expect.arrayContaining(["web", "api"]));
  });

  it("renders the repository table, evidence labels and per-repository traceability", async () => {
    const report = await build({ apiCoverage: false });
    const model = buildAssessmentReportPresentation(report);
    const html = assessmentReportV4Html(model);
    expect(html).toContain("Kho mã nguồn được đánh giá");
    expect(html).toContain("acme/billing-api");
    expect(html).toContain("services/billing");
    expect(html).toContain("<code>api</code>");
    expect(html).toContain("CẢNH BÁO PHẠM VI MÃ NGUỒN");
    expect(html).toContain(report.pins.repositorySetDigest);
  });

  it("escapes repository names in the printable document", async () => {
    const report = await build();
    const model = buildAssessmentReportPresentation(report);
    if (!("repositories" in model.header)) throw new Error("not a V4 model");
    model.header.repositories[0].repositoryFullName =
      '<script>alert("x")</script>';
    const html = assessmentReportV4Html(model);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
