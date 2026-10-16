import { RULE_DECISION_COMPLIANCE_OUTCOMES } from "../assessment/agentic-runtime.ts";
import {
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
} from "../assessment-domain/constants.ts";
import type { AssessmentFinalReportArtifact } from "../assessment-domain/schemas.ts";
import type {
  AssessmentFinalReportArtifactVersioned,
  AssessmentFinalReportV2,
} from "./schemas.ts";

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
  AssessmentReportV2Presentation | AssessmentReportV1Presentation;

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
    publicationState: "PUBLISHED";
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
  }>;
  obligationCatalog: Array<{
    assessmentRuleId: string;
    legalRequirementIds: string[];
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
    publicationState: "PUBLISHED";
  };
  sections: AssessmentReportSection[];
  legacy: {
    summary: string;
    findings: AssessmentFinalReportArtifact["findings"];
    ruleSetVersionId: string;
    caseRevision: number;
  };
};

const sections = (): AssessmentReportSection[] => [
  { id: ASSESSMENT_REPORT_SECTION_IDS.result, order: 1 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.applicabilityFacts, order: 2 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.obligationCatalog, order: 3 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.obligationDetails, order: 4 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.actionPlan, order: 5 },
  { id: ASSESSMENT_REPORT_SECTION_IDS.scopeTraceability, order: 6 },
];

export function buildAssessmentReportPresentation(
  artifact: AssessmentFinalReportArtifactVersioned,
): AssessmentReportPresentation {
  if (artifact.schemaVersion === ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION)
    return buildV1Presentation(artifact);
  return buildV2Presentation(artifact);
}

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
      publicationState: "PUBLISHED",
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
      publicationState: "PUBLISHED",
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
    })),
    obligationCatalog: details.map((detail) => ({
      assessmentRuleId: detail.assessmentRuleId,
      legalRequirementIds:
        artifact.ruleDetails.find(
          (rule) => rule.assessmentRuleId === detail.assessmentRuleId,
        )?.legalRequirementIds ?? [],
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
    },
  };
}
