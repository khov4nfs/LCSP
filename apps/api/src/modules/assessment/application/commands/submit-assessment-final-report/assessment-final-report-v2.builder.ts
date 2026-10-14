import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  ASSESSMENT_RECORD_STATES,
  ASSESSMENT_EVIDENCE_TYPES,
  type SubmitAssessmentFinalReportRequest,
} from "@lcsp/contracts/assessment-domain";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import type { Prisma } from "@prisma/client";

import {
  assessmentFinalReportV2Schema,
  ASSESSMENT_REPORT_REFERENCE_ORIGINS,
  type AssessmentFinalReportV2,
} from "@lcsp/contracts/assessment-report";
import type { AssessmentFinalizationSnapshot } from "../../services/assessment-completion-gate.service.js";
import { decisionFingerprint } from "../../../domain/decision-fingerprint.js";

type Narrative = SubmitAssessmentFinalReportRequest["findings"][number];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sourceChunkIds(contract: unknown): string[] {
  const value = record(contract)?.sourceChunkIds;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function criteria(contract: unknown) {
  const value = record(contract)?.criteria;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const criterionId = stringValue(row?.criterionId);
    const statement = stringValue(row?.statement);
    return criterionId && statement ? [{ criterionId, statement }] : [];
  });
}

function safeLocator(type: string, payload: unknown): string | null {
  const value = record(payload);
  if (type !== ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE || !value) {
    return null;
  }
  const path = stringValue(value.path);
  const startLine = value.startLine;
  const endLine = value.endLine;
  if (
    !path ||
    typeof startLine !== "number" ||
    typeof endLine !== "number" ||
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  ) {
    return null;
  }
  return `${path}:${startLine}-${endLine}`;
}

function sourceRef(
  source: { id: string; version: string },
  chunk: {
    documentId: string;
    locator: string;
    contentSha256: string;
  },
) {
  return {
    legalSourceVersionId: source.id,
    legalSourceVersion: source.version,
    documentId: chunk.documentId,
    locator: chunk.locator,
    contentSha256: chunk.contentSha256,
  };
}

function references(
  items: RuleDecision["references"],
  origin: "DECISION" | "CRITERION",
) {
  return items.map((reference) => ({ origin, reference }));
}

/**
 * Hydrates and projects only the accepted, pinned state needed for the V2
 * artifact. This function performs no legal or compliance reasoning.
 */
export async function buildAssessmentFinalReportV2(input: {
  tx: Prisma.TransactionClient;
  assessmentId: string;
  artifactId: string;
  request: SubmitAssessmentFinalReportRequest;
  snapshot: AssessmentFinalizationSnapshot;
}): Promise<AssessmentFinalReportV2> {
  const { tx, assessmentId, artifactId, request, snapshot } = input;
  const ruleSet = await tx.complianceRuleSetVersion.findUnique({
    where: { id: snapshot.pins.ruleSetVersionId },
    select: {
      id: true,
      version: true,
      ruleSetDigest: true,
      legalSourceVersion: {
        select: { id: true, version: true, integrityManifestRef: true },
      },
    },
  });
  const rules = await tx.assessmentRule.findMany({
    where: { ruleSetVersionId: snapshot.pins.ruleSetVersionId },
    orderBy: { ordinal: "asc" },
    select: {
      assessmentRuleId: true,
      assessmentRuleVersion: true,
      concept: true,
      legalIntent: true,
      applicabilityGuidance: true,
      criteria: true,
      contract: true,
      legalRequirementLinks: { select: { legalRequirementRowId: true } },
    },
  });
  const requirements = await tx.legalRequirement.findMany({
    where: { ruleSetVersionId: snapshot.pins.ruleSetVersionId },
    orderBy: { ordinal: "asc" },
    select: {
      id: true,
      legalRequirementId: true,
      title: true,
      proposition: true,
      applicabilityConditions: true,
      qualifiers: true,
      exceptions: true,
      nonRepositoryDuty: true,
      coverageState: true,
      provenance: {
        orderBy: { ordinal: "asc" },
        select: {
          legalSourceVersionId: true,
          documentId: true,
          locator: true,
          contentSha256: true,
        },
      },
    },
  });

  if (!ruleSet?.legalSourceVersion) {
    throw new Error("Pinned rule-set source is unavailable");
  }
  const source = ruleSet.legalSourceVersion;
  const chunkIds = [
    ...new Set(rules.flatMap((rule) => sourceChunkIds(rule.contract))),
  ];
  const chunks = await tx.legalDocumentChunk.findMany({
    where: {
      legalSourceVersionId: source.id,
      id: { in: chunkIds },
    },
    select: {
      id: true,
      documentId: true,
      locator: true,
      contentSha256: true,
      legalSourceVersionId: true,
      legalStatus: true,
    },
  });
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  const decisionByRule = new Map(
    snapshot.decisions.map((item) => [item.decision.assessmentRuleId, item]),
  );
  const narrativeByRule = new Map(
    request.findings.map((finding) => [finding.assessmentRuleId, finding]),
  );
  const referencedEvidenceIds = new Set<string>();
  const referencedFactIds = new Set<string>();
  for (const item of snapshot.decisions) {
    for (const reference of [
      ...item.decision.references,
      ...item.decision.criteria.flatMap((criterion) => criterion.references),
    ]) {
      if (
        reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
      ) {
        referencedEvidenceIds.add(reference.evidenceId);
      } else {
        referencedFactIds.add(reference.factId);
      }
    }
  }

  const facts = await tx.assessmentCaseFact.findMany({
    where: {
      assessmentId,
      factId: { in: [...referencedFactIds] },
    },
    select: {
      factId: true,
      caseRevision: true,
      kind: true,
      authority: true,
      statement: true,
      evidenceLinks: { select: { evidenceId: true } },
    },
  });
  const allEvidenceIds = new Set(referencedEvidenceIds);
  for (const fact of facts) {
    for (const link of fact.evidenceLinks) allEvidenceIds.add(link.evidenceId);
  }
  const evidence = await tx.assessmentEvidence.findMany({
    where: {
      assessmentId,
      evidenceId: { in: [...allEvidenceIds] },
    },
    select: {
      evidenceId: true,
      type: true,
      state: true,
      repositoryCommit: true,
      contentSha256: true,
      payload: true,
    },
  });
  const allEvidence = evidence.filter((item) =>
    allEvidenceIds.has(item.evidenceId),
  );
  if (
    allEvidence.length !== allEvidenceIds.size ||
    facts.length !== referencedFactIds.size ||
    allEvidence.some((item) => item.state !== ASSESSMENT_RECORD_STATES.ACCEPTED)
  ) {
    throw new Error("Accepted report references could not be reloaded");
  }

  const ruleDetails = rules.map((rule) => {
    const decision = decisionByRule.get(rule.assessmentRuleId);
    const narrative: Narrative | undefined = narrativeByRule.get(
      rule.assessmentRuleId,
    );
    if (!decision || !narrative) {
      throw new Error("Canonical rule coverage and narrative diverged");
    }
    const sourceRefs = sourceChunkIds(rule.contract).map((chunkId) => {
      const chunk = chunkById.get(chunkId);
      if (!chunk || chunk.legalSourceVersionId !== source.id) {
        throw new Error("Rule source chunk could not be verified");
      }
      return sourceRef(source, chunk);
    });
    if (sourceRefs.length === 0) {
      throw new Error("Rule has no verified source references");
    }
    const ruleCriteria = criteria(rule.contract);
    const decisionReferences = references(
      decision.decision.references,
      ASSESSMENT_REPORT_REFERENCE_ORIGINS.decision,
    );
    const criteriaDecisions = decision.decision.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      statement:
        ruleCriteria.find((item) => item.criterionId === criterion.criterionId)
          ?.statement ?? criterion.criterionId,
      outcome: criterion.outcome,
      rationale: criterion.rationale,
      references: references(
        criterion.references,
        ASSESSMENT_REPORT_REFERENCE_ORIGINS.criterion,
      ),
    }));
    const factIds = new Set<string>();
    const evidenceIds = new Set<string>();
    for (const reference of [
      ...decision.decision.references,
      ...decision.decision.criteria.flatMap(
        (criterion) => criterion.references,
      ),
    ]) {
      if (reference.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT) {
        factIds.add(reference.factId);
      } else {
        evidenceIds.add(reference.evidenceId);
      }
    }
    return {
      assessmentRuleId: rule.assessmentRuleId,
      assessmentRuleVersion: rule.assessmentRuleVersion,
      legalRequirementIds: rule.legalRequirementLinks.map(
        (link) =>
          requirements.find(
            (requirement) => requirement.id === link.legalRequirementRowId,
          )?.legalRequirementId ?? link.legalRequirementRowId,
      ),
      concept: rule.concept,
      legalIntent: rule.legalIntent,
      applicabilityGuidance: rule.applicabilityGuidance,
      criteria: ruleCriteria,
      decisionId: decision.decisionId,
      decisionRevision: decision.decisionRevision,
      decision: decision.decision,
      decisionReferences,
      criteriaDecisions,
      narrative: {
        summary: narrative.summary,
        recommendations: narrative.recommendations,
      },
      factIds: [...factIds].sort(),
      evidenceIds: [...evidenceIds].sort(),
      sourceRefs,
    };
  });

  const legalRequirements = requirements.map((requirement) => ({
    legalRequirementId: requirement.legalRequirementId,
    title: requirement.title,
    proposition: requirement.proposition,
    applicabilityConditions: Array.isArray(requirement.applicabilityConditions)
      ? requirement.applicabilityConditions.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    qualifiers: Array.isArray(requirement.qualifiers)
      ? requirement.qualifiers.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    exceptions: Array.isArray(requirement.exceptions)
      ? requirement.exceptions.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    nonRepositoryDuty: requirement.nonRepositoryDuty,
    coverageState: requirement.coverageState,
    sourceRefs: requirement.provenance.map((ref) => sourceRef(source, ref)),
  }));

  const factIndex = [...facts]
    .sort((left, right) => left.factId.localeCompare(right.factId))
    .map((fact) => ({
      factId: fact.factId,
      caseRevision: fact.caseRevision,
      kind: fact.kind,
      authority: fact.authority,
      statement: fact.statement,
      evidenceIds: fact.evidenceLinks.map((link) => link.evidenceId).sort(),
    }));
  const evidenceIndex = [...allEvidence]
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
    .map((item) => {
      const locator = safeLocator(item.type, item.payload);
      if (
        item.type === ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE &&
        !locator
      ) {
        throw new Error(
          "Repository evidence is missing a safe canonical locator",
        );
      }
      return {
        evidenceId: item.evidenceId,
        type: item.type,
        contentSha256: item.contentSha256,
        repositoryCommit: item.repositoryCommit,
        safeLocator: locator,
      };
    });
  const outcomeSummary = ruleDetails.reduce(
    (summary, rule) => {
      if (
        rule.decision.applicability ===
        RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      )
        summary.notApplicable += 1;
      else if (
        rule.decision.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
      )
        summary.applicableCompliant += 1;
      else summary.applicableNonCompliant += 1;
      return summary;
    },
    {
      totalRules: ruleDetails.length,
      applicableCompliant: 0,
      applicableNonCompliant: 0,
      notApplicable: 0,
    },
  );
  const report = {
    schemaVersion: ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
    artifactId,
    assessmentId,
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    identity: {
      repositorySnapshotId: snapshot.pins.repositorySnapshotId,
      repositoryCommit: snapshot.pins.repositoryCommit,
    },
    pins: {
      ...snapshot.pins,
      legalSourceVersionId: source.id,
      legalSourceVersion: source.version,
      ruleSetVersionId: ruleSet.id,
      ruleSetVersion: ruleSet.version,
      ruleSetDigest: ruleSet.ruleSetDigest,
    },
    caseRevision: snapshot.caseRevision,
    // Fingerprints must follow the exact canonical rule order serialized in
    // `ruleDetails` (the persisted rule-set ordinal), not the incidental
    // ordering of the Completion Gate's decision query. This keeps a valid
    // out-of-order decision submission reloadable and replay-safe.
    decisionFingerprint: decisionFingerprint(ruleDetails),
    legalRequirements,
    ruleDetails,
    factIndex,
    evidenceIndex,
    outcomeSummary,
    boundedNarrative: {
      summary: request.summary,
      actionPlan: request.findings.flatMap(
        (finding) => finding.recommendations,
      ),
      scopeLimitations: [],
    },
    publicationProvenance: {
      sourceManifestDigest: null,
      publishedAt: null,
    },
  };
  return assessmentFinalReportV2Schema.parse(report);
}
