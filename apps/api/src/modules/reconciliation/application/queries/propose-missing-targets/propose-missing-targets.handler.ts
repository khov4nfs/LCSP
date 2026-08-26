import { WIZARD_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  EVIDENCE_ERROR_CODES,
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
  TARGET_CANDIDATE_KINDS,
  TARGET_CANDIDATE_LIMITATION_CODES,
  type MissingTargetCandidate,
  type MissingTargetProposalResponse,
} from "../../contracts/missing-target-proposal.contract.js";
import { ProposeMissingTargetsQuery } from "./propose-missing-targets.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:target-candidate-v1";
const ALGORITHM_VERSION = "target-candidate-v1";
const PROVIDER_SEED_REF_PREFIXES = ["finding:", "invocation:"];

@QueryHandler(ProposeMissingTargetsQuery)
export class ProposeMissingTargetsHandler implements IQueryHandler<
  ProposeMissingTargetsQuery,
  MissingTargetProposalResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(
    query: ProposeMissingTargetsQuery,
  ): Promise<MissingTargetProposalResponse> {
    const [wizard, report] = await Promise.all([
      this.prisma.wizardProfile.findFirst({
        where: {
          id: query.wizardProfileId,
          assessmentId: query.assessmentId,
        },
        select: { id: true, status: true },
      }),
      this.prisma.technicalEvidenceReport.findFirst({
        where: {
          id: query.evidenceReportId,
          assessmentId: query.assessmentId,
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
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const wizardStatus = fromPrismaWizardStatus(wizard.status);
    if (wizardStatus !== WIZARD_STATUS_CODES.submitted) {
      const response = this.buildResponse(
        query,
        wizard.id,
        report.id,
        AGENTIC_TOOL_STATUSES.needsInput,
        AGENTIC_TOOL_COVERAGE_STATES.unavailable,
        [TARGET_CANDIDATE_LIMITATION_CODES.submittedTargetIdsUnavailable],
        [],
        false,
      );

      return this.writeAndReturn(query, wizard.id, response);
    }

    const explicitExcludes = new Set(query.excludeTargetIds);
    const limitations = unsupportedKinds(query.candidateKinds);
    limitations.push(
      TARGET_CANDIDATE_LIMITATION_CODES.submittedTargetIdsUnavailable,
    );

    const providerCandidates = query.candidateKinds.includes(
      TARGET_CANDIDATE_KINDS.providerUsage,
    )
      ? providers(report.evidencePayload, explicitExcludes, query.seedRefs)
      : [];
    const sortedCandidates = providerCandidates
      .sort(compareCandidates)
      .slice(0, query.maxResults);

    const response = this.buildResponse(
      query,
      wizard.id,
      report.id,
      limitations.length > 0
        ? AGENTIC_TOOL_STATUSES.outOfCoverage
        : AGENTIC_TOOL_STATUSES.ready,
      limitations.length > 0
        ? AGENTIC_TOOL_COVERAGE_STATES.partial
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      limitations,
      sortedCandidates,
      providerCandidates.length > query.maxResults,
    );

    return this.writeAndReturn(query, wizard.id, response);
  }

  private buildResponse(
    query: ProposeMissingTargetsQuery,
    wizardId: string,
    reportId: string,
    status: MissingTargetProposalResponse["status"],
    coverageState: MissingTargetProposalResponse["coverage_state"],
    limitations: string[],
    candidates: MissingTargetCandidate[],
    truncated: boolean,
  ): MissingTargetProposalResponse {
    const response: MissingTargetProposalResponse = {
      status,
      tool_name: AGENTIC_TOOL_NAMES.proposeMissingTargets,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlationId: query.correlationId,
      artifact_versions: {
        wizard_profile_id: wizardId,
        technical_evidence_report_id: reportId,
      },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: coverageState,
      evidence_refs: candidates.flatMap((item) => item.evidence_refs),
      limitations,
      result: {
        algorithm_version: ALGORITHM_VERSION,
        candidates,
        truncated,
      },
    };

    return response;
  }

  private async writeAndReturn(
    query: ProposeMissingTargetsQuery,
    wizardId: string,
    response: MissingTargetProposalResponse,
  ): Promise<MissingTargetProposalResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.missingTargetProposalRead,
      actorId: null,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.wizardProfile,
      resourceId: wizardId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        candidateKinds: query.candidateKinds,
        seedRefs: query.seedRefs,
        excludeTargetIds: query.excludeTargetIds,
        candidateCount: response.result.candidates.length,
      },
    });

    return response;
  }
}

function providers(
  payload: unknown,
  explicitExcludes: Set<string>,
  seedRefs: string[],
): MissingTargetCandidate[] {
  const root = rec(payload);
  const findings = root?.technical_findings;
  if (!Array.isArray(findings)) return [];

  const allowedSeedRefs =
    seedRefs.length === 0
      ? null
      : new Set(
          seedRefs.filter((seedRef) =>
            PROVIDER_SEED_REF_PREFIXES.some((prefix) =>
              seedRef.startsWith(prefix),
            ),
          ),
        );
  const seen = new Set<string>();

  return findings.flatMap((value) => {
    const item = rec(value);
    const provider = item && text(item.provider);
    const id = item && text(item.finding_id);
    const findingRef = id ? `finding:${id}` : null;
    if (!provider || !id || !findingRef || seen.has(provider)) return [];
    if (allowedSeedRefs && !allowedSeedRefs.has(findingRef)) return [];

    const targetRef = providerTargetRef(provider);
    if (explicitExcludes.has(targetRef)) return [];

    seen.add(provider);
    return [
      {
        candidate_ref: providerCandidateRef(provider),
        kind: TARGET_CANDIDATE_KINDS.providerUsage,
        target_ref: targetRef,
        attributes: { provider },
        score: 0.91,
        evidence_refs: [findingRef],
      },
    ];
  });
}

function unsupportedKinds(candidateKinds: string[]): string[] {
  return candidateKinds
    .filter((kind) => kind !== TARGET_CANDIDATE_KINDS.providerUsage)
    .map(
      (kind) =>
        `${TARGET_CANDIDATE_LIMITATION_CODES.unsupportedCandidateKind}:${kind}`,
    );
}

function providerCandidateRef(provider: string): string {
  return `candidate:provider_${slug(provider)}`;
}

function providerTargetRef(provider: string): string {
  return `target:provider_${slug(provider)}`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function compareCandidates(
  left: MissingTargetCandidate,
  right: MissingTargetCandidate,
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.candidate_ref.localeCompare(right.candidate_ref);
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
