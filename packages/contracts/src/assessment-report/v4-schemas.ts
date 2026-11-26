import { z } from "zod";

import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
} from "../assessment-domain/constants.ts";
import {
  ASSESSMENT_REPOSITORY_LIMITS,
  computeRepositorySetDigest,
  repositoryKeySchema,
  repositorySetDigestSchema,
} from "../assessment-domain/repository-set.ts";
import { repositorySourcePathPrefixSchema } from "../github-integration/source-scope.ts";
import { ASSESSMENT_REPORT_V3_LIMITS } from "./constants.ts";
import { assessmentReportSourceScopeSchema } from "./v3-schemas.ts";
import {
  boundedTextSchema,
  commitSchema,
  evidenceIndexSchemaV3,
  factIndexSchemaV3,
  identifierSchema,
  legalRequirementSchemaV3,
  outcomeSummarySchemaV3,
  publicationProvenanceSchemaV3,
  revisionSchema,
  ruleDetailSchemaV3,
  sha256Schema,
  uuidSchema,
  validateAssessmentFinalReportV3Invariants,
  validateV3SourceScope,
  type AssessmentFinalReportV3,
  type ReportRepositoryBinding,
} from "./v3-schemas.ts";
import {
  assessmentReportBoundedActionPlanSchema,
  boundedTextListSchema,
} from "./v3-schemas.ts";

/** One repository of the pinned set, as the report records it. */
export const assessmentReportRepositoryPinSchemaV4 = z.strictObject({
  repositoryKey: repositoryKeySchema,
  ordinal: z.number().int().min(0),
  repositoryFullName: boundedTextSchema,
  repositorySnapshotId: identifierSchema,
  repositoryScanJobId: identifierSchema,
  repositoryCommit: commitSchema,
  sourcePathPrefix: repositorySourcePathPrefixSchema.nullable(),
});
export type AssessmentReportRepositoryPinV4 = z.infer<
  typeof assessmentReportRepositoryPinSchemaV4
>;

/**
 * Evidence of a multi-repository report. Repository evidence and search coverage name the repository they
 * describe; customer answers are not repository-specific and carry no key.
 */
export const assessmentReportEvidenceIndexSchemaV4 =
  evidenceIndexSchemaV3.extend({
    repositoryKey: repositoryKeySchema.nullable(),
  });
export type AssessmentReportEvidenceIndexV4 = z.infer<
  typeof assessmentReportEvidenceIndexSchemaV4
>;

/** The source scope declared for one repository of the set. */
export const assessmentReportRepositorySourceScopeSchemaV4 =
  assessmentReportSourceScopeSchema.extend({
    repositoryKey: repositoryKeySchema,
  });
export type AssessmentReportRepositorySourceScopeV4 = z.infer<
  typeof assessmentReportRepositorySourceScopeSchemaV4
>;

/**
 * Business purpose: Validate a report written for an assessment pinned to several repositories, so every
 * source statement is judged against the repository it describes and the set cannot differ from the pinned one.
 * Business rules:
 * - The set digest must recompute from the listed repositories; identity and pins must describe the same set.
 * - Keys, snapshots and ordinals are unique and ordinals are contiguous from the primary repository (0).
 * - Exactly one source scope is declared per repository, in set order.
 * - Evidence is checked against the repository its key names; repository evidence without a pinned key is rejected.
 * - Everything that is not repository-specific (rules, facts, decisions, outcome, action plan) follows the V3 invariants.
 * Execution flow:
 * 1. Check the set (digest, identity, uniqueness, ordinals, scopes per repository).
 * 2. Project the report onto the V3 shape using the primary repository.
 * 3. Run the shared invariants with a binding that resolves each evidence item to its own repository.
 * Failure cases:
 * - Each violation adds a targeted issue with the offending path.
 * Side effects:
 * - None; records issues on the refinement context only.
 */
function validateAssessmentFinalReportV4Invariants(
  report: AssessmentFinalReportV4,
  context: z.RefinementCtx,
): void {
  const { repositories } = report.pins;
  const keys = new Set<string>();
  const snapshots = new Set<string>();
  for (const [index, pin] of repositories.entries()) {
    if (pin.ordinal !== index) {
      context.addIssue({
        code: "custom",
        path: ["pins", "repositories", index, "ordinal"],
        message:
          "Repository ordinals must be contiguous from the primary repository",
      });
    }
    if (keys.has(pin.repositoryKey)) {
      context.addIssue({
        code: "custom",
        path: ["pins", "repositories", index, "repositoryKey"],
        message: "Repository keys must be unique",
      });
    }
    keys.add(pin.repositoryKey);
    if (snapshots.has(pin.repositorySnapshotId)) {
      context.addIssue({
        code: "custom",
        path: ["pins", "repositories", index, "repositorySnapshotId"],
        message: "Repository snapshots must be unique within the set",
      });
    }
    snapshots.add(pin.repositorySnapshotId);
  }

  const recomputed = computeRepositorySetDigest(repositories);
  if (
    report.pins.repositorySetDigest !== recomputed ||
    report.identity.repositorySetDigest !== recomputed
  ) {
    context.addIssue({
      code: "custom",
      path: ["pins", "repositorySetDigest"],
      message: "Repository set digest does not match the listed repositories",
    });
  }
  const identityMatches =
    report.identity.repositories.length === repositories.length &&
    report.identity.repositories.every((entry, index) => {
      const pin = repositories[index];
      return (
        pin !== undefined &&
        entry.repositoryKey === pin.repositoryKey &&
        entry.repositorySnapshotId === pin.repositorySnapshotId &&
        entry.repositoryCommit.toLowerCase() ===
          pin.repositoryCommit.toLowerCase()
      );
    });
  if (!identityMatches) {
    context.addIssue({
      code: "custom",
      path: ["identity", "repositories"],
      message: "Report identity must match its pinned repositories",
    });
  }

  const scopesMatch =
    report.sourceScopes.length === repositories.length &&
    report.sourceScopes.every(
      (scope, index) =>
        scope.repositoryKey === repositories[index]?.repositoryKey,
    );
  if (!scopesMatch) {
    context.addIssue({
      code: "custom",
      path: ["sourceScopes"],
      message:
        "Exactly one source scope per pinned repository is required, in set order",
    });
  }

  const primary = repositories[0];
  const primaryScope = report.sourceScopes[0];
  if (!primary || !primaryScope) return;
  const pinByKey = new Map(
    repositories.map((pin) => [
      pin.repositoryKey,
      { commit: pin.repositoryCommit, sourcePathPrefix: pin.sourcePathPrefix },
    ]),
  );
  const binding: ReportRepositoryBinding = {
    checkIdentity: false,
    pinByKey,
    defaultPin: null,
    humanAnswerCommits: new Set(
      repositories.map((pin) => pin.repositoryCommit.toLowerCase()),
    ),
    skipSourceScope: true,
  };

  const { sourceScopes: _scopes, ...rest } = report;
  void _scopes;
  const { repositoryKey: _key, ...primaryDeclared } = primaryScope;
  void _key;
  const projection = {
    ...rest,
    identity: {
      repositorySnapshotId: primary.repositorySnapshotId,
      repositoryCommit: primary.repositoryCommit,
    },
    pins: {
      legalSourceVersionId: report.pins.legalSourceVersionId,
      legalSourceVersion: report.pins.legalSourceVersion,
      ruleSetVersionId: report.pins.ruleSetVersionId,
      ruleSetVersion: report.pins.ruleSetVersion,
      ruleSetDigest: report.pins.ruleSetDigest,
      repositorySnapshotId: primary.repositorySnapshotId,
      repositoryScanJobId: primary.repositoryScanJobId,
      repositoryCommit: primary.repositoryCommit,
      sourcePathPrefix: primary.sourcePathPrefix,
    },
    sourceScope: primaryDeclared,
    schemaVersion: "ASSESSMENT_FINAL_REPORT_V3",
  } as unknown as AssessmentFinalReportV3;
  validateAssessmentFinalReportV3Invariants(projection, context, binding);

  // Every repository's declared scope is judged against that repository's own evidence and pin.
  const plainEvidence = report.evidenceIndex.map(
    ({ repositoryKey: ignored, ...plain }) => {
      void ignored;
      return plain;
    },
  );
  for (const [index, scope] of report.sourceScopes.entries()) {
    const pin = repositories.find(
      (candidate) => candidate.repositoryKey === scope.repositoryKey,
    );
    if (!pin) continue;
    const { repositoryKey, ...declared } = scope;
    const ownedIds = new Set(
      report.evidenceIndex
        .filter((item) => item.repositoryKey === repositoryKey)
        .map((item) => item.evidenceId),
    );
    validateV3SourceScope(
      {
        pins: {
          sourcePathPrefix: pin.sourcePathPrefix,
          repositoryCommit: pin.repositoryCommit,
        },
        sourceScope: declared,
        evidenceIndex: plainEvidence,
      },
      new Map(
        plainEvidence
          .filter((item) => ownedIds.has(item.evidenceId))
          .map((item) => [item.evidenceId, item]),
      ),
      new RepositoryScopeContext(context, index) as unknown as z.RefinementCtx,
      (item) => ownedIds.has(item.evidenceId),
    );
  }
}

/**
 * Business purpose: Report issues of one repository's scope check under that repository's entry in `sourceScopes`.
 * Business rules:
 * - Issues the shared scope check places under `sourceScope` move to `sourceScopes/<index>`; other paths are kept.
 * Execution flow:
 * 1. Receive each issue from the shared check.
 * 2. Record it on the real refinement context with the re-rooted path.
 * Failure cases:
 * - Adds no issues of its own; it only rewrites the path of those it receives.
 * Side effects:
 * - Records issues on the wrapped refinement context.
 */
class RepositoryScopeContext {
  // Plain fields, not constructor parameter properties: contracts also load under Node's strip-only TypeScript mode.
  private readonly context: z.RefinementCtx;
  private readonly scopeIndex: number;

  constructor(context: z.RefinementCtx, scopeIndex: number) {
    this.context = context;
    this.scopeIndex = scopeIndex;
  }

  /**
   * Business purpose: Record one scope issue under the right repository entry.
   * Business rules:
   * - Only paths that start at `sourceScope` are moved; every other path is recorded unchanged.
   * Execution flow:
   * 1. Read the issue path.
   * 2. Re-root it when it points into `sourceScope`.
   * 3. Record the issue on the real context.
   * Failure cases:
   * - A missing path is recorded as the empty path.
   * Side effects:
   * - Adds one issue to the refinement context.
   */
  addIssue(issue: z.core.$ZodRawIssue | z.core.$ZodSuperRefineIssue): void {
    const path = (issue as { path?: PropertyKey[] }).path ?? [];
    this.context.addIssue({
      ...(issue as object),
      path:
        path[0] === "sourceScope"
          ? ["sourceScopes", this.scopeIndex, ...path.slice(1)]
          : path,
    } as never);
  }
}

export const assessmentFinalReportV4Schema = z
  .strictObject({
    schemaVersion: z.literal(ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION),
    artifactId: uuidSchema,
    assessmentId: uuidSchema,
    kind: z.literal(ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT),
    identity: z.strictObject({
      repositorySetDigest: repositorySetDigestSchema,
      repositories: z
        .array(
          z.strictObject({
            repositoryKey: repositoryKeySchema,
            repositorySnapshotId: identifierSchema,
            repositoryCommit: commitSchema,
          }),
        )
        .min(2)
        .max(ASSESSMENT_REPOSITORY_LIMITS.maxRepositories),
    }),
    pins: z.strictObject({
      legalSourceVersionId: uuidSchema,
      legalSourceVersion: boundedTextSchema,
      ruleSetVersionId: uuidSchema,
      ruleSetVersion: boundedTextSchema,
      ruleSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
      repositorySetDigest: repositorySetDigestSchema,
      repositories: z
        .array(assessmentReportRepositoryPinSchemaV4)
        .min(2)
        .max(ASSESSMENT_REPOSITORY_LIMITS.maxRepositories),
    }),
    caseRevision: revisionSchema,
    decisionFingerprint: sha256Schema,
    sourceScopes: z
      .array(assessmentReportRepositorySourceScopeSchemaV4)
      .min(2)
      .max(ASSESSMENT_REPOSITORY_LIMITS.maxRepositories),
    legalRequirements: z
      .array(legalRequirementSchemaV3)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_LEGAL_REQUIREMENTS),
    ruleDetails: z
      .array(ruleDetailSchemaV3)
      .min(1)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_RULE_DETAILS),
    factIndex: z
      .array(factIndexSchemaV3)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_INDEX_ENTRIES),
    evidenceIndex: z
      .array(assessmentReportEvidenceIndexSchemaV4)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_INDEX_ENTRIES),
    outcomeSummary: outcomeSummarySchemaV3,
    boundedNarrative: z.strictObject({
      summary: boundedTextSchema,
      scopeLimitations: boundedTextListSchema,
    }),
    boundedActionPlan: assessmentReportBoundedActionPlanSchema,
    publicationProvenance: publicationProvenanceSchemaV3,
  })
  .superRefine(validateAssessmentFinalReportV4Invariants);

export type AssessmentFinalReportV4 = z.infer<
  typeof assessmentFinalReportV4Schema
>;
