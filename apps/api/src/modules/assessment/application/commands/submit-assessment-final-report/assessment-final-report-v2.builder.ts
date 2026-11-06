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

/**
 * Business purpose: Safely inspect persisted JSON-shaped rule metadata while projecting a report.
 *
 * Business rules:
 * - Only non-array objects may supply structured metadata; malformed JSON is not interpreted.
 *
 * Execution flow:
 * 1. Check that the value is a non-null object and not an array.
 * 2. Return the object view or null for all other values.
 *
 * Failure cases:
 * - Missing or malformed metadata returns null so optional presentation fields remain absent.
 *
 * Side effects:
 * - None: reads an in-memory value without changing assessment or legal records.
 */
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Business purpose: Accept non-empty text metadata used to link the report to pinned source records.
 *
 * Business rules:
 * - Preserve accepted strings exactly; do not coerce other JSON values into identities or text.
 *
 * Execution flow:
 * 1. Require a string with at least one character.
 * 2. Return the original value or null.
 *
 * Failure cases:
 * - Empty strings and non-string values are omitted from the report projection.
 *
 * Side effects:
 * - None: performs an in-memory shape check only.
 */
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Business purpose: Read legal-source chunk identities declared by a pinned rule contract.
 *
 * Business rules:
 * - Retain only string identities from the stored sourceChunkIds array; do not invent provenance.
 *
 * Execution flow:
 * 1. Inspect the contract object for sourceChunkIds.
 * 2. Return its string members in stored order, or an empty list.
 *
 * Failure cases:
 * - Missing, malformed, or non-array metadata produces no source identities and is rejected by provenance validation when required.
 *
 * Side effects:
 * - None: reads pinned rule metadata without persistence changes.
 */
function sourceChunkIds(contract: unknown): string[] {
  const value = record(contract)?.sourceChunkIds;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Business purpose: Project the rule's declared criteria into the immutable report without adding criteria.
 *
 * Business rules:
 * - Include a criterion only when both its identifier and description are stored as non-empty strings.
 *
 * Execution flow:
 * 1. Read the criteria array from the pinned rule contract.
 * 2. Validate each entry's identity and statement and preserve valid entries in order.
 *
 * Failure cases:
 * - Missing arrays and incomplete entries are omitted; the report schema and completion checks determine whether the resulting report is acceptable.
 *
 * Side effects:
 * - None: creates an in-memory projection of authoritative rule data.
 */
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

/**
 * Business purpose: Expose a repository evidence location only when its path and line range are valid.
 *
 * Business rules:
 * - Only repository-source evidence may produce a locator; line numbers must be positive integers with an ordered range.
 *
 * Execution flow:
 * 1. Confirm the evidence type and payload shape.
 * 2. Validate path and line bounds, then format the stable path-and-range reference.
 *
 * Failure cases:
 * - Unsupported evidence types or malformed locations return null rather than a misleading citation.
 *
 * Side effects:
 * - None: formats the accepted evidence locator in memory.
 */
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

/**
 * Business purpose: Bind a report citation to the pinned legal-source version and source chunk.
 *
 * Business rules:
 * - Preserve source version, document, locator, and content hash from the immutable provenance records.
 * - Copy a non-empty display title only from the pinned LegalSourceDocument metadata for this source version.
 *
 * Execution flow:
 * 1. Combine the pinned source identity with the selected chunk's citation fields.
 * 2. Add the pinned document title when it is available and return the traceable V2 source reference.
 *
 * Failure cases:
 * - Missing required values are rejected by upstream provenance/schema validation rather than replaced.
 *
 * Side effects:
 * - None: constructs an in-memory reference and does not modify legal-source records.
 */
function sourceRef(
  source: { id: string; version: string },
  chunk: {
    documentId: string;
    documentTitle?: string;
    locator: string;
    contentSha256: string;
  },
) {
  return {
    legalSourceVersionId: source.id,
    legalSourceVersion: source.version,
    documentId: chunk.documentId,
    ...(chunk.documentTitle ? { documentTitle: chunk.documentTitle } : {}),
    locator: chunk.locator,
    contentSha256: chunk.contentSha256,
  };
}

/**
 * Business purpose: Preserve whether a report citation came from a rule decision or criterion decision.
 *
 * Business rules:
 * - Assign only the caller-provided authoritative origin and retain every supplied reference in order.
 *
 * Execution flow:
 * 1. Wrap each accepted decision reference with its origin.
 * 2. Return the ordered report references.
 *
 * Failure cases:
 * - Empty input produces an empty list; invalid reference shapes are rejected by report validation.
 *
 * Side effects:
 * - None: creates an in-memory reference projection.
 */
function references(
  items: RuleDecision["references"],
  origin: "DECISION" | "CRITERION",
) {
  return items.map((reference) => ({ origin, reference }));
}

/**
 * Business purpose: Build the immutable V2 report projection from the accepted finalization snapshot and pinned sources.
 *
 * Business rules:
 * - Use only the snapshot's repository and rule-set pins and stored decisions; this builder never evaluates applicability or compliance.
 * - Preserve rule, legal requirement, source, criterion, fact, evidence, and reference identities as stored.
 *
 * Execution flow:
 * 1. Load the pinned rule set, rules, legal requirements, and source provenance.
 * 2. Join accepted decisions and requested narratives to their authoritative rule and reference records.
 * 3. Construct and schema-validate the V2 artifact for the supplied assessment and artifact IDs.
 *
 * Failure cases:
 * - Missing pinned data, inconsistent references, or schema-invalid projections fail report construction; callers map these failures to the final-report contract.
 *
 * Side effects:
 * - Read-only queries through the caller's transaction; no assessment decisions or source records are changed.
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
        select: {
          id: true,
          version: true,
          integrityManifestRef: true,
          documents: { select: { documentId: true, title: true } },
        },
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
  const documentTitleById = new Map(
    source.documents
      .filter((document) => document.title.trim().length > 0)
      .map((document) => [document.documentId, document.title.trim()]),
  );
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
      return sourceRef(source, {
        ...chunk,
        documentTitle: documentTitleById.get(chunk.documentId),
      });
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
    sourceRefs: requirement.provenance.map((ref) =>
      sourceRef(source, {
        ...ref,
        documentTitle: documentTitleById.get(ref.documentId),
      }),
    ),
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
