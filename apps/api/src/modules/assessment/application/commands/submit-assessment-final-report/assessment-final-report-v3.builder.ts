import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DOMAIN_LIMITS,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  ASSESSMENT_RECORD_STATES,
  SEARCH_COVERAGE_SCOPE_KINDS,
  searchCoverageEvidenceRequestSchema,
  type SubmitAssessmentFinalReportRequest,
} from "@lcsp/contracts/assessment-domain";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import type { LegalContextRelationKind } from "@lcsp/contracts/compliance-rule-set";
import {
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_LIMITS,
  ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS,
  assessmentFinalReportV3Schema,
  searchCoverageRecordSchemaV3,
  type AssessmentFinalReportV3,
  type AssessmentReportActionPriority,
  type AssessmentReportSourceVisibilityLimitationReason,
  type AssessmentReportSourceVisibilityState,
  type SearchCoverageRecordV3,
} from "@lcsp/contracts/assessment-report";
import { RepositoryScanJobStatus, type Prisma } from "@prisma/client";

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
 * - Pure function; reads an in-memory value without state or persistence modifications.
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
 * - Pure function; performs an in-memory shape check only.
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
 * - Pure function; reads pinned rule metadata without persistence changes.
 */
function sourceChunkIds(contract: unknown): string[] {
  const value = record(contract)?.sourceChunkIds;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Business purpose: Project the rule's declared criteria statements into the immutable V3 report catalog.
 *
 * Business rules:
 * - Include a criterion only when both its identifier and description are stored as non-empty strings.
 *
 * Execution flow:
 * 1. Read the criteria array from the pinned rule contract.
 * 2. Validate each entry's identity and statement and preserve valid entries in order.
 *
 * Failure cases:
 * - Missing arrays and incomplete entries are omitted; the report schema determines whether the resulting report is acceptable.
 *
 * Side effects:
 * - Pure function; creates an in-memory projection of authoritative rule data.
 */
function criteria(
  contract: unknown,
): Array<{ criterionId: string; statement: string }> {
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
 * Business purpose: Expose a repository evidence location only when its path and line range are valid and bounded.
 *
 * Business rules:
 * - Only repository-source evidence may produce a locator; line numbers must be positive integers with an ordered range within MAX_LINE_SPAN.
 *
 * Execution flow:
 * 1. Confirm the evidence type and payload shape.
 * 2. Validate path, line bounds, and maximum line span limits, then format the stable path-and-range reference.
 *
 * Failure cases:
 * - Unsupported evidence types, malformed locations, or out-of-span ranges return null rather than a misleading citation.
 *
 * Side effects:
 * - Pure function; formats the accepted evidence locator in memory.
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
    endLine < startLine ||
    endLine - startLine >= ASSESSMENT_DOMAIN_LIMITS.MAX_LINE_SPAN
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
 * 2. Add the pinned document title when it is available and return the traceable source reference.
 *
 * Failure cases:
 * - Missing required values are rejected by upstream provenance/schema validation rather than replaced.
 *
 * Side effects:
 * - Pure function; constructs an in-memory reference and does not modify legal-source records.
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
 * Business purpose: Parse and enforce platform scan completeness verification for SEARCH_COVERAGE evidence records in V3 reports.
 *
 * Business rules:
 * - Derive executed queries, inspected entry points, truncated queries, known gaps, and direct fallback counts from the evidence payload.
 * - Enforce the P1-05/P1-06 scan completeness gate: verifiedCompleteness is true ONLY when platform scan job completed cleanly without blockers, truncated queries count is 0, known gaps count is 0, and meaningful search activity exists (at least one query or entry point).
 * - Agent self-reported completeness cannot elevate verifiedCompleteness without an authoritative platform scan completion.
 *
 * Execution flow:
 * 1. Attempt parsing the payload as a structured SearchCoverageRecordV3 or raw searchCoverageEvidenceRequestSchema.
 * 2. Extract query, entry point, gap, and fallback counts.
 * 3. Enforce the scan completeness gate conjunction.
 * 4. Return the normalized SearchCoverageRecordV3 projection, or null if unparseable.
 *
 * Failure cases:
 * - Malformed payloads return null so callers omit invalid searchCoverage metadata.
 *
 * Side effects:
 * - Pure function; computes normalized coverage metadata in memory.
 */
function parseSearchCoverageRecord(
  payload: unknown,
  platformScanSuccess: boolean,
): SearchCoverageRecordV3 | null {
  const obj = record(payload);
  if (!obj) return null;

  const structured = searchCoverageRecordSchemaV3.safeParse(obj);
  if (structured.success) {
    const data = structured.data;
    const verifiedCompleteness =
      platformScanSuccess &&
      data.verifiedCompleteness &&
      data.truncatedQueriesCount === 0 &&
      data.knownGapsCount === 0 &&
      (data.executedQueriesCount >= 1 || data.inspectedEntryPointsCount >= 1);
    return {
      ...data,
      verifiedCompleteness,
    };
  }

  const raw =
    searchCoverageEvidenceRequestSchema.safeParse(obj).data ??
    searchCoverageEvidenceRequestSchema
      .omit({ type: true, repositoryCommit: true })
      .safeParse(obj).data;
  if (!raw) return null;

  const executedQueriesCount = raw.queries.length;
  const inspectedEntryPointsCount = raw.inspectedEntryPoints.length;
  const truncatedQueriesCount = raw.queries.filter((q) => q.truncated).length;
  const knownGapsCount = raw.knownGaps.length;
  const directFallbackCount = raw.directSourceFallbacks.length;

  const verifiedCompleteness =
    platformScanSuccess &&
    truncatedQueriesCount === 0 &&
    knownGapsCount === 0 &&
    (executedQueriesCount >= 1 || inspectedEntryPointsCount >= 1);

  return {
    scopes: raw.scopes.map((scope) => ({
      kind: scope.kind,
      path: scope.path,
    })),
    executedQueriesCount,
    inspectedEntryPointsCount,
    truncatedQueriesCount,
    knownGapsCount,
    directFallbackCount,
    verifiedCompleteness,
  };
}

export interface BuildAssessmentFinalReportV3Input {
  tx: Prisma.TransactionClient;
  assessmentId: string;
  artifactId: string;
  request: SubmitAssessmentFinalReportRequest;
  snapshot: AssessmentFinalizationSnapshot;
}

/**
 * Business purpose: Construct the canonical, schema-valid V3 Assessment Final Report artifact from accepted decisions, authoritative pins, source scope, and rule-set relations.
 *
 * Business rules:
 * - P1-01: Bind pins.sourcePathPrefix and sourceScope directly to the authoritative repository snapshot.
 * - P1-02: Criteria statements are defined on ruleDetails[].criteria only; criteriaDecisions contains only criterionId, outcome, rationale, and references.
 * - P1-03: Bounded action plan items are derived from rule recommendations via deterministic indexing and priorities; no independently authored action summaries.
 * - P1-04: Related legal contexts are derived strictly from pinned rule-set relations (LegalRequirementContextRelation with toRuleId != null).
 * - P1-05/P1-06: KNOWN_FULL visibility is gated on verified platform scan completeness with zero truncations/gaps and root directory coverage. Otherwise, visibility remains KNOWN_LIMITED.
 *
 * Execution flow:
 * 1. Load pinned rule set, legal source documents, repository snapshot, and scan job status.
 * 2. Load rules, legal requirements, source chunks, and related legal context relations.
 * 3. Load accepted facts, evidence, and search coverage records; verify all cited items exist and are accepted.
 * 4. Project rules, criteria decisions, applicability basis references, and fact-to-evidence transitive closures.
 * 5. Determine sourceScope mode, visibility, exclusions, and limitations.
 * 6. Derive the bounded action plan highlights from rule recommendations.
 * 7. Assemble the complete V3 report structure and validate against assessmentFinalReportV3Schema.
 *
 * Failure cases:
 * - Missing pinned source records, unaccepted evidence, divergent coverage, or invalid schema structure throw an error.
 *
 * Side effects:
 * - Read-only queries against the database transaction; produces an in-memory validated V3 report artifact without mutating persistence.
 */
export async function buildAssessmentFinalReportV3(
  input: BuildAssessmentFinalReportV3Input,
): Promise<AssessmentFinalReportV3> {
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

  if (!ruleSet?.legalSourceVersion) {
    throw new Error("Pinned rule-set source is unavailable");
  }
  const source = ruleSet.legalSourceVersion;
  const documentTitleById = new Map(
    source.documents
      .filter((document) => document.title.trim().length > 0)
      .map((document) => [document.documentId, document.title.trim()]),
  );

  const snapshotRecord = tx.repositorySnapshot
    ? await tx.repositorySnapshot.findUnique({
        where: { id: snapshot.pins.repositorySnapshotId },
        select: {
          id: true,
          sourcePathPrefix: true,
        },
      })
    : null;
  const pinnedPrefix = snapshotRecord?.sourcePathPrefix ?? null;

  const scanJob = tx.repositoryScanJob
    ? await tx.repositoryScanJob.findUnique({
        where: { id: snapshot.pins.repositoryScanJobId },
        select: {
          id: true,
          status: true,
          blockedReason: true,
        },
      })
    : null;
  const platformScanSuccess =
    scanJob !== null &&
    scanJob.status === RepositoryScanJobStatus.COMPLETED &&
    !scanJob.blockedReason;

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
  const requirementById = new Map(requirements.map((r) => [r.id, r]));

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

  const contextRelations = tx.legalRequirementContextRelation
    ? await tx.legalRequirementContextRelation.findMany({
        where: {
          ruleSetVersionId: snapshot.pins.ruleSetVersionId,
          toRuleId: { not: null },
        },
        orderBy: { ordinal: "asc" },
        select: {
          id: true,
          relationId: true,
          kind: true,
          fromRuleId: true,
          toRuleId: true,
          toChunkId: true,
          ordinal: true,
        },
      })
    : [];

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
      ...(item.decision.applicabilityBasis ?? []).flatMap(
        (basis) => basis.references,
      ),
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
  const factById = new Map(facts.map((fact) => [fact.factId, fact]));

  const allEvidenceIds = new Set(referencedEvidenceIds);
  for (const fact of facts) {
    for (const link of fact.evidenceLinks) allEvidenceIds.add(link.evidenceId);
  }

  const searchCoverageEvidence = await tx.assessmentEvidence.findMany({
    where: {
      assessmentId,
      type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
      state: ASSESSMENT_RECORD_STATES.ACCEPTED,
      repositoryCommit: snapshot.pins.repositoryCommit,
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
  for (const sc of searchCoverageEvidence) {
    allEvidenceIds.add(sc.evidenceId);
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
      const searchCoverage =
        item.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE
          ? parseSearchCoverageRecord(item.payload, platformScanSuccess)
          : null;
      return {
        evidenceId: item.evidenceId,
        type: item.type,
        contentSha256: item.contentSha256,
        repositoryCommit: item.repositoryCommit,
        safeLocator: locator,
        ...(searchCoverage !== null ? { searchCoverage } : {}),
      };
    });

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
    const decisionReferences = decision.decision.references.map(
      (reference) => ({
        origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.decision,
        reference,
      }),
    );
    const criteriaDecisions = decision.decision.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      outcome: criterion.outcome,
      rationale: criterion.rationale,
      references: criterion.references.map((reference) => ({
        origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.criterion,
        reference,
      })),
    }));

    const applicabilityBasisReferences = (
      decision.decision.applicabilityBasis ?? []
    ).flatMap((basisEntry) =>
      basisEntry.references.map((reference) => ({
        origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.applicabilityBasis,
        legalRequirementId: basisEntry.legalRequirementId,
        kind: basisEntry.kind,
        index: basisEntry.index,
        reference,
      })),
    );

    const factIds = new Set<string>();
    const directEvidenceIds = new Set<string>();
    for (const reference of [
      ...decision.decision.references,
      ...decision.decision.criteria.flatMap(
        (criterion) => criterion.references,
      ),
      ...(decision.decision.applicabilityBasis ?? []).flatMap(
        (basis) => basis.references,
      ),
    ]) {
      if (reference.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT) {
        factIds.add(reference.factId);
      } else {
        directEvidenceIds.add(reference.evidenceId);
      }
    }

    const sortedFactIds = [...factIds].sort();
    const factEvidenceReferences = sortedFactIds.flatMap((factId) => {
      const fact = factById.get(factId);
      if (!fact) return [];
      return fact.evidenceLinks.map((link) => ({
        origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.factEvidence,
        factId,
        reference: {
          type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
          evidenceId: link.evidenceId,
        },
      }));
    });

    const allRuleEvidenceIds = new Set(directEvidenceIds);
    for (const ref of factEvidenceReferences) {
      allRuleEvidenceIds.add(ref.reference.evidenceId);
    }
    const sortedEvidenceIds = [...allRuleEvidenceIds].sort();

    const linkedRowIds = new Set(
      rule.legalRequirementLinks.map((link) => link.legalRequirementRowId),
    );
    const seenRelationIds = new Set<string>();
    const seenRelationTuples = new Set<string>();
    const relatedLegalContexts: Array<{
      relationId: string;
      kind: LegalContextRelationKind;
      fromLegalRequirementId: string;
      toLegalRequirementId: string;
      sourceRefs: Array<ReturnType<typeof sourceRef>>;
    }> = [];

    for (const relation of contextRelations) {
      if (!linkedRowIds.has(relation.fromRuleId) || !relation.toRuleId) {
        continue;
      }
      const fromReq = requirementById.get(relation.fromRuleId);
      const toReq = requirementById.get(relation.toRuleId);
      if (!fromReq || !toReq) continue;

      const tuple = `${fromReq.legalRequirementId}:${toReq.legalRequirementId}:${relation.kind}`;
      if (
        seenRelationIds.has(relation.relationId) ||
        seenRelationTuples.has(tuple)
      ) {
        continue;
      }

      const relSourceRefs: Array<ReturnType<typeof sourceRef>> = [];
      if (relation.toChunkId) {
        const chunk = chunkById.get(relation.toChunkId);
        if (chunk && chunk.legalSourceVersionId === source.id) {
          relSourceRefs.push(
            sourceRef(source, {
              ...chunk,
              documentTitle: documentTitleById.get(chunk.documentId),
            }),
          );
        }
      }
      if (relSourceRefs.length === 0 && toReq.provenance.length > 0) {
        for (const prov of toReq.provenance) {
          relSourceRefs.push(
            sourceRef(source, {
              ...prov,
              documentTitle: documentTitleById.get(prov.documentId),
            }),
          );
        }
      }
      if (relSourceRefs.length === 0) continue;

      seenRelationIds.add(relation.relationId);
      seenRelationTuples.add(tuple);
      relatedLegalContexts.push({
        relationId: relation.relationId,
        kind: relation.kind,
        fromLegalRequirementId: fromReq.legalRequirementId,
        toLegalRequirementId: toReq.legalRequirementId,
        sourceRefs: relSourceRefs,
      });
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
      relatedLegalContexts,
      concept: rule.concept,
      legalIntent: rule.legalIntent,
      applicabilityGuidance: rule.applicabilityGuidance,
      criteria: ruleCriteria,
      decisionId: decision.decisionId,
      decisionRevision: decision.decisionRevision,
      decision: decision.decision,
      decisionReferences,
      applicabilityBasisReferences,
      factEvidenceReferences,
      criteriaDecisions,
      narrative: {
        summary: narrative.summary,
        recommendations: narrative.recommendations,
      },
      factIds: sortedFactIds,
      evidenceIds: sortedEvidenceIds,
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

  const mode =
    pinnedPrefix !== null
      ? ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE
      : ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.WHOLE_REPOSITORY;

  const searchCoverageItems = evidenceIndex.filter(
    (
      item,
    ): item is typeof item & {
      searchCoverage: NonNullable<typeof item.searchCoverage>;
    } =>
      item.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE &&
      item.searchCoverage !== null &&
      item.searchCoverage !== undefined,
  );
  const searchCoverageEvidenceIds = searchCoverageItems.map(
    (item) => item.evidenceId,
  );

  const expectedRoot = pinnedPrefix === null ? "." : pinnedPrefix;
  const hasVerifiedRootCoverage =
    searchCoverageItems.length > 0 &&
    searchCoverageItems.every(
      (entry) =>
        entry.searchCoverage.verifiedCompleteness &&
        entry.searchCoverage.truncatedQueriesCount === 0 &&
        entry.searchCoverage.knownGapsCount === 0 &&
        (entry.searchCoverage.executedQueriesCount >= 1 ||
          entry.searchCoverage.inspectedEntryPointsCount >= 1),
    ) &&
    searchCoverageItems.some((entry) =>
      entry.searchCoverage.scopes.some(
        (scope) =>
          scope.kind === SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY &&
          scope.path === expectedRoot,
      ),
    );

  let visibility: AssessmentReportSourceVisibilityState;
  const limitationReasons: AssessmentReportSourceVisibilityLimitationReason[] =
    [];

  if (hasVerifiedRootCoverage) {
    visibility = ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL;
  } else {
    visibility = ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED;
    if (
      searchCoverageItems.some(
        (item) => item.searchCoverage.truncatedQueriesCount > 0,
      )
    ) {
      limitationReasons.push(
        ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.SEARCH_TRUNCATED,
      );
    }
    limitationReasons.push(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
    );
  }

  const sourceScope = {
    mode,
    visibility,
    sourcePathPrefix: pinnedPrefix,
    excludedPaths: [],
    limitationReasons,
    searchCoverageEvidenceIds,
  };

  const allHighlightItems: Array<{
    actionId: string;
    assessmentRuleId: string;
    ruleDetailRef: string;
    recommendationIndex: number;
    priority: AssessmentReportActionPriority;
  }> = [];

  for (const [ruleIndex, rule] of ruleDetails.entries()) {
    const priority =
      rule.decision.compliance ===
      RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
        ? ASSESSMENT_REPORT_ACTION_PRIORITIES.HIGH
        : ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW;

    for (const [recIndex] of rule.narrative.recommendations.entries()) {
      allHighlightItems.push({
        actionId: `${rule.assessmentRuleId}#${recIndex}`,
        assessmentRuleId: rule.assessmentRuleId,
        ruleDetailRef: `/ruleDetails/${ruleIndex}`,
        recommendationIndex: recIndex,
        priority,
      });
    }
  }

  const totalRecommendations = allHighlightItems.length;
  const maxHighlightItems =
    ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS;
  const includedCount = Math.min(totalRecommendations, maxHighlightItems);
  const omittedCount = Math.max(0, totalRecommendations - maxHighlightItems);
  const truncated = totalRecommendations > maxHighlightItems;
  const boundedActionPlan = {
    maxHighlightItems,
    totalRecommendations,
    omittedCount,
    truncated,
    items: allHighlightItems.slice(0, includedCount),
  };

  const outcomeSummary = ruleDetails.reduce(
    (summary, rule) => {
      if (
        rule.decision.applicability ===
        RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      ) {
        summary.notApplicable += 1;
      } else if (
        rule.decision.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
      ) {
        summary.applicableCompliant += 1;
      } else {
        summary.applicableNonCompliant += 1;
      }
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
    schemaVersion: ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
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
      sourcePathPrefix: pinnedPrefix,
    },
    caseRevision: snapshot.caseRevision,
    decisionFingerprint: decisionFingerprint(ruleDetails),
    sourceScope,
    legalRequirements,
    ruleDetails,
    factIndex,
    evidenceIndex,
    outcomeSummary,
    boundedNarrative: {
      summary: request.summary,
      scopeLimitations: sourceScope.limitationReasons,
    },
    boundedActionPlan,
    publicationProvenance: {
      sourceManifestDigest: null,
      publishedAt: null,
    },
  };

  return assessmentFinalReportV3Schema.parse(report);
}
