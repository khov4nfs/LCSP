import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { toPrismaEvidenceAcceptanceStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  TARGET_CANDIDATE_KINDS,
  type MissingTargetProposalResponse,
} from "../../contracts/missing-target-proposal.contract.js";
import { ProposeMissingTargetsQuery } from "./propose-missing-targets.query.js";
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
          organizationId: query.organizationId,
        },
        select: { id: true },
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
    if (!wizard || !report)
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const candidates = query.candidateKinds.includes(
      TARGET_CANDIDATE_KINDS.providerUsage,
    )
      ? providers(report.evidencePayload).slice(0, query.maxResults)
      : [];
    const response: MissingTargetProposalResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.proposeMissingTargets,
      tool_version: "1.0.0",
      config_hash: "sha256:target-candidate-v1",
      correlation_id: query.correlationId,
      artifact_versions: {
        wizard_profile_id: wizard.id,
        technical_evidence_report_id: report.id,
      },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: candidates.flatMap((item) => item.evidence_refs),
      limitations: [],
      result: {
        algorithm_version: "target-candidate-v1",
        candidates,
        truncated: false,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.missingTargetProposalRead,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.wizardProfile,
      resourceId: wizard.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: { toolName: response.tool_name },
    });
    return response;
  }
}
function providers(
  payload: unknown,
): MissingTargetProposalResponse["result"]["candidates"] {
  const root = rec(payload);
  const findings = root?.technical_findings;
  if (!Array.isArray(findings)) return [];
  const seen = new Set<string>();
  return findings
    .flatMap((value) => {
      const item = rec(value);
      const provider = item && text(item.provider);
      const id = item && text(item.finding_id);
      if (!provider || !id || seen.has(provider)) return [];
      seen.add(provider);
      return [
        {
          candidate_ref: `candidate:provider:${provider}`,
          kind: TARGET_CANDIDATE_KINDS.providerUsage,
          attributes: { provider },
          score: 1,
          evidence_refs: [`finding:${id}`],
        },
      ];
    })
    .sort((a, b) => a.candidate_ref.localeCompare(b.candidate_ref));
}
function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
