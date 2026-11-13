import { RULE_DECISION_COMPLIANCE_OUTCOMES } from "../assessment/agentic-runtime.ts";
import {
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
} from "../assessment-domain/constants.ts";
import type { AssessmentFinalReportArtifact } from "../assessment-domain/schemas.ts";
import type {
  AssessmentFinalReportArtifactVersioned,
  AssessmentFinalReportV2,
} from "./schemas.ts";
import {
  ASSESSMENT_REPORT_PUBLICATION_STATES,
  type AssessmentReportActionPriority,
} from "./constants.ts";
import {
  resolveV3BoundedActionPlanItems,
  type AssessmentFinalReportV3,
} from "./v3-schemas.ts";

export const ASSESSMENT_REPORT_SECTION_IDS = {
  result: "RESULT",
  applicabilityFacts: "APPLICABILITY_FACTS",
  obligationCatalog: "OBLIGATION_CATALOG",
  obligationDetails: "OBLIGATION_DETAILS",
  actionPlan: "ACTION_PLAN",
  scopeTraceability: "SCOPE_TRACEABILITY",
} as const;
export type AssessmentReportSectionId =
  (typeof ASSESSMENT_REPORT_SECTION_IDS)[keyof typeof ASSESSMENT_REPORT_SECTION_IDS];

export const ASSESSMENT_REPORT_OUTCOME_LABELS = {
  applicableCompliant: "APPLICABLE_COMPLIANT",
  applicableNonCompliant: "APPLICABLE_NON_COMPLIANT",
  notApplicable: "NOT_APPLICABLE",
} as const;

export type AssessmentReportPresentation =
  | AssessmentReportV1Presentation
  | AssessmentReportV2Presentation
  | AssessmentReportV3Presentation;

export type AssessmentReportSection = {
  id: AssessmentReportSectionId;
  order: number;
};

export type AssessmentReportV2Presentation = {
  version:
    | typeof ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION
    | typeof ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION;
  header: {
    assessmentId: string;
    artifactId: string;
    schemaVersion: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
    legalSourceVersionId: string;
    legalSourceVersion: string;
    ruleSetVersionId: string;
    ruleSetVersion: string;
    publicationState: typeof ASSESSMENT_REPORT_PUBLICATION_STATES.published;
  };
  sections: AssessmentReportSection[];
  summary: {
    totalRules: number;
    applicableCompliant: number;
    applicableNonCompliant: number;
    notApplicable: number;
    statement: "NO_NON_COMPLIANT_FINDINGS" | "NON_COMPLIANT_FINDINGS_PRESENT";
    priorityIssues: Array<{
      assessmentRuleId: string;
      obligation: string;
      issue: string;
      action: string;
    }>;
  };
  applicabilityFacts: Array<{
    assessmentRuleId: string;
    conditions: string[];
    acceptedFactIds: string[];
    acceptedEvidenceIds: string[];
    facts: Array<{
      factId: string;
      statement: string;
      authority: string;
      evidenceIds: string[];
    }>;
    evidence: Array<{
      evidenceId: string;
      type: string;
      safeLocator: string | null;
      contentSha256: string;
    }>;
  }>;
  obligationCatalog: Array<{
    assessmentRuleId: string;
    legalRequirementIds: string[];
    legalRequirements: Array<{
      id: string;
      title: string;
      proposition: string;
    }>;
    applicability: string;
    compliance: string | null;
  }>;
  obligationDetails: Array<{
    assessmentRuleId: string;
    legalRequirements: Array<{
      id: string;
      title: string;
      proposition: string;
    }>;
    conditions: string[];
    qualifiers: string[];
    exceptions: string[];
    applicabilityGuidance: string;
    observedFactIds: string[];
    evidenceIds: string[];
    observedFacts: Array<{
      factId: string;
      statement: string;
      authority: string;
      evidenceIds: string[];
    }>;
    evidence: Array<{
      evidenceId: string;
      type: string;
      safeLocator: string | null;
      contentSha256: string;
    }>;
    concept: string;
    legalIntent: string;
    applicability: string;
    compliance: string | null;
    rationale: string;
    legalReferences: AssessmentFinalReportV2["ruleDetails"][number]["sourceRefs"];
    decisionReferences: AssessmentFinalReportV2["ruleDetails"][number]["decisionReferences"];
    criterionDecisions: AssessmentFinalReportV2["ruleDetails"][number]["criteriaDecisions"];
    recommendations: string[];
  }>;
  actionPlan: Array<{
    assessmentRuleId: string;
    obligation: string;
    actions: string[];
  }>;
  scopeTraceability: {
    assessmentId: string;
    artifactId: string;
    schemaVersion: string;
    caseRevision: number;
    legalSourceVersionId: string;
    legalSourceVersion: string;
    ruleSetVersionId: string;
    ruleSetVersion: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
    legalRequirementIds: string[];
    assessmentRuleIds: string[];
    factIds: string[];
    evidenceIds: string[];
    scopeLimitations: string[];
  };
};

export type AssessmentReportV1Presentation = {
  version: typeof ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION;
  header: {
    assessmentId: string;
    artifactId: string;
    schemaVersion: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
    publicationState: typeof ASSESSMENT_REPORT_PUBLICATION_STATES.published;
  };
  sections: AssessmentReportSection[];
  legacy: {
    summary: string;
    findings: AssessmentFinalReportArtifact["findings"];
    ruleSetVersionId: string;
    caseRevision: number;
  };
};

export type AssessmentReportV3Presentation = {
  version: typeof ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION;
  header: {
    assessmentId: string;
    artifactId: string;
    schemaVersion: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
    legalSourceVersionId: string;
    legalSourceVersion: string;
    ruleSetVersionId: string;
    ruleSetVersion: string;
    publicationState: typeof ASSESSMENT_REPORT_PUBLICATION_STATES.published;
    sourceScope: AssessmentFinalReportV3["sourceScope"];
  };
  sections: AssessmentReportSection[];
  summary: {
    totalRules: number;
    applicableCompliant: number;
    applicableNonCompliant: number;
    notApplicable: number;
    statement: "NO_NON_COMPLIANT_FINDINGS" | "NON_COMPLIANT_FINDINGS_PRESENT";
    priorityIssues: Array<{
      assessmentRuleId: string;
      obligation: string;
      issue: string;
      action: string;
    }>;
  };
  applicabilityFacts: Array<{
    assessmentRuleId: string;
    conditions: string[];
    acceptedFactIds: string[];
    acceptedEvidenceIds: string[];
    facts: Array<{
      factId: string;
      statement: string;
      authority: string;
      evidenceIds: string[];
    }>;
    evidence: Array<{
      evidenceId: string;
      type: string;
      safeLocator: string | null;
      contentSha256: string;
    }>;
    applicabilityBasisReferences: AssessmentFinalReportV3["ruleDetails"][number]["applicabilityBasisReferences"];
  }>;
  obligationCatalog: Array<{
    assessmentRuleId: string;
    legalRequirementIds: string[];
    legalRequirements: Array<{
      id: string;
      title: string;
      proposition: string;
    }>;
    relatedLegalContexts: AssessmentFinalReportV3["ruleDetails"][number]["relatedLegalContexts"];
    applicability: string;
    compliance: string | null;
  }>;
  obligationDetails: Array<{
    assessmentRuleId: string;
    assessmentRuleVersion: string;
    legalRequirements: Array<{
      id: string;
      title: string;
      proposition: string;
    }>;
    relatedLegalContexts: AssessmentFinalReportV3["ruleDetails"][number]["relatedLegalContexts"];
    conditions: string[];
    qualifiers: string[];
    exceptions: string[];
    applicabilityGuidance: string;
    observedFactIds: string[];
    evidenceIds: string[];
    observedFacts: Array<{
      factId: string;
      statement: string;
      authority: string;
      evidenceIds: string[];
    }>;
    evidence: Array<{
      evidenceId: string;
      type: string;
      safeLocator: string | null;
      contentSha256: string;
    }>;
    concept: string;
    legalIntent: string;
    applicability: string;
    compliance: string | null;
    rationale: string;
    legalReferences: AssessmentFinalReportV3["ruleDetails"][number]["sourceRefs"];
    decisionReferences: AssessmentFinalReportV3["ruleDetails"][number]["decisionReferences"];
    applicabilityBasisReferences: AssessmentFinalReportV3["ruleDetails"][number]["applicabilityBasisReferences"];
    factEvidenceReferences: AssessmentFinalReportV3["ruleDetails"][number]["factEvidenceReferences"];
    criterionDecisions: AssessmentFinalReportV3["ruleDetails"][number]["criteriaDecisions"];
    recommendations: string[];
  }>;
  actionPlan: Array<{
    actionId: string;
    assessmentRuleId: string;
    obligation: string;
    priority: AssessmentReportActionPriority;
    action: string;
    ruleDetailRef: string;
    recommendationIndex: number;
  }>;
  scopeTraceability: {
    assessmentId: string;
    artifactId: string;
    schemaVersion: string;
    caseRevision: number;
    legalSourceVersionId: string;
    legalSourceVersion: string;
    ruleSetVersionId: string;
    ruleSetVersion: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
    sourceScope: AssessmentFinalReportV3["sourceScope"];
    legalRequirementIds: string[];
    assessmentRuleIds: string[];
    factIds: string[];
    evidenceIds: string[];
    scopeLimitations: string[];
  };
};

/**
 * Business purpose: Keep the customer-facing V1 and V2 report sections in the shared canonical order.
 *
 * Business rules:
 * - Emit each contracted section exactly once and retain its stable section identity and order.
 *
 * Execution flow:
 * 1. Construct the six section descriptors from the shared section constants.
 * 2. Return a fresh ordered list for the presentation projection.
 *
 * Failure cases:
 * - No external input is evaluated; section identity changes require the shared contract constants to be updated with consumers.
 *
 * Side effects:
 * - None: returns an in-memory section list.
 */
const sections = (): AssessmentReportSection[] => [
  { id: ASSESSMENT_REPORT_SECTION_IDS.result, order: 1 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.applicabilityFacts, order: 2 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.obligationCatalog, order: 3 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.obligationDetails, order: 4 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.actionPlan, order: 5 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.scopeTraceability, order: 6 },
];

export function buildAssessmentReportPresentation(
  artifact: AssessmentFinalReportArtifact,
): AssessmentReportV1Presentation;
export function buildAssessmentReportPresentation(
  artifact: AssessmentFinalReportV2,
): AssessmentReportV2Presentation;
export function buildAssessmentReportPresentation(
  artifact: AssessmentFinalReportV3,
): AssessmentReportV3Presentation;
export function buildAssessmentReportPresentation(
  artifact: AssessmentFinalReportArtifactVersioned,
): AssessmentReportPresentation;
/**
 * Business purpose: Project an immutable versioned report artifact into the shape consumed by customer presentation surfaces.
 *
 * Business rules:
 * - Select the matching V1, V2, or V3 projection from the artifact schema version; never recalculate accepted decisions.
 *
 * Execution flow:
 * 1. Inspect the versioned artifact discriminator.
 * 2. Dispatch to the version-specific presentation projection.
 *
 * Failure cases:
 * - The versioned contract restricts accepted inputs to V1, V2, or V3; unknown runtime versions throw an explicit error.
 *
 * Side effects:
 * - None: creates a presentation model without changing the source artifact.
 */
export function buildAssessmentReportPresentation(
  artifact: AssessmentFinalReportArtifactVersioned,
): AssessmentReportPresentation {
  if (artifact.schemaVersion === ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION)
    return buildV1Presentation(artifact);
  if (artifact.schemaVersion === ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION)
    return buildV2Presentation(artifact);
  if (artifact.schemaVersion === ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION)
    return buildV3Presentation(artifact);
  throw new Error(
    `Unsupported report schema version: ${(artifact as { schemaVersion?: string }).schemaVersion}`,
  );
}

/**
 * Business purpose: Preserve the existing V1 artifact's accepted report content for legacy presentation clients.
 *
 * Business rules:
 * - Keep the V1 assessment, artifact, repository pin, publication state, summary, findings, and revision as stored.
 *
 * Execution flow:
 * 1. Copy V1 header and pin values into the presentation model.
 * 2. Attach the canonical report sections and legacy content projection.
 *
 * Failure cases:
 * - Invalid V1 artifacts are rejected by the versioned contract before this projection is used.
 *
 * Side effects:
 * - None: constructs an in-memory backward-compatible presentation model.
 */
function buildV1Presentation(
  artifact: AssessmentFinalReportArtifact,
): AssessmentReportV1Presentation {
  return {
    version: artifact.schemaVersion,
    header: {
      assessmentId: artifact.assessmentId,
      artifactId: artifact.artifactId,
      schemaVersion: artifact.schemaVersion,
      repositorySnapshotId: artifact.pins.repositorySnapshotId,
      repositoryCommit: artifact.pins.repositoryCommit,
      publicationState: ASSESSMENT_REPORT_PUBLICATION_STATES.published,
    },
    sections: sections(),
    legacy: {
      summary: artifact.summary,
      findings: artifact.findings,
      ruleSetVersionId: artifact.pins.ruleSetVersionId,
      caseRevision: artifact.caseRevision,
    },
  };
}

/**
 * Business purpose: Present the immutable V2 report with explicit links among accepted rules, legal requirements, criteria, facts, and evidence.
 *
 * Business rules:
 * - Resolve references only against the report's own indexes and preserve stored rule decisions, pins, source references, narratives, and outcomes.
 * - Missing linked index entries are omitted rather than fabricated; no compliance decision is recomputed.
 *
 * Execution flow:
 * 1. Index the V2 legal requirements, facts, and evidence by their authoritative identities.
 * 2. Project each rule detail with only its linked requirements and referenced facts/evidence.
 * 3. Derive report counts and sections from the supplied artifact and return the V2 presentation model.
 *
 * Failure cases:
 * - A schema-invalid artifact must be rejected before projection; unresolved references remain absent for validation/reporting rather than being guessed.
 *
 * Side effects:
 * - None: returns a read-only in-memory projection of the V2 artifact.
 */
function buildV2Presentation(
  artifact: AssessmentFinalReportV2,
): AssessmentReportV2Presentation {
  const requirements = new Map(
    artifact.legalRequirements.map((requirement) => [
      requirement.legalRequirementId,
      requirement,
    ]),
  );
  const facts = new Map(artifact.factIndex.map((fact) => [fact.factId, fact]));
  const evidence = new Set(
    artifact.evidenceIndex.map((item) => item.evidenceId),
  );
  const details = artifact.ruleDetails.map((rule) => {
    const linkedRequirements = rule.legalRequirementIds
      .map((id) => requirements.get(id))
      .filter(
        (item): item is AssessmentFinalReportV2["legalRequirements"][number] =>
          Boolean(item),
      );
    const rationale = rule.decision.rationale;
    const conditions = linkedRequirements.flatMap(
      (item) => item.applicabilityConditions,
    );
    const factIds = rule.factIds.filter((id) => facts.has(id));
    const evidenceIds = rule.evidenceIds.filter((id) => evidence.has(id));
    const observedFacts = factIds
      .map((id) => facts.get(id))
      .filter((item): item is AssessmentFinalReportV2["factIndex"][number] =>
        Boolean(item),
      );
    const evidenceDetails = evidenceIds
      .map((id) =>
        artifact.evidenceIndex.find((item) => item.evidenceId === id),
      )
      .filter(
        (item): item is AssessmentFinalReportV2["evidenceIndex"][number] =>
          Boolean(item),
      )
      .map((item) => ({
        evidenceId: item.evidenceId,
        type: item.type,
        safeLocator: item.safeLocator ?? null,
        contentSha256: item.contentSha256,
      }));
    return {
      assessmentRuleId: rule.assessmentRuleId,
      legalRequirements: linkedRequirements.map((item) => ({
        id: item.legalRequirementId,
        title: item.title,
        proposition: item.proposition,
      })),
      conditions,
      qualifiers: linkedRequirements.flatMap((item) => item.qualifiers),
      exceptions: linkedRequirements.flatMap((item) => item.exceptions),
      applicabilityGuidance: rule.applicabilityGuidance,
      observedFactIds: factIds,
      evidenceIds,
      observedFacts,
      evidence: evidenceDetails,
      concept: rule.concept,
      legalIntent: rule.legalIntent,
      applicability: rule.decision.applicability,
      compliance: rule.decision.compliance,
      rationale,
      legalReferences: rule.sourceRefs,
      decisionReferences: rule.decisionReferences,
      criterionDecisions: rule.criteriaDecisions,
      recommendations: rule.narrative.recommendations,
    };
  });
  const priorityIssues = details
    .filter(
      (detail) =>
        detail.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    )
    .map((detail) => ({
      assessmentRuleId: detail.assessmentRuleId,
      obligation: detail.legalRequirements.map((item) => item.title).join("; "),
      issue: detail.rationale,
      action: detail.recommendations.join("; "),
    }));
  return {
    version: artifact.schemaVersion,
    header: {
      assessmentId: artifact.assessmentId,
      artifactId: artifact.artifactId,
      schemaVersion: artifact.schemaVersion,
      repositorySnapshotId: artifact.pins.repositorySnapshotId,
      repositoryCommit: artifact.pins.repositoryCommit,
      legalSourceVersionId: artifact.pins.legalSourceVersionId,
      legalSourceVersion: artifact.pins.legalSourceVersion,
      ruleSetVersionId: artifact.pins.ruleSetVersionId,
      ruleSetVersion: artifact.pins.ruleSetVersion,
      publicationState: ASSESSMENT_REPORT_PUBLICATION_STATES.published,
    },
    sections: sections(),
    summary: {
      ...artifact.outcomeSummary,
      statement:
        artifact.outcomeSummary.applicableNonCompliant === 0
          ? "NO_NON_COMPLIANT_FINDINGS"
          : "NON_COMPLIANT_FINDINGS_PRESENT",
      priorityIssues,
    },
    applicabilityFacts: details.map((detail) => ({
      assessmentRuleId: detail.assessmentRuleId,
      conditions: detail.conditions,
      acceptedFactIds: detail.observedFactIds,
      acceptedEvidenceIds: detail.evidenceIds,
      facts: detail.observedFacts,
      evidence: detail.evidence,
    })),
    obligationCatalog: details.map((detail) => ({
      assessmentRuleId: detail.assessmentRuleId,
      legalRequirementIds:
        artifact.ruleDetails.find(
          (rule) => rule.assessmentRuleId === detail.assessmentRuleId,
        )?.legalRequirementIds ?? [],
      legalRequirements: detail.legalRequirements,
      applicability: detail.applicability,
      compliance: detail.compliance,
    })),
    obligationDetails: details,
    actionPlan: details
      .filter((detail) => detail.recommendations.length > 0)
      .map((detail) => ({
        assessmentRuleId: detail.assessmentRuleId,
        obligation: detail.legalRequirements
          .map((item) => item.title)
          .join("; "),
        actions: detail.recommendations,
      })),
    scopeTraceability: {
      assessmentId: artifact.assessmentId,
      artifactId: artifact.artifactId,
      schemaVersion: artifact.schemaVersion,
      caseRevision: artifact.caseRevision,
      legalSourceVersionId: artifact.pins.legalSourceVersionId,
      legalSourceVersion: artifact.pins.legalSourceVersion,
      ruleSetVersionId: artifact.pins.ruleSetVersionId,
      ruleSetVersion: artifact.pins.ruleSetVersion,
      repositorySnapshotId: artifact.pins.repositorySnapshotId,
      repositoryCommit: artifact.pins.repositoryCommit,
      legalRequirementIds: artifact.legalRequirements.map(
        (item) => item.legalRequirementId,
      ),
      assessmentRuleIds: details.map((item) => item.assessmentRuleId),
      factIds: artifact.factIndex.map((item) => item.factId),
      evidenceIds: artifact.evidenceIndex.map((item) => item.evidenceId),
      scopeLimitations: artifact.boundedNarrative.scopeLimitations,
    },
  };
}

/**
 * Business purpose: Present the immutable V3 report with canonical source scope, applicability-basis references, and bounded action plans.
 *
 * Business rules:
 * - Preserve accepted decisions, canonical outcomes, authoritative snapshot path prefix, and structured source scope.
 * - Derive action plan recommendations via resolveV3BoundedActionPlanItems; never mutate or synthesize verdicts.
 *
 * Execution flow:
 * 1. Index V3 legal requirements, fact entries, and evidence entries by their canonical identifiers.
 * 2. Project each rule detail with linked obligations, related legal contexts, basis references, and criteria decisions.
 * 3. Resolve bounded action plan items to obtain verbatim recommendation text from referenced rules.
 * 4. Return the type-safe V3 presentation model.
 *
 * Failure cases:
 * - Unresolvable action plan references or malformed input throw without corrupting historical projections.
 *
 * Side effects:
 * - None: returns an in-memory presentation projection.
 */
function buildV3Presentation(
  artifact: AssessmentFinalReportV3,
): AssessmentReportV3Presentation {
  const requirements = new Map(
    artifact.legalRequirements.map((requirement) => [
      requirement.legalRequirementId,
      requirement,
    ]),
  );
  const facts = new Map(artifact.factIndex.map((fact) => [fact.factId, fact]));
  const evidence = new Map(
    artifact.evidenceIndex.map((item) => [item.evidenceId, item]),
  );
  const details = artifact.ruleDetails.map((rule) => {
    const linkedRequirements = rule.legalRequirementIds
      .map((id) => requirements.get(id))
      .filter(
        (item): item is AssessmentFinalReportV3["legalRequirements"][number] =>
          Boolean(item),
      );
    const conditions = linkedRequirements.flatMap(
      (item) => item.applicabilityConditions,
    );
    const observedFactIds = Array.from(
      new Set([
        ...rule.applicabilityBasisReferences
          .map((ref) =>
            "factId" in ref.reference ? ref.reference.factId : undefined,
          )
          .filter((id): id is string => Boolean(id)),
        ...rule.factEvidenceReferences.map((ref) => ref.factId),
      ]),
    ).filter((id) => facts.has(id));
    const evidenceIds = Array.from(
      new Set(
        rule.factEvidenceReferences.map((ref) => ref.reference.evidenceId),
      ),
    ).filter((id) => evidence.has(id));
    const observedFacts = observedFactIds
      .map((id) => facts.get(id)!)
      .filter(Boolean);
    const evidenceDetails = evidenceIds
      .map((id) => evidence.get(id)!)
      .filter(Boolean)
      .map((item) => ({
        evidenceId: item.evidenceId,
        type: item.type,
        safeLocator: item.safeLocator ?? null,
        contentSha256: item.contentSha256,
      }));

    return {
      assessmentRuleId: rule.assessmentRuleId,
      assessmentRuleVersion: rule.assessmentRuleVersion,
      legalRequirements: linkedRequirements.map((item) => ({
        id: item.legalRequirementId,
        title: item.title,
        proposition: item.proposition,
      })),
      relatedLegalContexts: rule.relatedLegalContexts,
      conditions,
      qualifiers: linkedRequirements.flatMap((item) => item.qualifiers),
      exceptions: linkedRequirements.flatMap((item) => item.exceptions),
      applicabilityGuidance: rule.applicabilityGuidance,
      observedFactIds,
      evidenceIds,
      observedFacts,
      evidence: evidenceDetails,
      concept: rule.concept,
      legalIntent: rule.legalIntent,
      applicability: rule.decision.applicability,
      compliance: rule.decision.compliance,
      rationale: rule.decision.rationale,
      legalReferences: rule.sourceRefs,
      decisionReferences: rule.decisionReferences,
      applicabilityBasisReferences: rule.applicabilityBasisReferences,
      factEvidenceReferences: rule.factEvidenceReferences,
      criterionDecisions: rule.criteriaDecisions,
      recommendations: rule.narrative.recommendations,
    };
  });

  const priorityIssues = details
    .filter(
      (detail) =>
        detail.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    )
    .map((detail) => ({
      assessmentRuleId: detail.assessmentRuleId,
      obligation: detail.legalRequirements.map((item) => item.title).join("; "),
      issue: detail.rationale,
      action: detail.recommendations.join("; "),
    }));

  const resolvedActionPlanItems = resolveV3BoundedActionPlanItems(artifact);
  const actionPlan = resolvedActionPlanItems.map((item) => {
    const detail = details.find(
      (d) => d.assessmentRuleId === item.assessmentRuleId,
    );
    const obligation =
      detail?.legalRequirements.map((req) => req.title).join("; ") ??
      item.assessmentRuleId;
    return {
      actionId: item.actionId,
      assessmentRuleId: item.assessmentRuleId,
      obligation,
      priority: item.priority,
      action: item.recommendation,
      ruleDetailRef: item.ruleDetailRef,
      recommendationIndex: item.recommendationIndex,
    };
  });

  return {
    version: artifact.schemaVersion,
    header: {
      assessmentId: artifact.assessmentId,
      artifactId: artifact.artifactId,
      schemaVersion: artifact.schemaVersion,
      repositorySnapshotId: artifact.pins.repositorySnapshotId,
      repositoryCommit: artifact.pins.repositoryCommit,
      sourcePathPrefix: artifact.pins.sourcePathPrefix,
      legalSourceVersionId: artifact.pins.legalSourceVersionId,
      legalSourceVersion: artifact.pins.legalSourceVersion,
      ruleSetVersionId: artifact.pins.ruleSetVersionId,
      ruleSetVersion: artifact.pins.ruleSetVersion,
      publicationState: ASSESSMENT_REPORT_PUBLICATION_STATES.published,
      sourceScope: artifact.sourceScope,
    },
    sections: sections(),
    summary: {
      ...artifact.outcomeSummary,
      statement:
        artifact.outcomeSummary.applicableNonCompliant === 0
          ? "NO_NON_COMPLIANT_FINDINGS"
          : "NON_COMPLIANT_FINDINGS_PRESENT",
      priorityIssues,
    },
    applicabilityFacts: details.map((detail) => ({
      assessmentRuleId: detail.assessmentRuleId,
      conditions: detail.conditions,
      acceptedFactIds: detail.observedFactIds,
      acceptedEvidenceIds: detail.evidenceIds,
      facts: detail.observedFacts,
      evidence: detail.evidence,
      applicabilityBasisReferences: detail.applicabilityBasisReferences,
    })),
    obligationCatalog: details.map((detail) => ({
      assessmentRuleId: detail.assessmentRuleId,
      legalRequirementIds:
        artifact.ruleDetails.find(
          (rule) => rule.assessmentRuleId === detail.assessmentRuleId,
        )?.legalRequirementIds ?? [],
      legalRequirements: detail.legalRequirements,
      relatedLegalContexts: detail.relatedLegalContexts,
      applicability: detail.applicability,
      compliance: detail.compliance,
    })),
    obligationDetails: details,
    actionPlan,
    scopeTraceability: {
      assessmentId: artifact.assessmentId,
      artifactId: artifact.artifactId,
      schemaVersion: artifact.schemaVersion,
      caseRevision: artifact.caseRevision,
      legalSourceVersionId: artifact.pins.legalSourceVersionId,
      legalSourceVersion: artifact.pins.legalSourceVersion,
      ruleSetVersionId: artifact.pins.ruleSetVersionId,
      ruleSetVersion: artifact.pins.ruleSetVersion,
      repositorySnapshotId: artifact.pins.repositorySnapshotId,
      repositoryCommit: artifact.pins.repositoryCommit,
      sourcePathPrefix: artifact.pins.sourcePathPrefix,
      sourceScope: artifact.sourceScope,
      legalRequirementIds: artifact.legalRequirements.map(
        (item) => item.legalRequirementId,
      ),
      assessmentRuleIds: details.map((item) => item.assessmentRuleId),
      factIds: artifact.factIndex.map((item) => item.factId),
      evidenceIds: artifact.evidenceIndex.map((item) => item.evidenceId),
      scopeLimitations: artifact.boundedNarrative.scopeLimitations,
    },
  };
}
