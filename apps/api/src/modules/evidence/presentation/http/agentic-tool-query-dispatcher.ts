import {
  AGENTIC_TOOL_NAMES,
  ARTIFACT_CHAIN_STAGES,
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import { EvaluateGapMatrixQuery } from "../../../classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.query.js";
import { GetGapEvidenceTraceQuery } from "../../../classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.query.js";
import { GetGapRequirementsQuery } from "../../../classification/application/queries/get-gap-requirements/get-gap-requirements.query.js";
import { GetAdminSourceCatalogQuery } from "../../../legal-rule-catalog/application/queries/get-admin-source-catalog/get-admin-source-catalog.query.js";
import { GetLegalCorpusReadinessQuery } from "../../../legal-rule-catalog/application/queries/get-legal-corpus-readiness/get-legal-corpus-readiness.query.js";
import { RetrieveLegalBasisQuery } from "../../../legal-rule-catalog/application/queries/retrieve-legal-basis/retrieve-legal-basis.query.js";
import { ValidateCitationSetQuery } from "../../../legal-rule-catalog/application/queries/validate-citation-set/validate-citation-set.query.js";
import { RECONCILIATION_CONTEXT_STATUSES } from "../../../reconciliation/application/contracts/reconciliation/reconciliation-context.contract.js";
import { CompareWizardClaimQuery } from "../../../reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.js";
import { GetArtifactChainQuery } from "../../../reconciliation/application/queries/get-artifact-chain/get-artifact-chain.query.js";
import { GetAssessmentContextQuery } from "../../../reconciliation/application/queries/get-assessment-context/get-assessment-context.query.js";
import { GetReconciliationContextQuery } from "../../../reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.query.js";
import {
  parseSingleTargetId,
  parseWizardClaimComparisonScope,
  parseWizardClaimExpectedValue,
  parseWizardClaimField,
  parseWizardClaimMaxEvidenceRefs,
} from "../../../reconciliation/presentation/http/compare-wizard-claim.request.js";

export type AgenticToolQueryDispatchArgs = {
  toolName: string;
  assessmentId: string;
  organizationId: string;
  userId: string;
  correlationId: string;
  artifactVersions: Record<string, unknown>;
  input: Record<string, unknown>;
};

/**
 * Nest owns CQRS reads only. Technical graph traversal/remediation is intentionally
 * absent and executes through Managed Deep Agent tools.
 */
export function buildAgenticToolQuery(args: AgenticToolQueryDispatchArgs) {
  switch (args.toolName) {
    case AGENTIC_TOOL_NAMES.getAssessmentContext:
      return get_assessment_context(args);
    case AGENTIC_TOOL_NAMES.getArtifactChain:
      return get_artifact_chain(args);
    case AGENTIC_TOOL_NAMES.getReconciliationContext:
      return get_reconciliation_context(args);
    case AGENTIC_TOOL_NAMES.compareWizardClaim:
      return compare_wizard_claim(args);
    case AGENTIC_TOOL_NAMES.getGapRequirements:
      return get_gap_requirements(args);
    case AGENTIC_TOOL_NAMES.getGapEvidenceTrace:
      return get_gap_evidence_trace(args);
    case AGENTIC_TOOL_NAMES.evaluateGapMatrix:
      return evaluate_gap_matrix(args);
    case AGENTIC_TOOL_NAMES.getAdminSourceCatalog:
      return get_admin_source_catalog(args);
    case AGENTIC_TOOL_NAMES.getLegalCorpusReadiness:
      return get_legal_corpus_readiness(args);
    case AGENTIC_TOOL_NAMES.retrieveLegalBasis:
      return retrieve_legal_basis(args);
    case AGENTIC_TOOL_NAMES.validateCitationSet:
      return validate_citation_set(args);
    default:
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        args.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
  }
}

export function get_assessment_context(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new GetAssessmentContextQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "wizardProfileId"),
    typedStringArray(input.include, Object.values(ASSESSMENT_CONTEXT_INCLUDES)),
    typedStringArray(
      input.answerFields,
      Object.values(ASSESSMENT_CONTEXT_ANSWER_FIELDS),
    ),
    args.correlationId,
  );
}

export function get_artifact_chain(args: AgenticToolQueryDispatchArgs) {
  const { input } = args;
  return new GetArtifactChainQuery(
    args.assessmentId,
    args.organizationId,
    args.correlationId,
    optionalRecord(input.anchor)
      ? optionalString(optionalRecord(input.anchor)?.artifactRef)
      : null,
    typedStringArray(
      input.requiredStages,
      Object.values(ARTIFACT_CHAIN_STAGES),
    ),
    input.exactVersions === true,
  );
}

export function get_reconciliation_context(args: AgenticToolQueryDispatchArgs) {
  const { input } = args;
  return new GetReconciliationContextQuery(
    args.assessmentId,
    args.organizationId,
    args.correlationId,
    stripOptionalRef(optionalString(input.flowRef), "flow:"),
    stringArray(input.conflictIds).map((value) => stripRef(value, "conflict:")),
    optionalString(input.cursor),
    numberWithDefault(input.maxResults, 25),
    typedStringArray(
      input.statuses,
      Object.values(RECONCILIATION_CONTEXT_STATUSES),
    ),
  );
}

export function compare_wizard_claim(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  const claimField = parseWizardClaimField(
    optionalString(input.claimField) ?? undefined,
    args.correlationId,
  );
  const rawMaxEvidenceRefs =
    typeof input.maxEvidenceRefs === "number"
      ? String(input.maxEvidenceRefs)
      : (optionalString(input.maxEvidenceRefs) ?? undefined);
  return new CompareWizardClaimQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "wizardProfileId"),
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    parseSingleTargetId(requiredString(input.targetId), args.correlationId),
    claimField,
    parseWizardClaimExpectedValue(
      optionalString(input.expectedValue) ?? undefined,
      claimField,
      args.correlationId,
    ),
    parseWizardClaimComparisonScope(
      optionalString(input.comparisonScope) ?? undefined,
      args.correlationId,
    ),
    parseWizardClaimMaxEvidenceRefs(rawMaxEvidenceRefs, args.correlationId),
    args.correlationId,
  );
}

export function get_gap_requirements(args: AgenticToolQueryDispatchArgs) {
  return new GetGapRequirementsQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}
export function get_gap_evidence_trace(args: AgenticToolQueryDispatchArgs) {
  return new GetGapEvidenceTraceQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    args.correlationId,
  );
}
export function evaluate_gap_matrix(args: AgenticToolQueryDispatchArgs) {
  return new EvaluateGapMatrixQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    args.correlationId,
  );
}
export function get_admin_source_catalog(args: AgenticToolQueryDispatchArgs) {
  return new GetAdminSourceCatalogQuery(
    args.assessmentId,
    args.organizationId,
    args.input,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}
export function get_legal_corpus_readiness(args: AgenticToolQueryDispatchArgs) {
  const { input } = args;
  return new GetLegalCorpusReadinessQuery(
    args.assessmentId,
    args.organizationId,
    new Date(`${requiredString(input.effectiveDate)}T00:00:00.000Z`),
    stripOptionalRef(optionalString(input.pinnedCorpusVersionId), "corpus_"),
    args.userId,
    null,
    null,
    args.correlationId,
  );
}
export function retrieve_legal_basis(args: AgenticToolQueryDispatchArgs) {
  return new RetrieveLegalBasisQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}
export function validate_citation_set(args: AgenticToolQueryDispatchArgs) {
  return new ValidateCitationSetQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

function requiredArtifactVersion(
  input: Record<string, unknown>,
  key: string,
): string {
  return requiredString(input[key]);
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function optionalRecord(value: unknown): Record<string, unknown> | null {
  return record(value);
}
function requiredString(value: unknown): string {
  const result = optionalString(value);
  if (!result)
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      { status: HttpStatus.NOT_FOUND },
    );
  return result;
}
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}
function numberWithDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}
function stripRef(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
function stripOptionalRef(value: string | null, prefix: string): string | null {
  return value ? stripRef(value, prefix) : null;
}
function typedStringArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  const values = stringArray(value);
  if (values.length === 0) return [];
  const allowedSet = new Set(allowed);
  if (
    values.some((item) => !allowedSet.has(item as T)) ||
    new Set(values).size !== values.length
  ) {
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      { status: HttpStatus.NOT_FOUND },
    );
  }
  return values as T[];
}
