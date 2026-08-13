import { WIZARD_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  EVIDENCE_ERROR_CODES,
  WIZARD_CLAIM_EXPECTED_VALUES,
  WIZARD_CLAIM_FIELDS,
  WIZARD_CLAIM_VERDICTS,
  type CompareWizardClaimResponse,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaWizardStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  WIZARD_CLAIM_LIMITATION_CODES,
  type WizardClaimExpectedValue,
} from "../../contracts/reconciliation/wizard-claim-comparison.contract.js";
import { CompareWizardClaimQuery } from "./compare-wizard-claim.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:compare-v1";

@QueryHandler(CompareWizardClaimQuery)
export class CompareWizardClaimHandler implements IQueryHandler<
  CompareWizardClaimQuery,
  CompareWizardClaimResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: CompareWizardClaimQuery,
  ): Promise<CompareWizardClaimResponse> {
    const [wizard, report] = await Promise.all([
      this.prisma.wizardProfile.findFirst({
        where: {
          id: query.wizardProfileId,
          assessmentId: query.assessmentId,
          organizationId: query.organizationId,
        },
        select: { id: true, status: true },
      }),
      this.prisma.technicalEvidenceReport.findFirst({
        where: {
          id: query.evidenceReportId,
          assessmentId: query.assessmentId,
          organizationId: query.organizationId,
          status: toPrismaEvidenceAcceptanceStatus(
            TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
          ),
        },
        select: { id: true, evidencePayload: true },
      }),
    ]);

    if (!wizard || !report) {
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const wizardStatus = fromPrismaWizardStatus(wizard.status);
    if (wizardStatus !== WIZARD_STATUS_CODES.submitted) {
      return this.writeAndReturn(
        query,
        wizard.id,
        this.buildResponse(
          query,
          wizard.id,
          report.id,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          [WIZARD_CLAIM_LIMITATION_CODES.profileNotSubmitted],
          WIZARD_CLAIM_VERDICTS.outOfCoverage,
          [],
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          "Wizard profile must be submitted before evidence comparison.",
        ),
      );
    }

    const verdict = compare(query, report.evidencePayload);
    return this.writeAndReturn(
      query,
      wizard.id,
      this.buildResponse(
        query,
        wizard.id,
        report.id,
        verdict.status,
        verdict.coverageState,
        verdict.limitations,
        verdict.verdict,
        verdict.evidenceRefs.slice(0, query.maxEvidenceRefs),
        verdict.coverageState,
        verdict.missingEvidenceExplanation,
        verdict.conflictCandidateRef,
      ),
    );
  }

  private buildResponse(
    query: CompareWizardClaimQuery,
    wizardId: string,
    reportId: string,
    status: CompareWizardClaimResponse["status"],
    coverageState: CompareWizardClaimResponse["coverage_state"],
    limitations: string[],
    verdict: CompareWizardClaimResponse["result"]["verdict"],
    evidenceRefs: string[],
    resultCoverageState: CompareWizardClaimResponse["result"]["coverage_state"],
    missingEvidenceExplanation?: string,
    conflictCandidateRef?: string,
  ): CompareWizardClaimResponse {
    return {
      status,
      tool_name: AGENTIC_TOOL_NAMES.compareWizardClaim,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlationId: query.correlationId,
      artifact_versions: {
        wizard_profile_id: wizardId,
        technical_evidence_report_id: reportId,
      },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: coverageState,
      evidence_refs: evidenceRefs,
      limitations,
      result: {
        verdict,
        compared_attributes: {
          target_ref: query.targetId,
          claim_field: query.claimField,
          expected_value: query.expectedValue,
          comparison_scope: query.comparisonScope,
        },
        evidence_refs: evidenceRefs,
        coverage_state: resultCoverageState,
        ...(missingEvidenceExplanation
          ? { missing_evidence_explanation: missingEvidenceExplanation }
          : {}),
        ...(conflictCandidateRef
          ? { conflict_candidate_ref: conflictCandidateRef }
          : {}),
      },
    };
  }

  private async writeAndReturn(
    query: CompareWizardClaimQuery,
    wizardId: string,
    response: CompareWizardClaimResponse,
  ): Promise<CompareWizardClaimResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.wizardClaimCompared,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.wizardProfile,
      resourceId: wizardId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        targetRef: query.targetId,
        claimField: query.claimField,
        expectedValue: query.expectedValue,
        comparisonScope: query.comparisonScope,
        verdict: response.result.verdict,
      },
    });

    return response;
  }
}

type ComparisonResult = {
  status: CompareWizardClaimResponse["status"];
  coverageState: CompareWizardClaimResponse["coverage_state"];
  verdict: CompareWizardClaimResponse["result"]["verdict"];
  evidenceRefs: string[];
  limitations: string[];
  missingEvidenceExplanation?: string;
  conflictCandidateRef?: string;
};

function compare(
  query: CompareWizardClaimQuery,
  payload: unknown,
): ComparisonResult {
  const evidence = extractEvidence(payload);
  const limitations = evidence.coverageLimited
    ? [WIZARD_CLAIM_LIMITATION_CODES.coverageLimited]
    : [];

  switch (query.claimField) {
    case WIZARD_CLAIM_FIELDS.provider:
      return compareProvider(query, evidence, limitations);
    case WIZARD_CLAIM_FIELDS.aiUsageType:
      return compareAiUsageType(query, evidence, limitations);
    case WIZARD_CLAIM_FIELDS.humanReview:
      return comparePresenceClaim(
        query,
        evidence.humanReviewRefs,
        evidence.reviewCoverageSufficient,
        limitations,
        "No deterministic human-review evidence was found for this scope.",
      );
    case WIZARD_CLAIM_FIELDS.deploymentContext:
      return compareDeployment(query, evidence, limitations);
    case WIZARD_CLAIM_FIELDS.decisionPath:
      return comparePresenceClaim(
        query,
        evidence.decisionRefs,
        evidence.decisionCoverageSufficient,
        limitations,
        "No deterministic decision-path evidence was found for this scope.",
      );
    default:
      return {
        status: AGENTIC_TOOL_STATUSES.outOfCoverage,
        coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
        verdict: WIZARD_CLAIM_VERDICTS.outOfCoverage,
        evidenceRefs: [],
        limitations: [
          ...limitations,
          WIZARD_CLAIM_LIMITATION_CODES.unsupportedClaimField,
        ],
        missingEvidenceExplanation:
          "Unsupported claim field for deterministic comparison.",
      };
  }
}

function compareProvider(
  query: CompareWizardClaimQuery,
  evidence: ExtractedEvidence,
  limitations: string[],
): ComparisonResult {
  const expectedProvider = query.expectedValue;
  const matched = evidence.providerEvidence.find(
    (item) => item.provider === expectedProvider,
  );
  if (matched) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: evidence.coverageState,
      verdict: WIZARD_CLAIM_VERDICTS.supported,
      evidenceRefs: [matched.ref],
      limitations,
    };
  }
  if (evidence.providerEvidence.length > 0) {
    return {
      status: AGENTIC_TOOL_STATUSES.conflict,
      coverageState: evidence.coverageState,
      verdict: WIZARD_CLAIM_VERDICTS.contradicted,
      evidenceRefs: evidence.providerEvidence
        .map((item) => item.ref)
        .slice(0, 3),
      limitations,
      conflictCandidateRef: buildConflictCandidateRef(query),
    };
  }
  if (!evidence.coverageLimited) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      verdict: WIZARD_CLAIM_VERDICTS.notFound,
      evidenceRefs: [],
      limitations,
      missingEvidenceExplanation:
        "Evidence search completed without a provider invocation for the requested value.",
    };
  }
  return {
    status: AGENTIC_TOOL_STATUSES.outOfCoverage,
    coverageState: AGENTIC_TOOL_COVERAGE_STATES.partial,
    verdict: WIZARD_CLAIM_VERDICTS.outOfCoverage,
    evidenceRefs: [],
    limitations,
    missingEvidenceExplanation:
      "Provider comparison could not be closed because evidence coverage is limited.",
  };
}

function compareAiUsageType(
  query: CompareWizardClaimQuery,
  evidence: ExtractedEvidence,
  limitations: string[],
): ComparisonResult {
  if (query.expectedValue !== WIZARD_CLAIM_EXPECTED_VALUES.providerApi) {
    return {
      status: AGENTIC_TOOL_STATUSES.outOfCoverage,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      verdict: WIZARD_CLAIM_VERDICTS.outOfCoverage,
      evidenceRefs: [],
      limitations: [
        ...limitations,
        WIZARD_CLAIM_LIMITATION_CODES.unsupportedClaimField,
      ],
      missingEvidenceExplanation:
        "Only PROVIDER_API is currently supported for AI usage type comparison.",
    };
  }
  if (
    evidence.providerEvidence.length > 0 ||
    evidence.modelInvocationRefs.length > 0
  ) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: evidence.coverageState,
      verdict: WIZARD_CLAIM_VERDICTS.supported,
      evidenceRefs: [
        ...evidence.providerEvidence.map((item) => item.ref),
        ...evidence.modelInvocationRefs,
      ].slice(0, 3),
      limitations,
    };
  }
  if (!evidence.coverageLimited) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      verdict: WIZARD_CLAIM_VERDICTS.notFound,
      evidenceRefs: [],
      limitations,
      missingEvidenceExplanation:
        "No provider-backed AI invocation evidence was found in the pinned report.",
    };
  }
  return {
    status: AGENTIC_TOOL_STATUSES.outOfCoverage,
    coverageState: AGENTIC_TOOL_COVERAGE_STATES.partial,
    verdict: WIZARD_CLAIM_VERDICTS.outOfCoverage,
    evidenceRefs: [],
    limitations,
    missingEvidenceExplanation:
      "AI usage type comparison remains limited because scanner coverage is incomplete.",
  };
}

function comparePresenceClaim(
  query: CompareWizardClaimQuery,
  refs: string[],
  coverageSufficient: boolean,
  limitations: string[],
  notFoundMessage: string,
): ComparisonResult {
  if (refs.length > 0) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: coverageSufficient
        ? AGENTIC_TOOL_COVERAGE_STATES.sufficient
        : AGENTIC_TOOL_COVERAGE_STATES.partial,
      verdict: WIZARD_CLAIM_VERDICTS.supported,
      evidenceRefs: refs.slice(0, query.maxEvidenceRefs),
      limitations,
    };
  }
  if (coverageSufficient) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      verdict: WIZARD_CLAIM_VERDICTS.notFound,
      evidenceRefs: [],
      limitations,
      missingEvidenceExplanation: notFoundMessage,
    };
  }
  return {
    status: AGENTIC_TOOL_STATUSES.outOfCoverage,
    coverageState: AGENTIC_TOOL_COVERAGE_STATES.partial,
    verdict: WIZARD_CLAIM_VERDICTS.outOfCoverage,
    evidenceRefs: [],
    limitations,
    missingEvidenceExplanation:
      "Coverage limitations prevent a deterministic verdict for this claim.",
  };
}

function compareDeployment(
  query: CompareWizardClaimQuery,
  evidence: ExtractedEvidence,
  limitations: string[],
): ComparisonResult {
  const matched = evidence.deploymentContexts.find(
    (item) => item.environment === query.expectedValue,
  );
  if (matched) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: evidence.coverageState,
      verdict: WIZARD_CLAIM_VERDICTS.supported,
      evidenceRefs: matched.evidenceRefs.slice(0, query.maxEvidenceRefs),
      limitations,
    };
  }
  if (evidence.deploymentContexts.length > 0) {
    return {
      status: AGENTIC_TOOL_STATUSES.conflict,
      coverageState: evidence.coverageState,
      verdict: WIZARD_CLAIM_VERDICTS.contradicted,
      evidenceRefs: evidence.deploymentContexts
        .flatMap((item) => item.evidenceRefs)
        .slice(0, query.maxEvidenceRefs),
      limitations,
      conflictCandidateRef: buildConflictCandidateRef(query),
    };
  }
  if (!evidence.coverageLimited) {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      verdict: WIZARD_CLAIM_VERDICTS.notFound,
      evidenceRefs: [],
      limitations,
      missingEvidenceExplanation:
        "No deployment-context evidence was found for the requested environment.",
    };
  }
  return {
    status: AGENTIC_TOOL_STATUSES.outOfCoverage,
    coverageState: AGENTIC_TOOL_COVERAGE_STATES.partial,
    verdict: WIZARD_CLAIM_VERDICTS.outOfCoverage,
    evidenceRefs: [],
    limitations,
    missingEvidenceExplanation:
      "Deployment comparison remains out of coverage because deployment evidence is partial.",
  };
}

type ExtractedEvidence = {
  coverageLimited: boolean;
  coverageState: CompareWizardClaimResponse["coverage_state"];
  reviewCoverageSufficient: boolean;
  decisionCoverageSufficient: boolean;
  providerEvidence: Array<{ provider: WizardClaimExpectedValue; ref: string }>;
  modelInvocationRefs: string[];
  humanReviewRefs: string[];
  decisionRefs: string[];
  deploymentContexts: Array<{
    environment: string;
    evidenceRefs: string[];
  }>;
};

function extractEvidence(payload: unknown): ExtractedEvidence {
  const root = asRecord(payload);
  const technicalFindings = Array.isArray(root?.technical_findings)
    ? root.technical_findings.filter(isRecord)
    : [];
  const providerEvidence = technicalFindings.flatMap((finding) => {
    const provider = providerValue(finding);
    const findingId = text(finding.finding_id);
    if (!provider || !findingId) return [];
    return [{ provider, ref: `finding:${findingId}` }];
  });
  const modelInvocationRefs = technicalFindings.flatMap((finding) => {
    const type = text(finding.finding_type);
    const findingId = text(finding.finding_id);
    if (!type || !findingId || !type.includes("MODEL_INVOCATION")) return [];
    return [`finding:${findingId}`];
  });

  const evidenceGraph = asRecord(root?.evidence_graph);
  const nodes = Array.isArray(evidenceGraph?.nodes)
    ? evidenceGraph.nodes.filter(isRecord)
    : [];
  const humanReviewRefs = nodes
    .filter((node) => text(node.node_type) === "HUMAN_REVIEW_STEP")
    .flatMap((node) => refs(node.evidence_refs));
  const decisionRefs = nodes
    .filter((node) => text(node.node_type) === "DECISION_RULE")
    .flatMap((node) => refs(node.evidence_refs));
  const deploymentContexts = Array.isArray(root?.deployment_contexts)
    ? root.deployment_contexts.filter(isRecord).flatMap((item) => {
        const environment = text(item.environment);
        if (
          environment !== WIZARD_CLAIM_EXPECTED_VALUES.production &&
          environment !== "DEVELOPMENT" &&
          environment !== "TEST" &&
          environment !== "STAGING" &&
          environment !== "UNKNOWN"
        ) {
          return [];
        }
        return [
          {
            environment: environment,
            evidenceRefs: refs(item.evidence_refs),
          },
        ];
      })
    : [];

  const coverageNotes = Array.isArray(root?.coverage_notes)
    ? root.coverage_notes
    : [];
  const coverageLimited = coverageNotes.length > 0;

  return {
    coverageLimited,
    coverageState: coverageLimited
      ? AGENTIC_TOOL_COVERAGE_STATES.partial
      : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    reviewCoverageSufficient:
      text(evidenceGraph?.review_coverage_state) === "SUFFICIENT",
    decisionCoverageSufficient:
      text(evidenceGraph?.decision_coverage_state) === "SUFFICIENT",
    providerEvidence,
    modelInvocationRefs,
    humanReviewRefs,
    decisionRefs,
    deploymentContexts,
  };
}

function providerValue(
  finding: Record<string, unknown>,
): WizardClaimExpectedValue | null {
  const explicit = text(finding.provider)?.toUpperCase();
  if (explicit === WIZARD_CLAIM_EXPECTED_VALUES.openai) {
    return WIZARD_CLAIM_EXPECTED_VALUES.openai;
  }
  if (explicit === WIZARD_CLAIM_EXPECTED_VALUES.google) {
    return WIZARD_CLAIM_EXPECTED_VALUES.google;
  }
  if (explicit === WIZARD_CLAIM_EXPECTED_VALUES.anthropic) {
    return WIZARD_CLAIM_EXPECTED_VALUES.anthropic;
  }

  const library = text(finding.library_group)?.toUpperCase();
  if (!library) return null;
  if (library.includes("OPENAI")) return WIZARD_CLAIM_EXPECTED_VALUES.openai;
  if (library.includes("GOOGLE") || library.includes("GEMINI")) {
    return WIZARD_CLAIM_EXPECTED_VALUES.google;
  }
  if (library.includes("ANTHROPIC")) {
    return WIZARD_CLAIM_EXPECTED_VALUES.anthropic;
  }
  return null;
}

function buildConflictCandidateRef(query: CompareWizardClaimQuery): string {
  return `conflict-candidate:${query.targetId}:${query.claimField}:${query.expectedValue}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
