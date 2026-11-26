import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
  computeRepositorySetDigest,
} from "@lcsp/contracts/assessment-domain";
import {
  assessmentFinalReportV4Schema,
  type AssessmentFinalReportV4,
  type AssessmentReportSourceVisibilityLimitationReason,
} from "@lcsp/contracts/assessment-report";

import { decisionFingerprint } from "../../../domain/decision-fingerprint.js";
import {
  buildAssessmentFinalReportParts,
  type BuildAssessmentFinalReportV3Input,
} from "./assessment-final-report-v3.builder.js";

/**
 * Business purpose: Decide whether the pinned set of an assessment needs the multi-repository report.
 *
 * Business rules:
 * - A report for several pinned repositories must name each repository, its commit, scope and evidence, so it
 *   uses the V4 format; a single repository keeps the V3 format that older artifacts already use.
 *
 * Execution flow:
 * 1. Count the repositories of the verified pinned set carried by the finalization snapshot.
 *
 * Failure cases:
 * - A snapshot without a recorded set is treated as one repository.
 *
 * Side effects:
 * - None; pure decision.
 */
export function finalReportNeedsRepositorySet(
  input: Pick<BuildAssessmentFinalReportV3Input, "snapshot">,
): boolean {
  return (input.snapshot.pins.repositories?.length ?? 0) > 1;
}

/**
 * Business purpose: Construct the canonical, schema-valid final report of an assessment pinned to several
 * repositories, so the customer receives one system-level result that still shows which repository every
 * source statement, commit and coverage claim belongs to.
 *
 * Business rules:
 * - All rule decisions, facts, legal basis and the action plan are the shared system-level content.
 * - The pinned set (keys, snapshots, commits, scopes) and its digest are recorded and must recompute.
 * - Each repository declares its own source scope and visibility; the narrative limitations are the union of
 *   the reasons of the repositories, so one limited repository limits the whole report.
 * - Every repository evidence item and search coverage names its repository; unbound evidence is refused.
 *
 * Execution flow:
 * 1. Reload the shared report content and each repository's scope through the shared parts builder.
 * 2. Assemble the pinned set, identity, per-repository source scopes and the combined limitations.
 * 3. Validate against the V4 schema, which re-checks every repository's evidence and scope.
 *
 * Failure cases:
 * - A snapshot that does not carry a set of two or more repositories, missing records or invalid structure throw.
 *
 * Side effects:
 * - Read-only queries; produces an in-memory validated report without mutating persistence.
 */
export async function buildAssessmentFinalReportV4(
  input: BuildAssessmentFinalReportV3Input,
): Promise<AssessmentFinalReportV4> {
  const { assessmentId, artifactId, request, snapshot } = input;
  const parts = await buildAssessmentFinalReportParts(input);
  if (!parts.multi || parts.repositories.length < 2) {
    throw new Error("A V4 report describes two or more repositories");
  }
  const repositories = parts.repositories.map((repository) => {
    if (!repository.repositoryKey || !repository.repositoryFullName) {
      throw new Error("Pinned repository is missing its key or name");
    }
    return {
      repositoryKey: repository.repositoryKey,
      ordinal: repository.ordinal,
      repositoryFullName: repository.repositoryFullName,
      repositorySnapshotId: repository.repositorySnapshotId,
      repositoryScanJobId: repository.repositoryScanJobId,
      repositoryCommit: repository.repositoryCommit,
      sourcePathPrefix: repository.sourcePathPrefix,
    };
  });
  const repositorySetDigest = computeRepositorySetDigest(repositories);
  const limitationReasons: AssessmentReportSourceVisibilityLimitationReason[] =
    [];
  for (const repository of parts.repositories) {
    for (const reason of repository.sourceScope.limitationReasons) {
      if (!limitationReasons.includes(reason)) limitationReasons.push(reason);
    }
  }

  const report = {
    schemaVersion: ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
    artifactId,
    assessmentId,
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    identity: {
      repositorySetDigest,
      repositories: repositories.map((repository) => ({
        repositoryKey: repository.repositoryKey,
        repositorySnapshotId: repository.repositorySnapshotId,
        repositoryCommit: repository.repositoryCommit,
      })),
    },
    pins: {
      legalSourceVersionId: parts.source.id,
      legalSourceVersion: parts.source.version,
      ruleSetVersionId: parts.ruleSet.id,
      ruleSetVersion: parts.ruleSet.version,
      ruleSetDigest: parts.ruleSet.ruleSetDigest,
      repositorySetDigest,
      repositories,
    },
    caseRevision: snapshot.caseRevision,
    decisionFingerprint: decisionFingerprint(parts.ruleDetails),
    sourceScopes: parts.repositories.map((repository) => ({
      repositoryKey: repository.repositoryKey,
      ...repository.sourceScope,
    })),
    legalRequirements: parts.legalRequirements,
    ruleDetails: parts.ruleDetails,
    factIndex: parts.factIndex,
    evidenceIndex: parts.evidenceIndex,
    outcomeSummary: parts.outcomeSummary,
    boundedNarrative: {
      summary: request.summary,
      scopeLimitations: limitationReasons,
    },
    boundedActionPlan: parts.boundedActionPlan,
    publicationProvenance: {
      sourceManifestDigest: null,
      publishedAt: null,
    },
  };

  return assessmentFinalReportV4Schema.parse(report);
}
