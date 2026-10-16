import { z } from "zod";

import { assessmentFinalReportArtifactSchema } from "../assessment-domain/schemas.ts";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
} from "../assessment-domain/constants.ts";
import { LEGAL_REQUIREMENT_COVERAGE_STATES } from "../compliance-rule-set/constants.ts";
import { ASSESSMENT_REPORT_REFERENCE_ORIGINS } from "./constants.ts";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionReferenceSchema,
  ruleDecisionSchema,
} from "../assessment/agentic-runtime.ts";

const identifierSchema = z.string().min(1).max(200);
const uuidSchema = z.uuid();
const revisionSchema = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const boundedTextSchema = z.string().trim().min(1).max(10_000);
const boundedTextListSchema = z.array(boundedTextSchema).max(200);

const sourceReferenceSchema = z.strictObject({
  legalSourceVersionId: uuidSchema,
  legalSourceVersion: boundedTextSchema,
  documentId: identifierSchema,
  locator: boundedTextSchema,
  contentSha256: sha256Schema,
});
export type AssessmentReportSourceReference = z.infer<
  typeof sourceReferenceSchema
>;

const legalRequirementSchema = z.strictObject({
  legalRequirementId: identifierSchema,
  title: boundedTextSchema,
  proposition: boundedTextSchema,
  applicabilityConditions: boundedTextListSchema,
  qualifiers: boundedTextListSchema,
  exceptions: boundedTextListSchema,
  nonRepositoryDuty: z.boolean(),
  coverageState: z.enum(LEGAL_REQUIREMENT_COVERAGE_STATES),
  sourceRefs: z.array(sourceReferenceSchema).min(1).max(200),
});
export type AssessmentReportLegalRequirement = z.infer<
  typeof legalRequirementSchema
>;

const evidenceIndexSchema = z.strictObject({
  evidenceId: uuidSchema,
  type: identifierSchema,
  contentSha256: sha256Schema,
  repositoryCommit: commitSchema.nullable(),
  safeLocator: boundedTextSchema.nullable(),
});
export type AssessmentReportEvidenceIndex = z.infer<typeof evidenceIndexSchema>;

const factIndexSchema = z.strictObject({
  factId: uuidSchema,
  caseRevision: revisionSchema,
  kind: identifierSchema,
  authority: identifierSchema,
  statement: boundedTextSchema,
  evidenceIds: z.array(uuidSchema).max(200),
});
export type AssessmentReportFactIndex = z.infer<typeof factIndexSchema>;

const decisionReferenceSchema = z.strictObject({
  origin: z.enum(ASSESSMENT_REPORT_REFERENCE_ORIGINS),
  reference: ruleDecisionReferenceSchema,
});

const criterionSchema = z.strictObject({
  criterionId: identifierSchema,
  statement: boundedTextSchema,
  outcome: identifierSchema,
  rationale: boundedTextSchema,
  references: z.array(decisionReferenceSchema).min(1).max(200),
});

const boundedNarrativeSchema = z.strictObject({
  summary: boundedTextSchema,
  recommendations: boundedTextListSchema,
});

const criterionDefinitionSchema = z.strictObject({
  criterionId: identifierSchema,
  statement: boundedTextSchema,
});

const ruleDetailSchema = z.strictObject({
  assessmentRuleId: identifierSchema,
  assessmentRuleVersion: identifierSchema,
  legalRequirementIds: z.array(identifierSchema).min(1).max(200),
  concept: boundedTextSchema,
  legalIntent: boundedTextSchema,
  applicabilityGuidance: boundedTextSchema,
  criteria: z.array(criterionDefinitionSchema).min(1).max(200),
  decisionId: uuidSchema,
  decisionRevision: revisionSchema,
  decision: ruleDecisionSchema,
  decisionReferences: z.array(decisionReferenceSchema).min(1).max(200),
  criteriaDecisions: z.array(criterionSchema).max(200),
  narrative: boundedNarrativeSchema,
  factIds: z.array(uuidSchema).max(200),
  evidenceIds: z.array(uuidSchema).max(200),
  sourceRefs: z.array(sourceReferenceSchema).min(1).max(200),
});
export type AssessmentReportRuleDetail = z.infer<typeof ruleDetailSchema>;

const outcomeSummarySchema = z.strictObject({
  totalRules: z.number().int().nonnegative(),
  applicableCompliant: z.number().int().nonnegative(),
  applicableNonCompliant: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
});

const publicationProvenanceSchema = z.strictObject({
  sourceManifestDigest: sha256Schema.nullable(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});

export const assessmentFinalReportV2Schema = z
  .strictObject({
    schemaVersion: z.literal(ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION),
    artifactId: uuidSchema,
    assessmentId: uuidSchema,
    kind: z.literal(ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT),
    identity: z.strictObject({
      repositorySnapshotId: identifierSchema,
      repositoryCommit: commitSchema,
    }),
    pins: z.strictObject({
      legalSourceVersionId: uuidSchema,
      legalSourceVersion: boundedTextSchema,
      ruleSetVersionId: uuidSchema,
      ruleSetVersion: boundedTextSchema,
      ruleSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
      repositorySnapshotId: identifierSchema,
      repositoryScanJobId: identifierSchema,
      repositoryCommit: commitSchema,
    }),
    caseRevision: revisionSchema,
    decisionFingerprint: sha256Schema,
    legalRequirements: z.array(legalRequirementSchema).max(2000),
    ruleDetails: z.array(ruleDetailSchema).min(1).max(2000),
    factIndex: z.array(factIndexSchema).max(5000),
    evidenceIndex: z.array(evidenceIndexSchema).max(5000),
    outcomeSummary: outcomeSummarySchema,
    boundedNarrative: z.strictObject({
      summary: boundedTextSchema,
      actionPlan: boundedTextListSchema,
      scopeLimitations: boundedTextListSchema,
    }),
    publicationProvenance: publicationProvenanceSchema,
  })
  .superRefine((report, context) => {
    if (
      report.identity.repositorySnapshotId !==
        report.pins.repositorySnapshotId ||
      report.identity.repositoryCommit.toLowerCase() !==
        report.pins.repositoryCommit.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["identity"],
        message: "Report identity must match its pinned repository identity",
      });
    }
    const ruleIds = report.ruleDetails.map((rule) => rule.assessmentRuleId);
    if (new Set(ruleIds).size !== ruleIds.length) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails"],
        message: "AssessmentRule IDs must be unique",
      });
    }

    const requirementIds = new Set(
      report.legalRequirements.map(
        (requirement) => requirement.legalRequirementId,
      ),
    );
    if (requirementIds.size !== report.legalRequirements.length) {
      context.addIssue({
        code: "custom",
        path: ["legalRequirements"],
        message: "LegalRequirement IDs must be unique",
      });
    }
    const factIds = new Set(report.factIndex.map((fact) => fact.factId));
    const evidenceIds = new Set(
      report.evidenceIndex.map((evidence) => evidence.evidenceId),
    );
    if (factIds.size !== report.factIndex.length) {
      context.addIssue({
        code: "custom",
        path: ["factIndex"],
        message: "Fact index IDs must be unique",
      });
    }
    if (evidenceIds.size !== report.evidenceIndex.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIndex"],
        message: "Evidence index IDs must be unique",
      });
    }
    for (const rule of report.ruleDetails) {
      for (const requirementId of rule.legalRequirementIds) {
        if (!requirementIds.has(requirementId)) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIds.indexOf(rule.assessmentRuleId),
              "legalRequirementIds",
            ],
            message: `Unknown LegalRequirement ${requirementId}`,
          });
        }
      }
      if (rule.assessmentRuleId !== rule.decision.assessmentRuleId) {
        context.addIssue({
          code: "custom",
          path: [
            "ruleDetails",
            ruleIds.indexOf(rule.assessmentRuleId),
            "decision",
          ],
          message: "Decision rule identity does not match rule detail",
        });
      }
      if (
        rule.decision.ruleSetVersionId !== report.pins.ruleSetVersionId ||
        rule.decision.repositorySnapshotId !==
          report.pins.repositorySnapshotId ||
        rule.decision.repositoryCommit.toLowerCase() !==
          report.pins.repositoryCommit.toLowerCase() ||
        rule.decision.caseRevision !== report.caseRevision
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "ruleDetails",
            ruleIds.indexOf(rule.assessmentRuleId),
            "decision",
          ],
          message: "Decision pins do not match the report pins",
        });
      }
      for (const factId of rule.factIds) {
        if (!factIds.has(factId)) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIds.indexOf(rule.assessmentRuleId),
              "factIds",
            ],
            message: `Unknown fact index entry ${factId}`,
          });
        }
      }
      for (const evidenceId of rule.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIds.indexOf(rule.assessmentRuleId),
              "evidenceIds",
            ],
            message: `Unknown evidence index entry ${evidenceId}`,
          });
        }
      }
      const decision = rule.decision;
      const decisionReferenceKeys = new Set(
        decision.references.map((reference) => JSON.stringify(reference)),
      );
      const referencedFactIds = new Set<string>();
      const referencedEvidenceIds = new Set<string>();
      for (const reference of [
        ...decision.references,
        ...decision.criteria.flatMap((criterion) => criterion.references),
      ]) {
        if (reference.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT) {
          referencedFactIds.add(reference.factId);
        } else {
          referencedEvidenceIds.add(reference.evidenceId);
        }
      }
      if (
        [...referencedFactIds].some(
          (factId) => !rule.factIds.includes(factId),
        ) ||
        [...referencedEvidenceIds].some(
          (evidenceId) => !rule.evidenceIds.includes(evidenceId),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIds.indexOf(rule.assessmentRuleId)],
          message:
            "Per-rule fact/evidence indexes must include accepted decision references",
        });
      }
      if (
        rule.decisionReferences.some(
          (item) =>
            item.origin !== ASSESSMENT_REPORT_REFERENCE_ORIGINS.decision ||
            !decisionReferenceKeys.has(JSON.stringify(item.reference)),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "ruleDetails",
            ruleIds.indexOf(rule.assessmentRuleId),
            "decisionReferences",
          ],
          message:
            "Decision references must mirror accepted decision-level references",
        });
      }
      const acceptedCriteria = new Map(
        decision.criteria.map((criterion) => [
          criterion.criterionId,
          criterion,
        ]),
      );
      for (const criterion of rule.criteriaDecisions) {
        const accepted = acceptedCriteria.get(criterion.criterionId);
        const acceptedReferenceKeys = new Set(
          accepted?.references.map((reference) => JSON.stringify(reference)) ??
            [],
        );
        if (
          !accepted ||
          criterion.references.some(
            (item) =>
              item.origin !== ASSESSMENT_REPORT_REFERENCE_ORIGINS.criterion ||
              !acceptedReferenceKeys.has(JSON.stringify(item.reference)),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIds.indexOf(rule.assessmentRuleId),
              "criteriaDecisions",
            ],
            message:
              "Criterion references must mirror accepted criterion references",
          });
        }
      }
      if (
        decision.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      ) {
        if (
          decision.compliance !== null ||
          decision.criteria.length !== 0 ||
          rule.criteriaDecisions.length !== 0
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIds.indexOf(rule.assessmentRuleId),
              "decision",
            ],
            message: "NOT_APPLICABLE cannot contain compliance criteria",
          });
        }
      } else if (
        new Set(
          rule.criteriaDecisions.map((criterion) => criterion.criterionId),
        ).size !== decision.criteria.length ||
        decision.criteria.some(
          (criterion) =>
            !rule.criteriaDecisions.some(
              (detail) => detail.criterionId === criterion.criterionId,
            ),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "ruleDetails",
            ruleIds.indexOf(rule.assessmentRuleId),
            "criteriaDecisions",
          ],
          message: "Applicable rule criteria must be represented exactly once",
        });
      } else if (
        decision.compliance !== RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT &&
        decision.compliance !== RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "ruleDetails",
            ruleIds.indexOf(rule.assessmentRuleId),
            "decision",
            "compliance",
          ],
          message:
            "Applicable decisions require a supported compliance outcome",
        });
      }
      for (const source of rule.sourceRefs) {
        if (
          source.legalSourceVersionId !== report.pins.legalSourceVersionId ||
          source.legalSourceVersion !== report.pins.legalSourceVersion
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIds.indexOf(rule.assessmentRuleId),
              "sourceRefs",
            ],
            message: "Rule source does not match pinned LegalSourceVersion",
          });
        }
      }
    }

    for (const requirement of report.legalRequirements) {
      for (const source of requirement.sourceRefs) {
        if (
          source.legalSourceVersionId !== report.pins.legalSourceVersionId ||
          source.legalSourceVersion !== report.pins.legalSourceVersion
        ) {
          context.addIssue({
            code: "custom",
            path: ["legalRequirements"],
            message:
              "LegalRequirement source does not match pinned LegalSourceVersion",
          });
        }
      }
    }

    for (const fact of report.factIndex) {
      for (const evidenceId of fact.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: ["factIndex"],
            message: `Unknown fact evidence index entry ${evidenceId}`,
          });
        }
      }
    }

    const counts = report.ruleDetails.reduce(
      (summary, rule) => {
        if (
          rule.decision.applicability ===
          RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
        ) {
          summary.notApplicable += 1;
        } else if (
          rule.decision.compliance ===
          RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
        ) {
          summary.applicableCompliant += 1;
        } else {
          summary.applicableNonCompliant += 1;
        }
        return summary;
      },
      { applicableCompliant: 0, applicableNonCompliant: 0, notApplicable: 0 },
    );
    if (
      report.outcomeSummary.totalRules !== report.ruleDetails.length ||
      report.outcomeSummary.applicableCompliant !==
        counts.applicableCompliant ||
      report.outcomeSummary.applicableNonCompliant !==
        counts.applicableNonCompliant ||
      report.outcomeSummary.notApplicable !== counts.notApplicable
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcomeSummary"],
        message: "Outcome counts do not match accepted rule decisions",
      });
    }
  });

export type AssessmentFinalReportV2 = z.infer<
  typeof assessmentFinalReportV2Schema
>;

export const assessmentFinalReportArtifactVersionedSchema =
  z.discriminatedUnion("schemaVersion", [
    assessmentFinalReportArtifactSchema,
    assessmentFinalReportV2Schema,
  ]);

export type AssessmentFinalReportArtifactVersioned = z.infer<
  typeof assessmentFinalReportArtifactVersionedSchema
>;

export const assessmentReportDecisionReferenceSchema = decisionReferenceSchema;
export const assessmentReportSourceReferenceSchema = sourceReferenceSchema;
export const assessmentReportLegalRequirementSchema = legalRequirementSchema;
export const assessmentReportFactIndexSchema = factIndexSchema;
export const assessmentReportEvidenceIndexSchema = evidenceIndexSchema;
